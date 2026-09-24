// Spike: validate scanner + events parser against real runs on disk.
// Run: node scripts/spike.ts

import { scanRuns, readReceipt, listRunArtifacts } from "../lib/scanner.ts";
import { buildTranscripts, eventsOverview } from "../lib/events.ts";

const scan = scanRuns();
console.log(`discovered ${scan.runs.length} runs\n`);

let failures = 0;
const fail = (msg: string) => {
	failures++;
	console.log(`  FAIL: ${msg}`);
};
const usageOf = (m: { usage?: { totalTokens?: number; total?: number } }) => m.usage?.totalTokens ?? m.usage?.total ?? 0;

for (const run of scan.runs) {
	console.log(`== ${run.runId.slice(0, 8)}  mode=${run.mode}  state=${run.state}  agents=[${run.agents.join(",")}]  key=${run.workflowKey ?? "-"}  parent=${run.parentWorkflowRunId?.slice(0, 8) ?? "-"}`);
	console.log(`   tokens=${JSON.stringify(run.totalTokens)}  cost=$${run.totalCostUsd?.toFixed(6) ?? "-"}  artifacts=${run.artifactCount}  events=${run.hasEvents}  log=${run.hasLog}  receipt=${run.hasReceipt}`);

	const entry = scan.byId.get(run.runId);
	if (!entry) fail("not in byId");

	if (run.mode === "workflow") {
		const ov = entry?.eventsPath ? await eventsOverview(entry.eventsPath) : null;
		if (ov) {
			const annotated = ov.children.filter((c) => c.runId !== "_wrapper");
			if (annotated.length > 0) console.log(`   note: workflow events.jsonl has ${annotated.length} annotated child(s) (unexpected shape, handled anyway)`);
			console.log(`   wrapper events: ${ov.children.find((c) => c.runId === "_wrapper")?.events ?? 0}`);
		}
		const receipt = entry ? readReceipt(entry.dir) : null;
		const childRunIds = (entry?.status.steps ?? []).map((s) => String(s.runId ?? "")).filter(Boolean);
		const receiptChildIds = Object.values(receipt?.entries ?? {}).map((e) => String(e.latestRunId ?? ""));
		if (JSON.stringify([...childRunIds].sort()) !== JSON.stringify([...receiptChildIds].sort())) {
			console.log(`   note: receipt child ids ${receiptChildIds.map((x) => x.slice(0, 8)).join(",")} vs steps ${childRunIds.map((x) => x.slice(0, 8)).join(",")}`);
		}
		for (const cid of childRunIds) {
			const child = scan.byId.get(cid);
			if (!child) {
				fail(`workflow child ${cid.slice(0, 8)} has no run dir`);
				continue;
			}
			const cts = child.eventsPath ? await buildTranscripts(child.eventsPath) : new Map();
			const t = cts.get(cid) ?? [...cts.values()][0];
			if (!t) fail(`child ${cid.slice(0, 8)} produced no transcript`);
			else {
				const toolCalls = t.messages.flatMap((m) => m.blocks.filter((b) => b.type === "toolCall"));
				const execs = [...t.toolExecutions.values()];
				const unpaired = toolCalls.filter((c) => c.id && !execs.some((e) => e.toolCallId === c.id));
				const inSum = t.messages.filter((m) => m.role === "assistant").reduce((s, m) => s + (m.usage?.input ?? 0), 0);
				const outSum = t.messages.filter((m) => m.role === "assistant").reduce((s, m) => s + (m.usage?.output ?? 0), 0);
				const st = child.status.steps?.[0]?.tokens ?? {};
				const aborted = execs.filter((e) => e.state === "aborted").length;
				console.log(`   child ${cid.slice(0, 8)}: ${t.messages.length} msgs (${t.messages.filter((m) => m.role === "assistant").length} asst), ${toolCalls.length} toolCalls, ${execs.length} execs (aborted=${aborted}), unpaired=${unpaired.length}, in/out=${inSum}/${outSum} vs status=${st.input}/${st.output}`);
				if (t.messages.length === 0) fail("child transcript has zero messages");
				if (unpaired.length > 0) fail(`${unpaired.length} toolCalls without execution record`);
				if (inSum !== (st.input ?? -1) || outSum !== (st.output ?? -1)) fail(`usage mismatch: events in/out=${inSum}/${outSum} status=${st.input}/${st.output}`);
			}
		}
	} else {
		const ov = entry?.eventsPath ? await eventsOverview(entry.eventsPath) : null;
		if (!ov) fail("no events overview");
		else {
			console.log(`   events: ${ov.bytes}B, in file: ${ov.children.map((c) => `${c.runId.slice(0, 8)}(${c.agent ?? "wrapper"}:${c.events})`).join(" ")}`);
			const cts = await buildTranscripts(entry!.eventsPath!);
			for (const [key, t] of cts) {
				const toolCalls = t.messages.flatMap((m) => m.blocks.filter((b) => b.type === "toolCall"));
				const execs = [...t.toolExecutions.values()];
				const unpaired = toolCalls.filter((c) => c.id && !execs.some((e) => e.toolCallId === c.id));
				const asst = t.messages.filter((m) => m.role === "assistant");
				const inSum = asst.reduce((s, m) => s + (m.usage?.input ?? 0), 0);
				const outSum = asst.reduce((s, m) => s + (m.usage?.output ?? 0), 0);
				const aborted = execs.filter((e) => e.state === "aborted").length;
				const stt = entry?.status.totalTokens ?? {};
				console.log(`   transcript ${key.slice(0, 8)}: ${t.messages.length} msgs (${asst.length} asst), ${toolCalls.length} toolCalls, execs=${execs.length} (aborted=${aborted}), unpaired=${unpaired.length}, in/out=${inSum}/${outSum} vs status=${stt.input}/${stt.output}`);
				if (t.messages.length === 0) fail(`${key}: zero messages`);
				if (asst.length === 0) fail(`${key}: zero assistant messages`);
				if (inSum !== (stt.input ?? -1) || outSum !== (stt.output ?? -1)) fail(`usage mismatch: events in/out=${inSum}/${outSum} status=${stt.input}/${stt.output}`);
				if (unpaired.length > 0) fail(`${unpaired.length} toolCalls without execution record`);
			}
		}
	}

	const arts = entry ? listRunArtifacts(entry.status) : [];
	if (arts.length > 0) console.log(`   artifacts: ${arts.slice(0, 4).map((a) => `${a.name}(${a.bytes}B)`).join(", ")}${arts.length > 4 ? ` +${arts.length - 4}` : ""}`);
	console.log("");
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
