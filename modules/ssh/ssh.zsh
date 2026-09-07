# Use ssh-agent-mux (1Password + Bitwarden) as SSH agent for everything.
export SSH_AUTH_SOCK=~/.ssh/ssh-agent-mux.sock

local dir=$(dirname $0)

# Symlink 1Password SSH agent config
local agent_toml=$dir/agent.toml
local agent_toml_symlink=$HOME/.config/1Password/ssh/agent.toml

# Symlink ssh-agent-mux config
local mux_toml=$dir/ssh-agent-mux.toml
local mux_toml_symlink=$HOME/.config/ssh-agent-mux/ssh-agent-mux.toml

for pair in \
	"$agent_toml:$agent_toml_symlink" \
	"$mux_toml:$mux_toml_symlink"
do
	local toml=${pair%%:*}
	local symlink=${pair#*:}

	mkdir -p $(dirname $symlink)

	if [ -L $symlink ] && [ "$(readlink $symlink)" = "$toml" ]; then
		_dbg "module(ssh) ~> $symlink already symlinked, nothing to do."
	elif [ -e $symlink ]; then
		_dbg "module(ssh) ~> $symlink exists but is not our symlink. replacing."
		rm $symlink
		ln -s $toml $symlink
	else
		_dbg "module(ssh) ~> symlinking $toml to $symlink"
		ln -s $toml $symlink
	fi
done
local allowed_signers_template=$dir/allowed_signers.tpl
local allowed_signers_output=$HOME/.ssh/allowed_signers

if is_installed op; then
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
fi
