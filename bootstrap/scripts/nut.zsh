#!/usr/bin/env zsh
# Bootstrap script for NUT (Network UPS Tools)
# Run: zsh zconf/bootstrap/scripts/nut.zsh

set -e

local dir="${0:A:h}/../../modules/nut"

echo "Installing nut..."
sudo pacman -S --needed nut

echo "Deploying NUT config files..."
sudo cp "$dir/ups.conf" /etc/nut/ups.conf
sudo cp "$dir/nut.conf" /etc/nut/nut.conf

echo "Reloading udev rules..."
sudo udevadm control --reload-rules
sudo udevadm trigger

echo "Enabling and starting NUT services..."
sudo systemctl enable --now nut-driver-enumerator nut-server

echo "Done. Test with: upsc ups"
