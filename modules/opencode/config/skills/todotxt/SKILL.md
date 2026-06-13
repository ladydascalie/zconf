---
name: todotxt
description: Manage tasks using todo.txt format via todo.sh CLI. Supports projects (+tag), contexts (@tag), and priorities (A-C).
license: MIT
compatibility: opencode
---

## What I do
- Query active tasks and filter by project (+tag) or context (@tag).
- Add, modify, complete, prioritize tasks via the terminal.
- Categorize tasks by project. Use the current repo name as the project. Example: `todo.sh add "implement xyz +repo-name @tag1 @tag2"`

## Commands
- `todo.sh add "task description +proj @ctx"` — add a task
- `todo.sh ls` — list pending tasks
- `todo.sh ls +proj` — filter by project
- `todo.sh ls @ctx` — filter by context
- `todo.sh do N` — mark task N as done (archives to done.txt)
- `todo.sh pri N A` — set priority (A, B, or C)
- `todo.sh rm N` — delete a task
- `todo.sh listpri` — list by priority
- `alias t='todo.sh'` is available in zconf

## Companion notes
Tasks can reference companion markdown files with `=> notes/slug.md`. These live in `~/todo/notes/` and contain full AI session context — file paths, previous findings, acceptance criteria, gotchas. When starting work on a task, read its companion note file first.

## File locations
- `~/todo.txt` — active tasks
- `~/todo/notes/` — companion note files (markdown)
- `~/todo.done.txt` — completed tasks (auto-archived)
- `~/.config/todo/config` — configuration
