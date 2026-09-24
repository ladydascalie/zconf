// fleet-web — browser UI for pi-subagents fleet runs.
// Read-only viewer over pi-subagents async run artifacts.
//
// /fleet-web          start (or reuse) the local server and open a browser tab
// /fleet-web stop     stop the server
// /fleet-web url      print the URL without opening a browser

import { startFleetServer, type FleetServer } from "./lib/server.ts";

interface FleetWebState {
	server?: FleetServer;
}

const state: FleetWebState = {};

async function openBrowser(url: string): Promise<boolean> {
	const { spawn } = await import("node:child_process");
	const candidates: Array<[string, string[]]> = [
		["xdg-open", [url]],
		["gio", ["open", url]],
		["open", [url]],
	];
	for (const [bin, args] of candidates) {
		const ok = await new Promise<boolean>((resolve) => {
			try {
				const child = spawn(bin, args, { stdio: "ignore", detached: true });
				child.once("error", () => resolve(false));
				child.once("spawn", () => {
					child.unref();
					resolve(true);
				});
			} catch {
				resolve(false);
			}
		});
		if (ok) return true;
	}
	return false;
}

export default function fleetWebExtension(pi: any) {
	// /reload re-runs this factory in the same process; close any server a previous
	// instance left listening so there is exactly one fleet-web port at a time
	const prev = (globalThis as any).__fleetWebServer;
	if (prev) {
		try {
			prev.close();
		} catch {
			/* already closed */
		}
		(globalThis as any).__fleetWebServer = undefined;
	}
	pi.registerCommand("fleet-web", {
		description: "Open the fleet runs browser UI (read-only viewer over pi-subagents artifacts)",
		getArgumentCompletions: (prefix: string) =>
			["stop", "url", "open"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
		handler: async (args: string, ctx: any) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "stop") {
				if (state.server) {
					state.server.close();
					state.server = undefined;
					ctx.ui.notify("fleet-web server stopped", "info");
				} else {
					ctx.ui.notify("fleet-web server is not running", "info");
				}
				return;
			}
			if (!state.server) {
				try {
					state.server = await startFleetServer();
					(globalThis as any).__fleetWebServer = state.server;
				} catch (e) {
					ctx.ui.notify(`fleet-web failed to start: ${e instanceof Error ? e.message : String(e)}`, "error");
					return;
				}
			}
			const url = `http://127.0.0.1:${state.server.port}/`;
			if (arg === "url") {
				ctx.ui.notify(url, "info");
				return;
			}
			const opened = await openBrowser(url);
			ctx.ui.notify(opened ? `fleet-web open in browser: ${url}` : `fleet-web running (open manually): ${url}`, "info");
		},
	});

	// release the port when pi exits (event names vary across versions; register defensively)
	const cleanup = () => {
		state.server?.close();
		state.server = undefined;
		(globalThis as any).__fleetWebServer = undefined;
	};
	try {
		pi.events.on("session_shutdown", cleanup);
		pi.events.on("session_end", cleanup);
	} catch {
		/* server dies with the process anyway */
	}
}
