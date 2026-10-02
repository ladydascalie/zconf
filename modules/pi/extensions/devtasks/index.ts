/**
 * pi-devtasks — supervised local dev processes for a pi session, on herdr panes.
 *
 * Each repo's dev task runs in one pane in the `devtasks` workspace. herdr owns
 * the process, so tasks outlive pi; there is no server, token or daemon.
 */

import { Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ConfigError, loadConfig } from "./config.ts";
import { createHerdr, herdrAvailable } from "./herdr.ts";
import { createManager, type DevManager, type TaskSnapshot, type Transition } from "./manager.ts";

interface DevNoticeData {
  text: string;
}

export default function devtasksExtension(pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;
  let manager: DevManager | undefined;
  let lastSnapshots: TaskSnapshot[] = [];
  const pending = new Map<string, Transition>();
  const suppressedTasks = new Set<string>();
  let flushTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;

  function requireManager(): DevManager {
    if (!manager) {
      const cwd = activeCtx?.cwd ?? process.cwd();
      throw new Error(`pi-devtasks: no .pi/dev.json found in ${cwd}; create one to declare dev tasks.`);
    }
    return manager;
  }

  function textResult(text: string, details?: unknown) {
    return { content: [{ type: "text" as const, text }], details };
  }

  function formatSnapshot(snapshot: TaskSnapshot): string {
    const bits = [`${snapshot.name}: ${snapshot.state}`];
    if (snapshot.paneId) bits.push(`pane ${snapshot.paneId}`);
    if (snapshot.port) bits.push(`port ${snapshot.port}`);
    if (snapshot.readyReason) bits.push(snapshot.readyReason);
    return bits.join(" — ");
  }

  function describeTransition(transition: Transition): string {
    const snapshot = transition.snapshot;
    switch (transition.kind) {
      case "ready":
        return `dev task "${transition.task}" is ready (${snapshot.readyReason ?? "ready"}) in ${snapshot.source}.`;
      case "failed":
        return `dev task "${transition.task}" failed: ${snapshot.readyReason ?? "unknown"} (${snapshot.source}).`;
      case "exited":
        return `dev task "${transition.task}" exited (${snapshot.readyReason ?? "exit"}) in ${snapshot.source}.`;
      case "stopped":
        return `dev task "${transition.task}" stopped.`;
    }
  }

  async function updateStatus(): Promise<void> {
    if (!activeCtx?.hasUI) return;
    if (!manager) {
      activeCtx.ui.setStatus("pi-devtasks", undefined);
      return;
    }
    try {
      lastSnapshots = await manager.status();
    } catch {
      return;
    }
    const running = lastSnapshots.filter((snapshot) => snapshot.state !== "stopped");
    const text = running.map((snapshot) => `${snapshot.name}:${snapshot.state}`).join(" ");
    activeCtx.ui.setStatus("pi-devtasks", text || undefined);
  }

  // Transition notices go to the user only: appendEntry is stored and rendered
  // in the transcript but never enters LLM context.
  pi.registerEntryRenderer<DevNoticeData>("pi-devtasks", (entry, _options, theme) => {
    const text = entry.data?.text;
    if (!text) return undefined;
    return new Text(`${theme.fg("customMessageLabel", "[pi-devtasks]")} ${text}`, 0, 0);
  });

  function flush(): void {
    flushTimer = undefined;
    if (!activeCtx || !activeCtx.isIdle() || pending.size === 0) return;
    const items = [...pending.values()];
    pending.clear();
    pi.appendEntry<DevNoticeData>("pi-devtasks", { text: items.map(describeTransition).join("\n") });
  }

  function scheduleFlush(delay = 300): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  function onTransition(transition: Transition): void {
    void updateStatus();
    if (shuttingDown || transition.kind === "stopped") return;
    if (suppressedTasks.has(transition.task)) return;
    pending.set(transition.task, transition);
    if (activeCtx?.isIdle()) scheduleFlush();
  }

  // ---- Setup ------------------------------------------------------------

  function startManager(ctx: ExtensionContext): void {
    if (!herdrAvailable()) {
      if (ctx.hasUI) ctx.ui.notify("pi-devtasks: not inside herdr (HERDR_ENV≠1); dev tasks are unavailable.", "warning");
      return;
    }

    let config;
    try {
      config = loadConfig(ctx.cwd);
    } catch (err) {
      if (ctx.hasUI) {
        ctx.ui.notify(err instanceof ConfigError ? err.message : `pi-devtasks: ${(err as Error).message}`, "error");
      }
      return;
    }
    if (!config) return;

    suppressedTasks.clear();
    for (const task of config.tasks.values()) if (!task.notify) suppressedTasks.add(task.name);

    manager = createManager({ repoRoot: ctx.cwd, config, herdr: createHerdr(), onTransition });
    void updateStatus();
  }

  // ---- Tools ------------------------------------------------------------

  pi.registerTool({
    name: "dev_list",
    label: "List dev tasks",
    description:
      "List the local dev tasks declared in this repo's .pi/dev.json and their current state. Call this to discover task names before starting anything.",
    parameters: Type.Object({}),
    async execute() {
      if (!manager) return textResult("No dev tasks configured for this repo.");
      const snapshots = await manager.status();
      if (snapshots.length === 0) return textResult("No dev tasks configured.");
      return textResult(snapshots.map((s) => `${s.name}: ${s.cmd} — ${s.state}`).join("\n"));
    },
  });

  pi.registerTool({
    name: "dev_start",
    label: "Start dev task",
    description:
      "Start a declared local dev task in a herdr pane and wait until it reports ready, fails, or times out. Returns the readiness verdict and recent output. Use dev_list for task names.",
    parameters: Type.Object({ task: Type.String({ description: "Task name from .pi/dev.json" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const dev = requireManager();
      const snapshot = await dev.start(params.task);
      const { lines, source } = await dev.logs(params.task, 50);
      const header = `dev task "${params.task}" -> ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`;
      const body = lines.length > 0 ? `\n\nrecent output:\n${lines.join("\n")}` : "";
      return textResult(`${header}${body}\n\n${source}`, snapshot);
    },
  });

  pi.registerTool({
    name: "dev_stop",
    label: "Stop dev task",
    description: "Stop a running dev task by sending Ctrl+C to its herdr pane, closing the pane if it does not settle.",
    parameters: Type.Object({ task: Type.String({ description: "Task name from .pi/dev.json" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const dev = requireManager();
      const snapshot = await dev.stop(params.task);
      const { lines, source } = await dev.logs(params.task, 20);
      const body = lines.length > 0 ? `\n\nlast output:\n${lines.join("\n")}` : "";
      return textResult(`dev task "${params.task}" -> ${snapshot.state}${body}\n\n${source}`, snapshot);
    },
  });

  pi.registerTool({
    name: "dev_restart",
    label: "Restart dev task",
    description: "Stop then start a dev task in its herdr pane, waiting for it to become ready again.",
    parameters: Type.Object({ task: Type.String({ description: "Task name from .pi/dev.json" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const dev = requireManager();
      const snapshot = await dev.restart(params.task);
      const { lines, source } = await dev.logs(params.task, 50);
      const header = `dev task "${params.task}" -> ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`;
      const body = lines.length > 0 ? `\n\nrecent output:\n${lines.join("\n")}` : "";
      return textResult(`${header}${body}\n\n${source}`, snapshot);
    },
  });

  pi.registerTool({
    name: "dev_status",
    label: "Dev task status",
    description: "Show the state of all declared dev tasks, or one task: state, herdr pane, port and readiness.",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "Optional task name; omit for all tasks" })),
    }),
    async execute(_toolCallId, params) {
      const dev = requireManager();
      const snapshots = await dev.status(params.task);
      return textResult(snapshots.map(formatSnapshot).join("\n") || "No tasks.", snapshots);
    },
  });

  pi.registerTool({
    name: "dev_logs",
    label: "Dev task logs",
    description: "Return the most recent output lines from a dev task's herdr pane. Never dumps the whole scrollback.",
    parameters: Type.Object({
      task: Type.String({ description: "Task name from .pi/dev.json" }),
      lines: Type.Optional(Type.Number({ description: "How many trailing lines to return (default 200)" })),
    }),
    async execute(_toolCallId, params) {
      const dev = requireManager();
      const { lines, source } = await dev.logs(params.task, params.lines ?? 200);
      return textResult(`${lines.length} line(s) from ${source}:\n\n${lines.join("\n")}`, {
        source,
        count: lines.length,
      });
    },
  });

  // ---- /dev command -----------------------------------------------------

  pi.registerCommand("dev", {
    description: "Manage the repo's dev task: /dev (start the sole task) | start|stop|restart|status|logs|focus [task] | list",
    handler: async (args, ctx) => {
      activeCtx = ctx;
      if (!manager) {
        ctx.ui.notify("No dev tasks configured for this repo", "warning");
        return;
      }

      const names = [...manager.config.tasks.keys()];
      const sole = names.length === 1 ? names[0] : undefined;
      const [first, second] = args.trim().split(/\s+/).filter(Boolean);
      let sub = first;
      let task = second;

      // Bare /dev acts on the sole task; with several declared it lists.
      if (!sub) {
        if (!sole) {
          const snapshots = await manager.status();
          ctx.ui.notify(snapshots.map((s) => `${s.name}: ${s.state}`).join("\n"), "info");
          return;
        }
        sub = "start";
      }

      if (sub === "list") {
        const snapshots = await manager.status();
        ctx.ui.notify(snapshots.map((s) => `${s.name}: ${s.state}`).join("\n") || "No dev tasks configured", "info");
        return;
      }

      if (!task) {
        if (sole) task = sole;
        else if (sub !== "status") {
          ctx.ui.notify(`/dev ${sub} needs a task name (this repo declares: ${names.join(", ")})`, "warning");
          return;
        }
      }

      try {
        switch (sub) {
          case "start": {
            const snapshot = await manager.start(task!);
            ctx.ui.notify(`${task}: ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`, "info");
            break;
          }
          case "stop": {
            const snapshot = await manager.stop(task!);
            ctx.ui.notify(`${task}: ${snapshot.state}`, "info");
            break;
          }
          case "restart": {
            const snapshot = await manager.restart(task!);
            ctx.ui.notify(`${task}: ${snapshot.state}${snapshot.readyReason ? ` (${snapshot.readyReason})` : ""}`, "info");
            break;
          }
          case "status": {
            const snapshots = await manager.status(task);
            ctx.ui.notify(snapshots.map(formatSnapshot).join("\n") || "No tasks", "info");
            break;
          }
          case "logs": {
            const { lines, source } = await manager.logs(task!, 40);
            ctx.ui.notify(`${source}\n\n${lines.slice(-40).join("\n")}`, "info");
            break;
          }
          case "focus": {
            const ok = await manager.focus(task!);
            if (!ok) ctx.ui.notify(`${task}: no pane yet`, "warning");
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
    startManager(ctx);
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    pending.clear();
    // herdr owns the panes, so they keep running after pi exits.
    manager?.dispose();
    manager = undefined;
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
