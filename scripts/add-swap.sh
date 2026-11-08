#!/usr/bin/env bash
# Adds a swap file: a safety net so a memory peak slows the server down instead of killing a container.
# Safe to run twice. Run on the server:   ./scripts/add-swap.sh        (2 GB)   or   ./scripts/add-swap.sh 1G
set -euo pipefail
SIZE="${1:-2G}"

if [ -n "$(swapon --show=NAME --noheadings 2>/dev/null)" ]; then
  echo "Swap already exists, nothing to do:"
  swapon --show
  exit 0
fi

sudo fallocate -l "$SIZE" /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile > /dev/null
sudo swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf > /dev/null
sudo sysctl -w vm.swappiness=10 > /dev/null

echo "Swap is on ($SIZE) and will stay on after a reboot:"
swapon --show
free -m
