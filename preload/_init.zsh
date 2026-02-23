# 1Password: default to personal account for op commands.
export OP_ACCOUNT=my.1password.com

_dbg() { if (( ${+VERBOSE_STARTUP} )); then echo $@; fi } # conditional debug print
_locate() { find "$0" -type f ! -wholename "$0" } 	  # locate files in modules.
_load() { [ -f "$1" ] && source "$1" }		          # source a file.
_is_zsh_file() { [ "${1##*.}" = "zsh" ] }		  # check if file is a zsh file.
_info() { echo "\033[1;34m==>\033[0m \033[1m$@\033[0m" }  # bold blue arrow + bold text.

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
