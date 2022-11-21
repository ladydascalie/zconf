_dbg() { if (( ${+VERBOSE_STARTUP} )); then echo $@; fi } # conditional debug print
_locate() { find "$0" -type f ! -wholename "$0" } 	  # locate files in modules.
_load() { [ -f $1 ] && source $1 }		          # source a file.
_is_zsh_file() { [ "${1##*.}" = "zsh" ] }		  # check if file is a zsh file.

# This one will spit out a warning, annoying the user.
warn_is_installed() {
	if which $1 > /dev/null 2>&1; then
		return 0
	fi
	echo "$1: not installed"
        return 1
}

# This one will fail silently, without warning.
is_installed() {
	if which $1 > /dev/null 2>&1; then
		return 0
	fi
        return 1
}

# This one will fail silently, without warning.
is_macos() {
	# never gonna use windows so I don't need to be smart!
	if [ "$(uname 2> /dev/null)" != "Linux" ]; then
		return 0
	fi
	return 1
}

# This one will fail silently, without warning.
is_linux() {
	if [ "$(uname 2> /dev/null)" = "Linux" ]; then
		return 0
	fi
	return 1
}