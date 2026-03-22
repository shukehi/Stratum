#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FOLLOW_LOGS="${1:-}"
SERVICE_NAME="stratum.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

if systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
  echo "Restarting ${SERVICE_NAME}..."
  systemctl restart "$SERVICE_NAME"
else
  echo "Installing ${SERVICE_NAME}..."
  bash "$ROOT_DIR/scripts/install-systemd-service.sh"
fi

echo
systemctl status "$SERVICE_NAME" --no-pager

if [[ "$FOLLOW_LOGS" == "--logs" ]]; then
  echo
  journalctl -u "$SERVICE_NAME" -f
fi
