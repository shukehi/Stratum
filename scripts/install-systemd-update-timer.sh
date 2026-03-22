#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

if [[ -z "${SUDO_USER:-}" ]]; then
  echo "SUDO_USER is not set. Use: sudo ./scripts/install-systemd-update-timer.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_USER="${SUDO_USER}"
UPDATE_SERVICE_PATH="/etc/systemd/system/stratum-update.service"
UPDATE_TIMER_PATH="/etc/systemd/system/stratum-update.timer"

sed \
  -e "s|__USER__|$TARGET_USER|g" \
  -e "s|__WORKDIR__|$ROOT_DIR|g" \
  "$ROOT_DIR/deploy/stratum-update.service" > "$UPDATE_SERVICE_PATH"

cp "$ROOT_DIR/deploy/stratum-update.timer" "$UPDATE_TIMER_PATH"

systemctl daemon-reload
systemctl enable --now stratum-update.timer

echo "Installed $UPDATE_SERVICE_PATH"
echo "Installed $UPDATE_TIMER_PATH"
systemctl status stratum-update.timer --no-pager
