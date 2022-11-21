local dir="$(dirname $0)"
local config_dir=$HOME/.config/environment.d
local config_files=($dir/*.conf)

for f in $config_files; do
	filename=$f:t
	if [ -f $config_dir/$filename ]; then
		# it's already there, we're good
		_dbg "module(systemd) ~> $config_dir/$filename already exists, nothing to do."
		continue
	else
		# symlink it to the destination
		_dbg "linking $f ~> $config_dir/$filename"
		ln -s $f $config_dir/$filename
	fi
done
