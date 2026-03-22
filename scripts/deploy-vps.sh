#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js 20+ first."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Run: corepack enable && corepack prepare pnpm@latest --activate"
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
pnpm install --frozen-lockfile
pnpm rebuild better-sqlite3

echo "Running verification..."
pnpm typecheck
pnpm test
pnpm build

cat <<EOF

VPS preflight complete.

Next steps:
  1. Review .env and fill optional API keys if needed.
  2. Start a one-off smoke run:
       pnpm backtest --symbol BTCUSDT --limit 300
  3. Start the long-running scheduler:
       pnpm dev
  4. Or install the systemd service:
       sudo ./scripts/install-systemd-service.sh

EOF
