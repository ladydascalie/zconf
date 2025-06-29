local dir=$(dirname $0)
local tools=(
	$(find "$dir" -type f ! -wholename "$0" | sort
)

# load them all in.
for f in $tools; do
	if _is_zsh_file $f; then
		_dbg "loading ~> $f"
		_load $f
	fi
done
