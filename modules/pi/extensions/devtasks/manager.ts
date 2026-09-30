/**
 * Process supervision for pi-devtasks: spawn, readiness, logs, group kill.
 *
 * Only one child is tracked per declared task. Children are spawned detached so
 * the whole process group (mise/go run fork grandchildren) can be signalled —
 * killing only the direct child leaks orphans.
 */

import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DevConfig, ReadyProbe, TaskConfig } from "./config.ts";
import { compileStdoutMatcher, httpOk, tcpConnect } from "./probes.ts";

export type TaskState = "stopped" | "starting" | "ready" | "exited" | "failed";

export interface TaskExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  at: number;
}

export interface TaskSnapshot {
  name: string;
  cmd: string;
  cwd: string;
  state: TaskState;
  pid?: number;
  port?: number;
  readyReason?: string;
  startedAt?: number;
  readyAt?: number;
  lastExit?: TaskExit;
  logFile: string;
  bufferedLines: number;
}

export type ManagerEvent =
  | { type: "log"; task: string; line: string }
  | { type: "state"; task: string; snapshot: TaskSnapshot };

export interface Transition {
  task: string;
  kind: "ready" | "failed" | "exited" | "stopped";
  snapshot: TaskSnapshot;
}

export interface ManagerOptions {
  repoRoot: string;
  config: DevConfig;
  onTransition?: (transition: Transition) => void;
}

export interface DevManager {
  readonly config: DevConfig;
  start(name: string): Promise<TaskSnapshot>;
  stop(name: string): Promise<TaskSnapshot>;
  restart(name: string): Promise<TaskSnapshot>;
  status(name?: string): TaskSnapshot[];
  logs(name: string, lines?: number): { lines: string[]; logFile: string };
  subscribe(listener: (event: ManagerEvent) => void): () => void;
  stopAll(): Promise<void>;
}

interface Runtime {
  cfg: TaskConfig;
  state: TaskState;
  child?: ChildProcess;
  pid?: number;
  readyReason?: string;
  startedAt?: number;
  readyAt?: number;
  lastExit?: TaskExit;
  logFile: string;
  logStream?: fs.WriteStream;
  lines: string[];
  bytes: number;
  pendingOut: string;
  pendingErr: string;
  exited?: Promise<void>;
  exitResolve?: () => void;
  readyResolve?: () => void;
  probeTimer?: NodeJS.Timeout;
  probeDeadlineTimer?: NodeJS.Timeout;
  stopRequested: boolean;
  stdoutMatcher?: RegExp;
  stdoutMatched: boolean;
}

const MAX_LINES = 2000;
const MAX_BYTES = 512 * 1024;
const PROBE_INTERVAL_MS = 500;

