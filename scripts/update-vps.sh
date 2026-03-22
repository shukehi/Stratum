#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE_NAME="${SERVICE_NAME:-stratum.service}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js 20+ first."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Run: corepack enable && corepack prepare pnpm@latest --activate"
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
pnpm install --frozen-lockfile
pnpm rebuild better-sqlite3

echo "Running verification..."
pnpm typecheck
pnpm test
pnpm build

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
  echo "Restarting $SERVICE_NAME..."
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl restart "$SERVICE_NAME"
  else
    sudo systemctl restart "$SERVICE_NAME"
  fi
  echo "Following logs..."
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl status "$SERVICE_NAME" --no-pager
  else
    sudo systemctl status "$SERVICE_NAME" --no-pager
  fi
else
  cat <<EOF

Update complete.

No systemd unit named '$SERVICE_NAME' was detected.
If you run Stratum manually, start it with:
  pnpm dev

If the unit exists under another name, run:
  SERVICE_NAME=<your-unit>.service bash ./scripts/update-vps.sh

EOF
fi
