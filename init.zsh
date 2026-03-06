# use this for extra debug information.
# export VERBOSE_STARTUP

# pick an editor, we both know it's gotta be vim.
export EDITOR=vim

local root_dir=$(dirname "$0")
local preload=$root_dir/preload/_init.zsh
local configurations=(
	# shell configuration
	starship/starship.zsh 	# cross shell prompt.
	antidote/antidote.zsh 	# plugin manager.

	# configure zsh itself
	zsh/options.zsh 	# basic options.

	# modules
	modules/_init.zsh	# configurations for tools.
)

# Ensure requisite functions are preloaded.
source $preload

# First-time bootstrap. Only runs once — delete .bootstrapped to re-run.
if [ ! -f "$root_dir/.bootstrapped" ]; then
	_info "First-time bootstrap"
	echo "    Installing packages and tools. sudo may be required."
	echo ""

	# bootstrap/<pkg-manager>.zsh — only runs if that package manager is installed.
	# e.g. pacman.zsh runs only if pacman exists, paru.zsh only if paru exists.
	for f in "$root_dir"/bootstrap/*.zsh; do
		local name="${f:t:r}" # filename without path or extension
		if is_installed "$name"; then
			_info "bootstrap: $name"
			source "$f"
		fi
	done

	# bootstrap/scripts/*.zsh — always run unconditionally.
	for f in "$root_dir"/bootstrap/scripts/*.zsh; do
		_info "bootstrap: ${f:t:r}"
		source "$f"
	done

	rehash
	touch "$root_dir/.bootstrapped"
fi

for f in "${configurations[@]}"; do
	_load "${root_dir}/${f}"
done

# warn if zconf has uncommitted changes
if [ -n "$(git -C "$root_dir" status --porcelain 2>/dev/null)" ]; then
	echo "\033[1;33m==>\033[0m \033[1mzconf has uncommitted changes\033[0m"
fi
