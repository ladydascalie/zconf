// events.jsonl parsing: stream NDJSON, group per child, rebuild transcripts.
// Every event type we don't know is ignored (forward compatibility).

import type { ContentBlock, ParsedMessage, ToolExecution, Usage } from "./types.ts";

const MAX_STRING = 20_000; // per-string cap with explicit truncation marker

function cap(value: unknown): unknown {
	if (typeof value === "string") {
		if (value.length > MAX_STRING) {
			return { __truncated: true, length: value.length, text: value.slice(0, MAX_STRING) };
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(cap);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cap(v);
		return out;
	}
	return value;
}

export interface RawEvent {
	type: string;
	ts?: number;
	[key: string]: unknown;
}

/** Stream-parse an NDJSON file without holding the whole file in memory. */
export async function* readNdjson(path: string, startLine = 0): AsyncGenerator<{ line: number; event: RawEvent }> {
	const { createReadStream } = await import("node:fs");
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
	let lineNo = -1;
	for await (const line of rl) {
		lineNo++;
		if (lineNo < startLine) continue;
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			yield { line: lineNo, event: JSON.parse(trimmed) as RawEvent };
		} catch {
			// tolerate corrupt/partial trailing line (file is append-only)
		}
	}
}

interface ChildAcc {
	childRunId: string;
	agent?: string;
	stepIndex: number;
	messages: ParsedMessage[];
	toolExecutions: Map<string, ToolExecution>;
	totalUsage: Usage;
	startedAt?: number;
	endedAt?: number;
	eventCount: number;
	firstUserMessage?: string;
}

function newChild(childRunId: string, stepIndex: number, agent?: string): ChildAcc {
	return {
		childRunId,
		agent,
		stepIndex,
		messages: [],
		toolExecutions: new Map(),
		totalUsage: {},
		eventCount: 0,
	};
}

function addUsage(tot: Usage, u?: Usage): void {
	if (!u) return;
	for (const k of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total", "totalTokens"] as const) {
		const v = u[k];
		if (typeof v === "number") tot[k] = (tot[k] ?? 0) + v;
	}
}

function blocksOf(message: any): ContentBlock[] {
	const content = message?.content;
	if (!Array.isArray(content)) return [];
	return content.filter((b: any) => b && typeof b === "object");
}

/**
 * Build child transcripts from a run's events.jsonl.
 * Events carry child annotations on the top level: subagentRunId / subagentStepIndex / subagentAgent.
 * Wrapper events (subagent.*) have no subagentSource and are skipped here.
 */
