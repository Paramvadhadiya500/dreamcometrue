#!/usr/bin/env bash
# Database backup. Run on the server, inside the project folder:  ./scripts/backup.sh
# A new file is kept ONLY if it is a complete dump (scripts/check-backup.sh). Older backups are never touched.
#
# Optional settings in ~/.livescore-backup (chmod 600, NOT in Git). See docs/BACKUPS.md.
#   BACKUP_S3_BUCKET=<bucket name>                also copy every good backup to S3
#   BACKUP_S3_REGION=ap-south-1
#   BACKUP_PING_URL=https://hc-ping.com/<uuid>    heartbeat: pinged after success, <url>/fail on failure
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="$PATH:/snap/bin:/usr/local/bin"     # cron has a short PATH; the aws CLI is installed here

DIR="${BACKUP_DIR:-$HOME/backups}"
CONF="${BACKUP_CONF:-$HOME/.livescore-backup}"
setting() { [ -f "$CONF" ] && grep -E "^$1=" "$CONF" | head -1 | cut -d= -f2- | tr -d '\r'; }
BUCKET="$(setting BACKUP_S3_BUCKET)"
REGION="$(setting BACKUP_S3_REGION)"; REGION="${REGION:-ap-south-1}"
PING="$(setting BACKUP_PING_URL)"

ping_hc() {
  if [ -n "$PING" ]; then curl -fsS -m 10 --retry 3 -o /dev/null "$PING$1" || echo "warning: heartbeat ping failed"; fi
}
failed() {
  rm -f "$TMP"
  echo "$(date '+%F %T') FAILED: $1"
  ping_hc /fail
  exit 1
}

mkdir -p "$DIR"
NAME="livescore-$(date +%F-%H%M).sql.gz"
FILE="$DIR/$NAME"
TMP="$FILE.tmp.$$"

# 1. dump into a temporary file
docker compose exec -T db pg_dump -U livescore livescore | gzip > "$TMP" \
  || failed "pg_dump did not finish (is the db container running?)"
# 2. keep it only if it is complete
CHECK="$(./scripts/check-backup.sh "$TMP")" || failed "$CHECK"
mv "$TMP" "$FILE" || failed "could not rename $TMP"
echo "$(date '+%F %T') Backup saved: $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)"

# 3. copy off the server (only if configured)
if [ -n "$BUCKET" ]; then
  if ! aws s3 cp --only-show-errors --region "$REGION" "$FILE" "s3://$BUCKET/backups/$NAME"; then
    echo "$(date '+%F %T') FAILED: copy to S3 (the local backup is kept: $FILE)"
    ping_hc /fail
    exit 1
  fi
  echo "$(date '+%F %T') Copied to s3://$BUCKET/backups/$NAME"
fi

# 4. tell the heartbeat service that all went well
ping_hc ""
