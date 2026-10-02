/**
 * Config loading and validation for pi-devtasks.
 *
 * The config lives at `<repo>/.pi/dev.json`. JSON is used deliberately so the
 * extension needs no runtime dependency (Node has no built-in TOML parser).
 */

import fs from "node:fs";
import path from "node:path";

export interface ReadyProbe {
  port?: number;
  stdout?: string;
  http?: string;
  delayMs?: number;
}

export interface StopConfig {
  timeoutMs: number;
}

export interface TaskConfig {
  name: string;
  cmd: string;
  /** Absolute working directory, resolved from the repo root. */
  cwd: string;
  notify: boolean;
  ready?: ReadyProbe;
  readyTimeoutMs: number;
  stop: StopConfig;
}

export interface DevConfig {
  path: string;
  repoRoot: string;
  tasks: Map<string, TaskConfig>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export function configPath(repoRoot: string): string {
  return path.join(repoRoot, ".pi", "dev.json");
}

/** Returns undefined when the repo declares no tasks. Throws ConfigError otherwise. */
export function loadConfig(repoRoot: string): DevConfig | undefined {
  const file = configPath(repoRoot);
  if (!fs.existsSync(file)) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`${file}: invalid JSON — ${(err as Error).message}`);
  }
  return parseConfig(raw, file, repoRoot);
}

function parseConfig(raw: unknown, file: string, repoRoot: string): DevConfig {
  if (!isObject(raw)) fail(file, "top level must be a JSON object");

  const tasksRaw = raw.tasks;
  if (!isObject(tasksRaw) || Object.keys(tasksRaw).length === 0) {
    fail(file, '"tasks" must be a non-empty object of task definitions');
  }

  const tasks = new Map<string, TaskConfig>();
  for (const [name, value] of Object.entries(tasksRaw)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      fail(file, `task name "${name}" must match [A-Za-z0-9_-]+`);
    }
    if (!isObject(value)) fail(file, `task "${name}" must be an object`);

    tasks.set(name, {
      name,
      cmd: reqString(value.cmd, file, `tasks.${name}.cmd`),
      cwd: path.resolve(repoRoot, optString(value.cwd, ".", file, `tasks.${name}.cwd`)),
      notify: optBool(value.notify, true, file, `tasks.${name}.notify`),
      ready: parseReady(value.ready, file, name),
      readyTimeoutMs: optNumber(value.readyTimeoutMs, DEFAULT_READY_TIMEOUT_MS, file, `tasks.${name}.readyTimeoutMs`),
      stop: parseStop(value.stop, file, name),
    });
  }

  return { path: file, repoRoot, tasks };
}

function parseReady(raw: unknown, file: string, name: string): ReadyProbe | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) fail(file, `tasks.${name}.ready must be an object`);

  const keys = ["port", "stdout", "http", "delayMs"].filter((key) => raw[key] !== undefined);
  if (keys.length !== 1) {
    fail(file, `tasks.${name}.ready must set exactly one of: port, stdout, http, delayMs`);
  }
  const key = keys[0]!;

  if (key === "port") {
    const port = raw.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      fail(file, `tasks.${name}.ready.port must be an integer between 1 and 65535`);
    }
    return { port };
  }

  if (key === "delayMs") {
    const delayMs = raw.delayMs;
    if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
      fail(file, `tasks.${name}.ready.delayMs must be a number >= 0`);
    }
    return { delayMs };
  }

  if (key === "stdout") {
    const stdout = raw.stdout;
    if (typeof stdout !== "string" || stdout.length === 0) {
      fail(file, `tasks.${name}.ready.stdout must be a non-empty string`);
    }
    try {
      new RegExp(stdout);
    } catch (err) {
      fail(file, `tasks.${name}.ready.stdout is not a valid regex — ${(err as Error).message}`);
    }
    return { stdout };
  }

  const http = raw.http;
  if (typeof http !== "string" || !/^https?:\/\//.test(http)) {
    fail(file, `tasks.${name}.ready.http must be an http(s) URL`);
  }
  return { http };
}

function parseStop(raw: unknown, file: string, name: string): StopConfig {
  if (raw === undefined || raw === null) {
    return { timeoutMs: DEFAULT_STOP_TIMEOUT_MS };
  }
  if (!isObject(raw)) fail(file, `tasks.${name}.stop must be an object`);

  return {
    timeoutMs: optNumber(raw.timeoutMs, DEFAULT_STOP_TIMEOUT_MS, file, `tasks.${name}.stop.timeoutMs`),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(file: string, message: string): never {
  throw new ConfigError(`${file}: ${message}`);
}

function reqString(value: unknown, file: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(file, `"${label}" must be a non-empty string`);
  return value;
}

function optString(value: unknown, fallback: string, file: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) fail(file, `"${label}" must be a non-empty string`);
  return value;
}

function optBool(value: unknown, fallback: boolean, file: string, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(file, `"${label}" must be a boolean`);
  return value;
}

function optNumber(value: unknown, fallback: number, file: string, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(file, `"${label}" must be a positive number`);
  }
  return value;
}
