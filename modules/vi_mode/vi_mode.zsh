# https://github.com/jeffreytse/zsh-vi-mode#execute-extra-commands
function zvm_after_init() {
	[[ -s "$HOME/.fzf.zsh" ]] && source "$HOME/.fzf.zsh"
}