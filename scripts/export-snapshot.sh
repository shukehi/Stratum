#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_VERSION="9.15.2"
EXPORT_DIR="${ROOT_DIR}/exports"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_DIR="${EXPORT_DIR}/stratum-snapshot-${RUN_ID}"
ARCHIVE_PATH="${SNAPSHOT_DIR}.tar.gz"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required."
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo ".env is missing in ${ROOT_DIR}."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source ".env"
set +a

DATABASE_PATH="${DATABASE_URL:-./data/stratum.db}"
if [[ "$DATABASE_PATH" = ":memory:" ]]; then
  echo "DATABASE_URL points to :memory:, nothing to export."
  exit 1
fi

if [[ ! -f "$DATABASE_PATH" ]]; then
  echo "Database file not found: $DATABASE_PATH"
  exit 1
fi

COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable >/dev/null 2>&1 || true
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null
PNPM_CMD=(corepack pnpm)

mkdir -p "$SNAPSHOT_DIR"/logs

cp "$DATABASE_PATH" "$SNAPSHOT_DIR/stratum.db"

for suffix in -shm -wal; do
  if [[ -f "${DATABASE_PATH}${suffix}" ]]; then
    cp "${DATABASE_PATH}${suffix}" "$SNAPSHOT_DIR/"
  fi
done

if [[ -d "${ROOT_DIR}/logs" ]]; then
  cp -R "${ROOT_DIR}/logs/." "$SNAPSHOT_DIR/logs/"
fi

{
  echo "snapshot_utc=${RUN_ID}"
  echo "database_path=${DATABASE_PATH}"
  echo "exchange_name=${EXCHANGE_NAME:-}"
  echo "symbol=${SYMBOL:-}"
  echo "spot_symbol=${SPOT_SYMBOL:-}"
  echo "llm_provider=${LLM_PROVIDER:-}"
  echo "llm_model=${LLM_MODEL:-}"
  echo "heartbeat_interval_h=${HEARTBEAT_INTERVAL_H:-}"
  echo "log_level=${LOG_LEVEL:-}"
} > "$SNAPSHOT_DIR/metadata.txt"

"${PNPM_CMD[@]}" report --all > "$SNAPSHOT_DIR/report-all.txt" || true

tar -czf "$ARCHIVE_PATH" -C "$EXPORT_DIR" "$(basename "$SNAPSHOT_DIR")"

echo "Snapshot created:"
echo "  directory: $SNAPSHOT_DIR"
echo "  archive:   $ARCHIVE_PATH"
echo
echo "Copy it to your local machine with:"
echo "  scp <user>@<host>:${ARCHIVE_PATH} <local-path>/"
