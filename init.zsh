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

# Optional bootstrap scripts: bootstrap/<pkg-manager>.zsh
# Only runs once. Delete .bootstrapped to re-run.
if [ ! -f "$root_dir/.bootstrapped" ]; then
	_info "First-time bootstrap"
	echo "    Installing packages and tools. sudo may be required."
	echo ""
	for f in "$root_dir"/bootstrap/*.zsh(N); do
		local pkg_manager=${${f:t}%.zsh}
		if is_installed "$pkg_manager"; then
			_info "bootstrap: $pkg_manager"
			source "$f"
		fi
	done
	for f in "$root_dir"/bootstrap/scripts/*.zsh(N); do
		_info "bootstrap: ${${f:t}%.zsh}"
		source "$f"
	done
	touch "$root_dir/.bootstrapped"
fi

for f in "${configurations[@]}"; do
	_load "${root_dir}/${f}"
done
