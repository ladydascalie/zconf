local dir=$(dirname $0)
local PUSHOVER_CONFIG_TEMPLATE=$dir/pushover.tpl
local PUSHOVER_CONFIG_IN_PLACE=$dir/pushover_func.zsh

# check file exists
if [ -f $PUSHOVER_CONFIG_IN_PLACE ]; then
        # if it does, all good.
        _dbg "module(pushover) ~> $PUSHOVER_CONFIG_IN_PLACE already exists, nothing to do."
else
        # keep a symlink since sublime merge doesn't read this variable.
        _dbg "module(pushover) ~> injecting $PUSHOVER_CONFIG_TEMPLATE to $PUSHOVER_CONFIG_IN_PLACE using 1password cli"
        op inject -i $PUSHOVER_CONFIG_TEMPLATE -o $PUSHOVER_CONFIG_IN_PLACE
fi
