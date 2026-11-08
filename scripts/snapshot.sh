#!/usr/bin/env bash
# Prints a status report with NO passwords and NO secrets, to paste into a new chat.
# Run on the server, from the project folder:  ./scripts/snapshot.sh
cd "$(dirname "$0")/.." || exit 1

q() { docker compose exec -T db psql -U livescore -d livescore -c "$1" 2>&1; }

echo "== time (UTC) =="; date -u
echo; echo "== code version =="
git log --oneline -5 2>&1
echo "-- uncommitted changes (should be empty):"; git status --short 2>&1 | head -20
echo; echo "== .env variable NAMES only =="
if [ -f .env ]; then cut -d= -f1 .env | sed '/^$/d'; else echo ".env is missing"; fi
echo; echo "== containers =="; docker compose ps 2>&1 | grep -v '^WARN'
echo; echo "== migrations applied =="; q "SELECT name, applied_at FROM schema_migrations ORDER BY name;"
echo; echo "== row counts =="
q "SELECT 'users' AS tbl, count(*) FROM users UNION ALL SELECT 'matches', count(*) FROM matches UNION ALL SELECT 'match_scorers', count(*) FROM match_scorers UNION ALL SELECT 'events', count(*) FROM events;"
echo; echo "== matches =="; q "SELECT id, name, sport, best_of, config FROM matches ORDER BY id;"
echo; echo "== users (no passwords) =="; q "SELECT username, role, active FROM users ORDER BY username;"
echo; echo "== who scores what =="; q "SELECT username, match_id FROM match_scorers ORDER BY 1, 2;"
echo; echo "== events per match =="; q "SELECT match_id, count(*) AS events, max(created_at) AS last_event FROM events GROUP BY 1 ORDER BY 1;"
echo; echo "== web check =="
curl -s -o /dev/null -m 5 -w "GET /api/matches -> %{http_code}\n" http://localhost/api/matches
curl -s -o /dev/null -m 5 -w "GET /health      -> %{http_code}\n" http://localhost/health
echo; echo "== disk and memory =="; df -h / | tail -1; free -m | sed -n '1,2p'
echo; echo "== backups =="; ls -lh ~/backups 2>/dev/null | tail -5 || echo "no ~/backups folder"
echo; echo "== app log, last 15 lines (look it over before pasting) =="; docker compose logs --tail 15 app 2>&1