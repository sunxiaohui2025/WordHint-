#!/bin/zsh
set -a
source "${0:A:h}/.env.local"
set +a
cd "${0:A:h}"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
