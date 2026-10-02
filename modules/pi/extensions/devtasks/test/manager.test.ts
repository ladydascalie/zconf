import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.ts";
import type { Herdr, HerdrPane, HerdrProcessInfo, HerdrWorkspace } from "../herdr.ts";
import { createManager } from "../manager.ts";

interface FakePane {
  paneId: string;
  workspaceId: string;
  tabId: string;
  cwd: string;
  label?: string;
  tokens: Record<string, string>;
  busy: boolean;
  output: string;
}

interface FakeHerdr extends Herdr {
  panes: Map<string, FakePane>;
  workspaces: HerdrWorkspace[];
  runs: Array<{ paneId: string; cmd: string }>;
  splits: Array<{ paneId: string; cwd: string; direction?: "right" | "down" }>;
  /** Called on run; return false to simulate a command that exits immediately. */
  onRun?: (paneId: string, cmd: string) => boolean;
}

function makeRepo(tasks: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-herdr-"));
  fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(root, ".pi", "dev.json"), JSON.stringify({ tasks }));
  return root;
}

function fakeHerdr(): FakeHerdr {
  let seq = 0;
  const panes = new Map<string, FakePane>();
  const workspaces: HerdrWorkspace[] = [];
  const runs: Array<{ paneId: string; cmd: string }> = [];
  const splits: Array<{ paneId: string; cwd: string; direction?: "right" | "down" }> = [];

  const addPane = (workspaceId: string, tabId: string, cwd: string): FakePane => {
    const pane: FakePane = { paneId: `p${++seq}`, workspaceId, tabId, cwd, tokens: {}, busy: false, output: "" };
    panes.set(pane.paneId, pane);
    return pane;
  };

  const fake: FakeHerdr = {
    panes,
    workspaces,
    runs,
    splits,
    async listWorkspaces() {
      return workspaces;
    },
    async createWorkspace(label, cwd) {
      const workspaceId = `w${workspaces.length + 1}`;
      const tabId = `${workspaceId}:t1`;
      const pane = addPane(workspaceId, tabId, cwd);
      workspaces.push({ workspaceId, tabId, label });
      return { workspaceId, tabId, rootPaneId: pane.paneId };
    },
    async listPanes(workspaceId) {
      return [...panes.values()]
        .filter((pane) => pane.workspaceId === workspaceId)
        .map((pane): HerdrPane => ({ ...pane }));
    },
    async paneTokens(paneId) {
      return panes.get(paneId)?.tokens ?? {};
    },
    async splitPane(paneId, cwd, direction) {
      const target = panes.get(paneId)!;
      splits.push({ paneId, cwd, direction });
      return addPane(target.workspaceId, target.tabId, cwd).paneId;
    },
    async createTab(workspaceId, cwd) {
      const tabId = `${workspaceId}:t${panes.size + 1}`;
      return { paneId: addPane(workspaceId, tabId, cwd).paneId, tabId };
    },
    async renamePane(paneId, label) {
      const pane = panes.get(paneId)!;
      pane.label = label;
    },
    async run(paneId, cmd) {
      const pane = panes.get(paneId)!;
      runs.push({ paneId, cmd });
      pane.output += `${cmd}\n`;
      pane.busy = fake.onRun ? fake.onRun(paneId, cmd) : true;
    },
    async read(paneId) {
      return panes.get(paneId)?.output ?? "";
    },
    async processInfo(paneId) {
      const pane = panes.get(paneId);
      if (!pane) throw new Error("no pane");
      return { shellPid: 100, foregroundPgid: pane.busy ? 200 : 100 } satisfies HerdrProcessInfo;
    },
    async sendCtrlC(paneId) {
      const pane = panes.get(paneId);
      if (pane) pane.busy = false;
    },
    async closePane(paneId) {
      panes.delete(paneId);
    },
    async reportMetadata(paneId, metadata) {
      const pane = panes.get(paneId);
      if (pane && metadata.tokens) pane.tokens = { ...pane.tokens, ...metadata.tokens };
    },
    async focusPane() {},
  };
  return fake;
}

test("starts in a pane, reports ready via delay probe, and stops with ctrl+c", async () => {
  const repoRoot = makeRepo({ dev: { cmd: "run-server", ready: { delayMs: 10 }, stop: { timeoutMs: 500 } } });
  const herdr = fakeHerdr();
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });

  const started = await manager.start("dev");
  assert.equal(started.state, "ready");
  assert.equal(started.paneId, "p1");
  assert.deepEqual(herdr.runs, [{ paneId: "p1", cmd: "run-server" }]);

  const stopped = await manager.stop("dev");
  assert.equal(stopped.state, "stopped");
  assert.equal(herdr.panes.get("p1")!.busy, false);
  manager.dispose();
});

