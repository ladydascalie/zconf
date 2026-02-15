#!/bin/bash

# Get ULID from selection or clipboard
primary=$(wl-paste --primary 2>/dev/null | tr -d '[:space:]')
clipboard=$(wl-paste 2>/dev/null | tr -d '[:space:]')

# Use whichever has content, prefer primary
if [ -n "$primary" ]; then
    ulid="$primary"
elif [ -n "$clipboard" ]; then
    ulid="$clipboard"
else
    notify-send "ULID Convert" "No ULID found in selection or clipboard"
    exit 1
fi

# Convert to hex
hex="0x$(echo "obase=16; ibase=32; $(echo "$ulid" | tr '0123456789ABCDEFGHJKMNPQRSTVWXYZ' '0123456789ABCDEFGHIJKLMNOPQRSTUV')" | bc | tr '[:upper:]' '[:lower:]')"

# Copy result and notify
echo "$hex" | wl-copy
notify-send "ULID Convert" "$hex"
