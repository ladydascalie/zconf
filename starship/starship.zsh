export STARSHIP_CONFIG=$HOME/zconf/starship/starship.toml
if is_installed starship; then
	eval "$(starship init zsh)"
fi
