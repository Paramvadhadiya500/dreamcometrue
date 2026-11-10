#!/usr/bin/env bash
# Deletes backups older than 7 days, but ALWAYS keeps the newest 3 complete backups,
# so a long run of failed backups can never delete your last good copy. Run by cron (install-cron.sh).
#   ./scripts/prune-backups.sh             delete
#   ./scripts/prune-backups.sh --dry-run   only show what would be deleted
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP=3
DAYS=7
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

# the newest $KEEP backups that pass the check are protected
keep=" "; n=0
for f in $(ls -1t "$DIR"/livescore-*.sql.gz 2>/dev/null); do
  [ "$n" -ge "$KEEP" ] && break
  if ./scripts/check-backup.sh "$f" >/dev/null 2>&1; then keep="$keep$f "; n=$((n + 1)); fi
done
[ "$n" -lt "$KEEP" ] && echo "$(date '+%F %T') WARNING: only $n complete backup(s) found in $DIR"

deleted=0
for f in $(find "$DIR" -maxdepth 1 -name 'livescore-*.sql.gz' -mtime +"$DAYS" 2>/dev/null); do
  case "$keep" in *" $f "*) continue ;; esac
  if [ "$DRY" -eq 1 ]; then echo "would delete $f"; else rm -f -- "$f"; fi
  deleted=$((deleted + 1))
done
# temporary files left by a backup that was killed half-way
for f in $(find "$DIR" -maxdepth 1 -name 'livescore-*.sql.gz.tmp.*' -mmin +120 2>/dev/null); do
  if [ "$DRY" -eq 1 ]; then echo "would delete $f"; else rm -f -- "$f"; fi
done

if [ "$DRY" -eq 1 ]; then
  echo "dry run: $deleted old backup(s) would be deleted; protected: $n newest complete backup(s)"
else
  echo "$(date '+%F %T') Prune: deleted $deleted backup(s) older than $DAYS days; kept the newest $n complete backup(s)"
fi
