---
name: spec-keeping
description: Maintain the user's personal spec library at ~/openspec/plans — check specs before planning work, draft proposals in changes/, promote reviewed drafts into specs/, and keep specs current when work changes behavior. Use when the user mentions specs, plans, designs, decisions worth keeping, or when starting nontrivial work that may have prior decisions recorded.
---

# Spec keeping

The user's spec library lives at `~/openspec/plans/` (plain markdown, git
repo). Read its README.md first if unsure of conventions. Two zones:

- `specs/` — accepted truth. Never write here without the user's review.
- `changes/` — drafts and proposals. Write freely; promotion is the review.

## What a spec is

A record of **decisions and intent**: what should be true, why, and what was
rejected. Not code documentation. The bar: *would the user or a fresh agent
session get this wrong without this file?* If not, don't create it.

## When to engage (lightest touch that works)

1. **While deciding.** A decision comes up that outlives the conversation.
   Offer in one line: "Worth capturing as a spec draft?" Never lecture; if the
   user declines, drop it.
2. **Before working.** When planning nontrivial work in a repo, check
   `specs/` for a relevant topic and the README **In flight** section for
   active tasks files first; read any that match. If none exists and the
   work will settle behavior decisions, offer to draft one first.
3. **After landing.** Work finished and a non-obvious choice was made — offer
   retroactive capture.

## Creating specs (the draft/promote loop)

1. Draft in `changes/<topic>.md`: status `draft`, today's date, then the
   substance — what should be true, why, rejected alternatives, open
   questions. Short; one sitting.
2. Show the user the draft (path, not necessarily full paste). If the
   diffing extension is available and the user wants a richer review, offer
   to submit it via diffing_plan_submit instead of chat review — inline
   comments and revisions work well for spec drafts. Steer reviewers to
   comment on the plan page (it carries the verdict and comments survive
   revisions); inline diff comments also work but are diff-bound and get
   split across stores. Answer/resolve comments, revise, and treat an
   approved verdict as the go-ahead.
   When picking up a diffing review, check BOTH stores: plan comments
   (`diffing plan show <id> --json` in the session's repo) AND inline
   code-review comments (`diffing comments --open`) — inline comments on
   the diff land in the code-review store, not the plan store. The diffing
   tools are loaded in pi, so "Send to agent" does fire: block on
   `diffing_await_review` instead of waiting for the user to say they are
   ready, and treat the handoff's `<general-comment>` as the prompt for
   the round. Two handoff gotchas: every await replays the whole thread
   history, resolved threads included, so act only on `status="open"`;
   and honour the `mode` (`comment-only` = reply only, never edit;
   `standard` = edits allowed). Reply and resolve serially — concurrent
   writes to diffing's stores have corrupted its state before.
3. On approval, promote: `mv changes/<topic>.md specs/<topic>.md`, set status
   to `accepted` with the date, and add a one-line entry to the README index.
   On rejection, discard or keep as `dropped` if it still has decision value.
4. If the user edits the draft during review, their version wins verbatim.

## Tracking active work (the tasks file)

When an accepted spec becomes active, multi-step work, give it a sibling
tasks file: `changes/<topic>.tasks.md`. The spec holds the why and the
contract; the tasks file holds the derived execution tasks and their status,
so both live next to each other and a fresh session (or a subagent lane) can
pick the work up mid-flight.

- One tasks file per topic, created when work starts, deleted when it lands.
  Do not index them under `specs/`; list active ones in the README **In
  flight** section. A file kept deliberately as a reference (a worked example)
  moves to `changes/archive/` instead — it leaves **In flight**, because that
  section is a to-do list, not a museum.
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
  lesson into the spec (one short paragraph), delete the tasks file, remove its
  README **In flight** line, promote a still-draft spec to `specs/` with its
  index line, and clear any scratchpad item for that work.
  Skipped closeout is the one drift this library reliably accumulates, and it
  always over-claims activity — a stale **In flight** is worse than an empty one,
  because it is the first thing a fresh session reads to decide what to work on.
- Same anti-rules as everything else: checkboxes and markdown only, no
  tooling, no status automation.

## Keeping specs alive

- If work contradicts a spec, update the spec **in the same effort** — state
  the change to the user and apply it (spec edits after an accepted spec
  still get a one-line confirmation, not a full re-review).
- Superseded topics: set status `superseded by <file>`, don't delete.
- Never let specs and code drift silently; if asked to work against stale
  specs, flag it.

## Finding things

The library is searched with `rg` — no index, no search tooling.

- Start from `README.md`: the Index section is the manifest (one line per live
  spec, one per in-flight tasks file). Read it, then open the matching file.
- For recall across the library: `rg -i '<terms>' ~/openspec/plans`, or scope it
  to `specs/` or `changes/`.
- Keep every index line keyword-rich — it *is* the retrieval surface. A spec
  whose index line is vague is effectively unfindable.
- Do not add a search index or embedding service over this library. If a
  retrieval tool is ever proposed, it must beat `rg` on a fixture of real
  queries before adoption.

## Anti-rules

- No frontmatter schemas, status automation, or tooling. Plain markdown only.
- Don't auto-create specs for everything; capture is opt-in per decision.
- Don't duplicate what code obviously shows. Specs carry the *why*, not the *how*.