export async function buildTranscripts(
	eventsPath: string,
	opts: { childRunIds?: string[]; maxEvents?: number } = {},
): Promise<Map<string, ChildAcc>> {
	const children = new Map<string, ChildAcc>();
	const byStep = new Map<string, ChildAcc>(); // fallback key for events without subagentRunId
	const maxEvents = opts.maxEvents ?? Infinity;

	let count = 0;
	for await (const { event } of readNdjson(eventsPath)) {
		if (count++ >= maxEvents) break;
		const type = event.type;
		if (!type) continue;
		// wrapper lifecycle events
		if (typeof type === "string" && type.startsWith("subagent.")) continue;

		const childRunId = typeof event.subagentRunId === "string" ? event.subagentRunId : "";
		if (opts.childRunIds && childRunId && !opts.childRunIds.includes(childRunId)) continue;
		const stepIndex = typeof event.subagentStepIndex === "number" ? event.subagentStepIndex : 0;
		const agent = typeof event.subagentAgent === "string" ? event.subagentAgent : undefined;
		const key = childRunId || `step:${stepIndex}`;
		let acc = children.get(key);
		if (!acc) {
			acc = newChild(childRunId || key, stepIndex, agent);
			children.set(key, acc);
		}
		if (acc.agent === undefined && agent) acc.agent = agent;
		acc.eventCount++;
		if (typeof event.ts === "number") {
			if (acc.startedAt === undefined || event.ts < acc.startedAt) acc.startedAt = event.ts;
			if (acc.endedAt === undefined || event.ts > acc.endedAt) acc.endedAt = event.ts;
		}
		void byStep;

		switch (type) {
			case "message_end": {
				const msg = event.message as any;
				if (!msg) break;
				const role = msg.role;
				const blocks = blocksOf(msg);
				if (role === "user" && acc.firstUserMessage === undefined) {
					const first = blocks.find((b) => b.type === "text")?.text;
					if (typeof first === "string") acc.firstUserMessage = first;
				}
				acc.messages.push({
					role: String(role ?? "unknown"),
					blocks: cap(blocks) as ContentBlock[],
					model: typeof msg.model === "string" ? msg.model : undefined,
					provider: typeof msg.provider === "string" ? msg.provider : undefined,
					usage: msg.usage as Usage | undefined,
					cost: msg.usage?.cost,
					stopReason: typeof msg.stopReason === "string" ? msg.stopReason : undefined,
					timestamp: typeof msg.timestamp === "number" ? msg.timestamp : (event.ts as number | undefined),
				});
				if (role === "assistant") addUsage(acc.totalUsage, msg.usage);
				break;
			}
			case "tool_execution_start": {
				const id = String(event.toolCallId ?? "");
				if (!id) break;
				acc.toolExecutions.set(id, {
					toolCallId: id,
					toolName: event.toolName as string | undefined,
					args: cap(event.args),
					startedAt: (event.ts as number) ?? undefined,
				});
				break;
			}
			case "tool_execution_end": {
				const id = String(event.toolCallId ?? "");
				const exec = acc.toolExecutions.get(id);
				if (!exec) break;
				exec.result = cap(event.result ?? event.output);
				exec.isError = Boolean(event.isError);
				exec.state = event.isError ? "error" : "ok";
				exec.endedAt = (event.ts as number) ?? undefined;
				break;
			}
			default:
				break;
		}
	}
	// finalize: mark tool calls that were issued but never executed (aborted runs)
	for (const acc of children.values()) {
		for (const msg of acc.messages) {
			for (const block of msg.blocks) {
				if (block.type !== "toolCall" || !block.id) continue;
				const id = String(block.id);
				if (acc.toolExecutions.has(id)) continue;
				acc.toolExecutions.set(id, {
					toolCallId: id,
					toolName: block.name,
					args: cap(block.arguments),
					state: "aborted",
				});
			}
		}
	}
	return children;
}

/** Convert internal accumulators to the wire shape. */
export function transcriptsToWire(accs: Iterable<ChildAcc>) {
	return [...accs].map((a) => ({
		childRunId: a.childRunId,
		agent: a.agent,
		stepIndex: a.stepIndex,
		messages: a.messages,
		toolExecutions: [...a.toolExecutions.values()],
		totalUsage: a.totalUsage,
		startedAt: a.startedAt,
		endedAt: a.endedAt,
		eventCount: a.eventCount,
		firstUserMessage: a.firstUserMessage,
	}));
}

/** Lightweight per-child overview without full parsing (counts only). */
export async function eventsOverview(eventsPath: string) {
	const { stat } = await import("node:fs/promises");
	const info = await stat(eventsPath).catch(() => null);
	if (!info) return null;
	const perChild = new Map<string, { agent?: string; events: number; types: Record<string, number> }>();
	for await (const { event } of readNdjson(eventsPath)) {
		const type = event.type;
		if (!type) continue;
		const childRunId = typeof event.subagentRunId === "string" ? event.subagentRunId : "_wrapper";
		let rec = perChild.get(childRunId);
		if (!rec) {
			rec = { agent: event.subagentAgent as string | undefined, events: 0, types: {} };
			perChild.set(childRunId, rec);
		}
		if (rec.agent === undefined && typeof event.subagentAgent === "string") rec.agent = event.subagentAgent;
		rec.events++;
		rec.types[type] = (rec.types[type] ?? 0) + 1;
	}
	return {
		path: eventsPath,
		bytes: info.size,
		mtimeMs: info.mtimeMs,
		children: [...perChild.entries()].map(([runId, r]) => ({ runId, ...r })),
	};
}
