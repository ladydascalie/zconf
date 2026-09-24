// fleet-web HTTP server: localhost-only, read-only JSON API + static UI.

import http from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { createReadStream, existsSync, statSync, watch } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRuns, readReceipt, readMission, readProcessTerminal, listRunArtifacts, artifactsKind, resolveArtifactDirs, runRootPaths } from "./scanner.ts";
import { buildTranscripts, eventsOverview, transcriptsToWire } from "./events.ts";

const PUB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
};
const MAX_FILE_BYTES = 2_000_000; // per-file response cap

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
	const buf = Buffer.from(JSON.stringify(body));
	res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length, "Cache-Control": "no-store" });
	res.end(buf);
}

function sendError(res: http.ServerResponse, code: number, message: string): void {
	sendJson(res, code, { error: message });
}

/** Serve a file, guarding that the resolved path stays under one of the allowlisted roots. */
async function sendAllowedFile(res: http.ServerResponse, filePath: string, roots: string[], asAttachmentName?: string): Promise<boolean> {
	const target = resolve(filePath);
	const allowed = roots.some((r) => {
		const root = resolve(r);
		return target === root || target.startsWith(root + "/");
	});
	if (!allowed) return false;
	const info = await stat(target).catch(() => null);
	if (!info || !info.isFile()) return false;
	if (info.size > MAX_FILE_BYTES) {
		// stream a truncated head with an explicit marker
		res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Truncated": String(info.size) });
		const stream = createReadStream(target, { encoding: "utf8", end: MAX_FILE_BYTES });
		stream.on("end", () => res.end(`\n\n[[truncated; file is ${info.size} bytes]]`));
		stream.pipe(res, { end: false });
		return true;
	}
	const ext = extname(target);
	res.writeHead(200, {
		"Content-Type": MIME[ext] ?? (ext === ".md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8"),
		"Cache-Control": "no-store",
		...(asAttachmentName ? { "Content-Disposition": `inline; filename="${asAttachmentName}"` } : {}),
	});
	res.end(await readFile(target));
	return true;
}

interface FleetServer {
	port: number;
	close(): void;
}

// ---- live updates: SSE + fs.watch on run roots ----

const sseClients = new Set<http.ServerResponse>();
const activeWatchers = new Set<ReturnType<typeof watch>>();
let changeDebounce: ReturnType<typeof setTimeout> | null = null;

function notifyRunChanged(): void {
	if (changeDebounce) return;
	changeDebounce = setTimeout(() => {
		changeDebounce = null;
		for (const res of sseClients) {
			try {
				res.write("event: runs-changed\ndata: {}\n\n");
			} catch {
				sseClients.delete(res);
			}
		}
	}, 400);
}

function watchRunRoots(): void {
	if (activeWatchers.size > 0) return;
	for (const root of runRootPaths()) {
		try {
			const w = watch(root, { recursive: true }, (eventType) => {
				if (eventType) notifyRunChanged();
			});
			w.on("error", () => activeWatchers.delete(w));
			activeWatchers.add(w);
		} catch {
			/* root vanished; scan re-establishes on next request */
		}
	}
}

function handleSse(res: http.ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-store",
		Connection: "keep-alive",
	});
	res.write("retry: 3000\n\n");
	sseClients.add(res);
	watchRunRoots();
	const heartbeat = setInterval(() => {
		try {
			res.write(": hb\n\n");
		} catch {
			/* closed */
		}
	}, 15000);
	res.on("close", () => {
		clearInterval(heartbeat);
		sseClients.delete(res);
	});
}

export function startFleetServer(): Promise<FleetServer> {
	return new Promise((resolvePromise, reject) => {
		const server = http.createServer(async (req, res) => {
			try {
				await route(req, res);
			} catch (err) {
				sendError(res, 500, err instanceof Error ? err.message : String(err));
			}
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolvePromise({
				port,
				close: () => {
					for (const w of activeWatchers) w.close();
					activeWatchers.clear();
					for (const c of sseClients) c.end();
					sseClients.clear();
					server.close();
				},
			});
		});
	});
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const path = decodeURIComponent(url.pathname);

	if (path === "/" || path === "/index.html") {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
		res.end(await readFile(join(PUB_DIR, "index.html")));
		return;
	}
	if (path.startsWith("/api/")) {
		await apiRoute(path, url.searchParams, res);
		return;
	}
	// static files from public/
	const rel = normalize(path).replace(/^([/\\])+/, "");
	const file = join(PUB_DIR, rel);
	if (file.startsWith(PUB_DIR) && existsSync(file)) {
		const ext = extname(file);
		res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
		res.end(await readFile(file));
		return;
	}
	sendError(res, 404, `not found: ${path}`);
}

