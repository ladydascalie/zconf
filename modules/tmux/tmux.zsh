local dir="$(dirname $0)"
local config_file="$dir/tmux.conf"
local symlink="$HOME/.tmux.conf"

# check file exists
if [ -f $symlink ]; then
        _dbg "module(tmux): $symlink already exists"
        # if it does, all good.
else
        # keep a symlink since sublime merge doesn't read this variable.
        _dbg "module(tmux): creating symlink $config_file ~> $symlink"
	ln -s $config_file $symlink
fi