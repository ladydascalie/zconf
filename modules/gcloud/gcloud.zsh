export PATH=${PATH}:"${HOME}/.local/opt/google-cloud-sdk/bin"
# TODO: remove when cloudsdk works with python 3.10
export CLOUDSDK_PYTHON=python2.7

# update path
if [ -f '/home/b/google-cloud-sdk/path.zsh.inc' ]; then . '/home/b/google-cloud-sdk/path.zsh.inc'; fi

# enable shell completion
if [ -f '/home/b/google-cloud-sdk/completion.zsh.inc' ]; then . '/home/b/google-cloud-sdk/completion.zsh.inc'; fi