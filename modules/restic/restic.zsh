local dir=$(dirname $0)

# templates
local AUTORESTIC_TEMPLATE=$dir/autorestic.yml.tpl
local AUTORESTIC_IN_PLACE=$dir/.autorestic.yml
local AUTORESTIC_SYMLINK=$HOME/.config/autorestic/.autorestic.yml

local PASSWORD_TEMPLATE=$dir/restic-password.tpl
local PASSWORD_IN_PLACE=$dir/.restic-password
local PASSWORD_SYMLINK=$HOME/.config/autorestic/.restic-password

# systemd units
local SERVICE_SOURCE=$dir/autorestic.service
local SERVICE_SYMLINK=$HOME/.config/systemd/user/autorestic.service

local TIMER_SOURCE=$dir/autorestic.timer
local TIMER_SYMLINK=$HOME/.config/systemd/user/autorestic.timer

# ensure personal ssh public key exists (needed for IdentityFile in sftp command)
local SSH_PUBKEY=$HOME/.ssh/personal.pub
if [ ! -f $SSH_PUBKEY ]; then
	_dbg "module(restic) ~> writing $SSH_PUBKEY from ssh agent"
	ssh-add -L | grep "personal$" > $SSH_PUBKEY
fi

# ensure target directories exist
mkdir -p $HOME/.config/autorestic
mkdir -p $HOME/.config/systemd/user

# inject autorestic config
if [ -f $AUTORESTIC_SYMLINK ]; then
	_dbg "module(restic) ~> $AUTORESTIC_SYMLINK already exists, nothing to do."
else
	_dbg "module(restic) ~> injecting $AUTORESTIC_TEMPLATE to $AUTORESTIC_IN_PLACE using 1password cli"
	op inject -i $AUTORESTIC_TEMPLATE -o $AUTORESTIC_IN_PLACE
	ln -s $AUTORESTIC_IN_PLACE $AUTORESTIC_SYMLINK
fi

# inject restic password
if [ -f $PASSWORD_SYMLINK ]; then
	_dbg "module(restic) ~> $PASSWORD_SYMLINK already exists, nothing to do."
else
	_dbg "module(restic) ~> injecting $PASSWORD_TEMPLATE to $PASSWORD_IN_PLACE using 1password cli"
	op inject -i $PASSWORD_TEMPLATE -o $PASSWORD_IN_PLACE
	ln -s $PASSWORD_IN_PLACE $PASSWORD_SYMLINK
fi

# symlink systemd service
if [ -f $SERVICE_SYMLINK ]; then
	_dbg "module(restic) ~> $SERVICE_SYMLINK already exists, nothing to do."
else
	_dbg "module(restic) ~> symlinking $SERVICE_SOURCE to $SERVICE_SYMLINK"
	ln -s $SERVICE_SOURCE $SERVICE_SYMLINK
fi

# symlink systemd timer
if [ -f $TIMER_SYMLINK ]; then
	_dbg "module(restic) ~> $TIMER_SYMLINK already exists, nothing to do."
else
	_dbg "module(restic) ~> symlinking $TIMER_SOURCE to $TIMER_SYMLINK"
	ln -s $TIMER_SOURCE $TIMER_SYMLINK
fi

# enable timer if not already enabled
if ! systemctl --user is-enabled autorestic.timer &> /dev/null; then
	_dbg "module(restic) ~> enabling autorestic.timer"
	systemctl --user enable autorestic.timer
fi

# helper functions
backup-now() {
	autorestic backup -a
}

backup-snapshots() {
	autorestic -v exec -a -- snapshots --latest ${1:-10}
}

backup-ls() {
	local target=${1:-/home/b}
	autorestic -v exec -a -- ls latest "$target" | grep -E "^${target}/[^/]+/?$"
}

backup-check() {
	autorestic -v exec -a -- check
}

backup-when() {
	systemctl --user list-timers autorestic.timer
}

backup-how() {
	local config=$HOME/.config/autorestic/.autorestic.yml
	echo "Backup automation setup:"
	echo ""
	echo "Timer unit:"
	local on_calendar=$(systemctl --user cat autorestic.timer 2>/dev/null | grep -oP '(?<=OnCalendar=).*')
	echo "  OnCalendar=$on_calendar"
	echo ""
	echo "Next runs:"
	systemd-analyze calendar "$on_calendar" --iterations=4 2>/dev/null | grep -E '^\s*(Next elapse|Iteration)'
	echo ""
	echo "Autorestic config ($config):"
	echo "  locations:"
	yq '.locations | to_entries[] | "    " + .key + ": " + (.value.from | join(", ")) + " -> " + (.value.to | join(", "))' -r "$config"
	echo "  cron:"
	yq '.locations | to_entries[] | "    " + .key + ": " + .value.cron' -r "$config"
	echo "  retention:"
	yq '.locations | to_entries[] | "    " + .key + ": " + ([.value.options.forget | to_entries[] | .key + "=" + (.value[0] | tostring)] | join(", "))' -r "$config"
	echo ""
	echo "Commands:"
	echo "  backup-now        run a backup immediately"
	echo "  backup-when       show next scheduled run"
	echo "  backup-status     show timer status"
	echo "  backup-snapshots  list recent snapshots"
	echo "  backup-ls [path]  list files in latest snapshot"
	echo "  backup-check      verify backup integrity"
}

backup-status() {
	systemctl --user status autorestic.timer
}
