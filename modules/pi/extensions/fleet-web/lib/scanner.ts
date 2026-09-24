// Run discovery + artifact resolution.
//
// Data layout (verified):
//   /tmp/pi-subagents-<scope>/async-subagent-runs/<runId>/   lifecycle artifacts
//     status.json, events.jsonl, output-<n>.log, subagent-log-<runId>.md,
//     mission.json, process-terminal.json, workflow-receipt.json (workflow runs)
//   Workflow runs (mode "workflow") hold wrapper events only; each child has its
//   own run dir with mode "single" and parentWorkflowRunId === workflow runId.
//   Per-task artifacts live under status.artifactsDir or derived session dirs.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { StatusDoc, WorkflowReceipt } from "./types.ts";

export interface RunArtifact {
	name: string;
	path: string;
	kind: "md" | "json" | "log" | "jsonl" | "other";
	bytes: number;
}

export interface RunSummary {
	runId: string;
	dir: string;
	mode: string;
	state: string;
	cwd?: string;
	workflowKey?: string;
	parentWorkflowRunId?: string;
	startedAt?: number;
	endedAt?: number;
	durationMs?: number;
	agents: string[];
	totalTokens?: Record<string, number>;
	totalCostUsd?: number;
	toolCount?: number;
	turnCount?: number;
	lsStyle?: string;
	hasEvents: boolean;
	hasLog: boolean;
	hasMission: boolean;
	hasReceipt: boolean;
	artifactCount: number;
	label?: string;
}

function safeReadJson(path: string): any | null {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function runDirs(): string[] {
	const roots: string[] = [];
	for (const entry of readdirSync(tmpdir())) {
		if (entry.startsWith("pi-subagents-")) {
			const runs = join(tmpdir(), entry, "async-subagent-runs");
			if (existsSync(runs)) roots.push(runs);
		}
	}
	return roots;
}

/** Roots to fs.watch for live updates. */
export function runRootPaths(): string[] {
	return runDirs();
}

export function artifactsKind(name: string): RunArtifact["kind"] {
	if (name.endsWith(".md")) return "md";
	if (name.endsWith(".json")) return "json";
	if (name.endsWith(".jsonl")) return "jsonl";
	if (name.endsWith(".log")) return "log";
	return "other";
}

function listArtifactsDir(dir: string | undefined, limit = 200): RunArtifact[] {
	const out: RunArtifact[] = [];
	if (!dir || !existsSync(dir)) return out;
	const walk = (d: string, prefix: string, depth: number) => {
		if (depth > 3 || out.length >= limit) return;
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			if (out.length >= limit) return;
			if (entry.name.startsWith(".")) continue;
			const p = join(d, entry.name);
			if (entry.isDirectory()) walk(p, prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1);
			else {
				try {
					out.push({ name: prefix ? `${prefix}/${entry.name}` : entry.name, path: p, kind: artifactsKind(entry.name), bytes: statSync(p).size });
				} catch {
					/* raced */
				}
			}
		}
	};
	walk(dir, "", 0);
	return out;
}

/** Resolve per-task artifact dirs for a run, from status hints then conventions. */
export function resolveArtifactDirs(status: StatusDoc): string[] {
	const dirs: string[] = [];
	const push = (d?: string) => {
		if (d && existsSync(d) && !dirs.includes(d)) dirs.push(d);
	};
	const cwd = status.cwd ? resolve(status.cwd) : undefined;

	// 1. explicit artifactsDir on the run
	push(status.artifactsDir as string | undefined);

	// 2. sessionDir / sibling session artifacts
	const sessionFile = status.sessionFile as string | undefined;
	if (sessionFile) {
		// sessionFile: <sessions>/<project-slug>/<date>_<id>/<uuid>/run-0/session.jsonl
		const parts = sessionFile.split("/");
		const slugIdx = parts.findIndex((p) => p.startsWith("--"));
		if (slugIdx >= 0) push(parts.slice(0, slugIdx + 1).join("/") + "/subagent-artifacts");
	}

	// 3. project conventions (artifactDir: "project")
	if (cwd) {
		push(join(cwd, ".pi/subagents/artifacts"));
		const pwr = status.parentWorkflowRunId as string | undefined;
		if (pwr) push(join(cwd, ".pi/subagents/artifacts/outputs", pwr));
		push(join(cwd, ".pi/subagents/chain-runs", String(status.runId ?? "")));
		if (pwr) push(join(cwd, ".pi/subagents/chain-runs", pwr));
	}
	return dirs;
}

