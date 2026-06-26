# Todo.txt startup printout
_todotxt_print() {
    command -v todo.sh &>/dev/null || return
    [[ -s "$HOME/todo.txt" ]] || return

    printf '\033[1;34m==>\033[0m \033[1mtodo\033[0m\n\n'
    todo.sh -c ls 2>/dev/null
    echo
}

t() {
    if [[ "${1:-}" == "edit" ]]; then
        ${EDITOR:-vim} "$HOME/todo.txt"
    else
        todo.sh "$@"
    fi
}

# Open companion note for a task: tn 1 → $EDITOR ~/todo/notes/auth-merge.md
tn() {
    local note
    note=$(sed -n "${1}p" "$HOME/todo.txt" | grep -oP '=>\s*\K\S+')
    if [[ -n "$note" && -f "$HOME/todo/$note" ]]; then
        ${EDITOR:-vim} "$HOME/todo/$note"
    elif [[ -n "$note" ]]; then
        echo "note not found: ~/todo/$note"
    else
        echo "no note ref on task $1"
    fi
}

