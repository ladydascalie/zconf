# hunk — versioned configuration for the Hunk diff viewer.
#
# Content lives here and is symlinked into ~/.config/hunk, so edits happen in this
# repo. Symlinked per item rather than per directory, because ~/.config/hunk/extensions
# also holds `installed/` (managed by `hunk extension install`) and runtime state.
#
# Deliberately NOT versioned here:
#   state.json                  runtime startup state
#   extensions/installed/       managed by `hunk extension install`
#
# config.toml and the extension file are safe to link: Hunk reads them at startup and
# does not rewrite them (theme/UI state lives in state.json).

export PATH='/home/b/.hunk/bin':"$PATH"

local dir=${0:A:h}
local hunk_dir="$HOME/.config/hunk"

local -a items=(
	config.toml
	extensions/note-mirror.ts
)

for item in $items; do
	local source="$dir/$item"
	local target="$hunk_dir/$item"

	if [[ ! -e "$source" ]]; then
		# Never link to nothing: a dangling symlink here is unrecoverable in place.
		_dbg "module(hunk) ~> $source is missing, skipping $item."
		continue
	fi

	if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
		_dbg "module(hunk) ~> $target already correct, nothing to do."
	elif [[ -e "$target" && ! -L "$target" ]]; then
		# A real file is in the way — move it aside once, then link.
		_dbg "module(hunk) ~> backing up $target to ${target}.bak"
		mv "$target" "${target}.bak"
		ln -s "$source" "$target"
	elif [[ ! -e "$target" ]]; then
		mkdir -p "$(dirname "$target")"
		_dbg "module(hunk) ~> symlinking $source ~> $target"
		ln -s "$source" "$target"
	fi
done

# Hunk's bundled skills are generated from the CLI metadata, so link (never copy) to keep
# them aligned across upgrades (`hunk skill path`). Both roots are linked: ~/.agents/skills
# is read by every harness, ~/.pi/agent/skills mirrors the other vendor skills there.
local -a skill_names=(hunk-review hunk-extensions)
local skills_dir="$HOME/.hunk/skills"
local -a skill_roots=("$HOME/.agents/skills" "$HOME/.pi/agent/skills")

for root in $skill_roots; do
	for name in $skill_names; do
		local source="$skills_dir/$name"
		local target="$root/$name"

		if [[ ! -e "$source" ]]; then
			_dbg "module(hunk) ~> $source is missing, skipping $name."
			continue
		fi

		if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
			_dbg "module(hunk) ~> $target already correct, nothing to do."
			continue
		fi

		if [[ -e "$target" && ! -L "$target" ]]; then
			_dbg "module(hunk) ~> backing up $target to ${target}.bak"
			mv "$target" "${target}.bak"
		fi

		mkdir -p "$root"
		_dbg "module(hunk) ~> symlinking $source ~> $target"
		ln -sfn "$source" "$target"
	done
done
