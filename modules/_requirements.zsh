# check required tools are installed
local required=(
	go
	exa
	starship
	git
	pass
	docker
	docker-compose
)

for r in $required; do
	warn_is_installed $r
done