---
name: spec-keeping
description: Maintain the user's personal spec library at ~/.agents/store/plans — a project/topic folder per decision (`specs/<project>/<topic>/README.md` accepted, `changes/<project>/<topic>/` drafts/tasks/handoff); check specs before planning work, draft proposals in changes/, promote reviewed drafts into specs/, and keep specs current when work changes behavior. Use when the user mentions specs, plans, designs, decisions worth keeping, or when starting nontrivial work that may have prior decisions recorded.
---

# Spec keeping

The user's spec library lives at `~/.agents/store/plans/` (plain markdown, git
repo). Read its README.md first if unsure of conventions. Two zones:

- `specs/` — accepted truth. Never write here without the user's review.
- `changes/` — drafts, proposals and active work. Write freely; promotion is
  the review.

## Folder shape

One project, one topic, one folder — named after the thing being worked on:

```
specs/<project>/<topic>/README.md      the accepted spec
changes/<project>/<topic>/README.md    the draft, before promotion
changes/<project>/<topic>/tasks.md     active work, deleted on closeout
changes/<project>/<topic>/handoff.md   cross-repo hand-off state, while a boundary is live
changes/archive/<project>/<topic>/     a folder kept as a reference, not a museum
```

- The project is the repo the work belongs to — `go-backend`, `runbooks`,
  `ll-frontend`, `pi`. The topic is the thing being worked on, kebab-case, with
  the project prefix dropped: `runbooks-identity` → `runbooks/identity/`,
  `pi-dev-tasks` → `pi/dev-tasks/`.
- `README.md` is the spec itself, so a folder opens onto its own decision. A
  topic folder left with only `tasks.md`/`handoff.md` is a topic that landed
  without a spec — finish it or delete it.
- A topic may be renamed with qualifiers as it narrows (`add-steam-login`, then
  `steam-login-epic-refresh` if the work returns with a different intent). Never
  a second folder for the same topic.
- **The two zones stay separate.** Tasks and handoff files always live under
  `changes/`, even when their spec is accepted, because that zone is the whole
  to-do list. Promotion therefore moves **only the spec**:
  `git mv changes/<project>/<topic>/README.md specs/<project>/<topic>/README.md`.
  The `tasks.md`/`handoff.md` stay put; the two zones never hold two copies of a
  spec.
- Cross-references are library-root-relative, so they survive a move:
  `specs/runbooks/identity/README.md`,
  `changes/go-backend/event-based-rewards/tasks.md`. Never a relative `../`
  hop — folder depth changes, root-relative paths don't.

## What a spec is

A record of **decisions and intent**: what should be true, why, and what was
rejected. Not code documentation. The bar: *would the user or a fresh agent
session get this wrong without this file?* If not, don't create it.

## When to engage (lightest touch that works)

1. **While deciding.** A decision comes up that outlives the conversation.
   Offer in one line: "Worth capturing as a spec draft?" Never lecture; if the
   user declines, drop it.
2. **Before working.** When planning nontrivial work in a repo, check
   `specs/` for a relevant project/topic folder and the README **In flight**
   section for active tasks files first; read any that match. If none exists and
   the work will settle behavior decisions, offer to draft one first.
3. **After landing.** Work finished and a non-obvious choice was made — offer
   retroactive capture.

## Creating specs (the draft/promote loop)

1. Draft in `changes/<project>/<topic>/README.md`: status `draft`, today's date,
   then the substance — what should be true, why, rejected alternatives, open
   questions. Short; one sitting.
2. Show the user the draft (path, not necessarily full paste). For a richer
   review, use the harness's review flow rather than chat:
   - **Delta:** review inline in the thread — keep the draft in the thread's
     worktree, or attach the spec-library checkout (`~/.agents/store/plans`), so the
     user can open the markdown, select text and leave line-anchored comments
     (Comment Mode in the file pane). Comments arrive as threads you reply to
     and resolve; revise in place, and treat the sign-off as the go-ahead. If
     the user wants an isolated pass instead, `/review` opens a separate review
     conversation whose `/approve` or `/request-changes` verdict lands back in
     this thread. When picking up comments, act only on threads still open, and
     honour any "comment only" instruction: reply, never edit.
   - **pi:** if the diffing extension is available, offer to submit via
     `diffing_plan_submit` instead of chat review — inline comments and revisions
     work well for drafts, and comments survive revisions on the plan page. Steer
     reviewers to comment on the plan page (it carries the verdict); inline diff
     comments are diff-bound and get split across stores, so when picking up a
     diffing review check BOTH the plan store (`diffing plan show <id> --json`)
     and the code-review store (`diffing comments --open`). The diffing tools are
     loaded in pi, so "Send to agent" does fire: block on `diffing_await_review`
     rather than waiting to be told, and treat the handoff's `<general-comment>`
     as the round's prompt. Every await replays the whole thread history, resolved
     threads included, so act only on `status="open"`; honour `mode`
     (`comment-only` = reply only, never edit; `standard` = edits allowed), and
     reply/resolve serially — concurrent writes have corrupted diffing's state
     before. An approved verdict is the go-ahead.
3. On approval, promote the spec: `git mv
   changes/<project>/<topic>/README.md specs/<project>/<topic>/README.md`, set
   status to `accepted` with the date, and add a one-line entry to the README
   index. Its `tasks.md`/`handoff.md` stay in `changes/`. On rejection, discard
   or keep as `dropped` if it still has decision value.
4. If the user edits the draft during review, their version wins verbatim.

## Tracking active work (the tasks file)

