# 1Password: default to personal account for op commands.
export OP_ACCOUNT=my.1password.com

# --- Profiling / timing primitives ---
zmodload zsh/datetime 2>/dev/null
_PROFILE_START=$EPOCHREALTIME

# Print elapsed time in ms since _PROFILE_START with a label (only when VERBOSE_STARTUP is set).
_profile_checkpoint() {
  (( ${+VERBOSE_STARTUP} )) || return
  local label="${1:-checkpoint}"
  local now=$EPOCHREALTIME
  local elapsed=$(( (now - _PROFILE_START) * 1000 ))
  printf "  [%6.0fms] %s\n" $elapsed "$label"
}

_dbg() { if (( ${+VERBOSE_STARTUP} )); then echo $@; fi } # conditional debug print
_locate() { find "$0" -type f ! -wholename "$0" } 	  # locate files in modules.

# source a file, with optional timing when VERBOSE_STARTUP is set.
_load() {
  if (( ${+VERBOSE_STARTUP} )); then
    local _t0=$EPOCHREALTIME
    [ -f "$1" ] && source "$1"
    local _elapsed=$(( (EPOCHREALTIME - _t0) * 1000 ))
    printf "  [%6.0fms] load: %s\n" $_elapsed "$1"
  else
    [ -f "$1" ] && source "$1"
  fi
}

_is_zsh_file() { [ "${1##*.}" = "zsh" ] }		  # check if file is a zsh file.
_info() { echo "\033[1;34m==>\033[0m \033[1m$@\033[0m" }  # bold blue arrow + bold text.

# Lazy-load command completions via compdef on first tab press.
# Usage: _lazy_compdef <command> "<completion command>"
#   _lazy_compdef gh "gh completion --shell zsh"
#   _lazy_compdef kubectl "kubectl completion zsh"
_lazy_compdef() {
  local cmd=$1
  local comp_cmd=$2

  eval "
    function _${cmd} {
      unfunction _${cmd}
      source <(${comp_cmd}) 2>/dev/null || return 1
      _${cmd} \"\$@\"
    }
  "
  (( ${+functions[_${cmd}]} )) && compdef "_${cmd}" "$cmd"
}

# check program is installed
# usage: warn_is_installed <program>
warn_is_installed() {
	if ! command -v $1 &> /dev/null; then
		echo "Warning: $1 is not installed."
		return 1
	fi
}


# This one will fail silently, without warning.
is_installed() {
	if ! command -v $1 &> /dev/null; then
		return 1
	fi
}

# This one will fail silently, without warning.
is_linux() {
	if [ "$(uname 2> /dev/null)" = "Linux" ]; then
		return 0
	fi
	return 1
}
