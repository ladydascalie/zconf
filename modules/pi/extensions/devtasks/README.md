# pi-devtasks

Supervises a repo's long-running local dev commands (`mise run dev`, `go run .`,
`npm run dev`) and shows their live output in one web page.

Two modes:

- **daemon** (`devd`) — a long-lived process that owns the tasks. One permanent
  page, tasks survive pi, every managed repo aggregated. Preferred.
- **in-process** — the old behaviour: the server and children live inside a pi
  session. Used as a fallback when the daemon is unavailable.

## Tasks

Declare them in `.pi/dev.json` at the repo root (see the `devtasks-setup` skill):

```json
{
  "server": { "host": "127.0.0.1", "token": true },
  "tasks": {
    "dev": { "cmd": "mise run dev", "ready": { "port": 8080 } },
    "worker": { "cmd": "go run ./cmd/worker", "ready": { "stdout": "worker ready" } }
  }
}
```

Tools: `dev_list`, `dev_start`, `dev_stop`, `dev_restart`, `dev_status`,
`dev_logs`. Command: `/dev list|start|stop|restart|status|logs|open`.

## Run the daemon

```bash
# foreground
node --experimental-strip-types daemon.ts

# or via the wrapper
./bin/devd
```

The page is `http://127.0.0.1:4770/?token=<persisted token>`. The port and token
are stable, so the URL can be bookmarked. The extension **lazily spawns** the
daemon on first use, so the systemd unit is optional.

### systemd (always on)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/pi-devtasks.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pi-devtasks
```

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PI_DEV_TASKS_PORT` | `4770` | fixed page port (hard-fails if taken) |
| `PI_DEV_TASKS_HOST` | `127.0.0.1` | bind host |
| `PI_DEV_TASKS_SOCKET` | `$XDG_RUNTIME_DIR/pi-devtasks.sock` | control socket |

State lives in `$XDG_STATE_HOME/pi-devtasks/` (`repos.json`, `running.json`,
`daemon-token`, `daemon.log`, per-task logs).

## Tests

```bash
node --experimental-strip-types --test test/*.test.ts
```

## Spike limitations

- A daemon restart does not re-adopt running children; recorded process groups
  from an unclean shutdown are killed on next start.
- No repo add/remove UI yet — a repo is registered by running pi there once.
- Transitions (ready/failed/exited) append a transcript note but never start a
  model turn; `notify` per task opts out. Deliberate stops and the stop caused
  by `/reload` are not reported to the model.
- The daemon serves the page from the code it loaded at start-up, so a running
  daemon shows the old UI until it is restarted (a restart also restarts its
  tasks).
