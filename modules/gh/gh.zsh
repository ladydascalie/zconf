if is_installed gh; then
	_lazy_compdef gh "gh completion --shell zsh"
	alias git-cherry="git cherry -v main | gh pr edit --body-file -"
fi
