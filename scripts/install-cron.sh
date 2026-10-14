#!/usr/bin/env bash
# Installs automatic database backups, and removes backups older than 7 days. Safe to run again.
#   ./scripts/install-cron.sh          backup every hour (use during the event)
#   ./scripts/install-cron.sh daily    backup once a day at 03:00 (use the rest of the year)
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-hourly}"
case "$MODE" in
  hourly) WHEN="0 * * * *" ;;
  daily)  WHEN="0 3 * * *" ;;
  *) echo "Usage: $0 [hourly|daily]"; exit 1 ;;
esac

mkdir -p "$HOME/backups"
BACKUP_LINE="$WHEN cd $PROJECT && ./scripts/backup.sh >> $HOME/backups/backup.log 2>&1 # livescore-backup"
PRUNE_LINE="30 4 * * * find $HOME/backups -name 'livescore-*.sql.gz' -mtime +7 -delete # livescore-prune"

# keep every other line the user already has, replace only our two lines
CURRENT="$(crontab -l 2>/dev/null || true)"
KEPT="$(printf '%s\n' "$CURRENT" | grep -v 'livescore-backup' | grep -v 'livescore-prune' || true)"
printf '%s\n%s\n%s\n' "$KEPT" "$BACKUP_LINE" "$PRUNE_LINE" | sed '/^$/d' | crontab -

echo "Installed ($MODE). Backup schedule now:"
crontab -l | grep livescore
