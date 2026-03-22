#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

if [[ -z "${SUDO_USER:-}" ]]; then
  echo "SUDO_USER is not set. Use: sudo ./scripts/install-systemd-service.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_USER="${SUDO_USER}"

SERVICE_PATH="/etc/systemd/system/stratum.service"

sed \
  -e "s|__USER__|$TARGET_USER|g" \
  -e "s|__WORKDIR__|$ROOT_DIR|g" \
  "$ROOT_DIR/deploy/stratum.service" > "$SERVICE_PATH"

systemctl daemon-reload
systemctl enable --now stratum.service

echo "Installed $SERVICE_PATH"
systemctl status stratum.service --no-pager
