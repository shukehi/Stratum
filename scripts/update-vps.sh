#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_VERSION="9.15.2"
SERVICE_NAME="${SERVICE_NAME:-stratum.service}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
LOG_DIR="${ROOT_DIR}/logs"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="${LOG_DIR}/update-${RUN_ID}.log"

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code=$?
  echo
  echo "Update failed with exit code ${exit_code}."
  echo "Log file: ${LOG_FILE}"
  echo
  echo "Last 40 log lines:"
  tail -n 40 "$LOG_FILE" || true
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
    echo
    echo "Last 40 lines from ${SERVICE_NAME}:"
    if [[ "${EUID}" -eq 0 ]]; then
      journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
    else
      sudo journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
    fi
  fi
  exit "$exit_code"
}

trap on_error ERR

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js 20+ first."
  exit 1
fi

if command -v corepack >/dev/null 2>&1; then
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable >/dev/null 2>&1 || true
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null
  PNPM_CMD=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
else
  echo "pnpm is required. Install pnpm or Node.js with Corepack support first."
  exit 1
fi

echo "Fetching latest code for branch '$CURRENT_BRANCH'..."
git pull --ff-only origin "$CURRENT_BRANCH"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

database_url="${DATABASE_URL:-./data/stratum.db}"
if [[ "$database_url" != ":memory:" ]]; then
  mkdir -p "$(dirname "$database_url")"
fi

echo "Installing dependencies..."
"${PNPM_CMD[@]}" install --frozen-lockfile --force --production=false
"${PNPM_CMD[@]}" rebuild better-sqlite3

echo "Running verification..."
"${PNPM_CMD[@]}" typecheck
"${PNPM_CMD[@]}" test
"${PNPM_CMD[@]}" build

echo "Update succeeded."
echo "Log file: ${LOG_FILE}"

  echo "Restarting $SERVICE_NAME..."
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl restart "$SERVICE_NAME"
    systemctl status "$SERVICE_NAME" --no-pager
  else
    sudo systemctl restart "$SERVICE_NAME"
    sudo systemctl status "$SERVICE_NAME" --no-pager
  fi
else
  echo "Update complete. (No systemd service detected to restart)"
fi
