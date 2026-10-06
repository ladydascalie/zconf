/**
 * Memory Check Extension
 *
 * Read-only checks over the memory store and the spec library, run once at
 * session start and reported into the system prompt. Silent when clean.
 *
 * Why this exists: the rules in each harness's `AGENTS.md` and the skills are
 * otherwise unenforced, and a stale or overgrown always-injected file misleads
 * every session. This has no authority by design — it never blocks a tool call,
 * a session switch, or a commit. It reports, and nothing more.
 *
 * Every check is cheap, deterministic and local: no network, no model call.
 * A check that fails to run is reported rather than silently skipped, so the
 * checker cannot itself rot into a silent no-op.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CORES = [
	{ label: "~/.pi/agent/AGENTS.md", file: path.join(os.homedir(), ".pi", "agent", "AGENTS.md") },
	{ label: "~/.config/delta/AGENTS.md", file: path.join(os.homedir(), ".config", "delta", "AGENTS.md") },
];
const STORE_DIR = path.join(os.homedir(), ".agents", "store");
const MEMORY_DIR = path.join(STORE_DIR, "memory");
const PLANS_DIR = path.join(STORE_DIR, "plans");
const CORE_BUDGET_BYTES = 10 * 1024;
const STALE_TASKS_DAYS = 7;
const CHECK_ENTRY_TYPE = "memory-check";

let findings: string[] | undefined;

async function computeFindings(pi: ExtensionAPI): Promise<string[]> {
	const out: string[] = [];
	await runCheck("core size", out, () => checkCoreSize(out));
	await runCheck("pointers", out, () => checkPointers(out));
	await runCheck("store git", out, () => checkGitClean(pi, STORE_DIR, "The store", out));
	await runCheck("closeout", out, () => checkCloseout(out));
	await runCheck("anchors", out, () => checkAnchors(pi, out));
	return out;
}

/**
 * Computed lazily on first use rather than only from `session_start`.
 *
 * `/reload` replaces the extension runtime without starting a session, so a
 * `session_start`-only check is inert after exactly the reload you just made to
 * change it. Computing on demand covers both paths.
 */
async function ensureFindings(pi: ExtensionAPI): Promise<string[]> {
	if (findings === undefined) {
		findings = await computeFindings(pi);
		// Audit trail. The report itself rides `before_agent_start`'s systemPrompt,
		// which replaces the prompt for that run and is NOT recorded in the
		// transcript — so without this, the check's silence and its absence would be
		// indistinguishable after the fact. Appended even when clean: the entry's
		// presence is the proof it ran, its content is the result. Non-context, so it
		// is stored in the session and never sent to the model.
		pi.appendEntry(CHECK_ENTRY_TYPE, { at: new Date().toISOString(), findings });
	}
	return findings;
}

function readIfFile(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return undefined;
	}
}

