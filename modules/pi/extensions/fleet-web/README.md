# fleet-web

Browser UI for inspecting pi-subagents fleet runs. Read-only viewer over the async run
artifacts pi-subagents writes to disk. See `PLAN.md` for the design notes.

## Usage

- `/fleet-web` — start the local server (127.0.0.1, ephemeral port) and open a browser tab
- `/fleet-web url` — print the URL without opening a browser
- `/fleet-web stop` — stop the server

The UI shows every run discovered under `/tmp/pi-subagents-*/async-subagent-runs/`:
workflow runs (with their child runs), single runs, per-child transcripts rebuilt from
`events.jsonl` (messages, thinking, tool calls with args/results, per-turn usage and cost),
and per-task artifacts. Live runs update via SSE push (polling fallback).

Deep links: `#/runs/<runId>` plus an optional tab segment `transcript|artifacts|events|raw`.

## Layout

- `index.ts` — extension entry (registers `/fleet-web`)
- `lib/scanner.ts` — run discovery, status parsing, artifact resolution
- `lib/events.ts` — `events.jsonl` NDJSON streaming parser + transcript builder
- `lib/server.ts` — localhost HTTP server: JSON API, static files, SSE
- `public/` — no-build vanilla frontend (ES modules)
- `scripts/spike.ts` — parser validation against real runs on disk (`node scripts/spike.ts`)

## Notes

- Zero npm dependencies; loaded by pi via jiti.
- Binds to 127.0.0.1 only; serves artifact files only from resolved allowlisted roots.
- Forward compatible: unknown fields/event types are ignored.
- With `artifactDir: "project"` (set in `~/.pi/agent/extensions/subagent/config.json`),
  per-task artifacts live under `<cwd>/.pi/subagents/` — add that to `.gitignore`.
  Async lifecycle artifacts always stay in the temp root (no config exists to move them).
