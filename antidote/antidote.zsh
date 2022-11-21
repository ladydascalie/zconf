# clone antidote if necessary
[[ -e ~/.antidote ]] || git clone https://github.com/mattmc3/antidote.git ~/.antidote

# source antidote
. ~/.antidote/antidote.zsh

antidote bundle < $HOME/zconf/antidote/zsh_plugins.txt > $HOME/zconf/antidote/zsh_plugins.zsh

# uncomment if you want your session to have commands like `antidote update`
autoload -Uz $/.antidote/functions/antidote

# source static plugins file
source $HOME/zconf/antidote/zsh_plugins.zsh

# -- This is used to avoid the issue with oh-my-zsh vi-mode plugin
# -- leaving behind garbage in the RPROMPT. 
RPROMPT=''