async function runCheck(
	name: string,
	findings: string[],
	fn: () => void | Promise<void>,
): Promise<void> {
	try {
		await fn();
	} catch (error) {
		findings.push(`Check "${name}" failed to run: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** 1. Each injected core has a budget. Growth is only visible if something looks. */
function checkCoreSize(findings: string[]): void {
	for (const core of CORES) {
		let size: number;
		try {
			size = fs.statSync(core.file).size;
		} catch {
			continue; // harness not installed on this machine
		}
		if (size > CORE_BUDGET_BYTES) {
			const kb = (size / 1024).toFixed(1);
			findings.push(
				`${core.label} is ${kb} KB, over the ~10 KB budget — move a whole section to memory/REFERENCE.md and leave one pointer line.`,
			);
		}
	}
}

/** 2. A pointer that does not resolve is a manifest that lies. */
function checkPointers(findings: string[]): void {
	for (const core of CORES) {
		const agents = readIfFile(core.file) ?? "";
		for (const line of agents.split("\n")) {
			if (!line.includes("§")) continue; // only § lines carry a section pointer
			const file = line.match(/`([A-Za-z0-9._-]*\.md)`/)?.[1];
			if (!file) continue;
			const section = line
				.replace(/^.*§\s*/, "")
				.replace(/\s+(?:—|--).*$/, "")
				.trim();
			const body = readIfFile(path.join(MEMORY_DIR, file));
			if (body === undefined) {
				findings.push(`${core.label} names ${file}, which does not exist in the store.`);
			} else if (section && !body.split("\n").includes(`## ${section}`)) {
				findings.push(`${core.label} points at ${file} § ${section}, which has no such heading.`);
			}
		}
	}

	const readme = readIfFile(path.join(PLANS_DIR, "README.md")) ?? "";
	for (const match of readme.matchAll(/^- ((?:specs|changes)\/[^\s`]+\.md)/gm)) {
		const rel = match[1];
		if (!fs.existsSync(path.join(PLANS_DIR, rel))) {
			findings.push(`Spec library README points at ${rel}, which does not exist.`);
		}
	}
}

/** 3 + 4. A store with uncommitted edits means the last session did not finish. */
async function checkGitClean(
	pi: ExtensionAPI,
	dir: string,
	label: string,
	findings: string[],
): Promise<void> {
	const { stdout, code } = await pi.exec("git", ["-C", dir, "status", "--porcelain"]);
	if (code !== 0) return; // not a repo, or git unavailable — stay quiet
	const files = stdout.split("\n").filter((line) => line.trim().length > 0);
	if (files.length > 0) {
		findings.push(`${label} has ${files.length} uncommitted file(s) — commit them (${dir}).`);
	}
}

/**
 * 5. A finished tasks file that nobody has touched for a while is a missed closeout.
 *
 * Deliberately staleness-based rather than "all tasks done": a file that just
 * completed may legitimately be waiting for its PR to merge, and a checker that
 * fires on that trains you to ignore it. Merged branches are also usually
 * deleted, so a `git branch --merged` test cannot detect the real case.
 */
function checkCloseout(findings: string[]): void {
	const changesDir = path.join(PLANS_DIR, "changes");
	let entries: string[];
	try {
		entries = fs.readdirSync(changesDir);
	} catch {
		return;
	}
	const cutoff = Date.now() - STALE_TASKS_DAYS * 24 * 60 * 60 * 1000;
	for (const name of entries) {
		if (!name.endsWith(".tasks.md")) continue;
		const file = path.join(changesDir, name);
		const body = readIfFile(file) ?? "";
		const open = (body.match(/\[ \]/g) ?? []).length;
		const done = (body.match(/\[x\]/gi) ?? []).length;
		if (open > 0 || done === 0) continue;
		if (fs.statSync(file).mtimeMs > cutoff) continue;
		findings.push(
			`changes/${name} has no open tasks and has not changed in over ${STALE_TASKS_DAYS} days — verify whether it landed; if so close it out (promote the spec, delete the file, drop the README In flight line).`,
		);
	}
}

const ANCHOR_RE = /<!--\s*verify\s([^>]*?)-->/g;

/** Stable repo name -> local checkout. Mirrors ~/zconf/modules/memory/recall-verify.sh. */
function repoPath(repo: string): string | undefined {
	const home = os.homedir();
	const map: Record<string, string> = {
		"go-backend": path.join(home, "Code", "LootLocker", "go-backend"),
		index: path.join(home, "Code", "LootLocker", "index"),
		"ll-frontend": path.join(home, "Code", "LootLocker", "ll-frontend"),
		"publisher-frontend": path.join(home, "Code", "LootLocker", "publisher-frontend"),
		"php-backend": path.join(home, "Code", "LootLocker", "php-backend"),
		runbooks: path.join(home, "Code", "Personal", "runbooks"),
		"runbooks-docs": path.join(home, "Code", "Personal", "runbooks-docs"),
	};
	return map[repo];
}

function listMarkdown(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name === ".git") continue;
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".md")) out.push(p);
		}
	};
	walk(dir);
	return out;
}

function parseAttrs(s: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const kv of s.trim().split(/\s+/)) {
		const i = kv.indexOf("=");
		if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
	}
	return out;
}

/** 6. An anchored fact whose symbol or path moved is stale until re-checked. */
async function verifyAnchor(pi: ExtensionAPI, a: Record<string, string>): Promise<string | undefined> {
	const dir = a.repo ? repoPath(a.repo) : undefined;
	if (!dir) return `repo ${a.repo} has no local path — unverifiable (memory kept)`;
	if (!fs.existsSync(path.join(dir, ".git"))) return `repo ${a.repo} not checked out — unverifiable (memory kept)`;
	const ok = async (args: string[]): Promise<boolean> =>
		(await pi.exec("git", ["-C", dir, ...args])).code === 0;
	if (!(await ok(["cat-file", "-e", `${a.sha}^{commit}`]))) return `commit ${a.sha} gone (rebased/gc'd)`;
	if (a.path) {
		if (!(await ok(["cat-file", "-e", `HEAD:${a.path}`]))) return `path ${a.path} missing at HEAD (moved/renamed)`;
		const { stdout, code } = await pi.exec("git", ["-C", dir, "log", "--oneline", `${a.sha}..HEAD`, "--", a.path]);
		if (code === 0 && stdout.trim().length > 0) return `path ${a.path} changed since ${a.sha}`;
	}
	if (a.symbol && !(await ok(["grep", "-qw", "-e", a.symbol, "HEAD"]))) return `symbol ${a.symbol} missing at HEAD (renamed?)`;
	return undefined;
}

async function checkAnchors(pi: ExtensionAPI, findings: string[]): Promise<void> {
	for (const file of listMarkdown(MEMORY_DIR)) {
		const lines = (readIfFile(file) ?? "").split("\n");
		for (let i = 0; i < lines.length; i++) {
			for (const m of lines[i].matchAll(ANCHOR_RE)) {
				const a = parseAttrs(m[1]);
				const problem = await verifyAnchor(pi, a);
				if (problem) findings.push(`${path.relative(MEMORY_DIR, file)}:${i + 1}: ${problem} [${a.repo}@${a.sha}]`);
			}
		}
	}
}

function formatFindings(findings: string[]): string {
	return [
		"## Memory check (memory-check extension, read-only)",
		"Findings over the memory store and the spec library. Act on them, or say why not.",
		...findings.map((finding) => `- ${finding}`),
		"Skills: ~/.agents/skills/memory-keeping/ and ~/.agents/skills/spec-keeping/.",
	].join("\n");
}

export default function memoryCheckExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		findings = undefined;
		const current = await ensureFindings(pi);
		if (current.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`Memory check: ${current.length} finding(s)`, "warning");
		}
	});

	// Findings ride the system prompt rather than a transcript message: they are
	// session-start guidance, not conversation. Cached for the session so the
	// prompt prefix does not churn turn to turn.
	pi.on("before_agent_start", async (event) => {
		const current = await ensureFindings(pi);
		if (current.length === 0) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${formatFindings(current)}` };
	});

	// Manual trigger, so the mechanism is inspectable rather than invisible:
	// confirm it loaded, or re-run it mid-session after a merge lands.
	pi.registerCommand("memory-check", {
		description: "Run the read-only memory/spec drift checks now",
		handler: async (_args, ctx) => {
			findings = undefined;
			const current = await ensureFindings(pi);
			ctx.ui.notify(
				current.length === 0 ? "Memory check: clean" : formatFindings(current),
				current.length === 0 ? "info" : "warning",
			);
		},
	});
}
