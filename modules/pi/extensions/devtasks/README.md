# pi-devtasks

Supervises a repo's long-running local dev commands (`mise run dev`, `go run .`,
`npm run dev`) in a **herdr pane**, in a dedicated `devtasks` workspace. herdr
owns the process, so tasks outlive pi; there is no server, token or daemon.

The extension requires herdr (`HERDR_ENV=1`). Outside herdr the tools report
devtasks unavailable.

## Tasks

Declare them in `.pi/dev.json` at the repo root (see the `devtasks-setup` skill):

```json
{
  "tasks": {
    "dev": { "cmd": "mise run dev", "ready": { "port": 8091 } },
    "worker": { "cmd": "go run ./cmd/worker", "ready": { "stdout": "worker ready" } }
  }
}
```

Tools: `dev_list`, `dev_start`, `dev_stop`, `dev_restart`, `dev_status`,
`dev_logs`. Command: `/dev` starts the repo's sole task; `/dev start|stop|restart|status|logs|focus [task]` (the task name is optional when only one is declared).

## Layout

One pane per repo, in a workspace labelled `devtasks` (created on first use).
The pane runs with `--cwd` = repo root, its label is the repo slug, and its
pane token carries `repo`/`task`/`status` so the herdr sidebar is the dashboard.
One task runs per repo at a time; a second concurrent start is rejected. New
panes split **side by side** (to the right); beyond four panes in the first tab,
new repos get a second tab.

## Model

- `pane run` echoes the command into the pane, so a `stdout` readiness marker
  that also appears in `cmd` matches the echo. Use a marker only the program
  prints.
- Liveness is polled from `pane process-info`: when the pane's foreground
  process group is the shell again, the task has ended.
- Stop sends Ctrl+C to the pane; if it does not settle within `stop.timeoutMs`
  the pane is closed (and recreated on the next start).
- Panes are not stopped on `session_shutdown` — they keep running.

## Tests

```bash
node --test test/
```

`test/herdr.test.ts` covers the CLI envelope parsing with a fake runner;
`test/manager.test.ts` drives the pane manager against a fake `Herdr`, so no
live herdr session is needed.

## Notes

- Transitions (ready/failed/exited) append a transcript note but never start a
  model turn; `notify` per task opts out. Deliberate stops are not reported.
- Panes on the alternate screen lose history; `dev_logs` reads the pane tail.
