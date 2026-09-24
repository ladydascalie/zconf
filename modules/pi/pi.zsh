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
	skills/memory-keeping
	skills/spec-keeping
	extensions/memory-check.ts
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
