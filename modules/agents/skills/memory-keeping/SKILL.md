---
name: memory-keeping
description: Maintain the durable memory store — route a new fact to the right tier, keep the injected core small, and find what is already known before starting work. Use when you learn something durable (a gotcha, a preference, a corrected assumption, a resolved blocker), when you need to recall prior context, or when the injected core has grown.
---

# Memory keeping

Memory holds **durable facts**: environment details, gotchas, preferences, corrections.
It does not hold decisions (→ `spec-keeping`) or chronology (→ `daily/`).

## Where things live

There is **one store**, `~/.agents/store/` — a single git repo shared by every harness
(pi, Delta, …), holding the **facts** tier in `memory/` (this skill) and the spec library
in `plans/` (`spec-keeping`). Only the injected core differs, because each harness reads
its own personal `AGENTS.md`.

| Tier | Holds | File | Cost |
|---|---|---|---|
| Injected | invariants + the pointer manifest | the harness's own `AGENTS.md` (`~/.pi/agent/AGENTS.md` for pi, `~/.config/delta/AGENTS.md` for Delta) | every session |
| Retrieved | pi-tool facts | `~/.agents/store/memory/PI.md` | on demand |
| Retrieved | Delta-tool facts | `~/.agents/store/memory/DELTA.md` | on demand |
| Retrieved | facts, gotchas, conventions | `~/.agents/store/memory/REFERENCE.md` | on demand |
| Retrieved | chronology | `~/.agents/store/memory/daily/<date>.md` | on demand |
| Retrieved | open follow-ups | `~/.agents/store/memory/SCRATCHPAD.md` | on demand |

**Harness-specific facts go in the harness file** (`PI.md`, `DELTA.md`) — never in the
shared `REFERENCE.md`, and never in the injected core. The store path is defined here,
once; every harness's manifest points at the same `~/.agents/store/memory/`.

If the harness confines file tools to its worktree (Delta), read and edit these files
through the terminal (`cat`, `sed`, heredoc) instead.

There is **no cap and no index**. The injected file stays small by being *curated*, not truncated —
which is the difference between a file that degrades visibly and one that silently loses its tail.

## Finding things (before nontrivial work)

1. The injected `AGENTS.md` carries the manifest. It names the file and the section for each area.
2. `rg -i '<terms>' ~/.agents/store/memory/` — search the store (scope to one file or section when you can).
3. Read the section. Never act on a remembered paraphrase of it.

Reading the file at the moment of use is the point: **a file read on demand cannot be stale.** That is
why there is no index — there is no second copy to diverge from the truth.

## Writing (the routing question)

Ask once, in this order:

1. **Must this be true in every session, whatever I am working on?**
   → the harness's own `AGENTS.md`. Rare: a new invariant, or a machine/environment fact needed to
   interpret an error.
2. **Is it knowledge about the harness itself** — config paths, skills, profiles, worktrees, review
   mechanics, transports, provider auth?
   → the harness file: `PI.md` for pi, `DELTA.md` for Delta. Read only when relevant. Never fold it
   into the core or the shared `REFERENCE.md`.
3. **Is it needed only when working on X?**
   → `REFERENCE.md`, in X's section. Common.
4. **Did it happen at a time?**
   → `daily/<date>.md`.

Then:

- One fact per bullet. Keyword-rich — use the words you would actually search for, *including the
  symptom* ("connection refused", "silently dropped", "returns 0").
- State the fact, not the story. Keep the *why* only when it changes what you do next.
- A correction **replaces** the wrong fact in place. Never leave both versions standing.
- Do not record what the code, a config file, or a commit message already shows.
- Do not record what a fresh session would get right anyway. The bar is **"would a fresh session get
  this *wrong*?"**

## Curating — the whole discipline

`AGENTS.md` is **hand-edited, never appended to**. There is no append path, so it cannot grow by accident.

- Budget: keep it under ~10 KB (about the size of `go-backend/AGENTS.md`). Run `wc -c` in the same edit
  that changes it — visible size is what replaces the old hard cap.
- The `memory-check` mechanism (the pi extension, or the Delta `memory-check` skill) reports budget
  overruns, dead manifest pointers, uncommitted stores and stale tasks files. It is read-only and has no
  authority to block anything — **act on its findings, or say why not.** Run `/memory-check` after a merge
  lands.
- Over budget → move a whole **section** to `REFERENCE.md` and leave one pointer line. Move sections,
  never sentences.
- The manifest grows by **area**, not by fact. Adding a lesson does not touch the manifest. A lesson
  that seems to need its own pointer line is a signal it belongs in an existing area instead.
- If a fact feels too small to route properly, that is the signal it should not be recorded.

## Anchors — proving a fact still holds

Most facts need no anchor: a preference, an environment fact or a correction cannot rot
with a repo. A fact that *is* about a specific place in code may carry one, so
`recall-verify` can re-check it without a full read:

```
<!-- verify repo=go-backend sha=<sha> [path=<repo-relative>] [symbol=<ident>] [at=<date>] -->
```

- `repo` — a stable short name (`recall-verify` resolves it), never a path: a path
  rots on a move, the name does not.
- `sha` — the commit the fact was checked against (`git rev-parse HEAD` at the time).
- `path` / `symbol` — optional; either makes the check concrete (a moved/renamed path,
  a vanished symbol).
- `at` — the date of the check, for a human reading the marker.

The anchor records **where a fact was checked**, not **when it became true**. The fact
stands on its own: if the repo moves or disappears, the anchor degrades to
"unverifiable" and the memory is kept. `recall-verify` runs inside `memory-check`; run
it by hand as `recall-verify [-v]` after a rename or a repo move.

## Chronology

At the end of a substantial session — or when asked to wrap up — append to `daily/<date>.md`: what was
decided, what was learned, what got resolved, what is still open. Not narration: a fresh session reading
it should know what changed and why.

## Anti-rules

- **No search index, no embeddings, no retrieval service.** A tool must beat `rg` on a fixture of real
  queries before it is adopted (see `AGENTS.md` § Memory store).
- No frontmatter schemas, no status automation, no tooling over the store.
- Do not let the injected file become the store.
