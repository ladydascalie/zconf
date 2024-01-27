# check required tools are installed
local required=(
	starship
	go
	eza
	git
	pass
	docker
)

for r in $required; do
	warn_is_installed $r
done
