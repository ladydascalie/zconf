// fleet-web UI — no-build vanilla ES modules. Hash routing:
//   #/                    runs list
//   #/runs/<id>           run detail (tabs: transcript / artifacts / events / raw)

import { renderMd } from "./md.js";

const app = document.getElementById("app");
const liveBox = document.getElementById("live");
const conn = document.getElementById("conn");

const state = {
	route: { view: "list" },
	timer: null,
};

// ---------- helpers ----------

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) {
		let msg = res.statusText;
		try {
			msg = (await res.json()).error ?? msg;
		} catch {}
		throw new Error(`${res.status}: ${msg}`);
	}
	return res.json();
}

function fmtDur(ms) {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtNum(n) {
	if (n == null) return "—";
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function fmtCost(usd) {
	if (usd == null) return "—";
	return `$${usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4)}`;
}

function fmtTime(ts) {
	if (!ts) return "—";
	return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts) {
	if (!ts) return "—";
	return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function basename(p) {
	return p ? p.split("/").filter(Boolean).pop() : "";
}

function esc(s) {
	return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stateBadge(st) {
	return `<span class="badge ${esc(st)}">${esc(st)}</span>`;
}

function startPolling(fn, intervalMs = 3000) {
	stopPolling();
	const tick = () => {
		if (liveBox.checked) fn().catch(() => (conn.textContent = "poll failed"));
	};
	state.timer = setInterval(tick, intervalMs);
}

function stopPolling() {
	if (state.timer) clearInterval(state.timer);
	state.timer = null;
}

// Live updates: SSE push with polling fallback.
let sse = null;
let sseDebounce = null;

function startLive() {
	if (sse) return;
	// automation/headless dump contexts: EventSource holds the connection open
	// indefinitely (breaks virtual-time rendering); polling covers those cases
	if (typeof navigator !== "undefined" && navigator.webdriver) return;
	if (new URLSearchParams(location.search).has("nopush")) return;
	try {
		sse = new EventSource("/api/stream");
		sse.addEventListener("runs-changed", () => {
			if (!liveBox.checked) return;
			clearTimeout(sseDebounce);
			sseDebounce = setTimeout(() => render().catch(() => {}), 300);
		});
		sse.onerror = () => {
			conn.textContent = "push unavailable — polling";
		};
		sse.onopen = () => {
			conn.textContent = "live";
		};
	} catch {
		sse = null;
	}
}

function stopLive() {
	if (sse) {
		sse.close();
		sse = null;
	}
}

// ---------- viewport preservation ----------
// Same-page refreshes (polling / SSE / live toggle) must not move the user:
// capture scroll just before the DOM swap, pin to bottom when tailing, restore after.
function captureVp() {
	const sc = document.scrollingElement;
	return { top: sc.scrollTop, atBottom: sc.scrollHeight - sc.scrollTop - window.innerHeight < 60 };
}
function restoreVp(vp) {
	const sc = document.scrollingElement;
	if (vp.atBottom) sc.scrollTop = sc.scrollHeight;
	else sc.scrollTop = Math.min(vp.top, sc.scrollHeight);
}

// ---------- runs list ----------

let projectFilter = "";

async function renderList(samePage) {
	const data = await fetchJson("/api/runs");
	const runs = data.runs ?? [];
	const projects = [...new Set(runs.map((r) => r.cwd).filter(Boolean))].sort();
	if (projectFilter && !projects.includes(projectFilter)) projectFilter = "";

	const visible = runs.filter((r) => !projectFilter || r.cwd === projectFilter);

	const vp = samePage ? captureVp() : null;
	const rows = [];
	for (const run of visible) {
		rows.push(runRow(run, false));
		for (const child of (run.children ?? []).filter((c) => !projectFilter || c.cwd === projectFilter)) {
			rows.push(runRow(child, true));
		}
	}

	app.innerHTML = `
		<section>
			<div style="display:flex; gap:12px; align-items:center; margin-bottom:8px">
				<h3 style="margin:0">Runs (${visible.length})</h3>
				<span class="spacer" style="flex:1"></span>
				<select class="proj-filter" id="proj">
					<option value="">all projects</option>
					${projects.map((p) => `<option value="${esc(p)}" ${p === projectFilter ? "selected" : ""}>${esc(basename(p))}</option>`).join("")}
				</select>
			</div>
			<table class="runs">
				<thead><tr><th>run</th><th>project</th><th>agents</th><th>state</th><th class="num">tokens in/out</th><th class="num">cost</th><th class="num">dur</th><th class="num">artifacts</th></tr></thead>
				<tbody>${rows.join("") || `<tr><td colspan="8" class="empty">no runs discovered</td></tr>`}</tbody>
			</table>
		</section>`;
	if (vp) restoreVp(vp);
	document.getElementById("proj").onchange = (e) => {
		projectFilter = e.target.value;
		renderList().catch(showError);
	};
	app.querySelectorAll("tr[data-run]").forEach((tr) => {
		tr.onclick = () => (location.hash = `#/runs/${tr.dataset.run}`);
	});
	conn.textContent = `${runs.length} runs`;
}

function runRow(run, isChild) {
	const dur = run.state === "running" && run.startedAt ? Date.now() - run.startedAt : run.durationMs;
	const tok = run.totalTokens ?? {};
	const label = run.label || run.agents.map((a) => `<span class="agent-chip">${esc(a)}</span>`).join("");
	const mode = isChild ? `↳ ${esc(run.mode)}` : esc(run.mode);
	const title = run.agents.length ? "" : "";
	return `<tr data-run="${esc(run.runId)}" class="${isChild ? "child" : "parent"}" title="${esc(run.runId)}">
		<td><span class="run-id">${esc(run.runId.slice(0, 8))}</span><br><small style="color:var(--dim)">${mode}${run.workflowKey ? " · " + esc(run.workflowKey) : ""}</small></td>
		<td><span class="cwd">${esc(basename(run.cwd)) || "—"}</span></td>
		<td>${label}</td>
		<td>${stateBadge(run.state)}</td>
		<td class="num">${fmtNum(tok.input)} / ${fmtNum(tok.output)}</td>
		<td class="num">${fmtCost(run.totalCostUsd)}</td>
		<td class="num">${fmtDur(dur)}</td>
		<td class="num">${run.artifactCount ?? 0}</td>
	</tr>`;
}

// ---------- run detail ----------

let detailTab = "transcript";
let openArtifact = null;

async function renderDetail(runId, prev = {}) {
	const d = await fetchJson(`/api/runs/${runId}`);
	const st = d.status ?? {};
	const steps = st.steps ?? [];
	const tok = st.totalTokens ?? {};
	const isWorkflow = st.mode === "workflow";
	const running = st.state === "running";

	const projDir = st.cwd ? ` · <span class="cwd">${esc(st.cwd)}</span>` : "";
	const stepModels = [...new Set(steps.map((s) => s.model).filter(Boolean))];

	// build the whole page in a detached container and swap once the tab content
	// (incl. transcript fetches) is ready — keeps height stable so scroll never
	// clamps and there is no blank-flash between header and tab content
	const holder = document.createElement("div");
	holder.innerHTML = `
		<a class="back" href="#/">← all runs</a>
		<div class="detail-header">
			<h2>${esc(st.workflowKey ?? runId.slice(0, 8))} ${stateBadge(st.state ?? "")} <span class="run-id">${esc(runId)}</span></h2>
			<div class="stat-row">
				<span>mode <b>${esc(st.mode ?? "?")}</b></span>
				<span>project <b>${esc(basename(st.cwd)) || "—"}</b>${projDir}</span>
				<span>started <b>${fmtDate(st.startedAt)}</b></span>
				<span>duration <b>${fmtDur(running && st.startedAt ? Date.now() - st.startedAt : st.durationMs)}</b></span>
				${stepModels.length ? `<span>model <b>${esc(stepModels.join(", "))}</b></span>` : ""}
				<span>tokens <b>${fmtNum(tok.input)} in / ${fmtNum(tok.output)} out</b></span>
				<span>cost <b>${fmtCost(st.totalCost?.costUsd)}</b></span>
				${st.toolCount != null ? `<span>tools <b>${st.toolCount}</b></span>` : ""}
				${st.turnCount != null ? `<span>turns <b>${st.turnCount}</b></span>` : ""}
				${st.processTerminal?.state ? `<span>process <b>${esc(st.processTerminal.state)}</b></span>` : ""}
				${st.runFanoutBudget ? `<span>fanout <b>${st.runFanoutBudget.used}/${st.runFanoutBudget.limit}</b></span>` : ""}
			</div>
		</div>
		<div class="tabs">
			${["transcript", "artifacts", "events", "raw"].map((t) => `<div class="tab ${detailTab === t ? "active" : ""}" data-tab="${t}">${t}</div>`).join("")}
		</div>
		<div id="tab-body"></div>`;

	const samePage = prev.samePage === true;

	const body = holder.querySelector("#tab-body");
	if (detailTab === "transcript") await renderTranscriptTab(body, runId, d, isWorkflow, null);
	else if (detailTab === "artifacts") await renderArtifactsTab(body, runId, d);
	else if (detailTab === "events") await renderEventsTab(body, runId, d);
	else renderRawTab(body, d);

	// capture the user's place from the still-mounted old page just before the
	// swap (post-fetches), so scrolling during a slow transcript fetch is kept
	const vp = samePage ? captureVp() : null;
	const openDetails = samePage ? new Set([...app.querySelectorAll("details[data-k][open]")].map((el) => el.dataset.k)) : null;

	app.replaceChildren(holder);
	holder.querySelectorAll(".tab").forEach((el) => {
		el.onclick = () => {
			detailTab = el.dataset.tab;
			openArtifact = null;
			document.scrollingElement.scrollTop = 0;
			renderDetail(runId).catch(showError);
		};
	});
	if (vp) restoreVp(vp);

	// poll through render() so refreshes keep the user's place (never renderDetail directly)
	if (running) startPolling(render);
	else stopPolling();
	conn.textContent = `run ${runId.slice(0, 8)} · ${st.state}`;
}

// ----- transcript -----

async function renderTranscriptTab(body, runId, d, isWorkflow, prevOpen) {
	if (isWorkflow) {
		const steps = d.status?.steps ?? [];
		body.innerHTML = `<section><h3>children</h3><p style="color:var(--dim)">Workflow runs aggregate child runs — each child has its own full transcript.</p>
			<table class="runs"><thead><tr><th>step</th><th>agent</th><th>state</th><th>latest output</th><th class="num">dur</th><th></th></tr></thead><tbody>
			${steps
				.map(
					(s, i) => `<tr data-run="${esc(s.runId ?? "")}" style="cursor:pointer">
					<td>${esc(s.workflowKey ?? String(i))}</td><td><span class="agent-chip">${esc(s.agent ?? "?")}</span></td>
					<td>${stateBadge(s.status ?? "unknown")}</td>
					<td class="last-out" title="${esc(s.lastOutput ?? "")}">${esc(s.lastOutput ?? "—")}</td>
					<td class="num">${fmtDur(s.durationMs)}</td>
					<td><span class="run-id">${esc((s.runId ?? "").slice(0, 8))}</span></td></tr>`,
				)
				.join("")}</tbody></table></section>`;
		body.querySelectorAll("tr[data-run]").forEach((tr) => {
			if (tr.dataset.run) tr.onclick = () => (location.hash = `#/runs/${tr.dataset.run}`);
		});
		return;
	}

	let data;
	try {
		data = await fetchJson(`/api/runs/${runId}/transcript`);
	} catch (e) {
		body.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
		return;
	}
	const ts = data.transcripts ?? [];
	if (ts.length === 0) {
		body.innerHTML = `<div class="empty">no transcript events recorded for this run</div>`;
		return;
	}
	const execMap = new Map();
	for (const t of ts) for (const ex of t.toolExecutions ?? []) execMap.set(ex.toolCallId, ex);

	let html = "";
	for (const [ci, t] of ts.entries()) {
		html += `<section><h3>child ${esc((t.childRunId ?? "").slice(0, 8))} · ${esc(t.agent ?? "?")} · ${t.messages.length} messages · ${fmtNum(t.totalUsage?.input)} in / ${fmtNum(t.totalUsage?.output)} out</h3>`;
		for (const [mi, msg] of t.messages.entries()) {
			const usage = msg.usage ?? {};
			const headMeta = [
				msg.model,
				msg.stopReason && msg.stopReason !== "stop" ? msg.stopReason : null,
				`in ${fmtNum(usage.input)}`,
				`out ${fmtNum(usage.output)}`,
				usage.cacheRead ? `cache ${fmtNum(usage.cacheRead)}` : null,
				msg.cost?.total ? fmtCost(msg.cost.total) : null,
				msg.timestamp ? fmtTime(msg.timestamp) : null,
			]
				.filter(Boolean)
				.map((x) => `<span>${esc(x)}</span>`)
				.join("");
			let bodyHtml = "";
			if (String(msg.role).toLowerCase() === "toolresult") {
				// tool outputs arrive as toolResult-role messages: plain text, render mono
				const text = (msg.blocks ?? []).filter((b) => b.type === "text").map(blockText).join("\n");
				bodyHtml = text
					? `<details class="tool" data-k="o:${ci}:${mi}"><summary><span class="tname">output</span><span class="spacer" style="flex:1"></span><span class="tdur">${fmtNum(text.length)} chars</span></summary>${renderOutputPre(capBody(text))}</details>`
					: `<span style="color:var(--dim)">(empty output)</span>`;
			} else {
				for (const [bi, block] of (msg.blocks ?? []).entries()) {
					if (block.type === "text" && block.text) {
						bodyHtml += `<div class="md-block">${renderMd(blockText(block))}</div>`;
					} else if (block.type === "thinking" && (block.thinking || block.text)) {
						const th = blockText(block);
						bodyHtml += `<details data-k="th:${ci}:${mi}:${bi}"><summary> thinking (${fmtNum(th.length)} chars)</summary><div class="thinking">${esc(th)}</div></details>`;
					} else if (block.type === "toolCall") {
						const ex = execMap.get(block.id) ?? { toolCallId: block.id, toolName: block.name, args: block.arguments, state: "aborted" };
						bodyHtml += renderTool(ex);
					} else if (block.type === "toolResult") {
						const text = block.output ?? blockText(block);
						bodyHtml += `<details data-k="tr:${ci}:${mi}:${bi}"><summary>tool result</summary><pre class="raw" style="max-height:320px; overflow:auto">${esc(capBody(String(text)))}</pre></details>`;
					}
				}
			}
			if (!bodyHtml) bodyHtml = `<span style="color:var(--dim)">(empty)</span>`;
			html += `<div class="msg ${esc(msg.role)}"><div class="head role-${esc(msg.role)}"><span class="role">${esc(msg.role)}</span><span class="spacer"></span>${headMeta}</div><div class="body">${bodyHtml}</div></div>`;
		}
		html += `</section>`;
	}
	body.innerHTML = html;
	// on refresh, mirror the exact open/closed state the user had (never fight their choices)
	if (prevOpen) body.querySelectorAll("details[data-k]").forEach((el) => { el.open = prevOpen.has(el.dataset.k); });
}

// Extract human-readable text from a tool execution result.
// Shape (verified): { content: [{ type: "text", text: "..." }, ...] } — fall back to
// pretty-printed JSON for anything else.
function resultText(result) {
	if (result == null) return "";
	if (typeof result === "string") return result;
	if (Array.isArray(result?.content)) {
		const parts = result.content.map((b) => {
			if (b && typeof b === "object" && typeof b.text === "string") return b.text;
			return JSON.stringify(b, null, 2);
		});
		return parts.join("\n");
	}
	return JSON.stringify(result, null, 2);
}

function blockText(block) {
	if (!block) return "";
	const t = block.text ?? block.thinking;
	if (typeof t === "string") return t;
	if (t && typeof t === "object" && t.__truncated) return `${t.text}\n… (truncated, ${fmtNum(t.length - (t.text?.length ?? 0))} more chars)`;
	return t == null ? "" : JSON.stringify(t, null, 2);
}

function capBody(text, cap = 60000) {
	return text.length > cap ? `${text.slice(0, cap)}\n… (truncated, ${fmtNum(text.length - cap)} more chars)` : text;
}

// Unified-diff detection + red/green line rendering.
function isDiff(text) {
	if (!text || !text.includes("\n")) return false;
	if (/^diff --git /m.test(text)) return true;
	if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text)) return true;
	if (/^--- (a\/|\/dev\/null)/m.test(text) && /^\+\+\+ (b\/|\/dev\/null)/m.test(text)) return true;
	return false;
}

const DIFF_META_RE = /^(diff --git|index |old mode|new mode|new file mode|deleted file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files|GIT binary patch|--- |\+\+\+ |\\)/;

function renderDiff(text) {
	const lines = text.split("\n");
	const out = lines.map((line) => {
		let cls = "dl-ctx";
		if (/^@@/.test(line)) cls = "dl-hunk";
		else if (DIFF_META_RE.test(line)) cls = "dl-meta";
		else if (/^\+/.test(line)) cls = "dl-add";
		else if (/^-/.test(line)) cls = "dl-del";
		return `<span class="${cls}">${esc(line)} </span>`;
	});
	return out.join("");
}

function renderOutputPre(text) {
	if (isDiff(text)) return `<pre class="diff">${renderDiff(text)}</pre>`;
	return `<pre>${esc(text)}</pre>`;
}

function renderTool(ex) {
	const stateCls = `state-${esc(ex.state ?? "ok")}`;
	const dur = ex.startedAt && ex.endedAt ? ` <span class="tdur">(${fmtDur(ex.endedAt - ex.startedAt)})</span>` : "";
	const argsStr = typeof ex.args === "string" ? ex.args : JSON.stringify(ex.args);
	let argsPreview = "";
	try {
		const a = typeof ex.args === "string" ? JSON.parse(ex.args) : ex.args;
		argsPreview = a?.command ?? a?.path ?? a?.file_path ?? a?.pattern ?? argsStr;
	} catch {
		argsPreview = argsStr;
	}
	argsPreview = String(argsPreview).slice(0, 160);
	const resultStr = resultText(ex.result);
	const RESULT_CAP = 60000;
	const resultBody = capBody(resultStr, RESULT_CAP);
	const resultHtml = resultStr ? renderOutputPre(resultBody) : "";
	return `<details class="tool" data-k="t:${esc(ex.toolCallId ?? "")}" ${ex.state === "error" ? "open" : ""}>
		<summary><span class="tname">${esc(ex.toolName ?? "?")}</span><span class="targs">${esc(argsPreview)}</span><span class="spacer" style="flex:1"></span><span class="${stateCls}">${esc(ex.state ?? "ok")}</span>${dur}</summary>
		${argsStr ? `<pre>${esc(argsStr)}</pre>` : ""}
		${resultHtml}
	</details>`;
}

// ----- artifacts -----

async function renderArtifactsTab(body, runId, d) {
	const items = [];
	if (d.logFile) items.push({ name: d.logFile, kind: "md" });
	for (const f of d.outputLogs ?? []) items.push({ name: f, kind: "log" });
	for (const a of d.artifacts ?? []) items.push(a);
	if (items.length === 0) {
		body.innerHTML = `<div class="empty">no artifacts discovered for this run</div>`;
		return;
	}
	body.innerHTML = `<section><h3>artifacts (${items.length})</h3><div class="artifact-list">
		${items
			.map(
				(a) => `<div class="artifact" data-name="${esc(a.name)}"><span class="akind">${esc(a.kind ?? "?")}</span><span class="aname">${esc(a.name)}</span><span class="asize">${a.bytes != null ? fmtNum(a.bytes) + "B" : ""}</span></div>`,
			)
			.join("")}</div></section>
		<section id="viewer-content"></section>`;
	const viewer = body.querySelector("#viewer-content");
	body.querySelectorAll(".artifact").forEach((el) => {
		el.onclick = async () => {
			openArtifact = el.dataset.name;
			await loadArtifact(runId, openArtifact, viewer);
			body.querySelectorAll(".artifact").forEach((x) => (x.style.background = x.dataset.name === openArtifact ? "var(--panel2)" : ""));
		};
	});
	if (openArtifact) await loadArtifact(runId, openArtifact, viewer);
}

async function loadArtifact(runId, name, viewer) {
	if (!viewer) return;
	viewer.innerHTML = `<h3>${esc(name)}</h3><div class="empty"><span class="spin">◌</span></div>`;
	try {
		const res = await fetch(`/api/runs/${runId}/file/${encodeURIComponent(name)}`);
		if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
		const text = await res.text();
		const truncated = res.headers.get("X-Truncated");
		if (name.endsWith(".md")) {
			viewer.innerHTML = `<h3>${esc(name)} ${truncated ? '<small style="color:var(--yellow)">(truncated)</small>' : ""}</h3><div class="md">${renderMd(text)}</div>`;
		} else if (name.endsWith(".json") || name.endsWith(".jsonl")) {
			const pretty = name.endsWith(".json") ? JSON.stringify(JSON.parse(text), null, 2) : text;
			viewer.innerHTML = `<h3>${esc(name)}</h3><pre class="raw">${esc(pretty)}</pre>`;
		} else {
			viewer.innerHTML = `<h3>${esc(name)}</h3><pre class="raw">${esc(text)}</pre>`;
		}
	} catch (e) {
		viewer.innerHTML = `<div class="empty">failed to load: ${esc(e.message)}</div>`;
	}
}

// ----- events -----

async function renderEventsTab(body, runId, d) {
	let ov = null;
	try {
		ov = await fetchJson(`/api/runs/${runId}/events-overview`);
	} catch {}
	body.innerHTML = `<section>
		<h3>events.jsonl ${ov ? `· ${(ov.bytes / 1024).toFixed(0)} KB` : ""}</h3>
		${
			ov
				? `<table class="runs"><thead><tr><th>source</th><th>agent</th><th class="num">events</th><th>types</th></tr></thead><tbody>${ov.children
						.map(
							(c) => `<tr><td class="run-id">${c.runId === "_wrapper" ? "(wrapper lifecycle)" : esc(c.runId.slice(0, 8))}</td><td>${esc(c.agent ?? "—")}</td><td class="num">${c.events}</td><td>${Object.entries(c.types)
								.sort((a, b) => b[1] - a[1])
								.slice(0, 8)
								.map(([k, v]) => `<span class="agent-chip">${esc(k)}×${v}</span>`)
								.join("")}</td></tr>`,
						)
						.join("")}</tbody></table>`
				: `<div class="empty">no events file</div>`
		}
		<div style="margin-top:12px"><button id="load-raw" class="proj-filter" style="cursor:pointer">load first 500 raw events</button></div>
		<pre class="raw" id="raw-events" style="display:none; margin-top:8px"></pre>
	</section>`;
	body.querySelector("#load-raw").onclick = async (e) => {
		const pre = body.querySelector("#raw-events");
		pre.style.display = "";
		pre.textContent = "loading…";
		try {
			const data = await fetchJson(`/api/runs/${runId}/events?limit=500`);
			e.target.textContent = `showing ${data.events.length} of file (nextAfter=${data.nextAfter})`;
			pre.textContent = data.events.map((x) => `${x.line}: ${JSON.stringify(x.event)}`).join("\n").slice(0, 400000);
		} catch (err) {
			pre.textContent = `error: ${err.message}`;
		}
	};
}

// ----- raw -----

function renderRawTab(body, d) {
	body.innerHTML = `<section><h3>status.json</h3><pre class="raw">${esc(JSON.stringify(d.status, null, 2))}</pre>
		${d.receipt ? `<h3>workflow-receipt.json</h3><pre class="raw">${esc(JSON.stringify(d.receipt, null, 2))}</pre>` : ""}
		${d.mission ? `<h3>mission.json</h3><pre class="raw">${esc(JSON.stringify(d.mission, null, 2))}</pre>` : ""}
		${d.processTerminal ? `<h3>process-terminal.json</h3><pre class="raw">${esc(JSON.stringify(d.processTerminal, null, 2))}</pre>` : ""}
	</section>`;
}

function showError(err) {
	app.innerHTML = `<div class="empty">error: ${esc(err.message)}</div>`;
}

// ---------- routing ----------

function parseHash() {
	const m = location.hash.match(/^#\/runs\/([A-Za-z0-9_-]+)(?:\/([a-z]+))?/);
	if (m) return { view: "detail", runId: m[1], tab: m[2] };
	return { view: "list" };
}

async function render() {
	// serialize renders: a slow transcript fetch must not race the next poll tick
	if (state.renderBusy) {
		state.renderQueued = true;
		return;
	}
	state.renderBusy = true;
	try {
		state.route = parseHash();
		if (state.route.tab && ["transcript", "artifacts", "events", "raw"].includes(state.route.tab)) detailTab = state.route.tab;
		// same-page refreshes (polling / SSE / live toggle) keep the user's place:
		// scroll + open details are captured at swap time inside the renderers
		const routeKey = state.route.view === "detail" ? `d:${state.route.runId}:${detailTab}` : "list";
		const samePage = routeKey === state.lastRouteKey;
		state.lastRouteKey = routeKey;
		if (state.route.view === "detail") await renderDetail(state.route.runId, { samePage });
		else await renderList(samePage);
	} catch (err) {
		showError(err);
	} finally {
		state.renderBusy = false;
		if (state.renderQueued) {
			state.renderQueued = false;
			render();
		}
	}
}

window.addEventListener("hashchange", () => {
	detailTab = "transcript";
	openArtifact = null;
	render();
});
liveBox.addEventListener("change", () => {
	if (!liveBox.checked) {
		stopPolling();
	} else {
		render();
	}
});
render();
startPolling(render);
startLive();
