#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-taskfollow}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
APP_PORT="${APP_PORT:-8002}"
BACKUP_KEEP_FILES="${BACKUP_KEEP_FILES:-${RETENTION_DAYS:-7}}"
RUN_CALENDAR="${RUN_CALENDAR:-Sun *-*-* 03:30:00}"
BACKUP_SERVICE_NAME="${BACKUP_SERVICE_NAME:-taskfollow-backup}"
DB_FILE="${DB_FILE:-$APP_DIR/data/sop.db}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/data/backups}"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BACKUP_SERVICE_FILE="/etc/systemd/system/${BACKUP_SERVICE_NAME}.service"
BACKUP_TIMER_FILE="/etc/systemd/system/${BACKUP_SERVICE_NAME}.timer"

cd "$APP_DIR"

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

print_context() {
  echo "==> App dir: $APP_DIR"
  echo "==> Branch: $BRANCH"
  echo "==> Service: $SERVICE_NAME"
  echo "==> Port: $APP_PORT"
  echo "==> Run user: $SERVICE_USER"
}

backup_database() {
  mkdir -p "$BACKUP_DIR"
  if [ ! -f "$DB_FILE" ]; then
    echo "==> No database found: $DB_FILE"
    return 0
  fi

  local backup_file="$BACKUP_DIR/sop-$(date +%Y%m%d-%H%M%S).db"
  cp "$DB_FILE" "$backup_file"
  chmod 600 "$backup_file" 2>/dev/null || true
  local backup_index=0
  while IFS= read -r old_backup; do
    backup_index=$((backup_index + 1))
    if [ "$backup_index" -gt "$BACKUP_KEEP_FILES" ]; then
      rm -f "$old_backup"
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'sop-*.db' -print | sort -r)

  echo "==> Database backup created: $backup_file"
  echo "==> Kept latest $BACKUP_KEEP_FILES backup files in: $BACKUP_DIR"
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
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found. You can run manually: cd $APP_DIR && $PYTHON_BIN app.py $APP_PORT"
    exit 1
  fi

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
    return 0
  fi

  echo "==> systemd service not found: ${SERVICE_NAME}.service"
  local create_choice
  create_choice="$(ask_yes_no "是否自动创建 systemd 服务 ${SERVICE_NAME}？[Y/n] " "yes")"
  if [ "$create_choice" = "yes" ]; then
    create_service
  else
    echo "==> Skip service creation"
    echo "    Manual run: cd $APP_DIR && $PYTHON_BIN app.py $APP_PORT"
    return 1
  fi
}

restart_service() {
  ensure_service
  echo "==> Restarting service: $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl status "$SERVICE_NAME" --no-pager -l
}

install_backup_timer() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found. This command is for Linux servers using systemd."
    exit 1
  fi

  echo "==> Installing weekly database backup timer"
  echo "==> Schedule: $RUN_CALENDAR"
  echo "==> Keep latest backup files: $BACKUP_KEEP_FILES"

  sudo tee "$BACKUP_SERVICE_FILE" >/dev/null <<SERVICE_EOF
[Unit]
Description=TaskFollow SQLite database backup

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
Environment=APP_DIR=$APP_DIR
Environment=BACKUP_KEEP_FILES=$BACKUP_KEEP_FILES
ExecStart=$APP_DIR/scripts/taskfollow.sh backup
SERVICE_EOF

  sudo tee "$BACKUP_TIMER_FILE" >/dev/null <<TIMER_EOF
[Unit]
Description=Run TaskFollow SQLite database backup weekly

[Timer]
OnCalendar=$RUN_CALENDAR
Persistent=true
Unit=${BACKUP_SERVICE_NAME}.service

[Install]
WantedBy=timers.target
TIMER_EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now "${BACKUP_SERVICE_NAME}.timer"
  sudo systemctl list-timers "${BACKUP_SERVICE_NAME}.timer" --no-pager
  echo "==> Installed. Test once with: sudo systemctl start ${BACKUP_SERVICE_NAME}.service"
}

update_app() {
  print_context
  backup_database

  local pull_choice="${AUTO_PULL:-ask}"
  if [ "$pull_choice" = "ask" ]; then
    pull_choice="$(ask_yes_no "是否拉取 GitHub 最新代码？[y/N] " "no")"
  fi

  if [ "$pull_choice" = "yes" ] || [ "$pull_choice" = "y" ]; then
    pull_code
  else
    echo "==> Skip git pull"
  fi

  check_code

  local restart_choice="${AUTO_RESTART:-ask}"
  if [ "$restart_choice" = "ask" ]; then
    restart_choice="$(ask_yes_no "是否重启 systemd 服务 $SERVICE_NAME？[Y/n] " "yes")"
  fi

  if [ "$restart_choice" = "yes" ] || [ "$restart_choice" = "y" ]; then
    restart_service
  else
    echo "==> Skip service restart"
  fi

  echo "==> Done"
}

status_service() {
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl status "$SERVICE_NAME" --no-pager -l || true
    sudo systemctl list-timers "${BACKUP_SERVICE_NAME}.timer" --no-pager || true
  else
    echo "systemctl not found."
  fi
}

show_help() {
  cat <<HELP
Usage: ./scripts/taskfollow.sh <command>

Commands:
  update                 备份数据库，可选拉取代码，并可选重启服务
  restart                重启 systemd 服务，不拉代码
  backup                 立即备份 data/sop.db，并只保留最近 7 个备份文件
  install-service        创建/更新 taskfollow systemd 服务
  install-backup-timer   安装每周数据库备份定时器
  status                 查看应用服务和备份定时器状态
  help                   显示帮助

Notes:
  服务器拉取包含统一脚本的更新后，如果之前装过旧版备份定时器，
  请执行一次：./scripts/taskfollow.sh install-backup-timer
  这样 systemd 定时器会改为新的统一脚本入口。

Common env:
  APP_PORT=8002
  SERVICE_NAME=taskfollow
  PYTHON_BIN=python3
  BACKUP_KEEP_FILES=7
  RUN_CALENDAR="Sun *-*-* 03:30:00"
HELP
}

main() {
  local command="${1:-update}"
  case "$command" in
    update) update_app ;;
    restart) print_context; restart_service ;;
    backup) backup_database ;;
    install-service) print_context; create_service ;;
    install-backup-timer) install_backup_timer ;;
    status) status_service ;;
    help|-h|--help) show_help ;;
    *)
      echo "Unknown command: $command"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
