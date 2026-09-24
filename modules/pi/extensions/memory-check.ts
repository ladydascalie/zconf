/**
 * Memory Check Extension
 *
 * Read-only checks over the memory store and the spec library, run once at
 * session start and reported into the system prompt. Silent when clean.
 *
 * Why this exists: the rules in ~/.pi/agent/AGENTS.md and the skills are
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

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const AGENTS_MD = path.join(AGENT_DIR, "AGENTS.md");
const MEMORY_DIR = path.join(AGENT_DIR, "memory");
const REFERENCE_MD = path.join(MEMORY_DIR, "REFERENCE.md");
const PLANS_DIR = path.join(os.homedir(), "openspec", "plans");
const CORE_BUDGET_BYTES = 10 * 1024;
const STALE_TASKS_DAYS = 7;
const CHECK_ENTRY_TYPE = "memory-check";

let findings: string[] | undefined;

async function computeFindings(pi: ExtensionAPI): Promise<string[]> {
	const out: string[] = [];
	await runCheck("core size", out, () => checkCoreSize(out));
	await runCheck("pointers", out, () => checkPointers(out));
	await runCheck("memory store git", out, () => checkGitClean(pi, MEMORY_DIR, "The memory store", out));
	await runCheck("spec library git", out, () => checkGitClean(pi, PLANS_DIR, "The spec library", out));
	await runCheck("closeout", out, () => checkCloseout(out));
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

/** 1. The injected core has a budget. Growth is only visible if something looks. */
function checkCoreSize(findings: string[]): void {
	const stat = fs.statSync(AGENTS_MD);
	if (stat.size > CORE_BUDGET_BYTES) {
		const kb = (stat.size / 1024).toFixed(1);
		findings.push(
			`AGENTS.md is ${kb} KB, over the ~10 KB budget — move a whole section to memory/REFERENCE.md and leave one pointer line.`,
		);
	}
}

/** 2. A pointer that does not resolve is a manifest that lies. */
function checkPointers(findings: string[]): void {
	const agents = readIfFile(AGENTS_MD) ?? "";
	const reference = readIfFile(REFERENCE_MD) ?? "";
	const headings = new Set(
		reference
			.split("\n")
			.filter((line) => line.startsWith("## "))
			.map((line) => line.slice(3).trim()),
	);
	for (const match of agents.matchAll(/`REFERENCE\.md`\s*§\s*(.+?)\s+(?:—|--)/g)) {
		const section = match[1].trim();
		if (!headings.has(section)) {
			findings.push(`Manifest points at REFERENCE.md § ${section}, which has no such heading.`);
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

function formatFindings(findings: string[]): string {
	return [
		"## Memory check (memory-check extension, read-only)",
		"Findings over the memory store and the spec library. Act on them, or say why not.",
		...findings.map((finding) => `- ${finding}`),
		"Skills: ~/.pi/agent/skills/memory-keeping/ and ~/.pi/agent/skills/spec-keeping/.",
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
