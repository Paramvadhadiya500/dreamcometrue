#!/usr/bin/env bash
# Checks that a backup file is a complete database dump. Prints OK or BAD with the reason.
# Exit code 0 = good. Used by backup.sh, restore.sh, restore-drill.sh, prune-backups.sh, security-check.sh.
#   ./scripts/check-backup.sh ~/backups/livescore-2026-11-10-1200.sql.gz
set -u
f="${1:?Usage: ./scripts/check-backup.sh <backup.sql.gz>}"
bad() { echo "BAD: $f: $1"; exit 1; }

[ -f "$f" ] || bad "file not found"
size="$(wc -c < "$f" | tr -d ' ')"
[ "$size" -ge 1024 ] || bad "only $size bytes (a real backup is several KB)"
gzip -t -- "$f" 2>/dev/null || bad "not a valid gzip file (cut off or damaged)"
# pg_dump writes this line at the very end; newer versions add a "\unrestrict" line after it
tail20="$(gzip -dc -- "$f" | tail -n 20)"
case "$tail20" in
  *"PostgreSQL database dump complete"*) ;;
  *) bad "the dump is not complete (end marker missing)" ;;
esac
events="$(gzip -dc -- "$f" | grep -c '^COPY public\.events ')"
[ "$events" -ge 1 ] || bad "the events table is missing"
echo "OK: $f ($size bytes)"
