# zsh specific environment
export HISTFILE=$HOME/.zsh_history
export HISTSIZE=100000
export SAVEHIST=100000
export ANTIBODY_HOME=$HOME/.antibody
export ZSH_CACHE_DIR=$HOME/.zshcache

# zsh options
zstyle ':completion:*' matcher-list 'm:{[:lower:]}={[:upper:]}'
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt CHASE_DOTS
setopt AUTO_CD
setopt SHARE_HISTORY

# for completions
autoload -Uz compinit
compinit

# enable Ctrl-x-e to edit command line
autoload -U edit-command-line
# vi style:
zle -N edit-command-line

# press `v` to edit.
bindkey -M vicmd v edit-command-line

# customised backwards search
custom-backward-delete-word() {
    local WORDCHARS=${WORDCHARS/\//}
    zle backward-delete-word
}
zle -N custom-backward-delete-word
bindkey '^W' custom-backward-delete-word

