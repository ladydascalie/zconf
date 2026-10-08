# pi — versioned configuration for the pi coding agent.
#
# Content lives here and is symlinked into ~/.pi/agent, so edits happen in this
# repo. Symlinked per item rather than per directory, because ~/.pi/agent/skills
# and ~/.pi/agent/extensions also hold things this repo must not own.
#
# Deliberately NOT versioned here:
#   auth.json                        secrets
#   memory/, memory-archive/         data, versioned in its own repo
#   extensions/herdr-agent-state.ts  managed by herdr, overwritten on update
#   skills/diffing-*                 managed by `diffing setup` (into ~/.agents/skills)
#   skills/memory-keeping            shared global skills (in ~/.agents/skills)
#   skills/spec-keeping              shared global skills (in ~/.agents/skills)
#
# settings.json is safe to link: pi persists it with an in-place writeFileSync,
# never a rename, so the symlink survives its writes.

local dir=${0:A:h}
local pi_dir="$HOME/.pi/agent"

local -a items=(
	AGENTS.md
	settings.json
	agents
	prompts
	extensions/memory-check.ts
	extensions/openrouter-key-status.ts
	extensions/fleet-web
	extensions/subagent
)

for item in $items; do
	local source="$dir/$item"
	local target="$pi_dir/$item"

	if [[ ! -e "$source" ]]; then
		# Never link to nothing. A missing source used to produce a dangling
		# symlink that then got moved into this directory, self-referential and
		# unrecoverable in place. Skipping is always safe; linking is not.
		_dbg "module(pi) ~> $source is missing, skipping $item."
		continue
	fi

	if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
		_dbg "module(pi) ~> $target already correct, nothing to do."
	elif [[ -e "$target" && ! -L "$target" ]]; then
		# A real file or directory is in the way — move it aside once, then link.
		_dbg "module(pi) ~> backing up $target to ${target}.bak"
		mv "$target" "${target}.bak"
		ln -s "$source" "$target"
	elif [[ ! -e "$target" ]]; then
		mkdir -p "$(dirname "$target")"
		_dbg "module(pi) ~> symlinking $source ~> $target"
		ln -s "$source" "$target"
	fi
done

# Point ~/.zshenv at the guard above. This one lives outside ~/.pi/agent, so it is
# linked separately from the items loop.
local zshenv_source=$dir/zshenv
local zshenv_target=$HOME/.zshenv

if [[ -L "$zshenv_target" && "$(readlink "$zshenv_target")" == "$zshenv_source" ]]; then
	_dbg "module(pi) ~> $zshenv_target already correct, nothing to do."
elif [[ -e "$zshenv_target" && ! -L "$zshenv_target" ]]; then
	_dbg "module(pi) ~> backing up $zshenv_target to ${zshenv_target}.bak"
	mv "$zshenv_target" "${zshenv_target}.bak"
	ln -s "$zshenv_source" "$zshenv_target"
elif [[ ! -e "$zshenv_target" ]]; then
	_dbg "module(pi) ~> symlinking $zshenv_source ~> $zshenv_target"
	ln -s "$zshenv_source" "$zshenv_target"
fi

# Switch the OpenRouter key pi authenticates with.
#
# auth.json resolves the key with `!cat ~/.pi/agent/openrouter/active.key`, so
# switching only re-points that symlink. pi caches the resolved command for the
# process lifetime, so a switch takes effect on the next `pi` launch.
pi-key() {
	local dir="$HOME/.pi/agent/openrouter"
	local keys="$dir/keys"
	local account="${1:-}"
	local -a accounts=($keys/*(N))
	accounts=(${accounts:t})

	if [[ "$account" == "status" ]]; then
		print -r -- "openrouter key: ${$(readlink "$dir/active.key"):t}"
		return 0
	fi

	if (( ${#accounts} == 0 )); then
		print -ru2 -- "pi-key: no keys in $keys"
		return 1
	fi

	if [[ -z "$account" ]]; then
		account=$(printf '%s\n' "${accounts[@]}" | fzf --prompt='openrouter key> ' --height=20% --reverse) || return 1
		[[ -n "$account" ]] || return 1
	fi

	if [[ ! -f "$keys/$account" ]]; then
		print -ru2 -- "pi-key: unknown account '$account' (have: ${(j:, :)accounts})"
		return 1
	fi
	if [[ ! -s "$keys/$account" ]]; then
		print -ru2 -- "pi-key: '$account' key is empty — put a key in $keys/$account"
		return 1
	fi

	ln -sfn "keys/$account" "$dir/active.key"
	print -r -- "openrouter key: $account"
}
