#!/bin/bash

# A valid ULID is exactly 26 Crockford Base32 characters
is_ulid() { [[ "$1" =~ ^[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]{26}$ ]]; }

# Get ULID from selection or clipboard
primary=$(wl-paste --primary 2>/dev/null | tr -d '[:space:]')
clipboard=$(wl-paste 2>/dev/null | tr -d '[:space:]')

# Use whichever is a valid ULID, prefer primary
if is_ulid "$primary"; then
    ulid="$primary"
elif is_ulid "$clipboard"; then
    ulid="$clipboard"
else
    notify-send "ULID Convert" "No ULID found in selection or clipboard"
    exit 1
fi

# Convert to hex
hex="0x$(echo "obase=16; ibase=32; $(echo "$ulid" | tr '[:lower:]' '[:upper:]' | tr '0123456789ABCDEFGHJKMNPQRSTVWXYZ' '0123456789ABCDEFGHIJKLMNOPQRSTUV')" | bc | tr '[:upper:]' '[:lower:]')"

# Copy result and notify
echo "$hex" | wl-copy
notify-send "ULID Convert" "$hex"
