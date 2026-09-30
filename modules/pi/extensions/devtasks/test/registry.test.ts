import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { entryId, knownRepos, publishEntry, readLiveEntries, unpublishEntry, type RegistryEntry } from "../registry.ts";

let previousStateHome: string | undefined;

before(() => {
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devtasks-reg-"));
});

after(() => {
  if (process.env.XDG_STATE_HOME) fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true });
  if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
});

function entry(overrides: Partial<RegistryEntry>): RegistryEntry {
  const port = overrides.port ?? 12345;
  return {
    v: 1,
    id: entryId(process.pid, port),
    pid: process.pid,
    repoRoot: `/tmp/repo-${port}`,
    label: `repo-${port}`,
    host: "127.0.0.1",
    port,
    token: "",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

test("publish then read live, unpublish removes", () => {
  const record = entry({});
  publishEntry(record);
  assert.ok(readLiveEntries().some((item) => item.id === record.id));
  unpublishEntry(record.id);
  assert.equal(readLiveEntries().some((item) => item.id === record.id), false);
});

test("entries with a dead pid are pruned", () => {
  const record = entry({ pid: 999999, port: 12346 });
  publishEntry(record);
  assert.equal(readLiveEntries().some((item) => item.id === record.id), false);
});

test("stale heartbeats are pruned", () => {
  const record = entry({ port: 12347, updatedAt: Date.now() - 60_000 });
  publishEntry(record);
  assert.equal(readLiveEntries().some((item) => item.id === record.id), false);
});

test("known repos survive unpublish", () => {
  const record = entry({ port: 12348, repoRoot: "/tmp/known-repo" });
  publishEntry(record);
  unpublishEntry(record.id);
  assert.ok(knownRepos().some((repo) => repo.repoRoot === "/tmp/known-repo"));
});
