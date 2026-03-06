#!/bin/sh
set -e

echo "==> Building test image..."
podman build --no-cache -f Dockerfile.test -t zconf-test . > /dev/null 2>&1

echo "==> Checking for unexpected output on a warm shell..."
output=$(podman run --rm zconf-test zsh -c 'source /home/testuser/zconf/init.zsh' 2>&1)

# Filter out known-acceptable lines
unexpected=$(echo "$output" | grep -vE \
    -e '^$' \
    -e 'Warning: .* is not installed' \
    -e 'zconf has uncommitted changes' \
    || true)

if [ -n "$unexpected" ]; then
    echo "FAIL: unexpected output:"
    echo "$unexpected"
    exit 1
fi

echo "==> All tests passed."
