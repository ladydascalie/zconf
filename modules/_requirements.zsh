# check required tools are installed
local required=(
	go
	eza
	starship
	git
	pass
	docker
)

for r in $required; do
	warn_is_installed $r
done
