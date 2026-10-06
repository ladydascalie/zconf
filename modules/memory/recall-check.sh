#!/usr/bin/env bash
# recall-check — measure retrieval methods against a fixture of real queries.
#
# Each `hit` row is a query you would actually type and the document that
# answers it; the method passes when that document is in its result set.
# Each `gap` row is a fact that EXISTS but whose wording does not contain the
# query terms — it shows the boundary: what no amount of flag-tweaking fixes,
# only better keywords in the fact (or a synonym in the query).
#
# Three methods, so the gain can be attributed:
#   raw   — literal phrase, case-sensitive   (what you type by rote)
#   case  — literal phrase, case-insensitive (adds rg -i)
#   smart — case-insensitive AND over terms  (adds multi-term AND)
#
# Run: recall-check [fixture.tsv]
set -u

here=$(cd "$(dirname "$0")" && pwd)
fixture=${1:-$here/recall-queries.tsv}
MEM="$HOME/.agents/store/memory"
SPEC="$HOME/.agents/store/plans"

andfiles() { # files matching every one of "$@" (AND), case-insensitive
	local dir="$1"; shift
	local files out p
	files=$(rg -i -l -- "$1" "$dir" 2>/dev/null); shift
	for p in "$@"; do
		[ -n "$files" ] || break
		out=$(printf '%s\n' "$files" | xargs -r rg -i -l -- "$p" 2>/dev/null)
		files=$out
	done
	printf '%s\n' "$files"
}

hit() { [ -n "$1" ] && grep -qF -- "$2" <<< "$1"; }

raw=0 case=0 smart=0 hits=0 gaps=0 surfaced=0
printf '%-26s %-6s %-5s %-5s %-5s\n' QUERY SCOPE RAW CASE SMART
while IFS=$'\t' read -r scope query expected kind; do
	[ -n "${scope:-}" ] || continue
	case $scope in mem) dir=$MEM ;; specs) dir=$SPEC ;; *) continue ;; esac

	if [ "$kind" = gap ]; then
		gaps=$((gaps+1))
		s=$(andfiles "$dir" $query)
		hit "$s" "$expected" && surfaced=$((surfaced+1))
		printf '%-26s %-6s %-5s\n' "$query" "$scope" "GAP"
		continue
	fi

	hits=$((hits+1))
	a=$(rg -l -- "$query" "$dir" 2>/dev/null); r=FAIL; hit "$a" "$expected" && { r=PASS; raw=$((raw+1)); }
	b=$(rg -i -l -- "$query" "$dir" 2>/dev/null); c=FAIL; hit "$b" "$expected" && { c=PASS; case=$((case+1)); }
	s=$(andfiles "$dir" $query);                m=FAIL; hit "$s" "$expected" && { m=PASS; smart=$((smart+1)); }
	printf '%-26s %-6s %-5s %-5s %-5s\n' "$query" "$scope" "$r" "$c" "$m"
done < "$fixture"

echo
printf 'hit rows — raw (literal, case-sensitive):  %d/%d\n' "$raw" "$hits"
printf 'hit rows — case (rg -i, phrase):            %d/%d\n' "$case" "$hits"
printf 'hit rows — smart (rg -i, AND over terms):   %d/%d\n' "$smart" "$hits"
printf 'gap rows — surfaced by smart (should be 0): %d/%d  (keyword/coverage gap)\n' "$surfaced" "$gaps"
