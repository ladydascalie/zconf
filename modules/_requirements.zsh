# check required tools are installed
local required=(
	go
	exa
	starship
	git
	pass
	docker
)

for r in $required; do
	warn_is_installed $r
done
