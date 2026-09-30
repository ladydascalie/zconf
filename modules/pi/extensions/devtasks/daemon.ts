/**
 * devd entry point. Run standalone (or detached by the extension):
 *
 *   node --experimental-strip-types daemon.ts
 *
 * Owns every repo's dev processes and serves the page on a fixed address.
 */

import { startDaemon } from "./daemon-server.ts";
import { daemonHost, daemonPort, daemonSocketPath, loadOrCreateToken } from "./daemon-paths.ts";

const port = daemonPort();
const host = daemonHost();
const socketPath = daemonSocketPath();
const token = loadOrCreateToken();

let daemon: Awaited<ReturnType<typeof startDaemon>>;
try {
  daemon = await startDaemon({ host, port, token, socketPath });
} catch (err) {
  const message = (err as NodeJS.ErrnoException).code === "EADDRINUSE"
    ? `port ${port} is already in use (set PI_DEV_TASKS_PORT or stop the other process)`
    : (err as Error).message;
  process.stderr.write(`pi-devtasks daemon failed to start: ${message}\n`);
  process.exit(1);
}

process.stderr.write(`pi-devtasks daemon listening on ${daemon.url} (socket ${socketPath})\n`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await daemon.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
