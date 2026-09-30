/**
 * Cross-repo discovery for pi-devtasks.
 *
 * Every running server publishes itself into a shared directory under the
 * user's home state dir. Any server can then list the others and aggregate
 * them. There is no daemon — the registry is just a directory of small JSON
 * files, pruned by pid liveness and heartbeat age.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RegistryEntry {
  v: 1;
  id: string;
  pid: number;
  repoRoot: string;
  label: string;
  host: string;
  port: number;
  token: string;
  startedAt: number;
  updatedAt: number;
}

export interface KnownRepo {
  repoRoot: string;
  label: string;
  lastSeen: number;
}

/** A server that has not heartbeat within this window is considered stale. */
const STALE_MS = 30_000;
/** Known (offline) repos are forgotten after this long. */
const KNOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "pi-devtasks");
}

export function registryDir(): string {
  return path.join(stateDir(), "registry");
}

export function entryId(pid: number, port: number): string {
  return `${pid}-${port}`;
}

export function publishEntry(entry: RegistryEntry): void {
  writeJsonAtomic(entryFile(entry.id), entry);
  rememberRepo(entry.repoRoot, entry.label, entry.updatedAt);
}

export function unpublishEntry(id: string): void {
  try {
    fs.rmSync(entryFile(id), { force: true });
  } catch {
    // Already gone.
  }
}

/** Live registry entries; dead or stale files are removed as a side effect. */
export function readLiveEntries(now = Date.now()): RegistryEntry[] {
  let files: string[];
  try {
    files = fs.readdirSync(registryDir());
  } catch {
    return [];
  }

  const live: RegistryEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(registryDir(), file);
    const entry = readEntry(full);
    if (!entry || !isPidAlive(entry.pid) || now - entry.updatedAt > STALE_MS) {
      remove(full);
      continue;
    }
    live.push(entry);
  }
  return live;
}

/** One entry per repo, preferring the most recently updated server. */
export function dedupeByRepo(entries: RegistryEntry[]): Map<string, RegistryEntry> {
  const byRepo = new Map<string, RegistryEntry>();
  for (const entry of entries) {
    const current = byRepo.get(entry.repoRoot);
    if (!current || entry.updatedAt > current.updatedAt) byRepo.set(entry.repoRoot, entry);
  }
  return byRepo;
}

export function rememberRepo(repoRoot: string, label: string, when = Date.now()): void {
  const repos = readKnownRaw();
  repos[repoRoot] = { repoRoot, label, lastSeen: when };
  writeJsonAtomic(knownFile(), repos);
}

/** All remembered repos, regardless of age (the daemon's managed set). */
export function allRepos(): KnownRepo[] {
  const repos = readKnownRaw();
  return Object.values(repos)
    .filter((repo) => repo && typeof repo.repoRoot === "string")
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

export function removeRepo(repoRoot: string): void {
  const repos = readKnownRaw();
  if (!(repoRoot in repos)) return;
  delete repos[repoRoot];
  writeJsonAtomic(knownFile(), repos);
}

export function knownRepos(now = Date.now()): KnownRepo[] {
  const repos = readKnownRaw();
  return Object.values(repos)
    .filter((repo) => repo && typeof repo.repoRoot === "string" && now - (repo.lastSeen ?? 0) <= KNOWN_TTL_MS)
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function entryFile(id: string): string {
  return path.join(registryDir(), `${id}.json`);
}

function knownFile(): string {
  return path.join(stateDir(), "repos.json");
}

function readEntry(file: string): RegistryEntry | undefined {
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as RegistryEntry;
    if (
      entry &&
      typeof entry.id === "string" &&
      typeof entry.pid === "number" &&
      typeof entry.port === "number" &&
      typeof entry.repoRoot === "string" &&
      typeof entry.updatedAt === "number"
    ) {
      return entry;
    }
  } catch {
    // Fall through to removal.
  }
  return undefined;
}

function readKnownRaw(): Record<string, KnownRepo> {
  try {
    const raw = JSON.parse(fs.readFileSync(knownFile(), "utf8")) as Record<string, KnownRepo>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists but belongs to another user — treat as alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function remove(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Best effort.
  }
}
