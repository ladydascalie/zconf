[[ -f /home/b/.config/op/plugins.sh ]] && source /home/b/.config/op/plugins.sh

function opsw() {
  local account
  account=$(op account list --format=json | jq -r '.[].url' | fzf --prompt="op account: ")
  [[ -n "$account" ]] && export OP_ACCOUNT="$account" && echo "OP_ACCOUNT=$account"
}
