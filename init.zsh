# use this for extra debug information.
# export VERBOSE_STARTUP

# pick an editor, we both know it's gotta be vim.
export EDITOR=vim

local root_dir=$(dirname $0)
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

for f in $configurations; do
	_load $root_dir/$f
done
