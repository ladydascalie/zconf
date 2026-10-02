/**
 * Pane-backed supervision for pi-devtasks.
 *
 * One repo owns one herdr pane in the `devtasks` workspace; one task runs in it
 * at a time (no subtasks). The manager finds-or-creates the pane, runs the
 * command, polls readiness and liveness through herdr, and stops by sending
 * Ctrl+C to the pane's foreground process group.
 */

import crypto from "node:crypto";
import path from "node:path";
import type { DevConfig, ReadyProbe, TaskConfig } from "./config.ts";
import type { Herdr } from "./herdr.ts";
import { compileStdoutMatcher, httpOk, tcpConnect } from "./probes.ts";

export type TaskState = "stopped" | "starting" | "ready" | "exited" | "failed";

export interface TaskExit {
  reason: string;
  at: number;
}

export interface TaskSnapshot {
  name: string;
  cmd: string;
  cwd: string;
  state: TaskState;
  paneId?: string;
  port?: number;
  readyReason?: string;
  startedAt?: number;
  readyAt?: number;
  lastExit?: TaskExit;
  /** Human pointer to the pane holding the task. */
  source: string;
}

export interface Transition {
  task: string;
  kind: "ready" | "failed" | "exited" | "stopped";
  snapshot: TaskSnapshot;
}

export interface ManagerOptions {
  repoRoot: string;
  config: DevConfig;
  herdr: Herdr;
  onTransition?: (transition: Transition) => void;
  workspaceLabel?: string;
  paneCapacity?: number;
  pollIntervalMs?: number;
  settleMs?: number;
}

export interface DevManager {
  readonly config: DevConfig;
  start(name: string): Promise<TaskSnapshot>;
  stop(name: string): Promise<TaskSnapshot>;
  restart(name: string): Promise<TaskSnapshot>;
  status(name?: string): Promise<TaskSnapshot[]>;
  logs(name: string, lines?: number): Promise<{ lines: string[]; source: string }>;
  focus(name: string): Promise<boolean>;
  dispose(): void;
}

interface Runtime {
  cfg: TaskConfig;
  state: TaskState;
  paneId?: string;
  workspaceId?: string;
  tabId?: string;
  startedAt?: number;
  readyAt?: number;
  readyReason?: string;
  lastExit?: TaskExit;
  stopRequested: boolean;
  busySeen: boolean;
  poll?: NodeJS.Timeout;
}

const SOURCE = "pi-devtasks";
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const DEFAULT_POLL_MS = 500;
const DEFAULT_SETTLE_MS = 1000;
const DEFAULT_PANE_CAPACITY = 4;

