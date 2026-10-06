# memory — recall helpers over the shared memory store and the spec library.
#
# rg is the search layer; these are only house defaults (case-insensitive,
# sorted, AND over multiple terms). No index, no schema, no second copy — see
# the memory-keeping skill. `recall-check` measures these against naive rg.
#
# zsh note: an unquoted $var does NOT word-split here, so terms are passed as
# the "$@" array throughout and never through a scalar.

_memory_dir=${0:A:h}

# Files under $1 whose text matches every one of the remaining terms (AND).
_recall_files() {
	local dir="$1"; shift
	(( $# )) || return 0
	local files out p
	files=$(rg -i -l -- "$1" "$dir" 2>/dev/null); shift
	for p in "$@"; do
		[[ -n "$files" ]] || break
		out=$(print -r -- "$files" | xargs -r rg -i -l -- "$p" 2>/dev/null)
		files=$out
	done
	print -r -- "$files"
}

_recall() {
	local dir="$1"; shift
	(( $# )) || { print -u2 "usage: ${funcstack[1]} <term> [term...]"; return 2 }
	local -a pats=("$@")
	if (( ${#pats[@]} == 1 )); then
		rg -i --sort path -C1 -- "${pats[1]}" "$dir"
		return
	fi
	local files out p
	files=$(_recall_files "$dir" "${pats[@]}")
	[[ -n "$files" ]] || return 1
	# Show only the lines matching every term — file-level AND alone still
	# prints every first-term hit in the surviving files.
	out=$(grep -inH -- "${pats[1]}" ${(f)files} 2>/dev/null)
	for p in "${pats[@]:1}"; do
		[[ -n "$out" ]] || break
		out=$(print -r -- "$out" | grep -i -- "$p")
	done
	print -r -- "$out"
}

mem() { _recall "$HOME/.agents/store/memory" "$@"; }
specs() { _recall "$HOME/.agents/store/plans" "$@"; }

recall-check() { bash "$_memory_dir/recall-check.sh" "$@"; }
