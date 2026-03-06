# zconf

To use this config, source it in `.zshrc`:

```zsh
[ -f ~/zconf/init.zsh ] && source ~/zconf/init.zsh
```

## Module load order

Modules are discovered via `find` and loaded in alphabetical order by path.
To control ordering, prefix the directory name (e.g. `1_mise` loads before `aws`).

## Bootstrap

Files in `bootstrap/` named `<pkg-manager>.zsh` are sourced if the named
package manager is installed. Bootstrap runs once, then writes a `.bootstrapped`
marker. Delete the marker to re-run.

## Dependencies

Several modules use the [1Password CLI][1password-cli] to inject secrets from
templates (`.tpl` files) into generated config files at first run.

[1password-cli]: https://developer.1password.com/docs/cli/get-started#install

## Testing

Run `./test.sh` to verify bootstrap and module loading in a disposable Arch Linux container (requires `podman`):

```sh
./test.sh
```

This will:

1. Build an image that runs bootstrap on a fresh user (first boot)
2. Source `init.zsh` a second time inside the build to verify idempotency
3. Run a third shell session and assert there is no unexpected output on stdout/stderr

The test passes if all three stages complete without errors or unexpected output. Modules that depend on 1Password are skipped when `op` is not available.
