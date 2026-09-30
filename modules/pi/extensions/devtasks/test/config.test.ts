import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../config.ts";

function writeConfig(body: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-cfg-"));
  fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(root, ".pi", "dev.json"), typeof body === "string" ? body : JSON.stringify(body));
  return root;
}

test("absent config returns undefined", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-cfg-"));
  assert.equal(loadConfig(root), undefined);
});

test("parses tasks and resolves cwd", () => {
  const root = writeConfig({ tasks: { dev: { cmd: "echo hi", cwd: "sub" } } });
  const config = loadConfig(root)!;
  const dev = config.tasks.get("dev")!;
  assert.equal(dev.cmd, "echo hi");
  assert.equal(dev.cwd, path.join(root, "sub"));
  assert.equal(dev.notify, true);
  assert.equal(dev.readyTimeoutMs, 60_000);
  assert.equal(dev.stop.signal, "SIGTERM");
  assert.equal(dev.ready, undefined);
});

test("rejects multiple probes", () => {
  const root = writeConfig({ tasks: { dev: { cmd: "x", ready: { port: 1, delayMs: 5 } } } });
  assert.throws(() => loadConfig(root), ConfigError);
});

test("rejects invalid stdout regex", () => {
  const root = writeConfig({ tasks: { dev: { cmd: "x", ready: { stdout: "(" } } } });
  assert.throws(() => loadConfig(root), /valid regex/);
});

test("rejects missing tasks", () => {
  const root = writeConfig({ server: {} });
  assert.throws(() => loadConfig(root), /tasks/);
});

test("rejects invalid JSON", () => {
  const root = writeConfig("{ nope");
  assert.throws(() => loadConfig(root), /invalid JSON/);
});
