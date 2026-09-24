# Global context

Rules, environment and preferences that apply in every session, whatever the working directory.
Detail lives in `~/.pi/agent/memory/` — see § Memory store.

## Code structure (language-agnostic)
- Do not abstract code unless it's required. Abstraction should flow naturally from context and implementation, not as a pre-emptive step. No speculative interfaces, layers, or indirection "for later".
- Where possible, use plain functions (over classes/objects/methods for their own sake).
- If a function takes more than 3 parameters, consider grouping arguments in a struct. Grouping rules:
  - `ctx context.Context` is always first (or the language's equivalent, e.g. first/implicit context or cancellation argument).
  - Infrastructural dependencies like db or cache clients can be grouped together, but on their own — do not mix them into general parameter structs.
  - Do: `func a(ctx context.Context, ds DataSources, p Params)`
  - Don't: `func b(ap AllParams)` (context and infrastructure must stay separate and explicit)
  - Do: `func c(ctx context.Context, db *sqlx.DB, name string)`
  - Don't: `func d(context.Context, *sqlx.DB, string, string, int)` (too many loose parameters — group the unrelated ones)

## Go code review
When reviewing Go code, follow the Go wiki's Code Review Comments guidelines: https://go.dev/wiki/CodeReviewComments
- Fetch/read the wiki page when reviewing rather than relying on memory, so judgments match the current guidance (naming, interfaces, error handling, doc comments, goroutine lifetimes, etc.).
- Treat it as the baseline for Go review feedback; flag violations of it alongside project-specific rules (e.g. ADR 0006 naming in this file).

## DB query function naming (ADR 0006)
Prefix = contract. One prefix per function.
- Get<X>: returns 1 row; missing row = error, return database.NewNoRecordFound.
- List<X>: returns many rows; empty result = OK.
- ShouldList<X>: returns many rows where empty = error.
- Insert<X>: insert 1 or many rows.
- Update<X>: update 1 or many rows.
- Upsert<X>: INSERT ... ON DUPLICATE KEY UPDATE.
- Delete<X>: hard delete.
- SoftDelete<X>: soft delete via deleted_at.
Banned prefixes: Find, Fetch, One, Pick, Select, All, Create, Add, Change, Set, Replace.

## API path versioning (ADR 0009)
- Version goes AFTER the feature. OK: /admin/accounts/v1. NOT: /v1/admin/accounts.
- Version = "v" + integer, starting at 1.
- Complete rewrite: insert an alliterative adjective-animal codename, reset version to v1.
  - /admin/triggers/bison-brawler/v1

## Database schema
- Never use foreign keys. Do not add `FOREIGN KEY` constraints anywhere (schema, DDL, migrations) — they are not allowed. An FK in the schema is incorrect state: drop it, never work around it by reordering tables.

## Environment
- CachyOS (Arch). `GOBIN` is the mise go bin, so `go install` lands there. Sudo needs a password — ask the user to run pacman installs.
- **mise + global npm CLIs**: global npm bins live per node version (`~/.local/share/mise/installs/node/<ver>/bin`), so a node version change silently removes every global CLI from PATH. Prefer `mise use -g npm:<pkg>` over `npm install -g`.
- pi `settings.json` `defaultProvider`/`defaultModel` are silently ignored unless the provider has configured auth — it falls back to another provider with no warning. OpenRouter key is in `~/.pi/agent/auth.json`.
- devenv: podman compose runs `dev-mysql` (mysql:8, :3306, db `game_backend`), `dev-php-backend` and `valkey`. A DB "connection refused" means the stack is stopped → `podman start dev-mysql`. go-backend **integration tests** instead use `MYSQL_URL` from `infrastructure/test.local.env` (random port written by `mage test:up`).

## Working rules
- **Subagents/lanes must NEVER commit.** The user reviews and approves all code first. A lane delivers uncommitted changes plus a report; the parent session commits only after approval.
- **Tool discipline**: use the strongest available primitive and never author throwaway scripts. Files → `read`; JSON → `jq`; curl queries → `-G --data-urlencode`; typed tools over parsing CLI dumps; a one-off filter stays a single inline `jq` in the same bash call.
- The diffing skills under `~/.pi/agent/skills/` are vendor-managed symlinks into `~/.agents/skills/` — do not edit them.
- **Specs** live in `~/openspec/plans` (`specs/` = accepted truth, `changes/` = drafts and tasks files). Use the `spec-keeping` skill for the loop, the closeout trigger, and how to find one.

## Workflow mechanics
- **diffing**: the MCP tools are loaded in pi, so the "Send to agent" baton fires. A handoff carries `decision` (approved | changes-requested | rejected | comment-only) and `mode` (`comment-only` = reply only, no file edits; `standard` = edits allowed), a `<general-comment>`, and EVERY threaded comment **including resolved ones with full history** — an await is a replay, not a delta, so act only on `status="open"`. Serialize replies and resolves: concurrent writes have corrupted `plans.json`.
- diffing vs hunk: diffing = the human drives live steering plus plan/mockup verdicts; hunk = a TUI where the AGENT drives the human's viewport, with no baton (must poll), no verdict, and session-bound comments.

## Memory store

Durable facts live in `~/.pi/agent/memory/` — plain markdown, searched with `rg`. This file holds the
invariants and the manifest below; the detail is read on demand. Use the `memory-keeping` skill for where
a new fact goes and how to find one.

- `REFERENCE.md` § go-backend schema & layout — `1_ddl.up.sql` is the living DDL, `mage dev:ddl`, `api/<name>http` layout
- `REFERENCE.md` § Go lessons — chi middleware/URL params, ULID base32, RowsAffected, txdb leases, fiber→chi parity
- `REFERENCE.md` § Laravel / php-backend — `.env` failure modes (FIFO / 0600 / truncated), valkey vs redis
- `REFERENCE.md` § apidog — wholesale-replace semantics, scenario short/long type forms, project ids
- `REFERENCE.md` § pi / tooling — fleet-web, bash `pkill`, diffing `plans.json` recovery
- `REFERENCE.md` § Personal projects — ladydascalie.github.io, Japan2027, Siralim/Steam Deck, PR-814
- `SCRATCHPAD.md` — open follow-ups; read it when planning work
- `daily/<date>.md` — chronology; `rg` it for "when did we…"
- `~/openspec/plans/README.md` — the spec index

Do not add a search index or embedding service for these stores. A retrieval tool must first beat `rg` on
a fixture of real queries before adoption.
