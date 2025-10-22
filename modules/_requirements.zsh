# check required tools are installed
local required=(
	starship
	eza
	git
	pass
	podman
	op
)

for r in $required; do
	warn_is_installed $r
done
