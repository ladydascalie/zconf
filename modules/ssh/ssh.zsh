# Use 1Password as SSH agent for everything.
export SSH_AUTH_SOCK=~/.1password/agent.sock


local dir=$(dirname $0)
local allowed_signers_template=$dir/allowed_signers.tpl
local allowed_signers_output=$HOME/.ssh/allowed_signers

if [ -f $allowed_signers_output ]; then
	_dbg "module(ssh) ~> $allowed_signers_output already exists, nothing to do."
else
	_dbg "module(ssh) ~> injecting $allowed_signers_template to $allowed_signers_output using 1password cli"
	op inject -i $allowed_signers_template -o $allowed_signers_output
fi

# SSH key on disk (needed by services that can't use 1Password agent, e.g. backrest)
local SSH_KEY=$HOME/.ssh/personal
local SSH_PUBKEY=$HOME/.ssh/personal.pub

if [ ! -f $SSH_KEY ]; then
	_dbg "module(ssh) ~> writing $SSH_KEY from 1password"
	op read "op://Private/personal/private key" > $SSH_KEY
	chmod 600 $SSH_KEY
fi

if [ ! -f $SSH_PUBKEY ]; then
	_dbg "module(ssh) ~> writing $SSH_PUBKEY from 1password"
	op read "op://Private/personal/public key" > $SSH_PUBKEY
fi
