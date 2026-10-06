#!/usr/bin/env bash
# recall-anchor — emit a verified <!-- verify … --> anchor for a fact.
#
# Resolves the repo, checks the target at HEAD, and prints the marker ready to append to
# a fact bullet. One call, so the anchor is verified at write time rather than guessed:
#
#   recall-anchor <repo> [--path <repo-relative>] [--symbol <ident>] [--at YYYY-MM-DD]
#   recall-anchor --list
#
# Exits 1 with a message if the repo, path or symbol does not resolve — an anchor you did
# not check is not an anchor.
set -u
. "$(cd "$(dirname "$0")" && pwd)/repos.sh"

repo="" path="" symbol="" at=$(date +%F)
while [ $# -gt 0 ]; do
	case "$1" in
		--path)    path=$2; shift 2 ;;
		--symbol)  symbol=$2; shift 2 ;;
		--at)      at=$2; shift 2 ;;
		--list)    repo_names; exit 0 ;;
		-h|--help) echo "usage: recall-anchor <repo> [--path P] [--symbol S] [--at DATE] | --list"; exit 0 ;;
		*)         repo=$1; shift ;;
	esac
done

[ -n "$repo" ] || { echo "usage: recall-anchor <repo> [--path P] [--symbol S] [--at DATE] | --list" >&2; exit 2; }
dir=$(repo_path "$repo")
[ -n "$dir" ] || { echo "unknown repo '$repo' (try: recall-anchor --list)" >&2; exit 2; }
[ -d "$dir/.git" ] || { echo "repo '$repo' not checked out at $dir" >&2; exit 2; }

if [ -n "$path" ]; then
	git -C "$dir" cat-file -e "HEAD:$path" 2>/dev/null \
		|| { echo "path '$path' is not at HEAD of '$repo' — fix it before anchoring" >&2; exit 1; }
fi
if [ -n "$symbol" ]; then
	git -C "$dir" grep -qw -e "$symbol" HEAD >/dev/null 2>&1 \
		|| { echo "symbol '$symbol' is not at HEAD of '$repo' — fix it before anchoring" >&2; exit 1; }
fi

marker="<!-- verify repo=$repo sha=$(git -C "$dir" rev-parse HEAD)"
[ -n "$path" ] && marker="$marker path=$path"
[ -n "$symbol" ] && marker="$marker symbol=$symbol"
printf '%s at=%s -->\n' "$marker" "$at"
