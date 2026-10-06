#!/usr/bin/env bash
# recall-verify — staleness check for anchored facts in the store.
#
# A fact may carry an inline anchor:
#   <!-- verify repo=<name> sha=<sha> [path=<repo-relative>] [symbol=<ident>] [at=<date>] -->
#
# The anchor records where a fact was last checked, not when it became true. The fact
# stands on its own; the anchor only lets this script re-check it later without a full
# read. A fact whose repo is moved or absent is reported "unverifiable", never wrong —
# the memory outlives the repo.
#
# Deterministic, local, git-only: no network, no model, no index.
# Silent when clean (exit 0). -v lists every anchor. Findings -> stdout; exit 1 if any.
#
# Run: recall-verify [-v] [store-root]
set -u

verbose=0 root=""
for a in "$@"; do
	case "$a" in
		-v|--verbose) verbose=1 ;;
		*) root="$a" ;;
	esac
done
root="${root:-$HOME/.agents/store}"

# Stable repo name -> local checkout. Add entries as anchors appear.
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

attr() { printf '%s' "$1" | sed -n "s/.*[[:space:]]$2=\([^[:space:]]*\).*/\1/p"; }

# repo sha path symbol -> problem text (empty = still resolves)
verify() {
	local repo=$1 sha=$2 path=$3 symbol=$4 dir
	dir=$(repo_path "$repo")
	[ -n "$dir" ] || { printf 'repo %s has no local path — unverifiable (memory kept)' "$repo"; return; }
	[ -d "$dir/.git" ] || { printf 'repo %s not checked out at %s — unverifiable (memory kept)' "$repo" "$dir"; return; }
	git -C "$dir" cat-file -e "$sha^{commit}" 2>/dev/null || { printf 'commit %s gone (rebased/gc'\''d)' "$sha"; return; }
	if [ -n "$path" ]; then
		git -C "$dir" cat-file -e "HEAD:$path" 2>/dev/null || { printf 'path %s missing at HEAD (moved/renamed)' "$path"; return; }
		[ -z "$(git -C "$dir" log --oneline "$sha..HEAD" -- "$path" 2>/dev/null)" ] || { printf 'path %s changed since %s' "$path" "$sha"; return; }
	fi
	if [ -n "$symbol" ]; then
		git -C "$dir" grep -qw -e "$symbol" HEAD >/dev/null 2>&1 || { printf 'symbol %s missing at HEAD (renamed?)' "$symbol"; return; }
	fi
	printf ''
}

mapfile -t anchors < <(find "$root" -name '*.md' -not -path '*/.git/*' -print0 \
	| xargs -0 -r rg -n --no-heading --with-filename -o '<!--\s*verify\s[^>]*-->' 2>/dev/null)

checked=0 bad=0
for entry in "${anchors[@]}"; do
	file=${entry%%:*}; rest=${entry#*:}; ln=${rest%%:*}; marker=${rest#*:}
	repo=$(attr "$marker" repo); sha=$(attr "$marker" sha)
	path=$(attr "$marker" path); symbol=$(attr "$marker" symbol)
	checked=$((checked + 1))
	rel=${file#"$root"/}
	if [ -z "$repo" ] || [ -z "$sha" ]; then
		printf '%s:%s: malformed anchor (need repo= and sha=)\n' "$rel" "$ln"
		bad=$((bad + 1))
		continue
	fi
	problem=$(verify "$repo" "$sha" "$path" "$symbol")
	if [ -n "$problem" ]; then
		printf '%s:%s: %s  [%s@%s]\n' "$rel" "$ln" "$problem" "$repo" "$sha"
		bad=$((bad + 1))
	elif [ "$verbose" = 1 ]; then
		printf '%s:%s: ok  [%s@%s]\n' "$rel" "$ln" "$repo" "$sha"
	fi
done

[ "$verbose" = 1 ] && printf '%d anchor(s) checked, %d need re-verification\n' "$checked" "$bad"
[ "$bad" -eq 0 ]
