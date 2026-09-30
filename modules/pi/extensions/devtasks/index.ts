/**
 * pi-devtasks — supervised local dev processes for a pi session.
 *
 * Prefers the devd daemon (one permanent page, tasks survive pi, all repos
 * aggregated); falls back to an in-process server when the daemon is
 * unavailable. Declares tasks per repo in .pi/dev.json.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ConfigError, loadConfig, type DevConfig } from "./config.ts";
import { createDaemonClient, ensureDaemon, type DaemonClient } from "./daemon-client.ts";
import { daemonUrl } from "./daemon-paths.ts";
import { createManager, type TaskSnapshot, type Transition } from "./manager.ts";
import { startServer } from "./server.ts";

interface Backend {
  kind: "daemon" | "local";
  start(task: string): Promise<TaskSnapshot>;
  stop(task: string): Promise<TaskSnapshot>;
  restart(task: string): Promise<TaskSnapshot>;
  status(task?: string): Promise<TaskSnapshot[]>;
  logs(task: string, lines: number): Promise<{ lines: string[]; logFile: string }>;
  pageUrl?: string;
  close(): Promise<void>;
}

const TRANSITION_KIND: Record<string, Transition["kind"] | undefined> = {
  ready: "ready",
  failed: "failed",
  exited: "exited",
  stopped: "stopped",
};

export default function devtasksExtension(pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;
  let backend: Backend | undefined;
  let lastSnapshots: TaskSnapshot[] = [];
  const pending = new Map<string, Transition>();
  const suppressedTasks = new Set<string>();
  let flushTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;

  function requireBackend(): Backend {
    if (!backend) {
      const cwd = activeCtx?.cwd ?? process.cwd();
      throw new Error(`pi-devtasks: no .pi/dev.json found in ${cwd}; create one to declare dev tasks.`);
    }
    return backend;
  }

  function textResult(text: string, details?: unknown) {
    return { content: [{ type: "text" as const, text }], details };
  }

  function formatSnapshot(snapshot: TaskSnapshot): string {
    const bits = [`${snapshot.name}: ${snapshot.state}`];
    if (snapshot.pid) bits.push(`pid ${snapshot.pid}`);
    if (snapshot.port) bits.push(`port ${snapshot.port}`);
    if (snapshot.readyReason) bits.push(snapshot.readyReason);
    return bits.join(" — ");
  }

  function describeTransition(transition: Transition): string {
    const snapshot = transition.snapshot;
    switch (transition.kind) {
      case "ready":
        return `dev task "${transition.task}" is ready (${snapshot.readyReason ?? "ready"}).`;
      case "failed":
        return `dev task "${transition.task}" failed: ${snapshot.readyReason ?? "unknown"}. Logs: ${snapshot.logFile}`;
      case "exited":
        return `dev task "${transition.task}" exited (${snapshot.readyReason ?? "exit"}). Logs: ${snapshot.logFile}`;
      case "stopped":
        return `dev task "${transition.task}" stopped.`;
    }
  }

  async function updateStatus(): Promise<void> {
    if (!activeCtx?.hasUI || !backend) return;
    try {
      lastSnapshots = await backend.status();
    } catch {
      return;
    }
    const running = lastSnapshots.filter((snapshot) => snapshot.state !== "stopped");
    if (running.length === 0) {
      activeCtx.ui.setStatus("pi-devtasks", undefined);
      return;
    }
    activeCtx.ui.setStatus("pi-devtasks", running.map((snapshot) => `${snapshot.name}:${snapshot.state}`).join(" "));
  }

  function flush(): void {
    flushTimer = undefined;
    if (!activeCtx || !activeCtx.isIdle() || pending.size === 0) return;
    const items = [...pending.values()];
    pending.clear();
    // No triggerTurn: a dev-process transition is a note, not a reason to spend
    // a model turn on its own.
    pi.sendMessage({ customType: "pi-devtasks", display: true, content: items.map(describeTransition).join("\n") });
  }

  function scheduleFlush(delay = 300): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  function onTransition(transition: Transition): void {
    void updateStatus();
    // Reload/shutdown stops tasks; that is not news, and a deliberate stop is
    // never something to tell the model about.
    if (shuttingDown || transition.kind === "stopped") return;
    if (suppressedTasks.has(transition.task)) return;
    pending.set(transition.task, transition);
    if (activeCtx?.isIdle()) scheduleFlush();
  }

  // ---- Backend setup ----------------------------------------------------

  async function startBackend(ctx: ExtensionContext): Promise<void> {
    if (backend) {
      await backend.close().catch(() => {});
      backend = undefined;
    }

    let config: DevConfig | undefined;
    try {
      config = loadConfig(ctx.cwd);
    } catch (err) {
      if (ctx.hasUI) ctx.ui.notify(err instanceof ConfigError ? err.message : `pi-devtasks: ${(err as Error).message}`, "error");
      return;
    }
    if (!config) return;

    suppressedTasks.clear();
    for (const task of config.tasks.values()) if (!task.notify) suppressedTasks.add(task.name);

    if (await useDaemon(ctx)) return;
    await useLocal(ctx, config);
  }

  async function useDaemon(ctx: ExtensionContext): Promise<boolean> {
    try {
      if (!(await ensureDaemon())) return false;
      const client: DaemonClient = createDaemonClient();
      await client.addRepo(ctx.cwd);
      const unsubscribe = client.subscribe(ctx.cwd, (event) => {
        if (event.type !== "state" || !event.snapshot) return;
        const kind = TRANSITION_KIND[event.snapshot.state];
        if (kind) onTransition({ task: event.task, kind, snapshot: event.snapshot });
      });
      backend = {
        kind: "daemon",
        start: (task) => client.start(ctx.cwd, task),
        stop: (task) => client.stop(ctx.cwd, task),
        restart: (task) => client.restart(ctx.cwd, task),
        status: (task) => client.status(ctx.cwd, task),
        logs: (task, lines) => client.logs(ctx.cwd, task, lines),
        pageUrl: daemonUrl(),
        // Daemon mode leaves tasks running when pi exits.
        close: async () => {
          unsubscribe();
        },
      };
      const link = daemonUrl();
      await updateStatus();
      if (ctx.hasUI) ctx.ui.notify(`pi-devtasks daemon: ${link}`, "info");
      else process.stderr.write(`pi-devtasks daemon: ${link}\n`);
      return true;
    } catch {
      return false;
    }
  }

  async function useLocal(ctx: ExtensionContext, config: DevConfig): Promise<void> {
    const manager = createManager({ repoRoot: ctx.cwd, config, onTransition });
    let displayUrl: string | undefined;
    let closeServer: (() => Promise<void>) | undefined;
    try {
      const server = await startServer(manager, config);
      displayUrl = server.displayUrl;
      closeServer = () => server.close();
    } catch (err) {
      if (ctx.hasUI) ctx.ui.notify(`pi-devtasks: ${(err as Error).message}`, "error");
    }
    backend = {
      kind: "local",
      start: (task) => manager.start(task),
      stop: (task) => manager.stop(task),
      restart: (task) => manager.restart(task),
      status: (task) => Promise.resolve(task ? manager.status(task) : manager.status()),
      logs: (task, lines) => Promise.resolve(manager.logs(task, lines)),
      pageUrl: displayUrl,
      close: async () => {
        await manager.stopAll();
        await closeServer?.();
      },
    };
    await updateStatus();
    if (displayUrl && ctx.hasUI) ctx.ui.notify(`pi-devtasks: web UI at ${displayUrl}`, "info");
  }

  // ---- Tools ------------------------------------------------------------

  pi.registerTool({
    name: "dev_list",
    label: "List dev tasks",
    description:
      "List the local dev tasks declared in this repo's .pi/dev.json and their current state. Call this to discover task names before starting anything.",
    parameters: Type.Object({}),
    async execute() {
      if (!backend) return textResult("No .pi/dev.json in this repo; no dev tasks are configured.");
      const snapshots = await backend.status();
      if (snapshots.length === 0) return textResult("No dev tasks configured.");
      return textResult(snapshots.map((s) => `${s.name}: ${s.cmd} — ${s.state}`).join("\n"));
    },
  });

  pi.registerTool({
    name: "dev_start",
    label: "Start dev task",
    description:
      "Start a declared local dev task and wait until it reports ready, fails, or times out. Returns the readiness verdict and recent output. Use dev_list for task names.",
    parameters: Type.Object({ task: Type.String({ description: "Task name from .pi/dev.json" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const dev = requireBackend();
      const snapshot = await dev.start(params.task);
      const { lines, logFile } = await dev.logs(params.task, 50);
      const header = `dev task "${params.task}" -> ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`;
      const body = lines.length > 0 ? `\n\nrecent output:\n${lines.join("\n")}` : "";
      return textResult(`${header}${body}\n\nfull log: ${logFile}`, snapshot);
    },
  });

  pi.registerTool({
    name: "dev_stop",
    label: "Stop dev task",
    description: "Stop a running dev task (SIGTERM the process group, then SIGKILL after the configured timeout).",
    parameters: Type.Object({ task: Type.String({ description: "Task name from .pi/dev.json" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const dev = requireBackend();
      const snapshot = await dev.stop(params.task);
      const lines = (await dev.logs(params.task, 20)).lines;
      const exit = snapshot.lastExit ? ` (exit ${snapshot.lastExit.code ?? snapshot.lastExit.signal ?? "unknown"})` : "";
      const body = lines.length > 0 ? `\n\nlast output:\n${lines.join("\n")}` : "";
      return textResult(`dev task "${params.task}" -> ${snapshot.state}${exit}${body}`, snapshot);
    },
  });

  pi.registerTool({
    name: "dev_restart",
    label: "Restart dev task",
    description: "Stop then start a dev task, waiting for it to become ready again.",
    parameters: Type.Object({ task: Type.String({ description: "Task name from .pi/dev.json" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const dev = requireBackend();
      const snapshot = await dev.restart(params.task);
      const lines = (await dev.logs(params.task, 50)).lines;
      const header = `dev task "${params.task}" -> ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`;
      const body = lines.length > 0 ? `\n\nrecent output:\n${lines.join("\n")}` : "";
      return textResult(`${header}${body}\n\nfull log: ${snapshot.logFile}`, snapshot);
    },
  });

  pi.registerTool({
    name: "dev_status",
    label: "Dev task status",
    description: "Show the state of all declared dev tasks, or one task: state, pid, port, readiness and last exit.",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "Optional task name; omit for all tasks" })),
    }),
    async execute(_toolCallId, params) {
      const dev = requireBackend();
      const snapshots = await dev.status(params.task);
      return textResult(snapshots.map(formatSnapshot).join("\n") || "No tasks.", snapshots);
    },
  });

  pi.registerTool({
    name: "dev_logs",
    label: "Dev task logs",
    description: "Return the most recent output lines from a dev task, plus the full log file path. Never dumps the whole log.",
    parameters: Type.Object({
      task: Type.String({ description: "Task name from .pi/dev.json" }),
      lines: Type.Optional(Type.Number({ description: "How many trailing lines to return (default 200)" })),
    }),
    async execute(_toolCallId, params) {
      const dev = requireBackend();
      const { lines, logFile } = await dev.logs(params.task, params.lines ?? 200);
      return textResult(`${lines.length} line(s) from ${logFile}:\n\n${lines.join("\n")}`, {
        logFile,
        count: lines.length,
      });
    },
  });

  // ---- /dev command -----------------------------------------------------

  pi.registerCommand("dev", {
    description: "Manage local dev tasks: /dev list | start <task> | stop <task> | restart <task> | status [task] | logs <task> | open",
    handler: async (args, ctx) => {
      activeCtx = ctx;
      const [sub, task] = args.trim().split(/\s+/);

      if (!sub || sub === "list") {
        if (!backend) {
          ctx.ui.notify("No .pi/dev.json in this repo", "warning");
          return;
        }
        const snapshots = await backend.status();
        const tasks = snapshots.length ? snapshots.map((s) => `${s.name}: ${s.state}`).join("\n") : "No dev tasks configured";
        ctx.ui.notify(backend.pageUrl ? `${tasks}\n\npage: ${backend.pageUrl}` : tasks, "info");
        return;
      }

      if (sub === "open") {
        ctx.ui.notify(backend?.pageUrl ?? "pi-devtasks is not running", backend?.pageUrl ? "info" : "warning");
        return;
      }

      if (!backend) {
        ctx.ui.notify("No .pi/dev.json in this repo", "warning");
        return;
      }
      if (!task && sub !== "status") {
        ctx.ui.notify(`/dev ${sub} needs a task name`, "warning");
        return;
      }

      try {
        switch (sub) {
          case "start": {
            const snapshot = await backend.start(task!);
            ctx.ui.notify(`${task}: ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`, "info");
            break;
          }
          case "stop": {
            const snapshot = await backend.stop(task!);
            ctx.ui.notify(`${task}: ${snapshot.state}`, "info");
            break;
          }
          case "restart": {
            const snapshot = await backend.restart(task!);
            ctx.ui.notify(`${task}: ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`, "info");
            break;
          }
          case "status": {
            const snapshots = await backend.status(task);
            ctx.ui.notify(snapshots.map(formatSnapshot).join("\n") || "No tasks", "info");
            break;
          }
          case "logs": {
            const { lines, logFile } = await backend.logs(task!, 40);
            ctx.ui.notify(`${logFile}\n\n${lines.slice(-40).join("\n")}`, "info");
            break;
          }
          default:
            ctx.ui.notify(`Unknown /dev subcommand: ${sub}`, "error");
        }
      } catch (err) {
        ctx.ui.notify((err as Error).message, "error");
      }
    },
  });

  // ---- Session lifecycle ------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    activeCtx = ctx;
    shuttingDown = false;
    await startBackend(ctx);
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    pending.clear();
    try {
      await backend?.close();
    } catch {
      // Shutdown must not throw.
    }
    backend = undefined;
    activeCtx?.ui.setStatus("pi-devtasks", undefined);
  });

  pi.on("agent_end", () => {
    if (pending.size > 0) scheduleFlush(0);
  });
  pi.on("agent_settled", () => {
    if (pending.size > 0) scheduleFlush(0);
  });

  pi.on("before_agent_start", (event) => {
    if (lastSnapshots.length === 0) return;
    const names = lastSnapshots.map((snapshot) => snapshot.name).join(", ");
    event.systemPromptOptions.promptGuidelines.push(
      `This repo declares local dev tasks in .pi/dev.json: ${names}. Manage them with the dev_start, dev_stop, dev_restart, dev_status and dev_logs tools instead of running these long-lived commands through the bash tool.`,
    );
  });
}
