#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_VERSION="9.15.2"

if [[ ! -f ".env" ]]; then
  echo ".env is missing in ${ROOT_DIR}. Create it before starting stratum.service."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required."
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required."
  exit 1
fi

COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable >/dev/null 2>&1 || true
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null

exec corepack pnpm dev
