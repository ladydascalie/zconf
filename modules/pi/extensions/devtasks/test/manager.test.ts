import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.ts";
import { createManager, type DevManager } from "../manager.ts";

let repoRoot: string;
let manager: DevManager;
let previousStateHome: string | undefined;

before(() => {
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-state-"));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-mgr-"));
  fs.mkdirSync(path.join(repoRoot, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "idle.js"), "setInterval(() => {}, 1000);");
  fs.writeFileSync(path.join(repoRoot, "exit.js"), "process.exit(3);");
  fs.writeFileSync(path.join(repoRoot, "ready.js"), "console.log('READY!'); setInterval(() => {}, 1000);");
  fs.writeFileSync(
    path.join(repoRoot, "env.js"),
    "console.log('PI_SESSION=' + process.env.PI_SESSION); setInterval(() => {}, 1000);",
  );

  fs.writeFileSync(
    path.join(repoRoot, ".pi", "dev.json"),
    JSON.stringify(
      {
        server: { token: false },
        tasks: {
          delay: {
            cmd: "node idle.js",
            ready: { delayMs: 100 },
            readyTimeoutMs: 5000,
            stop: { timeoutMs: 1500 },
          },
          exits: { cmd: "node exit.js", ready: { stdout: "NEVER_MATCHES" }, readyTimeoutMs: 5000 },
          prints: {
            cmd: "node ready.js",
            ready: { stdout: "READY" },
            readyTimeoutMs: 5000,
            stop: { timeoutMs: 1500 },
          },
          env: {
            cmd: "node env.js",
            ready: { stdout: "PI_SESSION=" },
            readyTimeoutMs: 5000,
            stop: { timeoutMs: 1500 },
          },
        },
      },
      null,
      2,
    ),
  );

  manager = createManager({ repoRoot, config: loadConfig(repoRoot)! });
});

after(async () => {
  await manager.stopAll();
  fs.rmSync(repoRoot, { recursive: true, force: true });
  if (process.env.XDG_STATE_HOME) fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true });
  if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
});

test("ready via delay probe, then stop kills the process group", async () => {
  const started = await manager.start("delay");
  assert.equal(started.state, "ready");
  assert.ok(started.pid, "expected a pid");
  const pid = started.pid!;

  const stopped = await manager.stop("delay");
  assert.equal(stopped.state, "stopped");
  assert.throws(() => process.kill(-pid, 0), /ESRCH/, "process group should be gone");
});

test("exiting before ready fails", async () => {
  const snapshot = await manager.start("exits");
  assert.equal(snapshot.state, "failed");
  assert.match(snapshot.readyReason ?? "", /exited before ready/);
  assert.equal(snapshot.lastExit?.code, 3);
});

test("ready via stdout probe and tail is available", async () => {
  const snapshot = await manager.start("prints");
  assert.equal(snapshot.state, "ready");
  assert.match(snapshot.readyReason ?? "", /stdout matched/);

  const { lines } = manager.logs("prints", 20);
  assert.ok(
    lines.some((line) => line.includes("READY!")),
    `expected READY! in ${JSON.stringify(lines)}`,
  );
  await manager.stop("prints");
});

test("PI_SESSION marker is injected", async () => {
  const snapshot = await manager.start("env");
  assert.equal(snapshot.state, "ready");
  await manager.stop("env");
});

test("unknown task throws", () => {
  assert.throws(() => manager.status("nope"), /unknown task/);
});
