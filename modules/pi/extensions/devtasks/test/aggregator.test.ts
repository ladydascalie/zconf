import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.ts";
import { createManager, type DevManager } from "../manager.ts";
import { startServer, type DevServer } from "../server.ts";

let previousStateHome: string | undefined;
let rootA: string;
let rootB: string;
let managerA: DevManager;
let managerB: DevManager;
let serverA: DevServer;
let serverB: DevServer;

function makeRepo(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(root, "idle.js"), "console.log('idle up'); setInterval(() => {}, 1000);");
  fs.writeFileSync(
    path.join(root, ".pi", "dev.json"),
    JSON.stringify({
      server: { token: false },
      tasks: { dev: { cmd: "node idle.js", ready: { delayMs: 50 }, stop: { timeoutMs: 1000 } } },
    }),
  );
  return root;
}

before(async () => {
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-agg-state-"));
  rootA = makeRepo("pi-devtasks-agg-a-");
  rootB = makeRepo("pi-devtasks-agg-b-");
  managerA = createManager({ repoRoot: rootA, config: loadConfig(rootA)! });
  managerB = createManager({ repoRoot: rootB, config: loadConfig(rootB)! });
  serverA = await startServer(managerA, managerA.config);
  serverB = await startServer(managerB, managerB.config);
});

after(async () => {
  await managerA.stopAll();
  await managerB.stopAll();
  await serverA.close();
  await serverB.close().catch(() => {});
  fs.rmSync(rootA, { recursive: true, force: true });
  fs.rmSync(rootB, { recursive: true, force: true });
  if (process.env.XDG_STATE_HOME) fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true });
  if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
});

test("server A aggregates server B", async () => {
  const data = (await (await fetch(`${serverA.url}api/all/status`)).json()) as { repos: any[] };
  assert.equal(data.repos.length, 2);
  const current = data.repos.find((repo) => repo.current);
  const peer = data.repos.find((repo) => !repo.current);
  assert.equal(current.repoRoot, rootA);
  assert.equal(peer.repoRoot, rootB);
  assert.equal(peer.online, true);
});

test("control and logs proxy to the peer", async () => {
  const control = await fetch(`${serverA.url}api/control?repo=${encodeURIComponent(rootB)}&task=dev&action=start`, {
    method: "POST",
  });
  assert.equal(control.status, 200);
  const bStatus = (await (await fetch(`${serverB.url}api/status`)).json()) as { tasks: any[] };
  assert.equal(bStatus.tasks[0].state, "ready");

  const logs = (await (
    await fetch(`${serverA.url}api/logs?repo=${encodeURIComponent(rootB)}&task=dev`)
  ).json()) as { logFile: string };
  assert.equal(typeof logs.logFile, "string");
});

test("merged stream carries peer events", async () => {
  await managerB.stop("dev");
  const controller = new AbortController();
  const response = await fetch(`${serverA.url}api/all/stream`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  await new Promise((resolve) => setTimeout(resolve, 400));
  await fetch(`${serverB.url}api/tasks/dev/start`, { method: "POST" });

  const deadline = Date.now() + 8000;
  let found = false;
  while (Date.now() < deadline && !found) {
    const raced = await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array; done: boolean }>((resolve) => setTimeout(() => resolve({ done: false }), 1000)),
    ]);
    if (raced.value) buffer += decoder.decode(raced.value);
    if (buffer.includes(`"repo":"${rootB}"`)) found = true;
    if (raced.done) break;
  }
  controller.abort();
  assert.ok(found, `expected a ${rootB} event in: ${buffer.slice(-400)}`);
});

test("a closed peer stays listed as offline", async () => {
  await managerB.stopAll();
  await serverB.close();
  const data = (await (await fetch(`${serverA.url}api/all/status`)).json()) as { repos: any[] };
  const repo = data.repos.find((item) => item.repoRoot === rootB);
  assert.ok(repo, "repo should still be listed");
  assert.equal(repo.online, false);
});
