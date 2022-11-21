local dir="$(dirname $0)"
local config_file="$dir/tmux.conf"
local symlink="$HOME/.tmux.conf"

# check file exists
if [ -f $symlink ]; then
        # if it does, all good.
else
        # keep a symlink since sublime merge doesn't read this variable.
	ln -s $config_file $symlink
fi