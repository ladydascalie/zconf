# check required tools are installed
local required=(
	starship
	git
	pass
	podman
	op
)

for r in $required; do
	warn_is_installed $r
done
