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

# Optional user-provided bootstrap scripts (not tracked in git).
# e.g. bootstrap.pacman.zsh, bootstrap.apt.zsh, bootstrap.yay.zsh
for f in "$root_dir"/bootstrap.*.zsh(N); do
	local pkg_manager=${${f:t}#bootstrap.}
	pkg_manager=${pkg_manager%.zsh}
	if is_installed "$pkg_manager"; then
		_dbg "bootstrap ~> $f"
		source "$f"
	fi
done

for f in "${configurations[@]}"; do
	_load "${root_dir}/${f}"
done
