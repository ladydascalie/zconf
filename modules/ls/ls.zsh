# GNU ls colours. Palette vendored from https://github.com/trapd00r/LS_COLORS
# and baked to a static string with `dircolors -b` (its TERM sections are empty,
# so the result is TERM-independent — no per-shell subprocess needed).
if [[ -r ${0:A:h}/LS_COLORS ]]; then
	export LS_COLORS="$(< ${0:A:h}/LS_COLORS)"
fi

alias ls='ls --color=auto --group-directories-first'
alias l='ls'
alias ll='ls -lah'
alias lt='tree'
