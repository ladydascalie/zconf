# Todo.txt startup printout
_todotxt_print() {
    command -v todo.sh &>/dev/null || return
    [[ -s "$HOME/todo.txt" ]] || return

    printf '\033[1;34m==>\033[0m \033[1mtodo\033[0m\n\n'
    todo.sh -c ls 2>/dev/null
    echo
}

alias t='todo.sh'

if [[ $- == *i* ]]; then
    _todotxt_print
fi
