#!/usr/bin/env bash
# Run on the server, inside the project folder:  ./scripts/restore.sh ~/backups/<file>.sql.gz
# WARNING: replaces ALL current data with the backup.
set -euo pipefail
FILE="${1:?Usage: ./scripts/restore.sh <backup.sql.gz>}"
[ -f "$FILE" ] || { echo "File not found: $FILE"; exit 1; }
read -r -p "This DELETES the current database and loads $FILE. Type yes to continue: " ANSWER
[ "$ANSWER" = "yes" ] || { echo "Cancelled"; exit 1; }

docker compose stop app
docker compose exec -T db psql -U livescore -d postgres -c "DROP DATABASE IF EXISTS livescore WITH (FORCE);"
docker compose exec -T db psql -U livescore -d postgres -c "CREATE DATABASE livescore;"
gunzip -c "$FILE" | docker compose exec -T db psql -U livescore -d livescore -v ON_ERROR_STOP=1
docker compose exec -T redis redis-cli FLUSHALL
docker compose up -d app
echo "Restore finished"