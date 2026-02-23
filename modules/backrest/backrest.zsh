# SSH config for Hetzner storage box (port 23, key on disk, no agent)
if ! grep -q "your-storagebox.de" $HOME/.ssh/config 2>/dev/null; then
	_dbg "module(backrest) ~> adding Hetzner SSH config"
	cat >> $HOME/.ssh/config << 'SSHEOF'

Host *.your-storagebox.de
	IdentityFile ~/.ssh/personal
	IdentityAgent none
	Port 23
SSHEOF
fi