export function createManager(options: ManagerOptions): DevManager {
  const { config, repoRoot, herdr, onTransition } = options;
  const workspaceLabel = options.workspaceLabel ?? "devtasks";
  const paneCapacity = options.paneCapacity ?? DEFAULT_PANE_CAPACITY;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const slug = repoSlug(repoRoot);
  const runtimes = new Map<string, Runtime>();

  for (const task of config.tasks.values()) {
    runtimes.set(task.name, { cfg: task, state: "stopped", stopRequested: false, busySeen: false });
  }

  function getRuntime(name: string): Runtime {
    const runtime = runtimes.get(name);
    if (!runtime) {
      const known = [...runtimes.keys()].join(", ");
      throw new Error(`pi-devtasks: unknown task "${name}"${known ? ` (known: ${known})` : ""}`);
    }
    return runtime;
  }

  function snapshot(runtime: Runtime): TaskSnapshot {
    return {
      name: runtime.cfg.name,
      cmd: runtime.cfg.cmd,
      cwd: runtime.cfg.cwd,
      state: runtime.state,
      paneId: runtime.paneId,
      port: runtime.cfg.ready?.port,
      readyReason: runtime.readyReason,
      startedAt: runtime.startedAt,
      readyAt: runtime.readyAt,
      lastExit: runtime.lastExit,
      source: runtime.paneId ? `herdr pane ${runtime.paneId}` : "herdr pane (not started)",
    };
  }

  function isActive(runtime: Runtime): boolean {
    return runtime.state === "starting" || runtime.state === "ready";
  }

  function tokens(runtime: Runtime, status: string): Record<string, string> {
    return { repo: slug, task: runtime.cfg.name, status };
  }

  async function labelPane(paneId: string, runtime: Runtime, status: string): Promise<void> {
    await herdr.renamePane(paneId, slug).catch(() => {});
    await herdr.reportMetadata(paneId, { source: SOURCE, tokens: tokens(runtime, status) }).catch(() => {});
  }

  async function ensurePane(runtime: Runtime): Promise<string> {
    const workspaces = await herdr.listWorkspaces();
    const existingWorkspace = workspaces.find((workspace) => workspace.label === workspaceLabel);

    if (!existingWorkspace) {
      const created = await herdr.createWorkspace(workspaceLabel, repoRoot);
      runtime.paneId = created.rootPaneId;
      runtime.workspaceId = created.workspaceId;
      runtime.tabId = created.tabId;
      await labelPane(created.rootPaneId, runtime, "stopped");
      return created.rootPaneId;
    }

    const panes = await herdr.listPanes(existingWorkspace.workspaceId);
    for (const pane of panes) {
      const paneTokens = await herdr.paneTokens(pane.paneId).catch(() => ({} as Record<string, string>));
      if (paneTokens.repo === slug) {
        runtime.paneId = pane.paneId;
        runtime.workspaceId = existingWorkspace.workspaceId;
        runtime.tabId = pane.tabId;
        return pane.paneId;
      }
    }

    const tabPanes = panes.filter((pane) => pane.tabId === existingWorkspace.tabId);
    let paneId: string;
    let tabId: string;
    if (tabPanes.length > 0 && tabPanes.length < paneCapacity) {
      // Side by side, appending to the right of the newest pane.
      paneId = await herdr.splitPane(tabPanes[tabPanes.length - 1]!.paneId, repoRoot, "right");
      tabId = existingWorkspace.tabId;
    } else {
      ({ paneId, tabId } = await herdr.createTab(existingWorkspace.workspaceId, repoRoot));
    }
    runtime.paneId = paneId;
    runtime.workspaceId = existingWorkspace.workspaceId;
    runtime.tabId = tabId;
    await labelPane(paneId, runtime, "stopped");
    return paneId;
  }

  function paneBusy(info: { shellPid?: number; foregroundPgid?: number }): boolean {
    return info.shellPid !== undefined && info.foregroundPgid !== undefined && info.foregroundPgid !== info.shellPid;
  }

  function setState(runtime: Runtime, state: TaskState, reason?: string): void {
    runtime.state = state;
    runtime.readyReason = reason;
  }

  function markReady(runtime: Runtime, reason: string): void {
    if (runtime.state !== "starting") return;
    setState(runtime, "ready", reason);
    runtime.readyAt = Date.now();
    void herdr
      .reportMetadata(runtime.paneId!, { source: SOURCE, tokens: tokens(runtime, "ready") })
      .catch(() => {});
    onTransition?.({ task: runtime.cfg.name, kind: "ready", snapshot: snapshot(runtime) });
  }

  function markFailed(runtime: Runtime, reason: string): void {
    if (runtime.state === "failed") return;
    setState(runtime, "failed", reason);
    runtime.lastExit = { reason, at: Date.now() };
    clearPoll(runtime);
    void herdr
      .reportMetadata(runtime.paneId!, { source: SOURCE, tokens: tokens(runtime, "failed") })
      .catch(() => {});
    onTransition?.({ task: runtime.cfg.name, kind: "failed", snapshot: snapshot(runtime) });
  }

  function markEnded(runtime: Runtime, reason: string): void {
    clearPoll(runtime);
    runtime.lastExit = { reason, at: Date.now() };
    setState(runtime, "exited", reason);
    void herdr
      .reportMetadata(runtime.paneId!, { source: SOURCE, tokens: tokens(runtime, "exited") })
      .catch(() => {});
    onTransition?.({ task: runtime.cfg.name, kind: "exited", snapshot: snapshot(runtime) });
  }

  function clearPoll(runtime: Runtime): void {
    if (runtime.poll) {
      clearInterval(runtime.poll);
      runtime.poll = undefined;
    }
  }

  async function startLivenessPoll(runtime: Runtime): Promise<void> {
    clearPoll(runtime);
    runtime.poll = setInterval(() => {
      void (async () => {
        if (runtime.state !== "ready" || !runtime.paneId) {
          clearPoll(runtime);
          return;
        }
        try {
          const info = await herdr.processInfo(runtime.paneId);
          if (paneBusy(info)) {
            runtime.busySeen = true;
            return;
          }
          markEnded(runtime, runtime.stopRequested ? "stopped" : "process ended");
        } catch {
          markEnded(runtime, "pane closed");
        }
      })();
    }, pollIntervalMs);
  }

  async function waitForReady(runtime: Runtime): Promise<void> {
    const probe = runtime.cfg.ready;
    if (!probe) {
      markReady(runtime, "ready on spawn (no probe)");
      return;
    }

    if (probe.delayMs !== undefined) {
      await sleep(probe.delayMs);
      if (runtime.state === "starting") markReady(runtime, `delay ${probe.delayMs}ms`);
      return;
    }

    const started = runtime.startedAt ?? Date.now();
    const deadline = started + runtime.cfg.readyTimeoutMs;
    while (runtime.state === "starting") {
      if (Date.now() > deadline) {
        markFailed(runtime, `readiness timeout after ${runtime.cfg.readyTimeoutMs}ms`);
        return;
      }
      try {
        const info = await herdr.processInfo(runtime.paneId!);
        if (paneBusy(info)) {
          runtime.busySeen = true;
        } else if (Date.now() - started > settleMs) {
          // The pane's shell is foreground again and the command never took
          // hold (or already exited): not ready, and never will be.
          markFailed(runtime, "ended before ready");
          return;
        }
        if (runtime.busySeen && (await probeSatisfied(runtime, probe))) return;
      } catch {
        // Transient herdr/pane errors while the task is coming up.
      }
      await sleep(pollIntervalMs);
    }
  }

  async function probeSatisfied(runtime: Runtime, probe: ReadyProbe): Promise<boolean> {
    if (probe.port !== undefined && (await tcpConnect(probe.port))) {
      markReady(runtime, `port ${probe.port} open`);
      return true;
    }
    if (probe.http !== undefined && (await httpOk(probe.http))) {
      markReady(runtime, `http ${probe.http} ok`);
      return true;
    }
    if (probe.stdout !== undefined) {
      const text = await herdr.read(runtime.paneId!, 80);
      if (compileStdoutMatcher(probe.stdout).test(text)) {
        markReady(runtime, `stdout matched /${probe.stdout}/`);
        return true;
      }
    }
    return false;
  }

  async function start(name: string): Promise<TaskSnapshot> {
    const runtime = getRuntime(name);
    const other = [...runtimes.values()].find((candidate) => candidate !== runtime && isActive(candidate));
    if (other) {
      throw new Error(`pi-devtasks: "${other.cfg.name}" is already running in this repo (one task per repo)`);
    }
    if (isActive(runtime)) return snapshot(runtime);
    if (!runtime.paneId || !(await paneExists(runtime))) {
      await ensurePane(runtime);
    }

    const info = await herdr.processInfo(runtime.paneId!);
    if (paneBusy(info)) {
      throw new Error(`pi-devtasks: pane ${runtime.paneId} is busy; cannot start "${name}"`);
    }

    runtime.state = "starting";
    runtime.startedAt = Date.now();
    runtime.readyAt = undefined;
    runtime.readyReason = undefined;
    runtime.lastExit = undefined;
    runtime.stopRequested = false;
    runtime.busySeen = false;
    await herdr.reportMetadata(runtime.paneId!, { source: SOURCE, tokens: tokens(runtime, "starting") }).catch(() => {});

    await herdr.run(runtime.paneId!, runtime.cfg.cmd);
    await waitForReady(runtime);
    if (runtime.state === "ready") await startLivenessPoll(runtime);
    return snapshot(runtime);
  }

  async function paneExists(runtime: Runtime): Promise<boolean> {
    try {
      await herdr.processInfo(runtime.paneId!);
      return true;
    } catch {
      return false;
    }
  }

  async function stop(name: string): Promise<TaskSnapshot> {
    const runtime = getRuntime(name);
    clearPoll(runtime);
    if (!runtime.paneId) {
      setState(runtime, "stopped");
      return snapshot(runtime);
    }

    runtime.stopRequested = true;
    try {
      if (paneBusy(await herdr.processInfo(runtime.paneId))) {
        await herdr.sendCtrlC(runtime.paneId);
        const deadline = Date.now() + runtime.cfg.stop.timeoutMs;
        while (Date.now() < deadline) {
          if (!paneBusy(await herdr.processInfo(runtime.paneId))) break;
          await sleep(200);
        }
        if (paneBusy(await herdr.processInfo(runtime.paneId))) {
          await herdr.closePane(runtime.paneId);
          runtime.paneId = undefined;
          runtime.workspaceId = undefined;
          runtime.tabId = undefined;
        }
      }
    } catch {
      // A vanished pane is already stopped.
    } finally {
      runtime.stopRequested = false;
    }

    setState(runtime, "stopped");
    if (runtime.paneId) {
      await herdr.reportMetadata(runtime.paneId, { source: SOURCE, tokens: tokens(runtime, "stopped") }).catch(() => {});
    }
    return snapshot(runtime);
  }

  async function restart(name: string): Promise<TaskSnapshot> {
    await stop(name);
    return start(name);
  }

  async function status(name?: string): Promise<TaskSnapshot[]> {
    const list = name === undefined ? [...runtimes.values()] : [getRuntime(name)];
    await Promise.all(list.map(refresh));
    return list.map(snapshot);
  }

  /** Adopt a pane that is already running (e.g. panes survived a pi restart). */
  async function refresh(runtime: Runtime): Promise<void> {
    if (!runtime.paneId || runtime.poll) return;
    try {
      const busy = paneBusy(await herdr.processInfo(runtime.paneId));
      if (busy && runtime.state === "stopped") {
        runtime.state = "ready";
        runtime.readyReason = "already running (adopted from herdr pane)";
        runtime.startedAt ??= Date.now();
        await startLivenessPoll(runtime);
      } else if (!busy && runtime.state === "ready") {
        setState(runtime, "stopped");
        runtime.lastExit = { reason: "process ended", at: Date.now() };
      }
    } catch {
      // Pane gone; leave the recorded state.
    }
  }

  async function logs(name: string, lines = 200): Promise<{ lines: string[]; source: string }> {
    const runtime = getRuntime(name);
    if (!runtime.paneId) return { lines: [], source: "herdr pane (not started)" };
    const text = await herdr.read(runtime.paneId, lines).catch(() => "");
    const tail = text
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.replace(ANSI_RE, ""))
      .slice(-lines);
    return { lines: tail, source: `herdr pane ${runtime.paneId}` };
  }

  async function focus(name: string): Promise<boolean> {
    const runtime = getRuntime(name);
    if (!runtime.paneId || !runtime.workspaceId || !runtime.tabId) return false;
    await herdr.focusPane(runtime.workspaceId, runtime.tabId).catch(() => {});
    return true;
  }

  function dispose(): void {
    for (const runtime of runtimes.values()) clearPoll(runtime);
  }

  return { config, start, stop, restart, status, logs, focus, dispose };
}

function repoSlug(repoRoot: string): string {
  const hash = crypto.createHash("sha1").update(repoRoot).digest("hex").slice(0, 8);
  return `${path.basename(repoRoot)}-${hash}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