export function listRunArtifacts(status: StatusDoc): RunArtifact[] {
	const seen = new Set<string>();
	const out: RunArtifact[] = [];
	const runId = String(status.runId ?? "");
	const parent = String(status.parentWorkflowRunId ?? "");
	const workflowKey = status.workflowKey ? String(status.workflowKey) : undefined;
	for (const dir of resolveArtifactDirs(status)) {
		for (const a of listArtifactsDir(dir)) {
			const key = a.path;
			if (seen.has(key)) continue;
			seen.add(key);
			const base = a.name.split("/").pop() ?? a.name;
			// scope: files named for this run, its workflow key, or run-dir-level files
			const keep =
				base.includes(runId) ||
				(workflowKey !== undefined && base.includes(workflowKey)) ||
				(!a.name.includes("/") && !/[0-9a-f]{8}-/.test(a.name));
			if (keep) out.push(a);
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readRun(dir: string): { dir: string; status: StatusDoc; eventsPath: string | null } | null {
	const status = safeReadJson(join(dir, "status.json")) as StatusDoc | null;
	if (!status || typeof status !== "object") return null;
	const eventsPath = join(dir, "events.jsonl");
	return {
		dir,
		status,
		eventsPath: existsSync(eventsPath) ? eventsPath : null,
	};
}

export interface ScanResult {
	runs: RunSummary[];
	byId: Map<string, { dir: string; status: StatusDoc; eventsPath: string | null }>;
}

function summarize(dir: string, status: StatusDoc, eventsPath: string | null): RunSummary {
	const runId = String(status.runId ?? status.id ?? basename(dir));
	const agents = (status.steps ?? []).map((s) => String(s.agent ?? "?"));
	const has = (p: string) => existsSync(p);
	const artifacts = listRunArtifacts(status);
	const tokens = status.totalTokens as Record<string, number> | undefined;
	return {
		runId,
		dir,
		mode: String(status.mode ?? "unknown"),
		state: String(status.state ?? "unknown"),
		cwd: status.cwd as string | undefined,
		workflowKey: status.workflowKey as string | undefined,
		parentWorkflowRunId: status.parentWorkflowRunId as string | undefined,
		startedAt: status.startedAt as number | undefined,
		endedAt: status.endedAt as number | undefined,
		durationMs: status.durationMs as number | undefined,
		agents,
		totalTokens: tokens,
		totalCostUsd: (status.totalCost as any)?.costUsd,
		toolCount: status.toolCount as number | undefined,
		turnCount: status.turnCount as number | undefined,
		hasEvents: Boolean(eventsPath),
		hasLog: has(join(dir, `subagent-log-${runId}.md`)),
		hasMission: has(join(dir, "mission.json")),
		hasReceipt: has(join(dir, "workflow-receipt.json")),
		artifactCount: artifacts.length,
	};
}

export function scanRuns(): ScanResult {
	const byId = new Map<string, { dir: string; status: StatusDoc; eventsPath: string | null }>();
	const runs: RunSummary[] = [];
	for (const root of runDirs()) {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = join(root, entry.name);
			const read = readRun(dir);
			if (!read) continue;
			const runId = String(read.status.runId ?? read.status.id ?? entry.name);
			byId.set(runId, read);
			runs.push(summarize(dir, read.status, read.eventsPath));
		}
	}
	runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
	return { runs, byId };
}

export function readReceipt(dir: string): WorkflowReceipt | null {
	return safeReadJson(join(dir, "workflow-receipt.json")) as WorkflowReceipt | null;
}

export function readMission(dir: string): unknown {
	return safeReadJson(join(dir, "mission.json"));
}

export function readProcessTerminal(dir: string): unknown {
	return safeReadJson(join(dir, "process-terminal.json"));
}
