export OPENCODE_EXPERIMENTAL_LSP_TOOL=true

local dir=$(dirname "$0")
local config_source="$dir/config"
local config_symlink="$HOME/.config/opencode"

# --- Symlink management ---
if [[ -L "$config_symlink" && "$(readlink "$config_symlink")" == "$config_source" ]]; then
    _dbg "module(opencode) ~> symlink already correct, nothing to do."
elif [[ -e "$config_symlink" && ! -L "$config_symlink" ]]; then
    # Real directory exists — back it up once, then symlink
    _dbg "module(opencode) ~> backing up $config_symlink to ${config_symlink}.bak"
    mv "$config_symlink" "${config_symlink}.bak"
    _dbg "module(opencode) ~> symlinking $config_source to $config_symlink"
    ln -s "$config_source" "$config_symlink"
elif [[ ! -e "$config_symlink" ]]; then
    mkdir -p "$(dirname "$config_symlink")"
    _dbg "module(opencode) ~> symlinking $config_source to $config_symlink"
    ln -s "$config_source" "$config_symlink"
fi

# --- Template injection ---
local OPENCODE_CONFIG="$config_source/opencode.json"
local OPENCODE_TEMPLATE="$config_source/opencode.tpl"

if [[ -f "$OPENCODE_CONFIG" ]]; then
    _dbg "module(opencode) ~> $OPENCODE_CONFIG already exists, nothing to do."
elif is_installed op; then
    _dbg "module(opencode) ~> injecting $OPENCODE_TEMPLATE to $OPENCODE_CONFIG using 1password cli"
    op inject -i "$OPENCODE_TEMPLATE" -o "$OPENCODE_CONFIG"
fi

# --- Node dependency bootstrap ---
if [[ ! -d "$config_source/node_modules" ]]; then
    _dbg "module(opencode) ~> running bun install in $config_source"
    (cd "$config_source" && bun install) &
fi
