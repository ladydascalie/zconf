/**
 * Client for the devd daemon, spoken over the Unix socket. Used by the
 * extension's tools and `/dev` command, and to lazily start the daemon.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { daemonSocketPath } from "./daemon-paths.ts";
import type { ManagerEvent, TaskSnapshot } from "./manager.ts";
import { stateDir } from "./registry.ts";

export interface DaemonClient {
  status(repo: string, task?: string): Promise<TaskSnapshot[]>;
  start(repo: string, task: string): Promise<TaskSnapshot>;
  stop(repo: string, task: string): Promise<TaskSnapshot>;
  restart(repo: string, task: string): Promise<TaskSnapshot>;
  logs(repo: string, task: string, lines: number): Promise<{ lines: string[]; logFile: string }>;
  addRepo(repo: string): Promise<void>;
  subscribe(repo: string, onEvent: (event: ManagerEvent) => void): () => void;
}

interface RawResponse {
  status: number;
  json: unknown;
}

export async function isDaemonAlive(): Promise<boolean> {
  try {
    const res = await request("GET", "/api/health", 800);
    return res.status === 200;
  } catch {
    return false;
  }
}

/** True if the daemon is (or became) reachable; spawns it detached if not. */
export async function ensureDaemon(): Promise<boolean> {
  if (await isDaemonAlive()) return true;
  spawnDaemon();
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    await delay(200);
    if (await isDaemonAlive()) return true;
  }
  return false;
}

export function createDaemonClient(): DaemonClient {
  return {
    async status(repo, task) {
      const res = await request("GET", `/api/status?repo=${encodeURIComponent(repo)}`);
      const tasks = (res.json as { tasks?: TaskSnapshot[] })?.tasks ?? [];
      return task ? tasks.filter((snapshot) => snapshot.name === task) : tasks;
    },
    async start(repo, task) {
      const res = await request("POST", `/api/control?repo=${encodeURIComponent(repo)}&task=${encodeURIComponent(task)}&action=start`);
      return (res.json as { task: TaskSnapshot }).task;
    },
    async stop(repo, task) {
      const res = await request("POST", `/api/control?repo=${encodeURIComponent(repo)}&task=${encodeURIComponent(task)}&action=stop`);
      return (res.json as { task: TaskSnapshot }).task;
    },
    async restart(repo, task) {
      const res = await request("POST", `/api/control?repo=${encodeURIComponent(repo)}&task=${encodeURIComponent(task)}&action=restart`);
      return (res.json as { task: TaskSnapshot }).task;
    },
    async logs(repo, task, lines) {
      const res = await request(
        "GET",
        `/api/logs?repo=${encodeURIComponent(repo)}&task=${encodeURIComponent(task)}&lines=${lines}`,
      );
      return res.json as { lines: string[]; logFile: string };
    },
    async addRepo(repo) {
      await request("POST", `/api/repos?repo=${encodeURIComponent(repo)}`);
    },
    subscribe(repo, onEvent) {
      return subscribe(repo, onEvent);
    },
  };
}

function spawnDaemon(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(here, "daemon.ts");
  if (!fs.existsSync(script)) return;
  const logPath = path.join(stateDir(), "daemon.log");
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", script], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: process.env,
    });
    child.unref();
  } catch {
    // Fall back to in-process when the daemon cannot be started.
  } finally {
    fs.closeSync(fd);
  }
}

function request(method: string, pathname: string, timeoutMs = 4000): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: daemonSocketPath(), path: pathname, method, timeout: timeoutMs },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            const message = (json as { error?: string })?.error ?? `daemon request failed (${status})`;
            reject(new Error(message));
            return;
          }
          resolve({ status, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("daemon request timed out")));
    req.on("error", reject);
    req.end();
  });
}

function subscribe(repo: string, onEvent: (event: ManagerEvent) => void): () => void {
  const req = http.get(
    { socketPath: daemonSocketPath(), path: `/api/stream?repo=${encodeURIComponent(repo)}` },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const parsed = parseSse(raw);
          if (parsed) {
            try {
              const payload = JSON.parse(parsed.data);
              onEvent({ type: parsed.event as ManagerEvent["type"], task: payload.task, line: payload.line, snapshot: payload.snapshot } as ManagerEvent);
            } catch {
              // Ignore malformed events.
            }
          }
          index = buffer.indexOf("\n\n");
        }
      });
      res.on("error", () => {});
    },
  );
  req.on("error", () => {});
  return () => req.destroy();
}

function parseSse(raw: string): { event: string; data: string } | undefined {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return data ? { event, data } : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
