/**
 * Stable locations and the persisted token for the devd daemon. Kept separate
 * from daemon.ts so the client can import them without starting a daemon.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./registry.ts";

export function daemonPort(): number {
  const parsed = Number(process.env.PI_DEV_TASKS_PORT ?? "4770");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4770;
}

export function daemonHost(): string {
  return process.env.PI_DEV_TASKS_HOST ?? "127.0.0.1";
}

export function daemonSocketPath(): string {
  if (process.env.PI_DEV_TASKS_SOCKET) return process.env.PI_DEV_TASKS_SOCKET;
  const base = process.env.XDG_RUNTIME_DIR || stateDir();
  return path.join(base, "pi-devtasks.sock");
}

export function daemonTokenFile(): string {
  return path.join(stateDir(), "daemon-token");
}

/** Stable across restarts so the bookmarked page URL keeps working. */
export function loadOrCreateToken(): string {
  try {
    const token = fs.readFileSync(daemonTokenFile(), "utf8").trim();
    if (token) return token;
  } catch {
    // Not created yet.
  }
  const token = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(daemonTokenFile(), token, { mode: 0o600 });
  return token;
}

export function daemonUrl(): string {
  const host = daemonHost();
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${displayHost}:${daemonPort()}/?token=${loadOrCreateToken()}`;
}
