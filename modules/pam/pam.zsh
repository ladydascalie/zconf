local dir=$(dirname $0)
local module=$dir/yubikey-sufficient

if [ -f $module ]; then
	_dbg "module(pam) ~> $module already exists, nothing to do."
else
	_dbg "module(pam) ~> injecting $module into pam.d"
	sudo cp $module /etc/pam.d/
fi
