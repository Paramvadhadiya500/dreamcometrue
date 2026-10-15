#!/usr/bin/env bash
# Security and health check to run before the event (and after every deploy).
# Prints PASS / WARN / FAIL for each check. It never prints passwords or secrets.
# Run it on the server:   ./scripts/security-check.sh
cd "$(dirname "$0")/.." || exit 1

PASS=0; WARN=0; FAIL=0
pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
warn() { echo "WARN  $1"; WARN=$((WARN + 1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }
envval() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }




echo "== settings file =="
if [ ! -f .env ]; then
  fail ".env is missing"
else
  [ -n "$(envval DB_PASSWORD)" ] && pass "DB_PASSWORD is set" || fail "DB_PASSWORD is empty or missing in .env"
  SECRET="$(envval JWT_SECRET)"
  if [ -z "$SECRET" ]; then fail "JWT_SECRET is empty or missing in .env"
  elif [ "${#SECRET}" -lt 32 ]; then warn "JWT_SECRET is short (under 32 characters). Make a new one: openssl rand -hex 32"
  else pass "JWT_SECRET is long enough"; fi
  MODE="$(stat -c %a .env 2>/dev/null)"
  [ "$MODE" = "600" ] && pass ".env can be read only by you" || warn ".env permissions are $MODE. Run: chmod 600 .env"
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then fail ".env is tracked by Git. Run: git rm --cached .env"; else pass ".env is not tracked by Git"; fi
fi

echo "== containers and ports =="
RUNNING="$(docker compose ps --status running --services 2>/dev/null)"
for svc in app db redis caddy; do
  if echo "$RUNNING" | grep -qx "$svc"; then pass "container $svc is running"; else fail "container $svc is NOT running"; fi
done
if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -Eq '(0\.0\.0\.0|\[::\]|\*):(5432|6379|3000)[[:space:]]'; then
    fail "the database, Redis or the app port is open to the internet. Remove any 'ports:' for db, redis and app"
  else
    pass "database, Redis and the app port are not open to the internet"
  fi
else
  warn "cannot check open ports (ss is not installed)"
fi

echo "== HTTPS =="
SITE="$(envval DOMAIN)"
[ -z "$SITE" ] && SITE=":80"
BASE="http://localhost"
if [ "$SITE" = ":80" ]; then
  warn "DOMAIN is empty or :80, so the site uses plain HTTP and passwords are NOT encrypted"
else
  REDIR="$(curl -s -m 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$SITE/" 2>/dev/null)"
  case "$REDIR" in
    30*" https://"*) pass "http://$SITE redirects to https" ;;
    *) warn "http://$SITE does not redirect to https (got: $REDIR)" ;;
  esac
  CODE="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://$SITE/health" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then
    pass "https://$SITE answers with a certificate your computer trusts"
    BASE="https://$SITE"
  else
    fail "https://$SITE does not work (code $CODE). See: docker compose logs --tail 30 caddy and LESSON_12.md section 4.5"
    BASE=""
  fi
fi

echo "== headers and login limit (through ${BASE:-nothing: HTTPS is not working}) =="
if [ -z "$BASE" ]; then
  warn "header and login-limit checks skipped because HTTPS does not work. Fix HTTPS first"
else
HEADERS="$(curl -s -m 10 -D - -o /dev/null "$BASE/health" 2>/dev/null | tr -d '\r')"
if [ -z "$HEADERS" ]; then
  warn "could not read $BASE/health"
else
  for h in x-content-type-options x-frame-options referrer-policy strict-transport-security; do
    if echo "$HEADERS" | grep -qi "^$h:"; then pass "header $h is set"; else warn "header $h is missing"; fi
  done
  if echo "$HEADERS" | grep -qi "^x-powered-by:"; then warn "the server announces its framework (x-powered-by)"; else pass "the framework name is hidden"; fi

  LAST=""
  for _ in 1 2 3 4 5 6; do
    LAST="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
      -d '{"username":"securitycheck-nobody","password":"wrong"}' "$BASE/login" 2>/dev/null)"
  done
  if [ "$LAST" = "429" ]; then pass "6 wrong passwords in a row are blocked (login limit works)"; else warn "login limit did not block the 6th wrong password (code $LAST)"; fi
fi
fi

echo "== passwords =="
PWOUT="$(docker compose run --rm -T app node check-passwords.js 2>/dev/null)"
PWRC=$?
echo "$PWOUT" | grep -E "^(WEAK|ok )"
case $PWRC in
  0) pass "no active account uses a known password" ;;
  1) fail "some active accounts use a known password (see WEAK lines above). Use the admin page: Scorers, New password" ;;
  *) warn "could not run the password check" ;;
esac

echo "== database and backups =="
FILES="$(ls migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')"
APPLIED="$(docker compose exec -T db psql -U livescore -d livescore -tA -c 'SELECT count(*) FROM schema_migrations' 2>/dev/null | tr -d '[:space:]')"
if [ -n "$APPLIED" ] && [ "$APPLIED" = "$FILES" ]; then pass "all $FILES migrations are applied"
else fail "migrations applied: ${APPLIED:-unknown}, migration files: $FILES. Run: docker compose run --rm app node migrate.js"; fi

if crontab -l 2>/dev/null | grep -q 'livescore-backup'; then pass "automatic backups are scheduled"; else warn "no automatic backups. Run: ./scripts/install-cron.sh"; fi
if [ -n "$(find "$HOME/backups" -name 'livescore-*.sql.gz' -mmin -120 2>/dev/null | head -1)" ]; then pass "a backup was made in the last 2 hours"
else warn "no backup in the last 2 hours. Run: ./scripts/backup.sh"; fi

echo "== server =="
USED="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"
if [ -z "$USED" ]; then warn "could not read disk usage"
elif [ "$USED" -ge 95 ]; then fail "disk is ${USED}% full"
elif [ "$USED" -ge 85 ]; then warn "disk is ${USED}% full"
else pass "disk is ${USED}% full"; fi
if systemctl is-active --quiet unattended-upgrades 2>/dev/null; then pass "automatic security updates are on"; else warn "automatic security updates are not active"; fi

echo
echo "Result: $PASS passed, $WARN warnings, $FAIL failed"
[ "$FAIL" -eq 0 ]
