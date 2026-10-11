# PROJECT CONTEXT: College Live Score

Last updated: 2026-10-11, after Lesson 10 (cricket engine).
Keep the "Status" section current. Never put passwords, tokens or the contents of .env in this file.

## 1. What this is
A live score website for my college sports month: about 20 games (10+ outdoor, 8+ indoor), many matches at the same time,
about 10,000 students. A volunteer scorer enters points on a phone; students watch the score on their phones within a few seconds.
Owner: Param Vadhadiya (3rd year B.Tech CSE, solo). Goal: reliable and simple, not "better than Cricbuzz".
Repo: github.com/Paramvadhadiya500/dreamcometrue (local folder on my laptop is called "crivcket", on the server ~/dreamcometrue).

## 2. How to help me (instructions for the AI assistant)
- I am a student. Use simple English, short steps, and say WHY in one line.
- Always say WHERE a command runs: Windows laptop (PowerShell) or the Ubuntu server (bash). They differ (`$env:X="1"` vs `X=1`).
- Give COMPLETE files, not partial edits. Partial edits caused broken pages before.
- Do not guess. If you need a file, a log or a query result, ask me for it. Ask me for exact error text.
- Never print real secrets; use obvious placeholders and warn me they are placeholders.
- Test your code before giving it to me when you can, and say honestly what you could not test.
- Remember: code travels through Git, DATA does not. My laptop database and the server database are separate.

## 3. Stack
- Backend: Node.js + Express, Socket.IO (rooms: one per match), `pg` (PostgreSQL), `redis` + `@socket.io/redis-adapter`, `jsonwebtoken`, `bcryptjs`.
- Frontend: two plain HTML pages, no framework: `public/index.html` (students) and `public/scorer.html` (scorers).
- Database: PostgreSQL 16. Cache and pub/sub: Redis 7.
- Deploy: Docker Compose on one AWS EC2 server (Ubuntu 24.04, region ap-south-1 Mumbai, Elastic IP, 20 GiB gp3). Caddy is the web server.
- No domain yet. Caddyfile is `:80 { encode gzip  reverse_proxy app:3000 }` = plain HTTP only (test setup). HTTPS is still to do.

## 4. Folder layout
```
server.js            main server (login, sockets, score actions, API)
db.js                Postgres pool (needs DATABASE_URL)
engine.js            table tennis rules + effectivePoints() (undo handling)
engines/index.js     registry: getEngine(sport)  ->  table_tennis | simple | cricket
engines/tableTennis.js, simple.js, cricket.js
migrate.js           applies migrations/*.sql in order, records them in schema_migrations
migrations/001_init.sql, 002_add_sport.sql, 003_cricket.sql
seed.js              creates demo users and 2 table tennis matches (DEMO passwords: do not use on the real server)
add-user.js          node add-user.js <name> <admin|scorer> <password 10+ chars>   (create or reset)
add-match.js         node add-match.js --id .. --name ".." --sport cricket|simple|table_tennis [--overs --players --first --freehit --bestof --scorer]
test.js              unit tests (all rules, a 400-game random cricket test)
loadtest.js          load test (viewers); scorer login from SCORER_USER / SCORER_PASS
scripts/backup.sh, restore.sh, snapshot.sh
Dockerfile, docker-compose.yml, Caddyfile, .dockerignore, .env.example, DEPLOY.md
```

## 5. How scoring works (the core idea)
- Event sourcing: every action is a row in `events` and is never deleted. The score is computed from the events.
- UNDO is an event too (`type='undo'`). `effectivePoints(events)` replays the log and lets each undo cancel the latest event.
- A match has a `sport`. `getEngine(sport)` returns an engine with:
  `compute(events, match) -> state`, `validate(action, state) -> error text or null`, optional `clean(action) -> data to store`.
- Action flow (`score:action` socket event, with an ack callback):
  1. check input shape; 2. `canScore` asks the DATABASE (role, active, assignment); 3. open a transaction and lock the match row (`FOR UPDATE`);
  4. same action id already stored? -> answer ok, do not apply twice; 5. `undo` allowed if something to undo, else `engine.validate`;
  6. INSERT the event; 7. COMMIT; 8. write the new state to Redis; 9. `io.to(matchId).emit("score:update", state)`; 10. ack to the scorer.
- State has a `version` (= seq of the last event). Pages ignore older versions.
- Redis key `state:<matchId>` (TTL 60 s) is written with a Lua "set only if newer version" script. Students read the cache, not the database.
  Redis down -> server falls back to the database. The Redis adapter lets several servers share rooms.
- The scorer page keeps a queue in localStorage and sends each action with a unique id and an ack; it retries on timeout and drops it only if the server refuses it.
  Known gap: the scorer's own screen does not update while offline.
- Auth: `POST /login` -> JWT (12 h) with only the username. Socket handshake sends the token; students have none. Roles: admin, scorer, student.
  `users.active=false` cuts a lost phone off immediately (checked on every action).
- Other routes: `GET /api/matches` (cached 10 s), `GET /health`.

