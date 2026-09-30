---
name: devtasks-setup
description: Collect the details and write a repo's .pi/dev.json for the pi-devtasks extension — inspect the project for dev commands, choose a readiness probe, and confirm the unknowns with the user before writing. Use when a repo has local dev commands but no .pi/dev.json, when asked to declare, configure, add, or fix dev tasks / dev servers / long-running commands, or when pi-devtasks reports a task failed or timed out.
---

# Declare dev tasks for pi-devtasks

pi-devtasks supervises a repo's long-running local dev processes. They are
declared in `.pi/dev.json` at the repo root; the extension reads it on
`session_start`. This skill produces that file.

The loader at `~/.pi/agent/extensions/devtasks/config.ts` (source
`~/zconf/modules/pi/extensions/devtasks/`) is the source of truth for what is
valid — read it if a rule here is unclear.

## Outcome

A valid `.pi/dev.json` where:
- every task the user actually runs is declared,
- each long-running server has a **readiness signal**, so `dev_start` returns
  "ready" vs "failed" instead of a blind "started".

The readiness choice is the part that makes this worth doing; spend the effort
there.

## 1. Recon — infer before asking

Read the repo and map each plausible dev command. Then look for the port or
health signal.

| Signal in repo | Command form |
|---|---|
| `mise.toml` / `.mise.toml` → `[tasks]` | `mise run <name>` |
| `package.json` `scripts` (lockfile tells the runner) | `npm run <s>` / `pnpm <s>` / `bun run <s>` / `yarn <s>` |
| `justfile` | `just <recipe>` |
| `Makefile` | `make <target>` |
| `go.mod` + `cmd/` dirs | `go run .` / `go run ./cmd/<x>` |
| `docker-compose.yml` / `compose.yaml` | `docker compose up <svc>` |
| `Procfile` | the process command |
| README / AGENTS.md "getting started", CI config | whatever they run |

Find the port/health details too: `.env` / `.env.example` (`PORT=`),
framework config (`vite.config`, `next.config`, `settings.py`), compose port
mappings, or a README "runs on :XXXX" / "health endpoint" line. Default ports
are easy to mis-remember — prefer a value found in the repo.

Skip one-off commands (migrations, installs, seeders). Only long-running
processes belong here.

## 2. Choose a readiness probe

`ready` must set **exactly one** of these. Preference: `port` > `http` >
`stdout` > `delayMs` > omit.

| Probe | Use when | Value |
|---|---|---|
| `{ "port": 8080 }` | a server that listens on a port — the strongest signal | the port it binds |
| `{ "http": "http://127.0.0.1:8080/health" }` | there is a health endpoint | a URL returning 2xx when up |
| `{ "stdout": "listening on" }` | a banner is reliable | a regex over combined output |
| `{ "delayMs": 1500 }` | a worker/daemon with no port or banner | grace period |
| omit `ready` | a short one-shot | ready immediately on spawn |

A wrong `port` means the task sits in `starting` until `readyTimeoutMs` (default
60s) and is then marked failed. If unsure, `stdout` on a known banner or a
generous `delayMs` beats guessing a port.

**Listening but broken is not detected.** A dev server with a corrupt build can
hold its port open while answering 5xx; `port` still reports ready and the
error is only in the logs — e.g. a Next.js `ENOENT` on a
`.next/static/.../_buildManifest.js.tmp.*` file. Recover with
`/dev restart <task>`, which regenerates the bad state. An `http` probe would
instead hold it in `starting` and fail it at `readyTimeoutMs`, so use `http`
only when the endpoint is expected to recover on its own.

## 3. Ask only what you can't infer

Present a short proposal (a table of `name | cmd | ready`) and then make **one**
`ask_user_question` call (max 4 questions). Ask about:

- **Which tasks to declare** — `multiSelect: true` over the discovered
  commands, with the likely ones pre-marked in the descriptions.
- **Ambiguous names** — if a command has no obvious task name, propose one.
- **Readiness for servers whose port/banner you could not find** — offer the
  port(s) seen, a stdout banner, or a delay; recommend the strongest you have.
- **Anything genuinely unclear** — e.g. two entrypoints, or a compose service
  vs. the host command.

Do not ask about defaults (`server.host`, `token`, timeouts, `notify`) — they
are fine. Do not ask whether tasks should auto-start: they never do; startup is
opt-in per `dev_start`.

## 4. Write `.pi/dev.json`

JSON only — no comments.

```json
{
  "server": { "host": "127.0.0.1", "token": true },
  "tasks": {
    "dev": {
      "cmd": "mise run dev",
      "cwd": ".",
      "ready": { "port": 8080 },
      "readyTimeoutMs": 60000,
      "stop": { "signal": "SIGTERM", "timeoutMs": 5000 }
    },
    "worker": {
      "cmd": "go run ./cmd/worker",
      "ready": { "stdout": "worker ready" }
    }
  }
}
```

Field rules (all optional except `cmd`):

- `server.host` default `127.0.0.1`; `server.token` default `true`. The web UI
  port is always chosen by the OS — there is no port to set.
- Task keys must match `[A-Za-z0-9_-]+`.
- `cmd` — run through the shell. Required.
- `cwd` — relative to the repo root; omit for the root.
- `notify` — default `true`; push ready/crash transitions to the session.
- `ready` — exactly one key as above.
- `readyTimeoutMs` — default `60000`, must be > 0.
- `stop.signal` — one of `SIGTERM` (default), `SIGINT`, `SIGKILL`, `SIGHUP`,
  `SIGQUIT`; `stop.timeoutMs` default `5000`, then SIGKILL.

No per-task `env`: apps manage their own environment. The extension injects
`PI_SESSION=1` so a program can detect it runs under pi.

## 5. Validate and verify

1. `jq . .pi/dev.json` — JSON is well-formed.
2. `/reload`, then `/dev list` (or the `dev_list` tool) — tasks appear with
   `stopped`.
3. `/dev start <task>` — expect `ready`. On `failed`, run `/dev logs <task>`:
   - "exited before ready" → the command is wrong or needs setup; fix `cmd`.
   - "readiness timeout" → the probe is wrong; retry §2 with the real port or
     banner (the process is left running; `/dev stop <task>` first).
   If the task is `ready` but the app itself answers 5xx or 404s, the probe
   cannot see that — `/dev restart <task>` is the recovery.
4. `/dev open` — the web UI shows live output and controls. It aggregates
   running repos (side by side, or tabs) in one tab: the current repo is always
   shown, others appear only while they have a running task, and a repo whose pi
   exited drops off.

## Guardrails

- One probe per task; never two.
- Don't create tasks for installs/migrations/one-shots.
- Don't start tasks while authoring; let the user opt in.
- If the user is unsure of a readiness signal, use `delayMs` and say so — a
  working delay beats a wrong port.
- Show the user the final file; it is committed project config.