When an accepted spec becomes active, multi-step work, give it a sibling tasks
file in its project/topic folder: `changes/<project>/<topic>/tasks.md`. The spec
holds the why and the contract; the tasks file holds the derived execution tasks
and their status, so both are found by the same folder name and a fresh session
(or a subagent lane) can pick the work up mid-flight.

- One tasks file per topic, created when work starts, deleted when it lands.
  While a spec is still a draft the tasks file sits at the same path
  (`changes/<project>/<topic>/tasks.md`); promotion moves only the `README.md`,
  so the tasks file does not move and the spec and its tasks never end up
  duplicated. List active ones in the README **In flight** section. A folder
  kept deliberately as a reference (a worked example) moves to
  `changes/archive/<project>/<topic>/` instead — it leaves **In flight**,
  because that section is a to-do list, not a museum.
- Content: a status header, the ordered task list with `[x]` / `[ ]` on each
  task line (one encoding, so `rg '\[ \]'` finds the open work), a
  verification contract per task (what evidence closes it), current
  branch/PR pointers, and the constraints an executor must honor (parity
  bars, non-negotiables, reviewer decisions, gotchas). Keep the task wording
  self-contained enough to hand to a fresh session without other context.
- Update the file in the same effort as code changes — checking off a task
  is part of finishing it.
- Tasks files are the delegation unit for parallel work: parallelizable
  tasks are written so each can run in its own lane/worktree without
  stepping on others (new files only, or disjoint claims).
- **Closeout is triggered by the work landing, not by remembering later.**
  When the PR merges (or the user says it landed — be precise, *pushed to the
  branch* is not *merged*), in that same effort: distill any durable outcome or
  lesson into the spec (one short paragraph), delete the tasks file and any
  finished `handoff.md`, remove its README **In flight** line, promote a
  still-draft spec to `specs/<project>/<topic>/README.md` with its index line,
  and clear any scratchpad item for that work. A topic folder that keeps its
  `README.md` goes with nothing; a folder with only dead task files is deleted.
  Skipped closeout is the one drift this library reliably accumulates, and it
  always over-claims activity — a stale **In flight** is worse than an empty one,
  because it is the first thing a fresh session reads to decide what to work on.
- Same anti-rules as everything else: checkboxes and markdown only, no
  tooling, no status automation.

### Hand-offs across repos

When a topic spans repos, the topic folder is the shared interface and
`changes/<project>/<topic>/handoff.md` is the live state. Add that file for as
long as a boundary is live, opening with a `## Handoff` block:

- `From:` repo @ branch (PR) and `To:` repo — direction is explicit.
- `State:` `blocked` | `ready` | `consumed`. Only `ready` means the consumer
  may start; say what it may rely on next.
- `Contract:` the apidog endpoint(s), or "no contract change". Never restate
  the field list — apidog owns it. The block carries what apidog cannot: which
  branch it is on, and what is deliberately unspecified.
- `Ready means:` the guarantee the consumer can depend on.
- `Not in contract:` what is explicitly not promised, so the consumer stops
  guessing.
- `Fixtures:` game/template ids, flags, or endpoints needed to exercise it.
- `Findings back:` the return path. The consumer appends discoveries — a bug,
  a contract mismatch, a blocker — as `[ ]` lines here. **A finding is written
  where the producer will read it, not in the consumer's scratchpad.**

Update the block in the same effort as the state changes; delete `handoff.md`
once the boundary is done (`consumed`, no open findings). A topic that spans
repos has **one** hand-off file per live boundary — a second per-repo copy is
the drift this convention exists to prevent, because the copies diverge exactly
where the hand-off matters. (A topic can have more than one boundary over its
life; retire the finished `handoff.md` before opening the next.)

The README **In flight** line names the repo that owns the next action and the
direction, so `rg <repo>` finds hand-offs both ways:

```
- changes/go-backend/event-based-rewards/tasks.md — → ll-frontend: consume reward_id/count (PR #828 awaiting merge)
- changes/go-backend/foo/tasks.md — ← go-backend: fix publisher-scoped reward reads (frontend blocked)
```

## Keeping specs alive

- If work contradicts a spec, update the spec **in the same effort** — state
  the change to the user and apply it (spec edits after an accepted spec
  still get a one-line confirmation, not a full re-review).
- Superseded topics: set status `superseded by <path>`, don't delete.
- Never let specs and code drift silently; if asked to work against stale
  specs, flag it.

## Finding things

The library is searched with `rg` — no index, no search tooling.

- Start from `README.md`: the Index section is the manifest (one line per live
  spec, one per in-flight tasks/handoff file). Read it, then open the matching
  folder.
- For recall across the library: `rg -i '<terms>' ~/.agents/store/plans`, or scope it
  to `specs/` or `changes/`. A topic folder makes the project/topic name a
  second retrieval key.
- Keep every index line keyword-rich, and name the project/topic folder in it —
  the line *is* the retrieval surface. A spec whose index line is vague is
  effectively unfindable.
- Do not add a search index or embedding service over this library. If a
  retrieval tool is ever proposed, it must beat `rg` on a fixture of real
  queries before adoption.

## Anti-rules

- No frontmatter schemas, status automation, or tooling. Plain markdown only.
- Don't auto-create specs for everything; capture is opt-in per decision.
- Don't duplicate what code obviously shows. Specs carry the *why*, not the *how*.
- Don't invent projects. The project folder is the repo the work belongs to
  (`go-backend`, `runbooks`, `ll-frontend`, `pi`); a new one is added only when a
  new repo is genuinely in play, not to group topics by theme.
