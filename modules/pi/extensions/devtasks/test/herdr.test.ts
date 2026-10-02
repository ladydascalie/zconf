import assert from "node:assert/strict";
import { test } from "node:test";
import { createHerdr, HerdrError, herdrAvailable, type HerdrResult, type HerdrRunner } from "../herdr.ts";

function runner(result: (args: string[]) => unknown): { calls: string[][]; run: HerdrRunner } {
  const calls: string[][] = [];
  const run: HerdrRunner = async (args) => {
    calls.push(args);
    const value = result(args);
    return { code: 0, stdout: JSON.stringify(value), stderr: "" } satisfies HerdrResult;
  };
  return { calls, run };
}

test("parses a workspace list", async () => {
  const { run } = runner(() => ({
    result: { workspaces: [{ workspace_id: "w1", active_tab_id: "w1:t1", label: "devtasks" }] },
  }));
  const workspaces = await createHerdr(run).listWorkspaces();
  assert.deepEqual(workspaces, [{ workspaceId: "w1", tabId: "w1:t1", label: "devtasks" }]);
});

test("createWorkspace returns workspace, tab and root pane", async () => {
  const { calls, run } = runner(() => ({
    result: {
      workspace: { workspace_id: "w9" },
      tab: { tab_id: "w9:t1" },
      root_pane: { pane_id: "w9:p1" },
    },
  }));
  const created = await createHerdr(run).createWorkspace("devtasks", "/repo");
  assert.deepEqual(created, { workspaceId: "w9", tabId: "w9:t1", rootPaneId: "w9:p1" });
  assert.deepEqual(calls[0], ["workspace", "create", "--label", "devtasks", "--cwd", "/repo", "--no-focus"]);
});

test("reads process info", async () => {
  const { run } = runner(() => ({
    result: { process_info: { shell_pid: 101, foreground_process_group_id: 202 } },
  }));
  assert.deepEqual(await createHerdr(run).processInfo("w0:p1"), { shellPid: 101, foregroundPgid: 202 });
});

test("reportMetadata emits --token and --state-label", async () => {
  const { calls, run } = runner(() => ({ result: {} }));
  await createHerdr(run).reportMetadata("w0:p1", {
    source: "pi-devtasks",
    tokens: { repo: "runbooks-abc", status: "ready" },
    stateLabel: "working=starting",
  });
  assert.deepEqual(calls[0], [
    "pane",
    "report-metadata",
    "w0:p1",
    "--source",
    "pi-devtasks",
    "--token",
    "repo=runbooks-abc",
    "--token",
    "status=ready",
    "--state-label",
    "working=starting",
  ]);
});

test("read returns raw pane text, not a JSON envelope", async () => {
  const run: HerdrRunner = async () => ({ code: 0, stdout: "line a\nline b\n", stderr: "" });
  assert.equal(await createHerdr(run).read("w0:p1", 10), "line a\nline b\n");
});

test("a non-zero exit throws a HerdrError", async () => {
  const run: HerdrRunner = async () => ({ code: 1, stdout: "", stderr: '{"error":"nope"}' });
  await assert.rejects(() => createHerdr(run).listWorkspaces(), HerdrError);
});

test("silent commands parse as an empty result", async () => {
  const run: HerdrRunner = async () => ({ code: 0, stdout: "", stderr: "" });
  await createHerdr(run).run("w0:p1", "mise run dev");
});

test("herdrAvailable reflects HERDR_ENV", () => {
  const previous = process.env.HERDR_ENV;
  delete process.env.HERDR_ENV;
  assert.equal(herdrAvailable(), false);
  process.env.HERDR_ENV = "1";
  assert.equal(herdrAvailable(), true);
  if (previous === undefined) delete process.env.HERDR_ENV;
  else process.env.HERDR_ENV = previous;
});
