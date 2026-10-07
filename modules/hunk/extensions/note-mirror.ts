/**
 * note-mirror — persist Hunk's live review notes so a crash or daemon restart is recoverable.
 *
 * Hunk keeps review notes in the live session (ReviewStore and live comments), and a
 * relaunched window loses them. This extension mirrors every saved note to disk on
 * `note_changed` and replays the mirror into a fresh session:
 *
 *   hunk mirror status     what is currently mirrored
 *   hunk mirror restore    replay the mirror into the live session
 *   hunk mirror clear      drop the mirror
 *
 * Capture shells out to the session broker because the extension event carries only an
 * opaque `fileKey`; `hunk session comment list` is the surface that pairs a note's body
 * with its file path. Nothing here writes to stdout from an event handler — the TUI owns it.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionCliCommandContext, HunkExtensionAPI } from "hunkdiff/extension";

const CAPTURE_DEBOUNCE_MS = 400;
const MIRROR_DIR = join(homedir(), ".hunk", "mirrors");

/** One live agent comment as `hunk session comment list --json` reports it. */
interface LiveComment {
	commentId: string;
	parentId?: string;
	filePath: string;
	hunkIndex?: number;
	side: "old" | "new";
	line: number;
	summary: string;
	rationale?: string;
	author?: string;
	createdAt?: string;
}

/** One saved reviewer note as `hunk session comment list --type all --json` reports it. */
interface ReviewNote {
	noteId: string;
	parentId?: string;
	source: string;
	filePath: string;
	hunkIndex?: number;
	oldRange?: [number, number];
	newRange?: [number, number];
	body: string;
	author?: string;
	createdAt?: string;
}

/** The on-disk mirror for one repository's most recent review. */
interface Mirror {
	version: 1;
	capturedAt: string;
	repoRoot: string;
	sourceLabel?: string;
	liveComments: LiveComment[];
	reviewNotes: ReviewNote[];
}

interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** The identity fields the session review exposes, whichever wrapper level they sit at. */
interface SessionIdentity {
	repoRoot?: string;
	sourceLabel?: string;
}

/** One note flattened to the fields `hunk session comment add` needs. */
interface RestoreItem {
	id: string;
	parentId?: string;
	filePath?: string;
	side?: "old" | "new";
	line?: number;
	oldLine?: number;
	newLine?: number;
	summary: string;
	rationale?: string;
	author?: string;
	/** True when a user-authored note has to be re-created as an agent comment (no user-note write path). */
	fromUser?: boolean;
}

/** Resolve the Hunk executable, preferring the running binary over a PATH lookup. */
function resolveHunkBin(): string {
	const override = process.env.HUNK_BIN;
	if (override) return override;
	const exec = basename(process.execPath);
	if (exec === "hunk" || exec.startsWith("hunk-")) return process.execPath;
	return "hunk";
}

/** Run the Hunk CLI and capture its output. Never rejects; a spawn failure is exit 127. */
function runHunk(args: string[], cwd: string, signal?: AbortSignal): Promise<RunResult> {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(resolveHunkBin(), args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				signal,
			});
		} catch (error) {
			resolve({ code: 127, stdout: "", stderr: String(error) });
			return;
		}
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		let settled = false;
		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			resolve({
				code,
				stdout: Buffer.concat(out).toString("utf8"),
				stderr: Buffer.concat(err).toString("utf8"),
			});
		};
		child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
		child.on("error", (error) => {
			if (!settled) {
				settled = true;
				resolve({ code: 127, stdout: "", stderr: String(error) });
			}
		});
		child.on("close", (code) => finish(code ?? 1));
	});
}

