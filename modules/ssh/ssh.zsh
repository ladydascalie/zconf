# Use 1Password as SSH agent for everything.
export SSH_AUTH_SOCK=~/.1password/agent.sock


local dir=$(dirname $0)
local allowed_signers_template=$dir/allowed_signers.tpl
local allowed_signers_output=$HOME/.ssh/allowed_signers

if [ -f $allowed_signers_output ]; then
	_dbg "module(git) ~> $allowed_signers_output already exists, nothing to do."
else
	_dbg "module(git) ~> injecting $allowed_signers_template to $allowed_signers_output using 1password cli"
	op inject -i $allowed_signers_template -o $allowed_signers_output
fi
