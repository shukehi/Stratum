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

if command -v corepack >/dev/null 2>&1; then
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable >/dev/null 2>&1 || true
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null
  PNPM_CMD=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
else
  echo "pnpm is required."
  exit 1
fi

# 生产环境：直接运行编译后的物理代码，消除 tsx 带来的内存熵
exec node dist/index.js
