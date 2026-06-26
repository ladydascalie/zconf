---
name: kanban
description: Use for any kanban board operations — listing, creating, moving, editing, or deleting cards. Use when the user mentions tasks, cards, tickets, work items, kanban, or columns.
---

# kanban

A plain-text kanban board where columns are folders and cards are markdown files with YAML frontmatter. Cards have sortable timestamped filenames and can be referenced by their slug suffix.

## File locations

- Board root: `<project>/.kanban/`
- Config: `<project>/.kanban/kanban.yaml`
- Cards: `<project>/.kanban/<column>/YYYYMMDD-HHMMSS-<slug>.md`
- CLI binary: `kanban` in PATH

## Referencing cards

Cards have full filenames like `20260616-142315-implement-login.md`. Reference them by just the slug suffix — e.g., `implement-login.md` — the tool finds matches via suffix matching.

**Never type the full timestamped name.** Always use the short slug form.

## LLM usage — always use `--json`

When you (the AI) need to query or modify the board, **always** use the `--json` variants. This returns/accepts structured JSON that you can parse programmatically instead of scraping text output.

| Command | Human-friendly | LLM-friendly |
|---------|---------------|--------------|
| `kanban list` | Emoji + columns with card lists | `kanban list --json` → structured board state |
| `kanban show <slug>` | Formatted metadata + body | `kanban show <slug> --json` → structured frontmatter + body |
| `kanban new <title>` | Opens `$EDITOR` with template | `kanban new --json '<json>'` → create card programmatically |
| `kanban config` | YAML config dump | `kanban config --json` → JSON config |

## Commands

| Command | Description |
|---------|-------------|
| `kanban init [dir]` | Initialize a new board (creates `.kanban/` with default columns) |
| `kanban list [col] [--json]` | List cards. Append `--json` for structured output |
| `kanban new <title>` | Create a card in the first column. Opens `$EDITOR` with title pre-filled |
| `kanban new --json '<json>'` | Create a card from JSON (LLM-friendly). Does not open editor |
| `kanban move <slug> <col>` | Move a card to another column. Use column ID (e.g., `doing`, `done`) |
| `kanban edit <slug>` | Open card in `$EDITOR` |
| `kanban show <slug> [--json]` | Show card content. Append `--json` for structured frontmatter + body |
| `kanban delete <slug>` | Delete a card |
| `kanban column add <name>` | Add a new column (default: wildcard). Use `--type linear` for linear columns |
| `kanban config [--json]` | Show effective config. Append `--json` for JSON output |

## Card format

```
---
priority:           # high | medium | low
labels:             # e.g. ["backend", "auth"]
---

# Card Title

## Notes

## Checklist

- [ ]
```

Priority is displayed as 🔴 high / 🟡 medium / 🟢 low in the TUI and `kanban show`.

### Creating cards with JSON (`--json`)

When creating a card via `--json`, the payload structure is:

```json
{
  "title": "Card Title",
  "body": "## Notes\n\nFull markdown body content",
  "priority": "high",
  "labels": ["backend", "auth"],
  "column": "todo"
}
```

- `title` (required) — card title, slugified for the filename
- `body` (optional) — full markdown body. Omit for default template (heading + Notes + Checklist)
- `priority` (optional) — `"high"`, `"medium"`, or `"low"`
- `labels` (optional) — array of label strings
- `column` (optional) — target column ID; defaults to the first column

## TUI (terminal UI)

Launch with `kanban tui`. Keybindings:

| Key | Action |
|-----|--------|
| `↑/↓` `j/k` | Navigate cards |
| `Tab` `←/→` `h/l` | Navigate columns |
| `Shift+←/→` | Move card to adjacent column |
| `Enter` | View card content |
| `y` | Copy card name to clipboard |
| `e` | Edit in `$EDITOR` |
| `n` | New card |
| `m` | Move card to any column by name |
| `d` | Delete card (with confirmation) |
| `?` | Help overlay |
| `q` / `Ctrl+C` | Quit |

## Typical workflow (AI)

````bash
# 1. Query the board state
kanban list --json

# 2. Create a card in a specific column
kanban new --json '{"title": "Implement login flow", "priority": "high", "labels": ["auth"], "column": "todo"}'

# 3. Show card details
kanban show implement-login-flow.md --json

# 4. Move card to next column
kanban move implement-login-flow.md doing

# 5. Move card to done
kanban move implement-login-flow.md done
````

## Typical workflow (human)

1. `kanban new "implement login flow"` — creates a card in todo, opens editor
2. User sets priority/labels in frontmatter
3. `kanban move implement-login-flow.md doing` — moves to in-progress
4. `kanban move implement-login-flow.md done` — marks done
