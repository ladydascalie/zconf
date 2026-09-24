---
name: memory-keeping
description: Maintain the durable memory store — route a new fact to the right tier, keep the injected core small, and find what is already known before starting work. Use when you learn something durable (a gotcha, a preference, a corrected assumption, a resolved blocker), when you need to recall prior context, or when ~/.pi/agent/AGENTS.md has grown.
---

# Memory keeping

Memory holds **durable facts**: environment details, gotchas, preferences, corrections.
It does not hold decisions (→ `spec-keeping`) or chronology (→ `daily/`).

## Where things live

| Tier | Holds | File | Cost |
|---|---|---|---|
| Injected | invariants + the pointer manifest | `~/.pi/agent/AGENTS.md` | every session |
| Retrieved | facts, gotchas, conventions | `~/.pi/agent/memory/REFERENCE.md` | on demand |
| Retrieved | chronology | `~/.pi/agent/memory/daily/<date>.md` | on demand |
| Retrieved | open follow-ups | `~/.pi/agent/memory/SCRATCHPAD.md` | on demand |

There is **no cap and no index**. The injected file stays small by being *curated*, not truncated —
which is the difference between a file that degrades visibly and one that silently loses its tail.

## Finding things (before nontrivial work)

1. The injected `AGENTS.md` carries the manifest. It names the file and the section for each area.
2. `rg -i '<terms>' ~/.pi/agent/memory/REFERENCE.md` — search the section the manifest points at.
3. Read the section. Never act on a remembered paraphrase of it.

Reading the file at the moment of use is the point: **a file read on demand cannot be stale.** That is
why there is no index — there is no second copy to diverge from the truth.

## Writing (the routing question)

Ask once, in this order:

1. **Must this be true in every session, whatever I am working on?**
   → `AGENTS.md`. Rare: a new invariant, or an environment fact needed to interpret an error.
2. **Is it needed only when working on X?**
   → `REFERENCE.md`, in X's section. Common.
3. **Did it happen at a time?**
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
- A read-only session-start check (`~/.pi/agent/extensions/memory-check.ts`) reports budget overruns,
  dead manifest pointers, uncommitted stores and stale tasks files into the system prompt. It has no
  authority to block anything — **act on its findings, or say why not.** Run `/memory-check` to trigger
  it on demand (e.g. right after a merge lands).
- Over budget → move a whole **section** to `REFERENCE.md` and leave one pointer line. Move sections,
  never sentences.
- The manifest grows by **area**, not by fact. Adding a lesson does not touch the manifest. A lesson
  that seems to need its own pointer line is a signal it belongs in an existing area instead.
- If a fact feels too small to route properly, that is the signal it should not be recorded.

## Chronology

At the end of a substantial session — or when asked to wrap up — append to `daily/<date>.md`: what was
decided, what was learned, what got resolved, what is still open. Not narration: a fresh session reading
it should know what changed and why.

## Anti-rules

- **No search index, no embeddings, no retrieval service.** A tool must beat `rg` on a fixture of real
  queries before it is adopted (see `AGENTS.md` § Memory store).
- No frontmatter schemas, no status automation, no tooling over the store.
- Do not let the injected file become the store.
