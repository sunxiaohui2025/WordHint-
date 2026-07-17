#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ENV_FILE="${WORDHINT_ENV_FILE:-$PWD/.env}"
if [[ ! -f "$ENV_FILE" ]]; then echo "缺少 $ENV_FILE，请先执行 cp .env.example .env" >&2; exit 1; fi
set -a; source "$ENV_FILE"; set +a
exec "$PWD/.venv/bin/uvicorn" app.main:app --host "${WORDHINT_HOST:-0.0.0.0}" --port "${WORDHINT_PORT:-8000}" --workers "${WORDHINT_WORKERS:-2}" --proxy-headers
