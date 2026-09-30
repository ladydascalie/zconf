/**
 * Readiness probes. A long-running server's exit code says nothing about
 * whether it came up, so readiness needs an independent signal.
 */

import http from "node:http";
import net from "node:net";

export function compileStdoutMatcher(pattern: string): RegExp {
  return new RegExp(pattern);
}

/** True when a TCP connection to host:port succeeds within the timeout. */
export function tcpConnect(port: number, host = "127.0.0.1", timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    const socket = net.connect({ port, host });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** True when GET url returns a 2xx within the timeout. */
export function httpOk(url: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      finish(ok);
    });
    req.once("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.once("error", () => finish(false));
  });
}