test("stdout probe matches pane output", async () => {
  const repoRoot = makeRepo({ dev: { cmd: "serve", ready: { stdout: "listening on" }, readyTimeoutMs: 2000 } });
  const herdr = fakeHerdr();
  herdr.onRun = (paneId) => {
    herdr.panes.get(paneId)!.output += "listening on :3000\n";
    return true;
  };
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });

  const snapshot = await manager.start("dev");
  assert.equal(snapshot.state, "ready");
  assert.match(snapshot.readyReason ?? "", /stdout matched/);
  manager.dispose();
});

test("a command that exits before ready fails", async () => {
  const repoRoot = makeRepo({ dev: { cmd: "boom", ready: { stdout: "never" }, readyTimeoutMs: 2000 } });
  const herdr = fakeHerdr();
  herdr.onRun = () => false; // never takes hold
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 30 });

  const snapshot = await manager.start("dev");
  assert.equal(snapshot.state, "failed");
  assert.match(snapshot.readyReason ?? "", /ended before ready/);
  manager.dispose();
});

test("one task per repo: a second start is rejected", async () => {
  const repoRoot = makeRepo({
    dev: { cmd: "serve", ready: { delayMs: 10 } },
    worker: { cmd: "work", ready: { delayMs: 10 } },
  });
  const herdr = fakeHerdr();
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });

  await manager.start("dev");
  await assert.rejects(() => manager.start("worker"), /already running in this repo/);
  manager.dispose();
});

test("restart reuses the same pane", async () => {
  const repoRoot = makeRepo({ dev: { cmd: "serve", ready: { delayMs: 10 }, stop: { timeoutMs: 500 } } });
  const herdr = fakeHerdr();
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });

  const first = await manager.start("dev");
  const again = await manager.restart("dev");
  assert.equal(again.paneId, first.paneId);
  assert.equal(herdr.runs.length, 2);
  manager.dispose();
});

test("logs return the pane tail", async () => {
  const repoRoot = makeRepo({ dev: { cmd: "serve", ready: { delayMs: 10 } } });
  const herdr = fakeHerdr();
  herdr.onRun = (paneId) => {
    herdr.panes.get(paneId)!.output += "line a\nline b\n";
    return true;
  };
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });

  await manager.start("dev");
  const { lines, source } = await manager.logs("dev", 2);
  assert.deepEqual(lines, ["line a", "line b"]);
  assert.match(source, /herdr pane p1/);
  manager.dispose();
});

test("new panes split side by side", async () => {
  const herdr = fakeHerdr();
  const managers = [];
  for (let i = 0; i < 3; i++) {
    const repoRoot = makeRepo({ dev: { cmd: "serve", ready: { delayMs: 1 } } });
    const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });
    managers.push(manager);
    await manager.start("dev");
  }
  assert.ok(herdr.splits.length >= 2);
  assert.ok(
    herdr.splits.every((split) => split.direction === "right"),
    `expected right splits, got ${JSON.stringify(herdr.splits)}`,
  );
  for (const manager of managers) manager.dispose();
});

test("unknown task throws", async () => {
  const repoRoot = makeRepo({ dev: { cmd: "serve" } });
  const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr: fakeHerdr() });
  await assert.rejects(() => manager.status("nope"), /unknown task/);
  manager.dispose();
});

test("overflows to a second tab past pane capacity", async () => {
  const herdr = fakeHerdr();
  const managers = [];
  for (let i = 0; i < 5; i++) {
    const repoRoot = makeRepo({ dev: { cmd: "serve", ready: { delayMs: 1 } } });
    const manager = createManager({ repoRoot, config: loadConfig(repoRoot)!, herdr, pollIntervalMs: 10, settleMs: 50 });
    managers.push(manager);
    await manager.start("dev");
  }
  const panes = [...herdr.panes.values()];
  const tabs = new Set(panes.map((pane) => pane.tabId));
  assert.equal(panes.length, 5);
  assert.equal(tabs.size, 2, `expected two tabs, got ${[...tabs].join(", ")}`);
  for (const manager of managers) manager.dispose();
});
