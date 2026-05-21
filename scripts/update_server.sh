#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-}"

cd "$APP_DIR"

echo "==> App dir: $APP_DIR"
echo "==> Branch: $BRANCH"

if [ -f data/sop.db ]; then
  mkdir -p data/backups
  BACKUP="data/backups/sop-$(date +%Y%m%d-%H%M%S).db"
  cp data/sop.db "$BACKUP"
  echo "==> Database backup: $BACKUP"
else
  echo "==> No existing database found, first start will create data/sop.db"
fi

echo "==> Pulling latest code"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Checking Python syntax"
"$PYTHON_BIN" -m py_compile app.py

if [ -n "$SERVICE_NAME" ]; then
  echo "==> Restarting service: $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl status "$SERVICE_NAME" --no-pager -l
else
  echo "==> SERVICE_NAME is not set, skip service restart"
  echo "    If you run manually, restart with: $PYTHON_BIN app.py 8001"
fi

echo "==> Update complete"
