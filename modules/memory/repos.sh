#!/usr/bin/env bash
# The stable repo name -> local checkout map, shared by the recall tools.
#
# One place to add a repo. `repo=` in an anchor is always one of these names, never a
# path — a path rots on a move, the name does not. The memory-check TS extension mirrors
# this map; keep them in step.

repo_path() {
	case "$1" in
		go-backend)         printf '%s' "$HOME/Code/LootLocker/go-backend" ;;
		index)              printf '%s' "$HOME/Code/LootLocker/index" ;;
		ll-frontend)        printf '%s' "$HOME/Code/LootLocker/ll-frontend" ;;
		publisher-frontend) printf '%s' "$HOME/Code/LootLocker/publisher-frontend" ;;
		php-backend)        printf '%s' "$HOME/Code/LootLocker/php-backend" ;;
		runbooks)           printf '%s' "$HOME/Code/Personal/runbooks" ;;
		runbooks-docs)      printf '%s' "$HOME/Code/Personal/runbooks-docs" ;;
		*)                  printf '%s' "" ;;
	esac
}

repo_names() {
	printf '%s\n' go-backend index ll-frontend publisher-frontend php-backend runbooks runbooks-docs
}
