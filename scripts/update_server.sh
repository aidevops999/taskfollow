#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-taskfollow}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
APP_PORT="${APP_PORT:-8001}"
AUTO_PULL="${AUTO_PULL:-ask}"
AUTO_RESTART="${AUTO_RESTART:-ask}"
AUTO_CREATE_SERVICE="${AUTO_CREATE_SERVICE:-ask}"

cd "$APP_DIR"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "==> App dir: $APP_DIR"
echo "==> Branch: $BRANCH"
echo "==> Service: $SERVICE_NAME"
echo "==> Port: $APP_PORT"
echo "==> Run user: $SERVICE_USER"

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
    echo "==> Database backup: $APP_DIR/$backup"
  else
    echo "==> No existing database found, first start will create $APP_DIR/data/sop.db"
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

service_exists() {
  systemctl list-unit-files "${SERVICE_NAME}.service" --no-legend 2>/dev/null | grep -q "${SERVICE_NAME}.service" || [ -f "$SERVICE_FILE" ]
}

create_service() {
  echo "==> Creating systemd service: $SERVICE_FILE"
  sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE_EOF
[Unit]
Description=TaskFollow SOP web app
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=$PYTHON_BIN app.py $APP_PORT
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICE_EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
}

ensure_service() {
  if service_exists; then
    return
  fi

  echo "==> systemd service not found: ${SERVICE_NAME}.service"
  local create_choice="$AUTO_CREATE_SERVICE"
  if [ "$AUTO_CREATE_SERVICE" = "ask" ]; then
    create_choice="$(ask_yes_no "是否自动创建 systemd 服务 ${SERVICE_NAME}？[Y/n] " "yes")"
  fi

  if [ "$create_choice" = "yes" ] || [ "$create_choice" = "y" ]; then
    create_service
  else
    echo "==> Skip service creation"
    echo "    You can run manually: cd $APP_DIR && $PYTHON_BIN app.py $APP_PORT"
    return 1
  fi
}

restart_service() {
  ensure_service
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
