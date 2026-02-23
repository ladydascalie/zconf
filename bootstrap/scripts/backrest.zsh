if is_installed backrest; then
	_dbg "bootstrap(backrest) ~> already installed, skipping"
	return
fi

local tmp=$(mktemp -d)
local tag=$(curl -sL -o /dev/null -w '%{url_effective}' https://github.com/garethgeorge/backrest/releases/latest | grep -oP '[^/]+$')
curl -sL "https://github.com/garethgeorge/backrest/releases/download/${tag}/backrest_Linux_x86_64.tar.gz" -o "$tmp/backrest.tar.gz"
tar -xzf "$tmp/backrest.tar.gz" -C "$tmp"
(cd "$tmp" && ./install.sh)
rm -rf "$tmp"
