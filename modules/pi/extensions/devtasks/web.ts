/**
 * Single-page web UI for pi-devtasks. Served by server.ts; talks to the local
 * server's aggregate API, which in turn proxies every other running repo.
 * One page, all repos — side by side or in tabs.
 */

export function renderPage(token: string): string {
  const tokenLiteral = JSON.stringify(token);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pi dev tasks</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --border: #2a2f3a; --text: #d7dce5; --muted: #8b93a3;
    --ok: #3fb950; --warn: #d29922; --bad: #f85149; --accent: #58a6ff;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; overflow: hidden; }
  header {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 0 0 auto;
    padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--bg); z-index: 2;
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .spacer { flex: 1; }
  .pill { font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; }
  nav { display: flex; gap: 6px; flex-wrap: wrap; }
  nav button.chip { background: #1f2430; color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 3px 11px; cursor: pointer; font-size: 12px; }
  nav button.chip.active { border-color: var(--accent); color: var(--accent); }
  nav button.chip.offline { opacity: .55; }
  .toggle button { background: #1f2430; color: var(--muted); border: 1px solid var(--border); padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .toggle button:first-child { border-radius: 7px 0 0 7px; }
  .toggle button:last-child { border-radius: 0 7px 7px 0; }
  .toggle button.active { color: var(--accent); border-color: var(--accent); }
  main { padding: 14px 18px; max-width: 1800px; width: 100%; margin: 0 auto; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  main.columns { display: grid; gap: 14px; height: 100%; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); grid-auto-rows: minmax(160px, 1fr); align-items: stretch; overflow: auto; }
  main.tabs { display: block; height: 100%; }
  .repo { background: transparent; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .repo-head { display: flex; align-items: center; gap: 8px; padding: 9px 13px; background: #12151b; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
  .repo-label { font-weight: 600; }
  .repo-state { color: var(--muted); font-size: 12px; margin-left: auto; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; }
  .dot.on { background: var(--ok); }
  .dot.off { background: var(--bad); }
  .tasks { padding: 10px; display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; overflow: auto; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 9px; overflow: hidden; display: flex; flex-direction: column; flex: 1 1 0; min-height: 150px; }
  .row { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
  .row .spacer { flex: 1; }
  .name { font-weight: 600; }
  .cmd { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: 2px 9px; border: 1px solid var(--border); color: var(--muted); }
  .badge.ok { color: var(--ok); border-color: var(--ok); }
  .badge.warn { color: var(--warn); border-color: var(--warn); }
  .badge.bad { color: var(--bad); border-color: var(--bad); }
  button.act { background: #1f2430; color: var(--text); border: 1px solid var(--border); border-radius: 7px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  button.act:hover { border-color: var(--accent); color: var(--accent); }
  button.act:disabled { opacity: .5; cursor: default; }
  .meta { padding: 7px 12px; color: var(--muted); font-size: 12px; min-height: 18px; flex: 0 0 auto; }
  pre.log { margin: 0; padding: 11px 12px; background: #0b0d11; color: #c9d1d9; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; flex: 1 1 auto; min-height: 60px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  pre.log:empty::before { content: "no output yet"; color: var(--muted); }
  .empty { color: var(--muted); padding: 12px; }
</style>
</head>
<body>
<header>
  <h1>pi dev tasks</h1>
  <nav id="repos"></nav>
  <span class="spacer"></span>
  <span class="toggle">
    <button data-layout="columns">side by side</button><button data-layout="tabs">tabs</button>
  </span>
  <span id="conn" class="pill">connecting…</span>
</header>
<main id="board" class="columns"></main>
<script>
const TOKEN = ${tokenLiteral};
function withToken(path) {
  if (!TOKEN) return path;
  return path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN);
}
const stripAnsi = (value) => value.replace(/\\u001b\\[[0-9;?]*[ -/]*[@-~]/g, "");
function stateClass(s) { return s === "ready" ? "ok" : s === "starting" ? "warn" : (s === "failed" || s === "exited") ? "bad" : ""; }
function isVisible(repo) { return !!repo.current || !!repo.managed || (repo.tasks || []).some((task) => task.state !== "stopped"); }
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
function setConn(text) { document.getElementById("conn").textContent = text; }

async function api(path, method) {
  const res = await fetch(withToken(path), { method: method || "GET" });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

const state = {
  layout: localStorage.getItem("pi-devtasks-layout") || "columns",
  selected: "all",
  repos: new Map(),
  logs: new Map(),
  loaded: new Set(),
};

const logKey = (repo, task) => repo + "|" + task;

function applyStatus(list) {
  const present = new Set();
  for (const repo of list) {
    present.add(repo.repoRoot);
    const existing = state.repos.get(repo.repoRoot) || {};
    existing.repoRoot = repo.repoRoot;
    existing.label = repo.label;
    existing.online = repo.online;
    existing.current = repo.current;
    existing.tasks = repo.tasks || [];
    state.repos.set(repo.repoRoot, existing);
    for (const task of existing.tasks) ensureLogs(repo.repoRoot, task.name);
  }
  for (const key of [...state.repos.keys()]) if (!present.has(key)) state.repos.delete(key);
  if (state.selected !== "all" && !present.has(state.selected)) state.selected = "all";
  render();
}

function ensureLogs(repo, task) {
  const key = logKey(repo, task);
  if (state.loaded.has(key)) return;
  state.loaded.add(key);
  api("/api/logs?repo=" + encodeURIComponent(repo) + "&task=" + encodeURIComponent(task) + "&lines=200")
    .then((data) => {
      const backlog = data.lines.map(stripAnsi).join("\\n");
      state.logs.set(key, backlog ? backlog + "\\n" : "");
      const pane = document.querySelector('pre.log[data-key="' + CSS.escape(key) + '"]');
      if (pane) { pane.textContent = state.logs.get(key) + "\\n"; pane.scrollTop = pane.scrollHeight; }
    })
    .catch(() => {});
}

function appendLog(repo, task, line) {
  const key = logKey(repo, task);
  let text = (state.logs.get(key) || "") + stripAnsi(line) + "\\n";
  const lines = text.split("\\n");
  if (lines.length > 1000) text = lines.slice(-1000).join("\\n");
  state.logs.set(key, text);
  const pane = document.querySelector('pre.log[data-key="' + CSS.escape(key) + '"]');
  if (pane) { pane.textContent = text; pane.scrollTop = pane.scrollHeight; }
}

function updateTaskState(repo, task, snapshot) {
  const entry = state.repos.get(repo);
  if (!entry) return;
  const index = entry.tasks.findIndex((t) => t.name === task);
  if (index === -1) entry.tasks.push(snapshot); else entry.tasks[index] = snapshot;
  render();
}

async function control(repo, task, action, button) {
  if (button) button.disabled = true;
  try {
    await api("/api/control?repo=" + encodeURIComponent(repo) + "&task=" + encodeURIComponent(task) + "&action=" + action, "POST");
    await refresh();
  } catch (err) {
    appendLog(repo, task, "error: " + err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderTask(repo, task) {
  const card = el("section", "card");
  const row = el("div", "row");
  const badge = el("span", "badge " + stateClass(task.state), task.state);
  row.appendChild(badge);
  row.appendChild(el("span", "name", task.name));
  row.appendChild(el("code", "cmd", task.cmd));
  row.appendChild(el("span", "spacer"));
  for (const action of ["start", "stop", "restart"]) {
    const b = el("button", "act", action);
    b.addEventListener("click", () => control(repo.repoRoot, task.name, action, b));
    row.appendChild(b);
  }
  card.appendChild(row);

  const bits = [];
  if (task.pid) bits.push("pid " + task.pid);
  if (task.port) bits.push("port " + task.port);
  if (task.readyReason) bits.push(task.readyReason);
  const since = task.readyAt || task.startedAt;
  if (since) bits.push("up " + Math.max(0, Math.round((Date.now() - since) / 1000)) + "s");
  card.appendChild(el("div", "meta", bits.join(" · ")));

  const pane = el("pre", "log");
  pane.dataset.key = logKey(repo.repoRoot, task.name);
  const text = state.logs.get(pane.dataset.key);
  if (text) pane.textContent = text.endsWith("\\n") ? text : text + "\\n";
  card.appendChild(pane);
  queueMicrotask(() => { pane.scrollTop = pane.scrollHeight; });
  return card;
}

function renderRepo(repo) {
  const section = el("section", "repo");
  const head = el("header", "repo-head");
  head.appendChild(el("span", "dot " + (repo.online ? "on" : "off")));
  head.appendChild(el("span", "repo-label", repo.label));
  head.appendChild(el("span", "repo-state", repo.online ? (repo.current ? "this session" : "online") : "offline"));
  section.appendChild(head);

  const tasks = el("div", "tasks");
  if (!repo.tasks || repo.tasks.length === 0) tasks.appendChild(el("div", "empty", "no tasks"));
  else for (const task of repo.tasks) tasks.appendChild(renderTask(repo, task));
  section.appendChild(tasks);
  return section;
}

function renderChips() {
  const nav = document.getElementById("repos");
  nav.innerHTML = "";
  const all = el("button", "chip" + (state.selected === "all" ? " active" : ""), "all");
  all.addEventListener("click", () => { state.selected = "all"; render(); });
  nav.appendChild(all);
  for (const repo of state.repos.values()) {
    if (!isVisible(repo)) continue;
    const chip = el("button", "chip" + (state.selected === repo.repoRoot ? " active" : "") + (repo.online ? "" : " offline"), repo.label);
    chip.title = repo.repoRoot;
    chip.addEventListener("click", () => { state.selected = repo.repoRoot; render(); });
    nav.appendChild(chip);
  }
  for (const b of document.querySelectorAll(".toggle button")) b.classList.toggle("active", b.dataset.layout === state.layout);
}

function render() {
  const board = document.getElementById("board");
  board.className = state.layout;
  board.innerHTML = "";
  const repos = [...state.repos.values()].filter(isVisible);
  let visible = repos;
  if (state.selected !== "all") {
    const match = repos.filter((repo) => repo.repoRoot === state.selected);
    visible = match.length ? match : repos;
  }
  if (visible.length === 0) board.appendChild(el("div", "empty", "No dev tasks running."));
  else for (const repo of visible) board.appendChild(renderRepo(repo));
  renderChips();
}

async function refresh() {
  const data = await api("/api/all/status");
  applyStatus(data.repos);
  setConn("live");
}

for (const b of document.querySelectorAll(".toggle button")) {
  b.addEventListener("click", () => {
    state.layout = b.dataset.layout;
    localStorage.setItem("pi-devtasks-layout", state.layout);
    render();
  });
}

function connect() {
  const es = new EventSource(withToken("/api/all/stream"));
  es.addEventListener("state", (e) => { const d = JSON.parse(e.data); updateTaskState(d.repo, d.task, d.snapshot); });
  es.addEventListener("log", (e) => { const d = JSON.parse(e.data); appendLog(d.repo, d.task, d.line); });
  es.onopen = () => setConn("live");
  es.onerror = () => setConn("reconnecting…");
}

refresh().then(connect).catch((err) => setConn("error: " + err.message));
setInterval(() => refresh().catch(() => setConn("reconnecting…")), 4000);
</script>
</body>
</html>`;
}
