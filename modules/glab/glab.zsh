if is_installed glab; then
	alias glab-cherry="git cherry -v main | glab mr update --description -"
fi
