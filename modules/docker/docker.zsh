if warn_is_installed docker; then
        alias d4c='docker rm -f $(docker ps -aq)'
fi