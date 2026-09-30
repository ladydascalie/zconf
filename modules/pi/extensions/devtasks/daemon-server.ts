/**
 * The devd daemon: one long-lived process that owns every repo's dev tasks and
 * serves the web UI on a fixed address. It reuses the same page and aggregate
 * API shape as the in-process server, but aggregation is local (all managers
 * live in this process) so there is no registry liveness, peer fetch or peer
 * SSE multiplexing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { createManager, type DevManager, type ManagerEvent, type TaskSnapshot } from "./manager.ts";
import { allRepos, rememberRepo, removeRepo, stateDir } from "./registry.ts";
import { renderPage } from "./web.ts";

export interface DaemonOptions {
  host: string;
  port: number;
  token: string;
  socketPath: string;
}

export interface Daemon {
  url: string;
  displayUrl: string;
  port: number;
  socketPath: string;
  close(): Promise<void>;
}

interface ManagerRecord {
  repoRoot: string;
  label: string;
  manager: DevManager;
  unsubscribe: () => void;
}

export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
  const { host, port, token, socketPath } = options;
  const records = new Map<string, ManagerRecord>();
  const allClients = new Set<ServerResponse>();
  const repoClients = new Map<string, Set<ServerResponse>>();

  killLeftovers();
  for (const known of allRepos()) {
    try {
      ensureManager(known.repoRoot);
    } catch {
      // Repo without a .pi/dev.json (or with a bad one) — skip until asked.
    }
  }

  function labelFor(repoRoot: string): string {
    return repoRoot.split("/").filter(Boolean).pop() ?? repoRoot;
  }

  function ensureManager(repoRoot: string): ManagerRecord {
    const existing = records.get(repoRoot);
    if (existing) return existing;

    const config = loadConfig(repoRoot);
    if (!config) throw new Error(`no .pi/dev.json in ${repoRoot}`);
    const label = labelFor(repoRoot);
    const manager = createManager({ repoRoot, config });
    const unsubscribe = manager.subscribe((event) => {
      emit(repoRoot, event);
      if (event.type === "state") recordRunning(repoRoot, event.snapshot);
    });
    const record: ManagerRecord = { repoRoot, label, manager, unsubscribe };
    records.set(repoRoot, record);
    rememberRepo(repoRoot, label);
    return record;
  }

  function removeManagedRepo(repoRoot: string): void {
    const record = records.get(repoRoot);
    if (record) {
      record.unsubscribe();
      records.delete(repoRoot);
      void record.manager.stopAll();
    }
    removeRepo(repoRoot);
  }

  function emit(repoRoot: string, event: ManagerEvent): void {
    for (const res of allClients) writeAllEvent(res, repoRoot, event);
    for (const res of repoClients.get(repoRoot) ?? []) writeRepoEvent(res, event);
  }

  function repoStatus(record: ManagerRecord) {
    return {
      repoRoot: record.repoRoot,
      label: record.label,
      online: true,
      current: false,
      managed: true,
      tasks: record.manager.status(),
    };
  }

  // ---- Routing ----------------------------------------------------------

  function makeHandler(requireToken: boolean) {
    return (req: IncomingMessage, res: ServerResponse) => void handle(req, res, requireToken);
  }

  async function handle(req: IncomingMessage, res: ServerResponse, requireToken: boolean): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (requireToken && token && url.searchParams.get("token") !== token && req.headers["x-pi-token"] !== token) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(renderPage(token));
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true, repos: records.size });
      return;
    }

    if (req.method === "GET" && pathname === "/api/all/status") {
      sendJson(res, 200, { repos: [...records.values()].map(repoStatus) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/repos") {
      sendJson(res, 200, {
        repos: [...records.values()].map((record) => ({
          repoRoot: record.repoRoot,
          label: record.label,
          online: true,
          current: false,
          managed: true,
        })),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/all/stream") {
      openAllStream(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      const repo = url.searchParams.get("repo");
      if (!repo) return sendJson(res, 400, { error: "repo is required" });
      try {
        sendJson(res, 200, { tasks: ensureManager(repo).manager.status() });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/stream") {
      const repo = url.searchParams.get("repo");
      if (!repo) return sendJson(res, 400, { error: "repo is required" });
      openRepoStream(req, res, repo);
      return;
    }

    if (req.method === "GET" && pathname === "/api/logs") {
      const repo = url.searchParams.get("repo");
      const task = url.searchParams.get("task");
      if (!repo || !task) return sendJson(res, 400, { error: "repo and task are required" });
      try {
        sendJson(res, 200, ensureManager(repo).manager.logs(task, parseLines(url)));
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/control") {
      await handleControl(res, url);
      return;
    }

    if (pathname === "/api/repos") {
      if (req.method === "POST") {
        const repo = url.searchParams.get("repo");
        if (!repo) return sendJson(res, 400, { error: "repo is required" });
        try {
          sendJson(res, 200, { repo: ensureManager(repo).repoRoot });
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "DELETE") {
        const repo = url.searchParams.get("repo");
        if (!repo) return sendJson(res, 400, { error: "repo is required" });
        removeManagedRepo(repo);
        sendJson(res, 200, { removed: repo });
        return;
      }
    }

    sendJson(res, 404, { error: "not found" });
  }

  async function handleControl(res: ServerResponse, url: URL): Promise<void> {
    const repo = url.searchParams.get("repo");
    const task = url.searchParams.get("task");
    const action = url.searchParams.get("action");
    if (!repo || !task || !action) return sendJson(res, 400, { error: "repo, task and action are required" });
    if (!["start", "stop", "restart"].includes(action)) return sendJson(res, 400, { error: "invalid action" });
    try {
      const { manager } = ensureManager(repo);
      const snapshot =
        action === "start" ? await manager.start(task) : action === "stop" ? await manager.stop(task) : await manager.restart(task);
      sendJson(res, 200, { task: snapshot });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
  }

  // ---- SSE --------------------------------------------------------------

  function openAllStream(req: IncomingMessage, res: ServerResponse): void {
    openSse(res);
    for (const record of records.values()) {
      for (const snapshot of record.manager.status()) {
        writeAllEvent(res, record.repoRoot, { type: "state", task: snapshot.name, snapshot });
      }
    }
    allClients.add(res);
    attachLifecycle(req, res, () => allClients.delete(res));
  }

  function openRepoStream(req: IncomingMessage, res: ServerResponse, repo: string): void {
    let record: ManagerRecord;
    try {
      record = ensureManager(repo);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return;
    }
    openSse(res);
    for (const snapshot of record.manager.status()) {
      writeRepoEvent(res, { type: "state", task: snapshot.name, snapshot });
    }
    let clients = repoClients.get(repo);
    if (!clients) {
      clients = new Set();
      repoClients.set(repo, clients);
    }
    clients.add(res);
    attachLifecycle(req, res, () => clients!.delete(res));
  }

  function writeAllEvent(res: ServerResponse, repo: string, event: ManagerEvent): void {
    if (event.type === "log") res.write(`event: log\ndata: ${JSON.stringify({ repo, task: event.task, line: event.line })}\n\n`);
    else res.write(`event: state\ndata: ${JSON.stringify({ repo, task: event.task, snapshot: event.snapshot })}\n\n`);
  }

  function writeRepoEvent(res: ServerResponse, event: ManagerEvent): void {
    if (event.type === "log") res.write(`event: log\ndata: ${JSON.stringify({ task: event.task, line: event.line })}\n\n`);
    else res.write(`event: state\ndata: ${JSON.stringify({ task: event.task, snapshot: event.snapshot })}\n\n`);
  }

  function openSse(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1000\n\n");
  }

  function attachLifecycle(req: IncomingMessage, res: ServerResponse, cleanup: () => void): void {
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    let cleaned = false;
    const teardown = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      cleanup();
    };
    req.on("close", teardown);
    res.on("close", teardown);
    res.on("error", teardown);
  }

  // ---- Listen -----------------------------------------------------------

  const tcpServer = http.createServer(makeHandler(true));
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    tcpServer.once("error", onError);
    tcpServer.listen(port, host, () => {
      tcpServer.off("error", onError);
      resolve();
    });
  });
  const boundPort = (tcpServer.address() as AddressInfo).port;

  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  try {
    fs.rmSync(socketPath);
  } catch {
    // No stale socket.
  }
  const unixServer = http.createServer(makeHandler(false));
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    unixServer.once("error", onError);
    unixServer.listen(socketPath, () => {
      unixServer.off("error", onError);
      resolve();
    });
  });
  try {
    fs.chmodSync(socketPath, 0o600);
  } catch {
    // Best effort.
  }

  const url = `http://${host}:${boundPort}/`;
  const displayUrl = token ? `${url}?token=${token}` : url;

  async function close(): Promise<void> {
    for (const record of records.values()) {
      record.unsubscribe();
      await record.manager.stopAll().catch(() => {});
    }
    records.clear();
    for (const res of allClients) safeEnd(res);
    allClients.clear();
    for (const clients of repoClients.values()) for (const res of clients) safeEnd(res);
    repoClients.clear();
    writeRunning({});

    await Promise.all([
      new Promise<void>((resolve) => tcpServer.close(() => resolve())),
      new Promise<void>((resolve) => unixServer.close(() => resolve())),
    ]);
    tcpServer.closeAllConnections?.();
    unixServer.closeAllConnections?.();
    try {
      fs.rmSync(socketPath);
    } catch {
      // Already gone.
    }
  }

  return { url, displayUrl, port: boundPort, socketPath, close };
}

// ---- Running-pgid bookkeeping (orphan cleanup) --------------------------

function runningFile(): string {
  return path.join(stateDir(), "running.json");
}

function readRunning(): Record<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(runningFile(), "utf8")) as Record<string, number>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeRunning(map: Record<string, number>): void {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const file = runningFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function recordRunning(repoRoot: string, snapshot: TaskSnapshot): void {
  const map = readRunning();
  const key = `${repoRoot}\u0000${snapshot.name}`;
  if (snapshot.state === "stopped" || snapshot.state === "exited" || snapshot.pid === undefined) delete map[key];
  else map[key] = snapshot.pid;
  writeRunning(map);
}

/** Kill process groups recorded by a previous daemon that did not shut down cleanly. */
function killLeftovers(): void {
  const map = readRunning();
  for (const pid of Object.values(map)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Group already gone.
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already gone.
    }
  }
  if (Object.keys(map).length > 0) writeRunning({});
}

function parseLines(url: URL): number {
  const parsed = Number(url.searchParams.get("lines") ?? "200");
  return Number.isFinite(parsed) ? parsed : 200;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function safeEnd(res: ServerResponse): void {
  try {
    res.end();
  } catch {
    // Already closed.
  }
}
