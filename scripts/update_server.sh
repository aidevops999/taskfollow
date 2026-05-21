#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-taskfollow}"
AUTO_PULL="${AUTO_PULL:-ask}"
AUTO_RESTART="${AUTO_RESTART:-ask}"

cd "$APP_DIR"

echo "==> App dir: $APP_DIR"
echo "==> Branch: $BRANCH"
echo "==> Service: $SERVICE_NAME"

ask_yes_no() {
  local prompt="$1"
  local default="$2"
  local answer
  if [ ! -t 0 ]; then
    echo "$default"
    return
  fi
  read -r -p "$prompt" answer
  answer="${answer:-$default}"
  case "$answer" in
    y|Y|yes|YES) echo "yes" ;;
    *) echo "no" ;;
  esac
}

backup_database() {
  if [ -f data/sop.db ]; then
    mkdir -p data/backups
    local backup="data/backups/sop-$(date +%Y%m%d-%H%M%S).db"
    cp data/sop.db "$backup"
    echo "==> Database backup: $backup"
  else
    echo "==> No existing database found, first start will create data/sop.db"
  fi
}

pull_code() {
  echo "==> Pulling latest code"
  git fetch origin "$BRANCH"
  git pull --ff-only origin "$BRANCH"
}

check_code() {
  echo "==> Checking Python syntax"
  "$PYTHON_BIN" -m py_compile app.py
}

restart_service() {
  echo "==> Restarting service: $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl status "$SERVICE_NAME" --no-pager -l
}

backup_database

pull_choice="$AUTO_PULL"
if [ "$AUTO_PULL" = "ask" ]; then
  pull_choice="$(ask_yes_no "是否拉取 GitHub 最新代码？[y/N] " "no")"
fi

if [ "$pull_choice" = "yes" ] || [ "$pull_choice" = "y" ]; then
  pull_code
else
  echo "==> Skip git pull"
fi

check_code

restart_choice="$AUTO_RESTART"
if [ "$AUTO_RESTART" = "ask" ]; then
  restart_choice="$(ask_yes_no "是否重启 systemd 服务 $SERVICE_NAME？[Y/n] " "yes")"
fi

if [ "$restart_choice" = "yes" ] || [ "$restart_choice" = "y" ]; then
  restart_service
else
  echo "==> Skip service restart"
fi

echo "==> Done"
