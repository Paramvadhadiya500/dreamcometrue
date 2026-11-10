#!/usr/bin/env bash
# Safe restore drill: proves a backup can really be restored, WITHOUT touching the live database.
# It loads the backup into a separate scratch database "livescore_drill", counts the rows,
# then deletes the scratch database again. Run on the server, when no match is live:
#   ./scripts/restore-drill.sh                       newest backup in ~/backups
#   ./scripts/restore-drill.sh <file.sql.gz>         a specific backup (for example one downloaded from S3)
set -uo pipefail
DIR="${BACKUP_DIR:-$HOME/backups}"
FILE="${1:-$(ls -1t "$DIR"/livescore-*.sql.gz 2>/dev/null | head -1)}"
[ -n "$FILE" ] || { echo "FAIL: no backup found in $DIR"; exit 1; }
FILE="$(realpath "$FILE")"
cd "$(dirname "$0")/.." || exit 1

DRILL=livescore_drill
sql() { docker compose exec -T db psql -U livescore -X -q -v ON_ERROR_STOP=1 "$@"; }
COUNTS="SELECT 'users', count(*) FROM users UNION ALL SELECT 'matches', count(*) FROM matches
        UNION ALL SELECT 'match_scorers', count(*) FROM match_scorers UNION ALL SELECT 'events', count(*) FROM events
        UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations"

./scripts/check-backup.sh "$FILE" || exit 1
cleanup() { sql -d postgres -c "DROP DATABASE IF EXISTS $DRILL WITH (FORCE);" >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
sql -d postgres -c "CREATE DATABASE $DRILL;" || { echo "FAIL: could not create the scratch database"; exit 1; }

start=$(date +%s)
if ! gzip -dc -- "$FILE" | sql -d "$DRILL" >/dev/null; then
  echo "FAIL: the backup did not load into the scratch database. Read the errors above."
  exit 1
fi
echo "Loaded $FILE into the scratch database in $(( $(date +%s) - start )) s."
echo "                     backup    live now"
paste <(sql -d "$DRILL" -tA -F' ' -c "$COUNTS") <(sql -d livescore -tA -F' ' -c "$COUNTS") \
  | awk '{ printf "  %-18s %7s %10s\n", $1, $2, $4 }'
echo "PASS: the backup restores. 'live now' can be a little higher (scores entered after the backup)."
