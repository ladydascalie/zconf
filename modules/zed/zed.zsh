local dir=$(dirname $0)
local config_in_place=$dir/zed
local config_symlink=$HOME/.config/zed

# ensure the destination directory exists
mkdir -p $(dirname $config_symlink)

# check file exists
if [ -f $config_symlink ]; then
        # if it does, all good.
        _dbg "module(zed) ~> $config_symlink already exists, nothing to do."
else
        # symlink to the home directory.
        _dbg "module(zed) ~> symlinking $config_in_place to $config_symlink"
        ln -s $config_in_place $config_symlink
fi
