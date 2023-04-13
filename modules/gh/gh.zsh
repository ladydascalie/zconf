if is_installed gh; then
        source <(gh completion --shell zsh)
fi

if is_installed gh; then
	alias git-cherry="git cherry -v main | gh pr edit --body-file -"
fi

# Ensure I can use the ?? alias for github copilot cli.
eval "$(github-copilot-cli alias -- "$0")"