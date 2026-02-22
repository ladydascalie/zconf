# zconf

To use this config, source it in `.zshrc`:

```zsh
[ -f ~/zconf/init.zsh ] && source ~/zconf/init.zsh
```

## Module load order

Modules are discovered via `find` and loaded in alphabetical order by path.
To control ordering, prefix the directory name (e.g. `1_mise` loads before `aws`).

## Bootstrap

Files in `bootstrap/` named `<pkg-manager>.zsh` are sourced at startup if the
named package manager is installed. For example, `bootstrap/pacman.zsh` runs
only on systems with `pacman`.

## Dependencies

Several modules use the [1Password CLI][1password-cli] to inject secrets from
templates (`.tpl` files) into generated config files at first run.

[1password-cli]: https://developer.1password.com/docs/cli/get-started#install
