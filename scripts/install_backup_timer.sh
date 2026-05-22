#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-taskfollow-backup}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUN_CALENDAR="${RUN_CALENDAR:-Sun *-*-* 03:30:00}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}.timer"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. This installer is for Linux servers using systemd."
  exit 1
fi

if [ ! -x "$APP_DIR/scripts/backup_database.sh" ]; then
  echo "Backup script not found or not executable: $APP_DIR/scripts/backup_database.sh"
  exit 1
fi

echo "==> Installing weekly database backup timer"
echo "==> App directory: $APP_DIR"
echo "==> Schedule: $RUN_CALENDAR"
echo "==> Retention: $RETENTION_DAYS days"

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=TaskFollow SQLite database backup

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
Environment=APP_DIR=$APP_DIR
Environment=RETENTION_DAYS=$RETENTION_DAYS
ExecStart=$APP_DIR/scripts/backup_database.sh
SERVICE

sudo tee "$TIMER_FILE" >/dev/null <<TIMER
[Unit]
Description=Run TaskFollow SQLite database backup weekly

[Timer]
OnCalendar=$RUN_CALENDAR
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
TIMER

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}.timer"
sudo systemctl list-timers "${SERVICE_NAME}.timer" --no-pager

echo "==> Installed. Test once with: sudo systemctl start ${SERVICE_NAME}.service"
