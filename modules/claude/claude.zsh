ENABLE_TOOL_SEARCH=true

local dir=$(dirname $0)
local CLAUDE_MD_SOURCE=$dir/CLAUDE.md
local CLAUDE_MD_SYMLINK=$HOME/.claude/CLAUDE.md

if [ -f $CLAUDE_MD_SYMLINK ]; then
        _dbg "module(claude) ~> $CLAUDE_MD_SYMLINK already exists, nothing to do."
else
        mkdir -p $HOME/.claude
        _dbg "module(claude) ~> symlinking $CLAUDE_MD_SOURCE to $CLAUDE_MD_SYMLINK"
        ln -s $CLAUDE_MD_SOURCE $CLAUDE_MD_SYMLINK
fi
