# clone antidote if necessary
[[ -e ~/.antidote ]] || git clone https://github.com/mattmc3/antidote.git ~/.antidote

# source antidote
. ~/.antidote/antidote.zsh

# only regenerate the static file if the plugin manifest has changed (saves ~100ms most shells)
local _plugins_txt=$HOME/zconf/antidote/zsh_plugins.txt
local _plugins_zsh=$HOME/zconf/antidote/zsh_plugins.zsh
if [[ ! -e $_plugins_zsh || $_plugins_txt -nt $_plugins_zsh ]]; then
	antidote bundle < $_plugins_txt > $_plugins_zsh
fi

# uncomment if you want your session to have commands like `antidote update`
autoload -Uz $/.antidote/functions/antidote

# source static plugins file
source $HOME/zconf/antidote/zsh_plugins.zsh

# -- This is used to avoid the issue with oh-my-zsh vi-mode plugin
# -- leaving behind garbage in the RPROMPT. 
RPROMPT=''