async function apiRoute(path: string, params: URLSearchParams, res: http.ServerResponse): Promise<void> {
	if (path === "/api/stream") {
		handleSse(res);
		return;
	}
	const scan = scanRuns();

	if (path === "/api/runs") {
		const ids = new Set(scan.runs.map((r) => r.runId));
		const roots = scan.runs.filter((r) => !r.parentWorkflowRunId || !ids.has(r.parentWorkflowRunId));
		sendJson(res, 200, { runs: roots.map((r) => ({ ...r, children: scan.runs.filter((c) => c.parentWorkflowRunId === r.runId) })) });
		return;
	}

	const runMatch = path.match(/^\/api\/runs\/([A-Za-z0-9_-]+)(\/.*)?$/);
	if (!runMatch) return sendError(res, 404, `unknown endpoint: ${path}`);
	const runId = runMatch[1];
	const entry = scan.byId.get(runId);
	if (!entry) return sendError(res, 404, `run not found: ${runId}`);
	const sub = runMatch[2] ?? "";

	if (sub === "" || sub === "/") {
		const status = entry.status;
		// workflow overview: surface each step's latest output line from its child run's
		// own status (child steps[0].recentOutput = recent assistant text snippets)
		for (const step of status.steps ?? []) {
			const childId = String(step.runId ?? "");
			if (!childId) continue;
			const childStep = scan.byId.get(childId)?.status.steps?.[0];
			const outputs = childStep?.recentOutput;
			if (!Array.isArray(outputs) || outputs.length === 0) continue;
			const last = outputs[outputs.length - 1];
			if (typeof last === "string" && last.trim()) {
				step.lastOutput = last.replace(/\s+/g, " ").trim().slice(0, 300);
			}
		}
		const receipt = readReceipt(entry.dir);
		const artifacts = listRunArtifacts(status);
		// workflow runs: surface per-entry outputReference files from the receipt
		if (receipt?.entries) {
			for (const [key, e] of Object.entries(receipt.entries)) {
				const ref = typeof e.outputReference === "string" ? e.outputReference : undefined;
				if (!ref || !existsSync(ref)) continue;
				if (artifacts.some((a) => a.path === ref)) continue;
				try {
					artifacts.push({ name: `outputs/${key}${extname(ref) || ".md"}`, path: ref, kind: artifactsKind(extname(ref) || ".md"), bytes: statSync(ref).size });
				} catch {
					/* raced */
				}
			}
		}
		sendJson(res, 200, {
			runId,
			dir: entry.dir,
			status,
			receipt,
			mission: readMission(entry.dir),
			processTerminal: readProcessTerminal(entry.dir),
			artifacts,
			eventsPath: entry.eventsPath,
			logFile: existsSync(join(entry.dir, `subagent-log-${runId}.md`)) ? `subagent-log-${runId}.md` : null,
			outputLogs: (await readdir(entry.dir).catch(() => [] as string[])).filter((f) => /^output-\d+\.log$/.test(f)),
		});
		return;
	}

	if (sub === "/transcript") {
		if (!entry.eventsPath) return sendError(res, 404, "run has no events.jsonl");
		const childRunIds = (entry.status.steps ?? []).map((s) => String(s.runId ?? "")).filter(Boolean);
		const wantChild = params.get("child");
		const accs = await buildTranscripts(entry.eventsPath, childRunIds.length > 0 ? { childRunIds } : {});
		const wire = transcriptsToWire(wantChild ? [...accs.entries()].filter(([k]) => k === wantChild).map(([, v]) => v) : accs.values());
		if (wantChild && wire.length === 0) return sendError(res, 404, `child not found: ${wantChild}`);
		sendJson(res, 200, { runId, transcripts: wire });
		return;
	}

	if (sub === "/events") {
		if (!entry.eventsPath) return sendError(res, 404, "run has no events.jsonl");
		const after = Number(params.get("after") ?? "0");
		const limit = Math.min(Number(params.get("limit") ?? "500"), 2000);
		const { readNdjson } = await import("./events.ts");
		const events: Array<{ line: number; event: unknown }> = [];
		for await (const item of readNdjson(entry.eventsPath, Number.isFinite(after) && after > 0 ? after : 0)) {
			events.push(item);
			if (events.length >= limit) break;
		}
		sendJson(res, 200, { runId, events, nextAfter: events.length > 0 ? events[events.length - 1].line + 1 : after });
		return;
	}

	if (sub === "/events-overview") {
		if (!entry.eventsPath) return sendError(res, 404, "run has no events.jsonl");
		sendJson(res, 200, await eventsOverview(entry.eventsPath));
		return;
	}

	const fileMatch = sub.match(/^\/file\/(.+)$/);
	if (fileMatch) {
		const name = fileMatch[1];
		const roots = [entry.dir, ...resolveArtifactDirs(entry.status)];
		// run-dir files (log/output/subagent-log) by exact name
		if (!name.includes("/") && (await sendAllowedFile(res, join(entry.dir, name), [entry.dir]))) return;
		// artifact files resolved from the artifact index
		const artifact = listRunArtifacts(entry.status).find((a) => a.name === name);
		if (artifact && (await sendAllowedFile(res, artifact.path, roots))) return;
		return sendError(res, 404, `artifact not found or not allowed: ${name}`);
	}

	sendError(res, 404, `unknown run endpoint: ${sub}`);
}
