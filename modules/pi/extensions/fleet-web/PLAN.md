# fleet-web — browser UI for pi-subagents fleet runs

Read-only observability extension: parse pi-subagents run artifacts from disk and render them in a
browser tab for deep inspection of async/fleet runs. No-build vanilla frontend, localhost HTTP
server started from a pi extension command.

## Where the data actually lives (verified on this machine)

1. **Async lifecycle artifacts** (the core data source) — always in a user temp root, regardless of
   `artifactDir` (no config exists to move them):

   ```
   /tmp/pi-subagents-uid-1000/async-subagent-runs/<runId>/
     status.json                  # authoritative: state, mode, steps[], children, tokens, cost,
                                  #   model, cwd, sessionId, workflowKey, processTerminal, timeouts
     events.jsonl                 # wrapper lifecycle events (subagent.run.*, subagent.step.*)
                                  #   + child Pi JSON events annotated with
                                  #   subagentRunId/subagentStepIndex/subagentAgent:
                                  #   message_start/end (role, text/thinking/toolCall blocks,
                                  #   provider, model, usage, stopReason),
                                  #   tool_execution_start/end (toolCallId, toolName, args, result)
     output-<n>.log               # human-readable live tail
     subagent-log-<runId>.md      # rendered markdown run summary
     mission.json, process-terminal.json, recovery-descriptor.json,
     run-fanout-budget.json, control/, result-index/, result-pending/
   ```

2. **Terminal results** — `/tmp/pi-subagents-<uid>/async-subagent-results/<runId>.json` (deleted once
   delivered); durable copies only as `completion-replay/<runId>.json` + `output-archives/<runId>.json`
   under the results dir, version 1, best-effort, expiring.

3. **Per-task artifacts** (inputs/outputs/transcripts/meta) — location depends on `artifactDir`:
   - `"project"` → `<cwd>/.pi/subagents/artifacts/` (`outputs/<runId>/…`), chain-runs →
     `<cwd>/.pi/subagents/chain-runs/{runId}/` (context.md, plan.md, progress.md, parallel-{i}/…)
   - `"session"` (default) → `~/.pi/agent/sessions/<session>/subagent-artifacts/`
   - files: `{runId}_{agent}_input.md`, `_output.md`, `{runId}_{agent}.jsonl`, `_meta.json`

   status.json gives `cwd`/`sessionId`, which lets the viewer resolve artifact roots per run without
   guessing. `artifactDir: "project"` makes those paths predictable and repo-scoped — we'll set it.

4. **Foreground runs** are sessions inside the parent and do NOT write async lifecycle artifacts —
   they stay chat-only. This viewer scopes itself to async/fleet runs (matching the request).

## Architecture

```
~/.pi/agent/extensions/fleet-web/
  index.ts        # extension entry: /fleet-web command, server lifecycle
  server.ts       # node:http, 127.0.0.1 only, ephemeral port, JSON API + static files
  scanner.ts      # discover run dirs, parse status.json, index artifacts
  events.ts       # events.jsonl streaming parser -> normalized child transcripts
  public/         # no-build vanilla TS ESM frontend (served statically)
    index.html, app.js (ES modules), style.css, lib/md.js (tiny markdown renderer)
```

Zero npm deps. TypeScript loaded via jiti like every pi extension; auto-discovered as a
subdirectory extension (`*/index.ts`), hot-reloadable with `/reload`.

### API

- `GET /api/projects` — runs grouped by `cwd` (project selector)
- `GET /api/runs` — index: runId, state, mode, agent(s), started/ended, duration, tokens, cost,
  model, workflowKey, has-artifacts flags; sorted newest first
- `GET /api/runs/:id` — status.json + mission + processTerminal + resolved artifact paths
- `GET /api/runs/:id/events?after=<offset>` — chunked raw events (offset cursor, size caps)
- `GET /api/runs/:id/steps/:i/transcript` — child transcript rebuilt from annotated events:
  ordered messages (user/assistant), thinking + toolCall blocks, paired tool executions with
  args/results, per-turn usage/cost, timing; server-side truncation with explicit markers
- `GET /api/runs/:id/log` / `…/output` / `…/artifacts/:name` — md/log/json artifacts, allowlisted
  roots only (path-traversal guard)
- `GET /api/stream` (SSE) — fs.watch on run dirs → push state/status deltas; poll fallback

### UI (vanilla, no build step)

1. **Runs list** — table grouped/filterable by project, state badges (running/complete/failed/
   stopped/paused), agent chips, tokens/cost/duration, live pulse for active runs
2. **Run detail** — header stats (model, cost, fanout budget, process-terminal proof), workflow
   step timeline / chain graph, per-child cards
3. **Transcript inspector** — collapsible thinking/tool blocks, tool args + rendered results,
   per-turn usage, jump-to-tool, copy-paste friendly
4. **Artifacts pane** — rendered markdown (task input/output, subagent-log, chain-run docs), raw
   log tail, `_meta.json` viewer
5. Later: cross-run search, token/cost rollups per agent, run diffing

## Config change

Create `~/.pi/agent/extensions/subagent/config.json` (doesn't exist yet):

```json
{ "artifactDir": "project" }
```

Then restart pi. Consequences: durable task artifacts land in `<cwd>/.pi/subagents/` — add
`.pi/subagents/` to each project's `.gitignore`. (npm-package repos also need an ignore rule;
pi-subagents warns about this at launch.) Lifecycle artifacts stay in temp either way — the
viewer scans the temp root, so nothing is lost, but old temp dirs are retention-pruned; the
project artifacts + archives are the durable record.

## Phases

1. **Parser spike (validate first).** Write `scanner.ts`/`events.ts`; run against the ~7 real runs
   already on disk. Also launch one parallel/workflow fanout run to exercise `steps[]`/
   `parallelGroups`/nested-children shapes (all current samples are `single` mode).
2. **Skeleton + runs index.** Extension, `/fleet-web` command, server, `/api/runs`, minimal list UI.
3. **Run detail + transcript inspector + artifacts** (phases 3 is the bulk).
4. **Live mode.** SSE + fs.watch, auto-follow an active run, cost/token rollups.
5. **Polish.** Markdown rendering, search, theming, empty-state/cleanup tolerance.
6. **Deferred.** pi-subagents `inspector.open` plugin registration so `H`/`Enter` in
   `/subagents-fleet` can open the browser on a selected child.

## Risks / guards

- **Forward compatibility** — docs mandate ignoring unknown fields/event types; parser must be lenient.
- **Huge events.jsonl** — cursor reads + per-field truncation (mirror pi-subagents' own 64 KiB budgets).
- **Security** — bind 127.0.0.1 only; serve artifact files only from resolved allowlisted roots;
  no run-control endpoints (read-only by decision).
- **Retention** — temp dirs may vanish mid-view; UI must degrade to "artifact missing" not crash;
  project artifacts + completion archives are the durable history.
