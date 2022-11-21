if warn_is_installed git; then
        alias g="git"
        alias gp="git push"
        alias gaa="git add ."
        alias gch="git checkout"
        alias gst="git status"
fi

local dir=$(dirname $0)
export GIT_CONFIG_GLOBAL=$dir/gitconfig
export GIT_CONFIG_SYMLINK=$HOME/.gitconfig

# check file exists
if [ -f $GIT_CONFIG_SYMLINK ]; then
        # if it does, all good.
        _dbg "module(git) ~> $GIT_CONFIG_SYMLINK already exists, nothing to do."
else
        # keep a symlink since sublime merge doesn't read this variable.
        _dbg "module(git) ~> symlinking $GIT_CONFIG_GLOBAL to $GIT_CONFIG_SYMLINK"
        ln -s $GIT_CONFIG_GLOBAL $GIT_CONFIG_SYMLINK
fi
