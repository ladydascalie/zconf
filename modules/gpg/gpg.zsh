export GPG_TTY=$(tty)

# GPG_AGENT_CONF is the path to the gpg-agent.conf file.
GPG_AGENT_CONF="${HOME}/.gnupg/gpg-agent.conf"

# PINENTRY_PROGRAM is the path to the pinentry program.
PINENTRY_PROGRAM="/usr/bin/pinentry-qt"


# Ensure that the gpg-agent.conf file has the correct options enabled.
OPTIONS=(
    "pinentry-program ${PINENTRY_PROGRAM}"
    "enable-ssh-support"
    "default-cache-ttl 86400"
    "max-cache-ttl 86400"
)

for OPTION in "${OPTIONS[@]}"; do
    if ! grep -q "^${OPTION}$" "${GPG_AGENT_CONF}"; then
        echo "Appending '${OPTION}' to ${GPG_AGENT_CONF} ..."
        echo "${OPTION}" >> "${GPG_AGENT_CONF}"
    else
        _dbg "module(gpg) the '${OPTION}' option is already present in ${GPG_AGENT_CONF}."
    fi
done
