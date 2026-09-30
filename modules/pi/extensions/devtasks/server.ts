/**
 * HTTP API and web UI for pi-devtasks. Plain node:http, loopback only, OS
 * assigned port, token guarded.
 *
 * Any running server can aggregate the others: it reads the shared registry,
 * fetches peers server-side with their token, and re-emits a merged SSE. The
 * browser therefore only ever talks to one origin — no wildcard CORS.
 */

import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DevConfig } from "./config.ts";
import type { DevManager, ManagerEvent, TaskSnapshot } from "./manager.ts";
import {
  dedupeByRepo,
  entryId,
  knownRepos,
  publishEntry,
  readLiveEntries,
  type RegistryEntry,
  unpublishEntry,
} from "./registry.ts";
import { renderPage } from "./web.ts";

export interface DevServer {
  id: string;
  /** Base URL without credentials, e.g. http://127.0.0.1:54321/ */
  url: string;
  /** Ready-to-open URL including ?token= when tokens are enabled. */
  displayUrl: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

export interface RepoStatus {
  repoRoot: string;
  label: string;
  online: boolean;
  current: boolean;
  /** Set by the daemon: a repo it is responsible for, shown even when idle. */
  managed?: boolean;
  tasks: TaskSnapshot[];
}

const TASK_ROUTE = /^\/api\/tasks\/([A-Za-z0-9_-]+)\/(start|stop|restart|logs|stream)$/;
const HEARTBEAT_MS = 5000;
const RECONCILE_MS = 5000;
const PEER_TIMEOUT_MS = 3000;

export async function startServer(manager: DevManager, config: DevConfig): Promise<DevServer> {
  const repoRoot = manager.config.repoRoot;
  const label = repoRoot.split("/").filter(Boolean).pop() ?? repoRoot;
  const token = config.server.token ? crypto.randomBytes(16).toString("hex") : "";
  const streams = new Set<ServerResponse>();

  const server = http.createServer((req, res) => void handle(req, res));

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(0, config.server.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const selfId = entryId(process.pid, port);
  const hostForUrl = config.server.host === "0.0.0.0" || config.server.host === "::" ? "127.0.0.1" : config.server.host;

  const entry: RegistryEntry = {
    v: 1,
    id: selfId,
    pid: process.pid,
    repoRoot,
    label,
    host: config.server.host === "0.0.0.0" || config.server.host === "::" ? "127.0.0.1" : config.server.host,
    port,
    token,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  publishEntry(entry);
  const heartbeat = setInterval(() => {
    entry.updatedAt = Date.now();
    publishEntry(entry);
  }, HEARTBEAT_MS);

  const url = `http://${hostForUrl}:${port}/`;
  const displayUrl = token ? `${url}?token=${token}` : url;

  // ---- Aggregation helpers ---------------------------------------------

  function peerEntries(): RegistryEntry[] {
    const live = readLiveEntries().filter((e) => e.id !== selfId && e.repoRoot !== repoRoot);
    return [...dedupeByRepo(live).values()];
  }

  async function peerJson(entry: RegistryEntry, pathname: string, method = "GET"): Promise<unknown> {
    const response = await fetch(`http://${entry.host}:${entry.port}${pathname}`, {
      method,
      headers: { "x-pi-token": entry.token },
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`peer ${entry.id} ${pathname} -> ${response.status}`);
    return response.json();
  }

  function selfStatus(): RepoStatus {
    return { repoRoot, label, online: true, current: true, tasks: manager.status() };
  }

  async function collectAll(): Promise<RepoStatus[]> {
    const peers = await Promise.all(
      peerEntries().map(async (peer): Promise<RepoStatus> => {
        try {
          const data = (await peerJson(peer, "/api/status")) as { tasks?: TaskSnapshot[] };
          return { repoRoot: peer.repoRoot, label: peer.label, online: true, current: false, tasks: data.tasks ?? [] };
        } catch {
          return { repoRoot: peer.repoRoot, label: peer.label, online: false, current: false, tasks: [] };
        }
      }),
    );

    const repos: RepoStatus[] = [selfStatus(), ...peers];
    const seen = new Set(repos.map((r) => r.repoRoot));
    for (const known of knownRepos()) {
      if (seen.has(known.repoRoot)) continue;
      repos.push({ repoRoot: known.repoRoot, label: known.label, online: false, current: false, tasks: [] });
    }
    return repos;
  }

  function collectRepoList(): Array<Pick<RepoStatus, "repoRoot" | "label" | "online" | "current">> {
    const repos = [selfStatus(), ...peerEntries().map((peer) => ({ repoRoot: peer.repoRoot, label: peer.label, online: true, current: false, tasks: [] }))];
    const seen = new Set(repos.map((r) => r.repoRoot));
    for (const known of knownRepos()) {
      if (seen.has(known.repoRoot)) continue;
      repos.push({ repoRoot: known.repoRoot, label: known.label, online: false, current: false, tasks: [] });
    }
    return repos.map(({ repoRoot: r, label: l, online, current }) => ({ repoRoot: r, label: l, online, current }));
  }

  // ---- Routing ----------------------------------------------------------

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!authorized(req, url)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(renderPage(token));
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      sendJson(res, 200, { tasks: manager.status() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/stream") {
      openLocalStream(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/repos") {
      sendJson(res, 200, { repos: collectRepoList() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/all/status") {
      sendJson(res, 200, { repos: await collectAll() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/all/stream") {
      openAllStream(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/logs") {
      await handleLogs(res, url);
      return;
    }

    if (req.method === "POST" && pathname === "/api/control") {
      await handleControl(res, url);
      return;
    }

    const route = pathname.match(TASK_ROUTE);
    if (route) {
      await handleTaskRoute(req, res, url, route[1]!, route[2]!);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }

  async function handleTaskRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    name: string,
    action: string,
  ): Promise<void> {
    if (action === "stream") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      openTaskStream(req, res, name);
      return;
    }
    if (action === "logs") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      sendLogs(res, name, parseLines(url));
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    try {
      const task =
        action === "start"
          ? await manager.start(name)
          : action === "stop"
            ? await manager.stop(name)
            : await manager.restart(name);
      sendJson(res, 200, { task });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
  }

  async function handleLogs(res: ServerResponse, url: URL): Promise<void> {
    const repo = url.searchParams.get("repo");
    const task = url.searchParams.get("task");
    if (!repo || !task) return sendJson(res, 400, { error: "repo and task are required" });

    if (repo === repoRoot) return sendLogs(res, task, parseLines(url));

    const peer = peerEntries().find((candidate) => candidate.repoRoot === repo);
    if (!peer) return sendJson(res, 404, { error: "repo not online" });
    try {
      const data = await peerJson(peer, `/api/tasks/${encodeURIComponent(task)}/logs?lines=${parseLines(url)}`);
      sendJson(res, 200, data);
    } catch (err) {
      sendJson(res, 502, { error: (err as Error).message });
    }
  }

  async function handleControl(res: ServerResponse, url: URL): Promise<void> {
    const repo = url.searchParams.get("repo");
    const task = url.searchParams.get("task");
    const action = url.searchParams.get("action");
    if (!repo || !task || !action) return sendJson(res, 400, { error: "repo, task and action are required" });
    if (!["start", "stop", "restart"].includes(action)) return sendJson(res, 400, { error: "invalid action" });

    try {
      if (repo === repoRoot) {
        const snapshot =
          action === "start" ? await manager.start(task) : action === "stop" ? await manager.stop(task) : await manager.restart(task);
        return sendJson(res, 200, { task: snapshot });
      }
      const peer = peerEntries().find((candidate) => candidate.repoRoot === repo);
      if (!peer) return sendJson(res, 404, { error: "repo not online" });
      const data = await peerJson(peer, `/api/tasks/${encodeURIComponent(task)}/${action}`, "POST");
      sendJson(res, 200, data);
    } catch (err) {
      sendJson(res, 502, { error: (err as Error).message });
    }
  }

  function sendLogs(res: ServerResponse, name: string, lines: number): void {
    try {
      sendJson(res, 200, manager.logs(name, lines));
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
  }

  // ---- SSE --------------------------------------------------------------

  function openLocalStream(req: IncomingMessage, res: ServerResponse): void {
    openSse(res);
    for (const snapshot of manager.status()) {
      writeLocalEvent(res, { type: "state", task: snapshot.name, snapshot });
    }
    const unsubscribe = manager.subscribe((event) => writeLocalEvent(res, event));
    attachLifecycle(req, res, () => unsubscribe());
  }

  function openTaskStream(req: IncomingMessage, res: ServerResponse, name: string): void {
    try {
      manager.status(name);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return;
    }
    openSse(res);
    const initial = manager.status(name)[0]!;
    res.write(`event: state\ndata: ${JSON.stringify(initial)}\n\n`);
    const unsubscribe = manager.subscribe((event) => {
      if (event.task !== name) return;
      if (event.type === "log") res.write(`event: log\ndata: ${JSON.stringify({ line: event.line })}\n\n`);
      else res.write(`event: state\ndata: ${JSON.stringify(event.snapshot)}\n\n`);
    });
    attachLifecycle(req, res, () => unsubscribe());
  }

  function openAllStream(req: IncomingMessage, res: ServerResponse): void {
    openSse(res);
    for (const snapshot of manager.status()) {
      writeAllEvent(res, repoRoot, { type: "state", task: snapshot.name, snapshot });
    }
    const unsubscribeSelf = manager.subscribe((event) => writeAllEvent(res, repoRoot, event));

    const peers = new Map<string, () => void>();
    const connectPeers = () => {
      const current = peerEntries();
      const currentIds = new Set(current.map((peer) => peer.id));
      for (const [id, destroy] of peers) {
        if (!currentIds.has(id)) {
          destroy();
          peers.delete(id);
        }
      }
      for (const peer of current) {
        if (peers.has(peer.id)) continue;
        peers.set(
          peer.id,
          openPeerStream(
            peer,
            (event) => writeAllEvent(res, peer.repoRoot, event),
            () => {
              peers.get(peer.id)?.();
              peers.delete(peer.id);
            },
          ),
        );
      }
    };
    connectPeers();
    const reconcile = setInterval(connectPeers, RECONCILE_MS);

    attachLifecycle(req, res, () => {
      clearInterval(reconcile);
      unsubscribeSelf();
      for (const destroy of peers.values()) destroy();
      peers.clear();
    });
  }

  function writeLocalEvent(res: ServerResponse, event: ManagerEvent): void {
    if (event.type === "log") res.write(`event: log\ndata: ${JSON.stringify({ task: event.task, line: event.line })}\n\n`);
    else res.write(`event: state\ndata: ${JSON.stringify({ task: event.task, snapshot: event.snapshot })}\n\n`);
  }

  function writeAllEvent(res: ServerResponse, repo: string, event: ManagerEvent): void {
    if (event.type === "log") {
      res.write(`event: log\ndata: ${JSON.stringify({ repo, task: event.task, line: event.line })}\n\n`);
    } else {
      res.write(`event: state\ndata: ${JSON.stringify({ repo, task: event.task, snapshot: event.snapshot })}\n\n`);
    }
  }

  function openSse(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1000\n\n");
    streams.add(res);
  }

  function attachLifecycle(req: IncomingMessage, res: ServerResponse, cleanup: () => void): void {
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    let cleaned = false;
    const teardown = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      cleanup();
      streams.delete(res);
    };
    req.on("close", teardown);
    res.on("close", teardown);
    res.on("error", teardown);
  }

  function openPeerStream(
    peer: RegistryEntry,
    onEvent: (event: ManagerEvent) => void,
    onDown: () => void,
  ): () => void {
    const req = http.get(
      { host: peer.host, port: peer.port, path: "/api/stream", headers: { "x-pi-token": peer.token } },
      (peerRes) => {
        if (peerRes.statusCode !== 200) {
          peerRes.resume();
          onDown();
          return;
        }
        let buffer = "";
        peerRes.setEncoding("utf8");
        peerRes.on("data", (chunk: string) => {
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
                // Ignore malformed peer events.
              }
            }
            index = buffer.indexOf("\n\n");
          }
        });
        peerRes.on("end", onDown);
        peerRes.on("error", onDown);
      },
    );
    req.on("error", onDown);
    return () => req.destroy();
  }

  function authorized(req: IncomingMessage, url: URL): boolean {
    if (!token) return true;
    if (url.searchParams.get("token") === token) return true;
    return req.headers["x-pi-token"] === token;
  }

  // ---- Shutdown ---------------------------------------------------------

  async function close(): Promise<void> {
    clearInterval(heartbeat);
    unpublishEntry(selfId);
    for (const stream of streams) {
      try {
        stream.end();
      } catch {
        // Already closed.
      }
    }
    streams.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
  }

  return { id: selfId, url, displayUrl, port, token, close };
}

function parseLines(url: URL): number {
  const parsed = Number(url.searchParams.get("lines") ?? "200");
  return Number.isFinite(parsed) ? parsed : 200;
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
