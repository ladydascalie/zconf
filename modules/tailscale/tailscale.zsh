# start tailscale with the current user as the operator
# this allows you to use tailscale without sudo
# https://tailscale.com/kb/1101/operator/
function tailscale-connect() {
	tailscale up --accept-routes --operator=$USER
}

function tailscale-reauth() {
	tailscale up --accept-routes --operator=$USER --force-reauth
}
