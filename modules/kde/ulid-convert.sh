#!/bin/bash

# A valid ULID is exactly 26 Crockford Base32 characters
is_ulid() { [[ "$1" =~ ^[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]{26}$ ]]; }

# Get ULID from: args > stdin > primary selection > clipboard
if [[ -n "$1" ]]; then
    input=$(echo "$1" | tr -d '[:space:]')
elif [[ ! -t 0 ]]; then
    input=$(cat | tr -d '[:space:]')
else
    input=$(wl-paste --primary 2>/dev/null | tr -d '[:space:]')
    if ! is_ulid "$input"; then
        input=$(wl-paste 2>/dev/null | tr -d '[:space:]')
    fi
fi

if ! is_ulid "$input"; then
    notify-send "ULID Convert" "No valid ULID found" 2>/dev/null
    echo "No valid ULID found" >&2
    exit 1
fi
ulid="$input"

# Convert to hex
hex="0x$(echo "obase=16; ibase=32; $(echo "$ulid" | tr '[:lower:]' '[:upper:]' | tr '0123456789ABCDEFGHJKMNPQRSTVWXYZ' '0123456789ABCDEFGHIJKLMNOPQRSTUV')" | bc | tr '[:upper:]' '[:lower:]')"

# Copy result and notify
echo "$hex"
echo "$hex" | wl-copy
notify-send "ULID Convert" "$hex"