export function createManager(options: ManagerOptions): DevManager {
  const { config, repoRoot, onTransition } = options;
  const runtimes = new Map<string, Runtime>();
  const listeners = new Set<(event: ManagerEvent) => void>();

  for (const task of config.tasks.values()) {
    runtimes.set(task.name, createRuntime(task, repoRoot));
  }

  function getRuntime(name: string): Runtime {
    const runtime = runtimes.get(name);
    if (!runtime) {
      const known = [...runtimes.keys()].join(", ");
      throw new Error(`pi-devtasks: unknown task "${name}"${known ? ` (known: ${known})` : ""}`);
    }
    return runtime;
  }

  function broadcast(event: ManagerEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A broken SSE subscriber must not affect supervision.
      }
    }
  }

  function snapshot(runtime: Runtime): TaskSnapshot {
    return {
      name: runtime.cfg.name,
      cmd: runtime.cfg.cmd,
      cwd: runtime.cfg.cwd,
      state: runtime.state,
      pid: runtime.child?.pid,
      port: runtime.cfg.ready?.port,
      readyReason: runtime.readyReason,
      startedAt: runtime.startedAt,
      readyAt: runtime.readyAt,
      lastExit: runtime.lastExit,
      logFile: runtime.logFile,
      bufferedLines: runtime.lines.length,
    };
  }

  function emitState(runtime: Runtime): void {
    broadcast({ type: "state", task: runtime.cfg.name, snapshot: snapshot(runtime) });
  }

  function transition(runtime: Runtime, kind: Transition["kind"]): void {
    emitState(runtime);
    if (runtime.stopRequested && kind === "stopped") return;
    onTransition?.({ task: runtime.cfg.name, kind, snapshot: snapshot(runtime) });
  }

  function onLine(runtime: Runtime, line: string): void {
    runtime.lines.push(line);
    runtime.bytes += Buffer.byteLength(line) + 1;
    while (runtime.lines.length > MAX_LINES || runtime.bytes > MAX_BYTES) {
      const removed = runtime.lines.shift();
      if (removed === undefined) break;
      runtime.bytes -= Buffer.byteLength(removed) + 1;
    }

    if (runtime.stdoutMatcher && runtime.state === "starting" && runtime.stdoutMatcher.test(line)) {
      runtime.stdoutMatched = true;
      markReady(runtime, `stdout matched /${runtime.cfg.ready?.stdout}/`);
    }

    broadcast({ type: "log", task: runtime.cfg.name, line });
  }

  function wireOutput(runtime: Runtime, stream: NodeJS.ReadableStream | null, which: "out" | "err"): void {
    if (!stream) return;
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      runtime.logStream?.write(chunk);
      const key = which === "out" ? "pendingOut" : "pendingErr";
      const combined = runtime[key] + chunk;
      const parts = combined.split("\n");
      runtime[key] = parts.pop() ?? "";
      for (const line of parts) onLine(runtime, line);
    });
  }

  function flushPending(runtime: Runtime): void {
    if (runtime.pendingOut) {
      onLine(runtime, runtime.pendingOut);
      runtime.pendingOut = "";
    }
    if (runtime.pendingErr) {
      onLine(runtime, runtime.pendingErr);
      runtime.pendingErr = "";
    }
  }

  function markReady(runtime: Runtime, reason: string): void {
    if (runtime.state !== "starting") return;
    runtime.state = "ready";
    runtime.readyAt = Date.now();
    runtime.readyReason = reason;
    clearProbeTimers(runtime);
    transition(runtime, "ready");
    runtime.readyResolve?.();
  }

  function markFailed(runtime: Runtime, reason: string): void {
    if (runtime.state === "failed") return;
    runtime.state = "failed";
    runtime.readyReason = reason;
    clearProbeTimers(runtime);
    transition(runtime, "failed");
    runtime.readyResolve?.();
  }

  function handleExit(runtime: Runtime, code: number | null, signal: NodeJS.Signals | null): void {
    flushPending(runtime);
    clearProbeTimers(runtime);
    closeLog(runtime);
    runtime.lastExit = { code, signal, at: Date.now() };
    runtime.child = undefined;
    runtime.pid = undefined;
    runtime.exitResolve?.();
    runtime.exitResolve = undefined;
    runtime.readyResolve?.();

    if (runtime.state === "starting") {
      runtime.state = "failed";
      runtime.readyReason = `exited before ready (${describeExit(code, signal)})`;
      transition(runtime, "failed");
      return;
    }
    if (runtime.stopRequested) {
      runtime.state = "stopped";
      runtime.readyReason = undefined;
      transition(runtime, "stopped");
      return;
    }
    runtime.state = code === 0 ? "stopped" : "exited";
    runtime.readyReason = `exited (${describeExit(code, signal)})`;
    transition(runtime, "exited");
  }

  function waitForReady(runtime: Runtime): Promise<void> {
    const probe = runtime.cfg.ready;
    if (!probe) {
      markReady(runtime, "ready on spawn (no probe)");
      return Promise.resolve();
    }
    if (runtime.state !== "starting") return Promise.resolve();

    return new Promise((resolve) => {
      runtime.readyResolve = () => {
        runtime.readyResolve = undefined;
        resolve();
      };

      if (probe.delayMs !== undefined) {
        runtime.probeTimer = setTimeout(() => {
          if (runtime.state === "starting") markReady(runtime, `delay ${probe.delayMs}ms`);
        }, probe.delayMs);
        runtime.probeDeadlineTimer = setTimeout(() => {
          if (runtime.state === "starting") {
            markFailed(runtime, `readiness timeout after ${runtime.cfg.readyTimeoutMs}ms`);
          }
        }, runtime.cfg.readyTimeoutMs);
        return;
      }

      const tick = async () => {
        if (runtime.state !== "starting") return;
        try {
          if (await checkProbe(runtime)) markReady(runtime, describeProbe(probe));
        } catch {
          // Probe failures are expected until the process is up.
        }
      };
      runtime.probeTimer = setInterval(() => void tick(), PROBE_INTERVAL_MS);
      runtime.probeDeadlineTimer = setTimeout(() => {
        if (runtime.state === "starting") {
          markFailed(runtime, `readiness timeout after ${runtime.cfg.readyTimeoutMs}ms`);
        }
      }, runtime.cfg.readyTimeoutMs);
      void tick();
    });
  }

  async function checkProbe(runtime: Runtime): Promise<boolean> {
    const probe = runtime.cfg.ready;
    if (!probe) return true;
    if (probe.port !== undefined) return tcpConnect(probe.port);
    if (probe.stdout !== undefined) return runtime.stdoutMatched;
    if (probe.http !== undefined) return httpOk(probe.http);
    return true;
  }

  function signalGroup(runtime: Runtime, signal: NodeJS.Signals): void {
    const pid = runtime.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") runtime.child?.kill(signal);
      else process.kill(-pid, signal);
    } catch {
      // ESRCH: the group is already gone.
    }
  }

  function waitForExit(runtime: Runtime, timeoutMs: number): Promise<boolean> {
    const exited = runtime.exited;
    if (!exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void exited.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async function start(name: string): Promise<TaskSnapshot> {
    const runtime = getRuntime(name);
    if (runtime.state === "starting" || runtime.state === "ready") return snapshot(runtime);
    if (runtime.state === "failed" && runtime.child) return snapshot(runtime);

    resetRuntime(runtime);
    runtime.state = "starting";
    runtime.startedAt = Date.now();
    runtime.readyReason = undefined;
    runtime.stopRequested = false;
    runtime.stdoutMatched = false;
    runtime.lines = [];
    runtime.bytes = 0;
    runtime.pendingOut = "";
    runtime.pendingErr = "";
    if (runtime.cfg.ready?.stdout) runtime.stdoutMatcher = compileStdoutMatcher(runtime.cfg.ready.stdout);
    else runtime.stdoutMatcher = undefined;

    openLog(runtime);
    emitState(runtime);

    const child = spawn(runtime.cfg.cmd, {
      cwd: runtime.cfg.cwd,
      env: { ...process.env, PI_SESSION: "1" },
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    runtime.child = child;
    runtime.pid = child.pid;
    runtime.exited = new Promise<void>((resolve) => {
      runtime.exitResolve = resolve;
    });
    wireOutput(runtime, child.stdout, "out");
    wireOutput(runtime, child.stderr, "err");
    child.once("exit", (code, signal) => handleExit(runtime, code, signal));
    child.once("error", (err) => markFailed(runtime, `spawn error: ${err.message}`));

    await waitForReady(runtime);
    return snapshot(runtime);
  }

  async function stop(name: string): Promise<TaskSnapshot> {
    const runtime = getRuntime(name);
    if (!runtime.child) {
      runtime.state = "stopped";
      runtime.readyReason = undefined;
      clearProbeTimers(runtime);
      emitState(runtime);
      return snapshot(runtime);
    }

    runtime.stopRequested = true;
    clearProbeTimers(runtime);
    signalGroup(runtime, runtime.cfg.stop.signal);
    const exited = await waitForExit(runtime, runtime.cfg.stop.timeoutMs);
    if (!exited) {
      signalGroup(runtime, "SIGKILL");
      await waitForExit(runtime, 2000);
    }
    runtime.stopRequested = false;
    if (runtime.child) markFailed(runtime, "did not exit after SIGKILL");

    return snapshot(runtime);
  }

  async function restart(name: string): Promise<TaskSnapshot> {
    await stop(name);
    return start(name);
  }

  function status(name?: string): TaskSnapshot[] {
    if (name === undefined) return [...runtimes.values()].map(snapshot);
    return [snapshot(getRuntime(name))];
  }

  function logs(name: string, lines = 200): { lines: string[]; logFile: string } {
    const runtime = getRuntime(name);
    const count = Math.max(0, Math.min(Math.floor(lines), MAX_LINES));
    const tail = count === 0 ? [] : runtime.lines.slice(-count).map(stripAnsi);
    return { lines: tail, logFile: runtime.logFile };
  }

  function subscribe(listener: (event: ManagerEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function stopAll(): Promise<void> {
    await Promise.all(
      [...runtimes.values()].map((runtime) => (runtime.child ? stop(runtime.cfg.name) : Promise.resolve(snapshot(runtime)))),
    );
  }

  return { config, start, stop, restart, status, logs, subscribe, stopAll };
}

function createRuntime(cfg: TaskConfig, repoRoot: string): Runtime {
  return {
    cfg,
    state: "stopped",
    logFile: logFilePath(repoRoot, cfg.name),
    lines: [],
    bytes: 0,
    pendingOut: "",
    pendingErr: "",
    stopRequested: false,
    stdoutMatched: false,
  };
}

function resetRuntime(runtime: Runtime): void {
  clearProbeTimers(runtime);
  closeLog(runtime);
  runtime.child = undefined;
  runtime.pid = undefined;
  runtime.exited = undefined;
  runtime.exitResolve = undefined;
  runtime.readyResolve = undefined;
}

function openLog(runtime: Runtime): void {
  fs.mkdirSync(path.dirname(runtime.logFile), { recursive: true });
  runtime.logStream = fs.createWriteStream(runtime.logFile, { flags: "a" });
}

function closeLog(runtime: Runtime): void {
  runtime.logStream?.end();
  runtime.logStream = undefined;
}

function clearProbeTimers(runtime: Runtime): void {
  if (runtime.probeTimer) {
    clearInterval(runtime.probeTimer);
    clearTimeout(runtime.probeTimer);
    runtime.probeTimer = undefined;
  }
  if (runtime.probeDeadlineTimer) {
    clearTimeout(runtime.probeDeadlineTimer);
    runtime.probeDeadlineTimer = undefined;
  }
}

function logFilePath(repoRoot: string, task: string): string {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const hash = crypto.createHash("sha1").update(repoRoot).digest("hex").slice(0, 8);
  const slug = `${path.basename(repoRoot)}-${hash}`;
  return path.join(base, "pi-devtasks", slug, `${task}.log`);
}

function describeProbe(probe: ReadyProbe): string {
  if (probe.port !== undefined) return `port ${probe.port} open`;
  if (probe.stdout !== undefined) return `stdout matched /${probe.stdout}/`;
  if (probe.http !== undefined) return `http ${probe.http} ok`;
  if (probe.delayMs !== undefined) return `delay ${probe.delayMs}ms`;
  return "ready";
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `signal ${signal}`;
  return `code ${code ?? "unknown"}`;
}

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}
