local dir=$(dirname $0)
local config_in_place=$dir/zed-config-folder
local config_symlink=$HOME/.config/zed

# ensure the destination directory exists
mkdir -p $(dirname $config_symlink)

# check if the symlink exists and points to the correct target
if [ -L $config_symlink ] && [ "$(readlink $config_symlink)" = "$config_in_place" ]; then
    # if it does, all good.
    _dbg "module(zed) ~> $config_symlink already exists and points to the correct target, nothing to do."
elif [ -e $config_symlink ]; then
    # if a file or directory exists at the symlink location but it's not a symlink
    _dbg "module(zed) ~> $config_symlink exists but is not a symlink. Manual intervention required."
else
    # symlink to the home directory.
    _dbg "module(zed) ~> symlinking $config_in_place to $config_symlink"
    ln -s $config_in_place $config_symlink
fi
