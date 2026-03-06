# NOTE: this is also done in vi_mode.zsh to alleviate compatibility issues.
# This is as recommended by the vi-mode documentation.
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# Set up fzf key bindings and fuzzy completion
if is_installed fzf; then
	source <(fzf --zsh)
fi

