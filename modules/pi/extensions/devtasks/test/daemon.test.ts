import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createDaemonClient } from "../daemon-client.ts";
import { startDaemon, type Daemon } from "../daemon-server.ts";
import type { ManagerEvent } from "../manager.ts";

let previousStateHome: string | undefined;
let previousSocket: string | undefined;
let repoRoot: string;
let daemon: Daemon;

before(async () => {
  previousStateHome = process.env.XDG_STATE_HOME;
  previousSocket = process.env.PI_DEV_TASKS_SOCKET;
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-dstate-"));
  process.env.XDG_STATE_HOME = state;
  process.env.PI_DEV_TASKS_SOCKET = path.join(state, "devd.sock");

  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-drepo-"));
  fs.mkdirSync(path.join(repoRoot, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "idle.js"), "console.log('idle up'); setInterval(() => {}, 1000);");
  fs.writeFileSync(
    path.join(repoRoot, ".pi", "dev.json"),
    JSON.stringify({
      server: { token: false },
      tasks: { dev: { cmd: "node idle.js", ready: { delayMs: 50 }, stop: { timeoutMs: 1000 } } },
    }),
  );

  daemon = await startDaemon({ host: "127.0.0.1", port: 0, token: "testtoken", socketPath: process.env.PI_DEV_TASKS_SOCKET });
});

after(async () => {
  await daemon.close();
  fs.rmSync(repoRoot, { recursive: true, force: true });
  if (process.env.XDG_STATE_HOME) fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true });
  if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
  if (previousSocket === undefined) delete process.env.PI_DEV_TASKS_SOCKET;
  else process.env.PI_DEV_TASKS_SOCKET = previousSocket;
});

test("serves the page and guards TCP with the token", async () => {
  assert.equal((await fetch(`${daemon.url}api/health`)).status, 401);
  const page = await fetch(`${daemon.url}?token=testtoken`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /pi dev tasks/);
});

test("the socket client adds a repo and controls its task", async () => {
  const client = createDaemonClient();
  await client.addRepo(repoRoot);
  const status = await client.status(repoRoot);
  assert.equal(status.length, 1);
  assert.equal(status[0].state, "stopped");

  const started = await client.start(repoRoot, "dev");
  assert.equal(started.state, "ready");

  const { lines, logFile } = await client.logs(repoRoot, "dev", 50);
  assert.ok(lines.some((line) => line.includes("idle up")), JSON.stringify(lines));
  assert.equal(typeof logFile, "string");

  const stopped = await client.stop(repoRoot, "dev");
  assert.equal(stopped.state, "stopped");
});

test("aggregate status exposes managed repos", async () => {
  const client = createDaemonClient();
  await client.addRepo(repoRoot);
  const data = (await (await fetch(`${daemon.url}api/all/status?token=testtoken`)).json()) as { repos: any[] };
  assert.equal(data.repos.length, 1);
  assert.equal(data.repos[0].managed, true);
  assert.equal(data.repos[0].repoRoot, repoRoot);
});

test("the socket stream delivers state and log events", async () => {
  const client = createDaemonClient();
  await client.addRepo(repoRoot);
  const events: ManagerEvent[] = [];
  const unsubscribe = client.subscribe(repoRoot, (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 200));

  await client.start(repoRoot, "dev");
  const deadline = Date.now() + 5000;
  while (
    Date.now() < deadline &&
    !events.some((event) => event.type === "state" && event.snapshot?.state === "ready")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  unsubscribe();

  assert.ok(events.some((event) => event.type === "state" && event.snapshot?.state === "ready"));
  assert.ok(events.some((event) => event.type === "log" && String(event.line).includes("idle up")));

  await client.stop(repoRoot, "dev");
});
