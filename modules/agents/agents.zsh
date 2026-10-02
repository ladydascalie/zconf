# agents — versioned global skills for the Agents Standard (~/.agents).
#
# `~/.agents/skills` is shared by every agent harness (pi, Delta, …) and also
# holds skills installed by external tools (`diffing setup`, skill
# marketplaces), recorded in `~/.agents/.skill-lock.json`. This repo owns only
# the locally-authored skills; they live here and are symlinked in per item, so
# an installer updating its own skills can never touch ours.
#
# Deliberately NOT versioned here:
#   .skill-lock.json                 installer state, changes on every install
#   skills/diffing-*                 managed by `diffing setup`
#   skills/herdr, skills/find-skills managed by skill installers
#   skills/htmx-*                    external htmx skill pack
#   memory/                          the shared memory store, its own git repo

local dir=${0:A:h}
local agents_dir="$HOME/.agents/skills"

local -a skills=(
	memory-check
	memory-keeping
	spec-keeping
)

for name in $skills; do
	local source="$dir/skills/$name"
	local target="$agents_dir/$name"

	if [[ ! -e "$source" ]]; then
		# Never link to nothing. A missing source used to produce a dangling
		# symlink that then got moved into this directory, self-referential and
		# unrecoverable in place. Skipping is always safe; linking is not.
		_dbg "module(agents) ~> $source is missing, skipping $name."
		continue
	fi

	if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
		_dbg "module(agents) ~> $target already correct, nothing to do."
	elif [[ -e "$target" && ! -L "$target" ]]; then
		# A real file or directory is in the way — move it aside once, then link.
		_dbg "module(agents) ~> backing up $target to ${target}.bak"
		mv "$target" "${target}.bak"
		ln -s "$source" "$target"
	elif [[ ! -e "$target" ]]; then
		mkdir -p "$(dirname "$target")"
		_dbg "module(agents) ~> symlinking $source ~> $target"
		ln -s "$source" "$target"
	fi
done
