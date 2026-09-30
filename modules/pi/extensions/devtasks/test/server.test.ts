import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.ts";
import { createManager, type DevManager } from "../manager.ts";
import { startServer, type DevServer } from "../server.ts";

function makeRepo(token: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-http-"));
  fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(root, "idle.js"), "setInterval(() => {}, 1000);");
  fs.writeFileSync(
    path.join(root, ".pi", "dev.json"),
    JSON.stringify({
      server: { token },
      tasks: { dev: { cmd: "node idle.js", ready: { delayMs: 50 }, stop: { timeoutMs: 1000 } } },
    }),
  );
  return root;
}

let repoRoot: string;
let manager: DevManager;
let server: DevServer;
let previousStateHome: string | undefined;

before(async () => {
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-state-"));
  repoRoot = makeRepo(false);
  manager = createManager({ repoRoot, config: loadConfig(repoRoot)! });
  server = await startServer(manager, manager.config);
});

after(async () => {
  await manager.stopAll();
  await server.close();
  fs.rmSync(repoRoot, { recursive: true, force: true });
  if (process.env.XDG_STATE_HOME) fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true });
  if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
});

test("serves the UI page", async () => {
  const res = await fetch(`${server.url}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /pi dev tasks/);
});

test("status, start, logs and stop over HTTP", async () => {
  const status = await (await fetch(`${server.url}api/status`)).json();
  assert.equal(status.tasks[0].name, "dev");
  assert.equal(status.tasks[0].state, "stopped");

  const started = await (await fetch(`${server.url}api/tasks/dev/start`, { method: "POST" })).json();
  assert.equal(started.task.state, "ready");

  const logs = await (await fetch(`${server.url}api/tasks/dev/logs?lines=10`)).json();
  assert.equal(typeof logs.logFile, "string");

  const stopped = await (await fetch(`${server.url}api/tasks/dev/stop`, { method: "POST" })).json();
  assert.equal(stopped.task.state, "stopped");
});

test("unknown task returns 400", async () => {
  const res = await fetch(`${server.url}api/tasks/nope/start`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("SSE stream opens with an initial state event", async () => {
  const controller = new AbortController();
  const res = await fetch(`${server.url}api/tasks/dev/stream`, { signal: controller.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!buffer.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
  }
  controller.abort();

  assert.match(buffer, /event: state/);
  assert.match(buffer, /"name":"dev"/);
});

test("token guards the API", async () => {
  const authRoot = makeRepo(true);
  const authManager = createManager({ repoRoot: authRoot, config: loadConfig(authRoot)! });
  const authServer = await startServer(authManager, authManager.config);
  try {
    assert.equal((await fetch(`${authServer.url}api/status`)).status, 401);
    assert.equal((await fetch(`${authServer.url}api/status?token=${authServer.token}`)).status, 200);
    assert.equal(
      (await fetch(`${authServer.url}api/status`, { headers: { "x-pi-token": authServer.token } })).status,
      200,
    );
  } finally {
    await authServer.close();
    await authManager.stopAll();
    fs.rmSync(authRoot, { recursive: true, force: true });
  }
});