/** Parse JSON, returning null rather than throwing on a non-JSON payload. */
function parseJson<T>(text: string): T | null {
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

/** Pull an array out of either a bare array or a `{ comments: [...] }` wrapper. */
function extractArray<T>(text: string): T[] {
	const parsed = parseJson<unknown>(text);
	if (Array.isArray(parsed)) return parsed as T[];
	if (parsed && typeof parsed === "object" && Array.isArray((parsed as { comments?: unknown }).comments)) {
		return (parsed as { comments: T[] }).comments;
	}
	return [];
}

/** Read the live session's identity so the mirror can be keyed by repository root. */
async function querySession(
	repo: string,
	signal?: AbortSignal,
): Promise<{ repoRoot: string; sourceLabel?: string } | null> {
	const result = await runHunk(["session", "review", "--repo", repo, "--json"], repo, signal);
	if (result.code !== 0) return null;
	// `hunk session review --json` wraps the review under a `review` key, like `comment list` wraps notes.
	const parsed = parseJson<{ review?: SessionIdentity } & SessionIdentity>(result.stdout);
	const body = parsed?.review ?? parsed;
	if (!body) return null;
	return { repoRoot: body.repoRoot ?? repo, sourceLabel: body.sourceLabel };
}

/** One mirror file per repository, named for readability and disambiguated by a hash. */
function mirrorPath(repoRoot: string): string {
	const slug = basename(repoRoot).replace(/[^A-Za-z0-9._-]/g, "_") || "repo";
	const digest = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
	return join(MIRROR_DIR, `${slug}-${digest}.json`);
}

async function readMirror(path: string): Promise<Mirror | null> {
	try {
		const text = await readFile(path, "utf8");
		const mirror = parseJson<Mirror>(text);
		return mirror && mirror.version === 1 ? mirror : null;
	} catch {
		return null;
	}
}

async function writeMirror(path: string, mirror: Mirror): Promise<void> {
	await mkdir(MIRROR_DIR, { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(mirror, null, 2)}\n`, "utf8");
	await rename(tmp, path);
}

/** Read both note surfaces the broker exposes and write them to the mirror. */
async function capture(cwd: string): Promise<void> {
	const session = await querySession(cwd);
	if (!session) return;

	const [liveResult, noteResult] = await Promise.all([
		runHunk(["session", "comment", "list", "--repo", cwd, "--json"], cwd),
		runHunk(["session", "comment", "list", "--repo", cwd, "--type", "all", "--json"], cwd),
	]);
	if (liveResult.code !== 0 && noteResult.code !== 0) return;

	const liveComments = extractArray<LiveComment>(liveResult.stdout);
	const reviewNotes = extractArray<ReviewNote>(noteResult.stdout);
	const liveIds = new Set(liveComments.map((comment) => comment.commentId));

	const mirror: Mirror = {
		version: 1,
		capturedAt: new Date().toISOString(),
		repoRoot: session.repoRoot,
		sourceLabel: session.sourceLabel,
		liveComments,
		// A saved note appears on both broker surfaces under the same id; keep the richer live record.
		reviewNotes: reviewNotes.filter((note) => !liveIds.has(note.noteId)),
	};
	await writeMirror(mirrorPath(session.repoRoot), mirror);
}

/** Flatten a mirror into restore items, preferring the richer live-comment record. */
function buildRestoreItems(mirror: Mirror): RestoreItem[] {
	const items: RestoreItem[] = [];
	const seen = new Set<string>();

	for (const comment of mirror.liveComments) {
		if (seen.has(comment.commentId)) continue;
		seen.add(comment.commentId);
		items.push({
			id: comment.commentId,
			parentId: comment.parentId,
			filePath: comment.filePath,
			side: comment.side,
			line: comment.line,
			summary: comment.summary,
			rationale: comment.rationale,
			author: comment.author,
		});
	}

	for (const note of mirror.reviewNotes) {
		if (!note.noteId || !note.body) continue;
		// A saved note appears on both broker surfaces under the same id; the live comment wins.
		if (seen.has(note.noteId)) continue;
		seen.add(note.noteId);
		items.push({
			id: note.noteId,
			parentId: note.parentId,
			filePath: note.filePath,
			oldLine: note.newRange ? undefined : note.oldRange?.[0],
			newLine: note.newRange?.[0],
			summary: note.body,
			author: note.author,
			fromUser: note.source === "user",
		});
	}

	return items;
}

/** Extract the id of a note the CLI just created from its (possibly wrapped) JSON result. */
function extractCreatedId(text: string): string | null {
	const parsed = parseJson<Record<string, unknown>>(text);
	if (!parsed) return null;
	// `comment add --json` wraps its payload under `result`; accept a bare shape too.
	const containers = [parsed, parsed.result, parsed.comment, parsed.note];
	for (const container of containers) {
		if (!container || typeof container !== "object") continue;
		for (const key of ["commentId", "noteId", "id"]) {
			const value = (container as Record<string, unknown>)[key];
			if (typeof value === "string" && value) return value;
		}
	}
	return null;
}

/** Replay an old note id's anchor as `comment add` arguments. */
function anchorArgs(item: RestoreItem): string[] | null {
	if (!item.filePath) return null;
	if (item.newLine !== undefined) return ["--file", item.filePath, "--new-line", String(item.newLine)];
	if (item.oldLine !== undefined) return ["--file", item.filePath, "--old-line", String(item.oldLine)];
	if (item.side && item.line !== undefined) {
		return ["--file", item.filePath, item.side === "old" ? "--old-line" : "--new-line", String(item.line)];
	}
	return null;
}

/** Replay the mirror into the live session, roots before their replies. */
async function restore(mirror: Mirror, repo: string, ctx: ExtensionCliCommandContext): Promise<number> {
	const items = buildRestoreItems(mirror);
	const idMap = new Map<string, string>();
	let created = 0;
	let failed = 0;
	let userRestored = 0;
	let pending = items;

	for (let pass = 0; pass < 4 && pending.length > 0; pass += 1) {
		const deferred: RestoreItem[] = [];
		for (const item of pending) {
			const parentId = item.parentId ? idMap.get(item.parentId) : undefined;
			if (item.parentId && !parentId) {
				deferred.push(item);
				continue;
			}

			const args = ["session", "comment", "add", "--repo", repo, "--summary", item.summary];
			if (parentId) {
				args.push("--reply-to", parentId);
			} else {
				const anchor = anchorArgs(item);
				if (!anchor) {
					failed += 1;
					await ctx.stderr.write(`  ! no usable anchor for: ${item.summary.slice(0, 60)}\n`);
					continue;
				}
				args.push(...anchor);
			}
			if (item.rationale) args.push("--rationale", item.rationale);
			if (item.author) args.push("--author", item.author);
			args.push("--json");

			const result = await runHunk(args, repo, ctx.signal);
			const id = result.code === 0 ? extractCreatedId(result.stdout) : null;
			if (id) {
				idMap.set(item.id, id);
				created += 1;
				if (item.fromUser) userRestored += 1;
			} else {
				failed += 1;
				await ctx.stderr.write(`  ! ${item.filePath ?? "reply"}: ${result.stderr.trim() || "no id returned"}\n`);
			}
		}
		if (deferred.length === pending.length) {
			for (const item of deferred) {
				failed += 1;
				await ctx.stderr.write(`  ! reply without a restored parent: ${item.summary.slice(0, 60)}\n`);
			}
			break;
		}
		pending = deferred;
	}

	const failedSuffix = failed > 0 ? `, ${failed} failed` : "";
	const userSuffix = userRestored > 0 ? ` (${userRestored} user ${userRestored === 1 ? "note" : "notes"} re-created as agent ${userRestored === 1 ? "comment" : "comments"})` : "";
	await ctx.stdout.write(`Restored ${created} ${created === 1 ? "note" : "notes"}${userSuffix}${failedSuffix}.\n`);
	return failed > 0 && created === 0 ? 1 : 0;
}

/** Read a `--flag value` option from a raw argument list. */
function readOption(args: readonly string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

export default function noteMirror(hunk: HunkExtensionAPI) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let capturing = false;
	let pendingCapture: string | null = null;

	/** Coalesce bursts of note changes into one capture. */
	function scheduleCapture(cwd: string) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void runCapture(cwd);
		}, CAPTURE_DEBOUNCE_MS);
	}

	async function runCapture(cwd: string) {
		if (capturing) {
			pendingCapture = cwd;
			return;
		}
		capturing = true;
		try {
			await capture(cwd);
		} catch {
			// A capture failure keeps the previous mirror; the next note change retries.
		} finally {
			capturing = false;
			const next = pendingCapture;
			pendingCapture = null;
			if (next) void runCapture(next);
		}
	}

	hunk.on("note_changed", (_payload, ctx) => {
		scheduleCapture(ctx.cwd);
	});

	hunk.registerCliCommand(
		{ name: "mirror", summary: "Recover Hunk review notes mirrored to disk", usage: "status | restore | clear" },
		async (args, ctx) => {
			const sub = args.find((arg) => !arg.startsWith("-")) ?? "status";
			const repo = readOption(args, "--repo") ?? ctx.cwd;
			const session = await querySession(repo, ctx.signal);
			const repoRoot = session?.repoRoot ?? repo;
			const path = mirrorPath(repoRoot);
			const mirror = await readMirror(path);

			if (sub === "clear") {
				await rm(path, { force: true });
				await ctx.stdout.write(`Cleared ${path}\n`);
				return { kind: "exit" };
			}

			if (!mirror) {
				await ctx.stderr.write(`No mirror at ${path}\n`);
				return { kind: "exit", code: sub === "restore" ? 1 : 0 };
			}

			if (sub === "status") {
				const stale = session?.sourceLabel && mirror.sourceLabel && session.sourceLabel !== mirror.sourceLabel;
				await ctx.stdout.write(
					[
						`${path}`,
						`  captured ${mirror.capturedAt} from ${mirror.sourceLabel ?? "unknown source"}`,
						`  ${mirror.liveComments.length} live ${mirror.liveComments.length === 1 ? "comment" : "comments"}, ${mirror.reviewNotes.length} review ${mirror.reviewNotes.length === 1 ? "note" : "notes"}`,
						stale ? `  (current review source is ${session?.sourceLabel}; anchors may not match)` : "",
					]
						.filter(Boolean)
						.join("\n") + "\n",
				);
				return { kind: "exit" };
			}

			if (sub === "restore") {
				if (!session) {
					await ctx.stderr.write(`No live Hunk session for ${repo}; nothing to restore into.\n`);
					return { kind: "exit", code: 1 };
				}
				const code = await restore(mirror, repo, ctx);
				return { kind: "exit", code };
			}

			await ctx.stderr.write("usage: hunk mirror status | restore | clear [--repo <path>]\n");
			return { kind: "exit", code: 1 };
		},
	);
}
