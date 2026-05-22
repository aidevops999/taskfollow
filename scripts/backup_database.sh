#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB_FILE="${DB_FILE:-$APP_DIR/data/sop.db}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "==> No database found: $DB_FILE"
  exit 0
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/sop-$timestamp.db"

cp "$DB_FILE" "$backup_file"
chmod 600 "$backup_file" 2>/dev/null || true

find "$BACKUP_DIR" -type f -name 'sop-*.db' -mtime +"$RETENTION_DAYS" -delete

echo "==> Database backup created: $backup_file"
echo "==> Removed backups older than $RETENTION_DAYS days from: $BACKUP_DIR"