## 6. Actions and state per sport
- table_tennis (settings: matches.best_of): actions `point{team A|B}`, `undo`. State: pointsA/B, gamesA/B, finishedGames, winner, status.
  Rules: game to 11, win by 2, best of 3 (or 5, 7).
- simple (any other sport): actions `point{team, value 1-10}`, `finish`, `undo`. State: scoreA, scoreB, status, winner (A, B or "draw").
- cricket (settings in matches.config: overs 1-50, players 2-11, firstBatting A|B, freeHit true|false):
  actions `ball{data:{runs 0-6, extra null|wide|noball|bye|legbye, wicket null|{kind}}}`, `end_innings`, `finish` (abandon), `undo`.
  Wide: runs = EXTRA runs (+1 penalty added by the engine). No ball: runs = bat runs (+1 penalty), next ball is a free hit (only run out).
  Bye/legbye: runs >= 1, legal ball. Wicket kinds: bowled, caught, lbw, stumped, runout, hitwicket. Max wickets = players - 1.
  Innings ends: all out, overs complete, target reached, or scorer ends it. Result text: "Team B won by 3 wickets", "... by 5 runs", tie, abandoned.
  NOT supported: player names/stats, super over, rain/DLS, penalty runs, retired batters, byes off a no ball, over-limits per bowler. Team names are "Team A/B".
- State of every sport also has: sport, matchId, name, version, status ("live"|"finished"), winner.

## 7. Database (PostgreSQL, database `livescore`, user `livescore`)
- users(username PK, password_hash, role admin|scorer, active)
- matches(id PK, name, best_of, sport, config jsonb)
- match_scorers(username, match_id)  PK(both)
- events(seq bigserial PK, id unique, match_id, type, team, value, data jsonb, by_user, created_at)
  type in: point, undo, finish, ball, end_innings
- schema_migrations(name PK, applied_at)
Rules: NEVER edit a migration that was already applied. Add a new numbered file (004_...sql). Write migrations so they can run twice (IF NOT EXISTS).

## 8. Environment and secrets
- Server `.env` (never in Git): DOMAIN (empty for now), DB_PASSWORD, JWT_SECRET. docker-compose builds DATABASE_URL from DB_PASSWORD.
  Do not change DB_PASSWORD on a running database (Postgres keeps the old one in its volume).
- Laptop `.env`: DATABASE_URL, REDIS_URL, (JWT_SECRET). Different values from the server.
- Secrets live in my private notes, not in Git, not in chat.

## 9. Run, test, deploy
Laptop (PowerShell, in the project folder; start Docker Desktop, then `docker start redis`; Postgres runs as a Windows service):
```
node test.js                 # must print: All tests passed
node migrate.js              # applies new migrations to the LOCAL database
node server.js               # http://localhost:3000   and  /scorer.html
```
Deploy (Ubuntu server, in ~/dreamcometrue), always in this order:
```
./scripts/backup.sh
git pull
docker compose up -d --build
docker compose run --rm app node migrate.js     # must print "applied ..." for new files
docker compose exec redis redis-cli FLUSHALL
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/matches     # must print 200
```
Create data on the SERVER too (it is a different database): `docker compose run --rm app node add-match.js ...` and `add-user.js ...`.
Status report to paste into a new chat: `./scripts/snapshot.sh` (prints no secrets).
More in DEPLOY.md. Never run `docker compose down -v` (deletes the database).

## 10. Mistakes we already made (do not repeat)
1. `.env` was committed to Git, then `git pull` overwrote the server's real `.env`. Check: `git check-ignore -v .env` must print a rule.
2. `.gitignore` had 3 leading spaces on every line (copied from chat), so nothing was ignored. Download files, do not copy code from chat.
3. `*.sql` in `.gitignore` blocked the migration files from GitHub.
4. `migrate.js` looked for .sql files in the wrong folder and said "up to date" without applying anything. It must use `path.join(__dirname, "migrations")`.
5. New code was deployed before the database migration ran, so every request crashed (missing column `sport`).
6. Matches created with SQL on the laptop did not exist on the server (separate databases).
7. Placeholder passwords from instructions (like CHOOSE-A-PASSWORD1) were used as real passwords. Set real ones.
8. The image must be rebuilt (`up -d --build`) before `migrate.js` runs, or new files are missing inside the container.

## 11. Status
Done: Lessons 1-10: Socket.IO rooms, event scoring, scorer queue with retry, login/roles, PostgreSQL, Redis cache + adapter + load test,
AWS EC2 deploy (Docker, Caddy, HTTP only), backups/runbook, multi-sport (simple + table tennis), cricket engine and cricket scorer screen.
Load test on AWS (500 viewers): median about 70-80 ms; one round had a worst case of about 2.5 s (not explained yet).
To do next: Lesson 11 admin panel (create matches/scorers from a web page), real team names, student home page (schedule, points table);
football engine; HTTPS + login rate limiting + hardening; full mock event with real scorers on real phones; rehearse a restore.
Known gaps: HTTP only; demo/placeholder passwords must be replaced; no admin UI (matches are created by script); single server (single point of failure);
backups are manual (hourly cron not confirmed); cricket limits in section 6; scorer screen does not update while offline.