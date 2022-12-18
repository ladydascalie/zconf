if warn_is_installed git; then
        alias g="git"
        alias gp="git push"
        alias gaa="git add ."
        alias gch="git checkout"
        alias gst="git status"
fi

local dir=$(dirname $0)
local GIT_CONFIG_TEMPLATE=$dir/gitconfig
local GIT_CONFIG_SYMLINK=$HOME/.gitconfig

# check file exists
if [ -f $GIT_CONFIG_SYMLINK ]; then
        # if it does, all good.
        _dbg "module(git) ~> $GIT_CONFIG_SYMLINK already exists, nothing to do."
else
        # keep a symlink since sublime merge doesn't read this variable.
        _dbg "module(git) ~> injecting $GIT_CONFIG_TEMPLATE to $GIT_CONFIG_SYMLINK using 1password cli"
        op inject -i $GIT_CONFIG_TEMPLATE -o $GIT_CONFIG_SYMLINK
fi
