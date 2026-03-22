#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_VERSION="9.15.2"

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

if [[ ! -f ".env" ]]; then
  cp ".env.example" ".env"
  echo "Created .env from .env.example. Review it before starting the scheduler."
fi

set -a
# shellcheck disable=SC1091
source ".env"
set +a

database_url="${DATABASE_URL:-./data/stratum.db}"
if [[ "$database_url" != ":memory:" ]]; then
  mkdir -p "$(dirname "$database_url")"
fi

echo "Installing dependencies..."
"${PNPM_CMD[@]}" install --frozen-lockfile --force
"${PNPM_CMD[@]}" rebuild better-sqlite3

echo "Running verification..."
"${PNPM_CMD[@]}" typecheck
"${PNPM_CMD[@]}" test
"${PNPM_CMD[@]}" build

cat <<EOF

VPS preflight complete.

Next steps:
  1. Review .env and fill optional API keys if needed.
  2. Start a one-off smoke run:
       corepack pnpm backtest --symbol BTCUSDT --limit 300
  3. Start the long-running scheduler:
       sudo ./scripts/boot.sh --logs
  4. Or install the systemd service:
       sudo ./scripts/install-systemd-service.sh

EOF
