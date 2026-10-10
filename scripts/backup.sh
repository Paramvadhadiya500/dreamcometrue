#!/usr/bin/env bash
# Run on the server, inside the project folder:  ./scripts/backup.sh
set -euo pipefail
mkdir -p ~/backups
FILE=~/backups/livescore-$(date +%F-%H%M).sql.gz
docker compose exec -T db pg_dump -U livescore livescore | gzip > "$FILE"
if [ "$(stat -c%s "$FILE")" -lt 300 ]; then
  echo "Backup looks empty, something went wrong: $FILE"; exit 1
fi
echo "Backup saved: $FILE"