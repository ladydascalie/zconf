pam_setup() {
	local dir=$(dirname $0)
	local module=$dir/yubikey-sufficient
	local target=/etc/pam.d/yubikey-sufficient

	if [ -f $target ]; then
		_dbg "module(pam) ~> $target already exists, nothing to do."
	else
		_dbg "module(pam) ~> injecting $module into pam.d"
		sudo cp $module /etc/pam.d/
	fi
}
