# CODEMAP: College Live Score

Written by reading the code (not by trusting PROJECT_CONTEXT). Every claim has `file:line`, or says `UNSURE:`.
Line numbers are from the files as they were on 2026-11-10 and will drift when code changes.

## 1. Files, one line each

### Server (repo root)
- `server.js` (477 lines): the whole app wiring: Express, Socket.IO, Redis cache, login, scorer action, public API routes. Starts at `server.js:471`.
- `admin.js`: router for `/api/admin/*` (create/edit/delete matches, create/reset/disable scorers). Mounted at `server.js:303`.
- `home.js`: builds `/api/home` and `/api/standings`; 3 s cache, gzip and ETag made once per rebuild (`home.js:8-15,86-93`).
- `standings.js`: pure points-table logic. Win 2, draw 1, loss 0 (`standings.js:9`).
- `engine.js`: table tennis rules `computeTableTennis` (`:2`) and `effectivePoints` for undo (`:39`).
- `engines/index.js`: `getEngine(sport)` registry for `table_tennis`, `simple`, `cricket` (`:2-12`).
- `engines/tableTennis.js`, `engines/simple.js`, `engines/cricket.js`: each exports `compute, validate, result, headline`; cricket also has `clean, checkConfig, normalizeConfig, parseBall`.
- `rateLimit.js`: `FailureLimiter` (sliding window, in memory) used for login limits (`server.js:227-228`).
- `db.js`: Postgres pool. Exits if `DATABASE_URL` is missing (`db.js:3-6`).
- `migrate.js`: runs `migrations/*.sql` in name order, one transaction each, records in `schema_migrations` (`migrate.js:14-36`).
- `migrations/001..004`: schema history (see section 4).
- `seed.js`: creates its own copy of the 001 schema and demo users (`seed.js:4`). `UNSURE:` what else it does after line 25 (not read).
- `add-user.js`: `node add-user.js <name> <admin|scorer> <password 10+ chars>`; create or reset (`add-user.js:1-2,7`).
- `add-match.js`: CLI to create a match (usage at `add-match.js:3-9`).
- `check-passwords.js`: lists accounts that use a known weak password (`check-passwords.js:1-2`).

### Pages (`public/`, served by `express.static` at `server.js:28`)
- `index.html`: student home. Tabs Live / Schedule / Results / Points. Polls `/api/home` every 10 s (`index.html:186-213`).
- `match.html`: one live match through a socket (`match.html:54-122`), plus `/api/match/:id` for venue/time (`:125`).
- `scorer.html`: scorer login, match picker, buttons for 3 sports, offline queue (`scorer.html:112-203`).
- `admin.html`: admin panel; calls `/login` (`:178`) and `/api/admin` (`:162`). `UNSURE:` internal details (only grepped).

### Deploy
- `Dockerfile`: node:22-alpine, `npm ci --omit=dev`, `node server.js` (`Dockerfile:1-11`).
- `docker-compose.yml`: 4 services `app`, `db` (postgres:16), `redis` (7), `caddy` (2); volumes `pgdata`, `caddy_data`, `caddy_config`.
- `Caddyfile`: site address `{$DOMAIN}`, gzip, security headers, `reverse_proxy app:3000` (`Caddyfile:15-26`).
- `.dockerignore`: leaves out `node_modules, .git, .env, *.log, loadtest.js, test.js`.
- `scripts/`: `backup.sh`, `restore.sh` (asks "yes", replaces all data), `snapshot.sh`, `install-cron.sh`, `security-check.sh`, `watch-load.sh`, `add-swap.sh`.

### Tests and load tests
- `test.js` (494 lines): unit tests, all pure logic. Prints `All tests passed` (`test.js:494`).
- `engines/test.js`: a stray copy of `test.js` that fails when run (see section 6).
- `loadtest.js`, `loadtest-real.js`, `loadtest-real-diag.js`, `loadtest-real-fixed.js`: load simulators. Do not run against production.

### Docs
- `PROJECT_CONTEXT.md`, `DEPLOY.md`, `LESSON_13.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/LESSONS.md`, `docs/ROADMAP.md`. `UNSURE:` the `docs/` files and `CONTRIBUTING.md` were only skimmed (first lines).

## 2. The three flows

### a) A viewer opens the home page and sees a live match
1. Browser loads `public/index.html`. `refresh()` runs at once and then every 10 s while the tab is visible (`index.html:213-215`). It fetches `/api/home` (`:188`).
2. `GET /api/home` (`server.js:317`) -> `home.get()` (`home.js:86`). Returns the cached promise if younger than 3 s; otherwise `build()` (`home.js:21`).
3. `build()` reads up to 500 matches and an `EXISTS` flag "has any events" (`home.js:22-28`). For each started match it calls `getState(id)` (`home.js:46`) and the engine's `result` and `headline` (`:48-49`).
4. `getState` (`server.js:93`): Redis `state:<id>` first; if missing or Redis fails, one shared Postgres load (`loadStateFromDb` `:73`) which then writes Redis (`cacheState` `:80`, only if newer, Lua script `:44-52`).
5. `buildState` (`server.js:59`) = `effectivePoints(events)` (undo applied) -> `engine.compute` -> adds names and `version` (= last event `seq`).
6. `sendPacket` (`server.js:307`) sends the ready gzip copy, or 304 if the ETag matches.
7. A match is "live" if it has any event row, "finished" if the engine says so (`home.js:43-52`).
8. Student taps a card -> `match.html?id=...`. Socket connects, emits `join-match` (`match.html:59-60`). Server (`server.js:423-436`) leaves old rooms, joins the room, sends `score:update` with the state. Later updates arrive from the scorer flow. Older versions are ignored (`match.html:96`).

### b) A scorer taps "+1" (undo, bad network)
1. Login: `POST /login` (`server.js:230`). Limits: 5 wrong per address+username, 40 per address, 10 minute block (`:227-228`). Success returns a JWT (12 h) and the match list (`:256-257`). Saved in localStorage (`scorer.html:131`).
2. Tap -> `act(type, team, value, data)` (`scorer.html:179`): puts `{id, matchId, type, team, value, data}` in the queue (localStorage `scorer-queue`), then `flush()`. `id` is `newId()` (`:177`).
3. `flush()` (`:190`) sends only `queue[0]` with a 5 s timeout, one at a time.
4. Server `score:action` (`server.js:438`): checks shape and `data` size <= 500 chars (`:442-449`), then `canScore` (`:111`, reads role/active/assignment from Postgres every time).
5. `applyAction` (`server.js:127`): BEGIN, lock match row `FOR UPDATE` (`:135`), load events, build state, **duplicate id check** (`:147`: answers `ok, duplicate`), then undo check or `engine.validate`, INSERT event (`:164`), rebuild state, COMMIT.
6. Back in the handler: `cacheState` (Redis), then `io.to(matchId).emit("score:update")` unless duplicate (`:457-461`), then `ack(result)`.
7. **Undo** = `act('undo')` -> an event with `type='undo'`. Allowed only if `effectivePoints(events)` is not empty (`server.js:153-154`). `effectivePoints` pops the latest counted event (`engine.js:39-46`). Undo can be undone? No: an undo only removes the latest non-undo event; there is no redo.
8. **Bad network:**
   - No ack in 5 s, or `retry:true` -> `setTimeout(flush, 2000)`, the item stays at the front (`scorer.html:197`).
   - Server crash/DB error -> `{ok:false, retry:true}` (`server.js:176`), so the phone retries.
   - Retry after a lost ack is safe: same `id` -> duplicate is answered ok (`server.js:147-151`).
   - Refused action (`ok:false` without retry) -> removed from queue and "Rejected: ..." shown (`scorer.html:198-199`).
   - On reconnect, `connect` handler calls `join()` and `flush()` (`scorer.html:405`).
   - Offline, the scorer's own screen does not change (it only changes on `score:update`) (`scorer.html:414-419`).
   - Queue survives a page reload (localStorage, `scorer.html:113`).
9. `UNSURE:` what happens if the DB is down for a long time and the phone keeps retrying forever (no cap seen in `flush`).

### c) The server restarts, or Redis is empty
- **Server restart:** all state is rebuilt from Postgres `events` on the first read; nothing is preloaded (`server.js:471-476` only connects Redis and listens). In-memory things reset: login counters (`rateLimit.js`), `matchMetaCache`, `matchListCache`, `inflight`, home cache.
- **Redis empty / flushed:** first `getState` finds nothing and loads from Postgres once (merged by `inflight`, `server.js:101-107`), then re-fills Redis. Keys also expire after 60 s (`:41`).
- **Redis down:** reads fall back to Postgres (`:97-99`); writes only log "cache write failed" (`:87`). The Redis client is created with `disableOfflineQueue` so it fails fast (`:33`). The Socket.IO adapter clients are separate (`:34-35`). `UNSURE:` how Socket.IO behaves while `pubClient`/`subClient` are down.
- **Connected browsers after a restart:** the socket drops; `match.html` shows "Reconnecting..." (`match.html:61`); on `connect` it re-joins and gets a fresh state (`:60`).
- **At startup:** if Redis cannot connect, the process exits (`server.js:476`). If Postgres is down at start, `db.js` does not check it; first query fails. `UNSURE:` whether `app` waits for Postgres in docker (compose uses only `depends_on` without health check, `docker-compose.yml:11-13`).
- After a deploy, PROJECT_CONTEXT says to run `redis-cli FLUSHALL` (`PROJECT_CONTEXT.md:128`).

## 3. Other routes (all in `server.js` unless noted)
- Public: `GET /api/home` (317), `/api/standings` (327), `/api/match/:id` (338, 10 s cache, id must match `^[a-z0-9-]{1,40}$`), `/api/matches` (266, old), `/health` (280).
- Scorer/admin: `GET /api/my-matches` (369). Admin only: `/api/admin/*` (`admin.js`; checks the DB on every request, `server.js:183-211`).
- Socket events: `join-match` (423), `score:action` (438). Server -> client: `score:update`.
- Socket auth: no token = student; bad token = error `invalid token` (`server.js:388-409`).

## 4. Data model (PostgreSQL, from `migrations/`)
- `users(username PK, password_hash, role admin|scorer, active)` (001)
- `matches(id PK, name, best_of, sport, config jsonb, team_a, team_b, competition, stage group|knockout, venue, start_time, created_at)` (001 + 002 + 003 + 004)
- `match_scorers(username, match_id)` PK both, both foreign keys (001)
- `events(seq bigserial PK, id text UNIQUE, match_id FK, type, team A|B, value int, data jsonb, by_user, created_at)`; type in `point, undo, finish, ball, end_innings` (001 + 002 + 003). Index `(match_id, seq)`.
- `schema_migrations(name PK, applied_at)` (created by `migrate.js:7`)
- Redis: key `state:<matchId>`, TTL 60 s, JSON of the state (`server.js:80-85`).
- Rule from the code: a delete of a match deletes its events (`admin.js:271-273`). So "events are never deleted" holds only for normal scoring.

## 5. Commands to run locally (Windows PowerShell, in the project folder)
Needs: Node, PostgreSQL, Redis (PROJECT_CONTEXT says Redis runs in Docker: `docker start redis`; Postgres as a Windows service).
```
node test.js                 # no DB or Redis needed. Last result on 2026-11-10: All tests passed
node migrate.js              # needs DATABASE_URL in .env (db.js:3)
node --env-file=.env server.js    # same as: npm start (package.json:8). Listens on http://localhost:3000
node add-user.js <name> <admin|scorer> <password-10+-chars>
node add-match.js --id .. --name ".." --sport cricket|simple|table_tennis
```
`.env` needs `DATABASE_URL` and `REDIS_URL` (names seen locally; values not read). `JWT_SECRET` is optional locally and falls back to `"dev-only-change-me"` (`server.js:16`). Plain `node server.js` does NOT load `.env` (`server.js` has no `dotenv` call; `UNSURE:` whether something else loads it), so use `npm start`.

Server (Ubuntu, `~/dreamcometrue`): see `DEPLOY.md` and `PROJECT_CONTEXT.md:122-133`. Never `docker compose down -v`.

## 7. Decisions and fixes for Phase 2

Audit date: 2026-11-10. Read-only review; nothing has been applied.

| # | Question | Answer | Risk | Proposed fix | Who does it |
|---|---|---|---|---|---|
| Q1 | JWT_SECRET guaranteed? | No — falls back to `"dev-only-change-me"`; no startup guard | **High** | Add a startup guard in `server.js:16` — if `NODE_ENV=production` and secret is missing/default/< 32 chars, call `process.exit(1)` | You (edit `server.js`) |
| Q2 | `engines/test.js` a mistake? | Yes — stray copy, 29 lines missing (FailureLimiter tests), broken `require` paths | Low | `git rm engines/test.js && git commit` | You (run git commands) |
| Q3 | Scorer retrying forever OK? | Duplicate-id check prevents double-counting; no backoff or queue cap is a gap; DB `connectionTimeoutMillis` is unset (waits forever) | Medium | Exponential backoff + queue-size cap in `scorer.html:197`; set `connectionTimeoutMillis: 5000` in `db.js:8` | You (edit client + db.js) |
| Q4 | App starts before Postgres? | Yes — `depends_on` has no healthcheck; Postgres may not be ready within seconds of reboot | Medium | Add `healthcheck` to `db` service (pg_isready -U livescore -d livescore); add `condition: service_healthy` to `app.depends_on` in `docker-compose.yml` | You (edit `docker-compose.yml`) |
| Q5 | FLUSHALL needed every deploy? | No — only after state-shape/engine-logic changes or a DB restore; harmless 60 s TTL handles normal deploys | Low | Use targeted `--scan --pattern "state:*"` delete; remove FLUSHALL from routine deploy script in `PROJECT_CONTEXT.md:128` | You (edit `PROJECT_CONTEXT`) |
| E1 | Migration order correct? | `DEPLOY.md` Section B is wrong (migrate before build); `docs/LESSONS.md` #5 and `PROJECT_CONTEXT.md:126` are correct (build then migrate; migrations are COPIED into the image by `Dockerfile:8`) | Medium | Fix `DEPLOY.md:39-41` to match: `git pull → up -d --build → node migrate.js` | You (edit `DEPLOY.md`) |
| E2 | Node version mismatch? | Docker uses Node 22; laptop runs v26.5.1; no `"engines"` field in `package.json` | Low | Add `"engines": {"node": ">=22"}` to `package.json` | You |
| E3 | `.env.example` missing? | File referenced by `DEPLOY.md:21` but absent from the repo | Low | Create `.env.example` (content in audit report); never commit with real secrets | You |

---

## 6. Mismatches found (details also in the chat report)
See section "Where PROJECT_CONTEXT and the code disagree" in the session report. Short list:
1. File is named `PROJECT_CONTEXT (5).md`; `CLAUDE.md:2` and the request name `PROJECT_CONTEXT.md`. (Renamed to `PROJECT_CONTEXT.md` with `git mv`; this item is now fixed.)
2. `.env.example` and `LESSON_12.md` are listed/referenced but missing from the working tree.
3. Deploy order differs: `DEPLOY.md:39-41` vs `PROJECT_CONTEXT.md:125-128`.
4. Folder list omits `docs/`, `CONTRIBUTING.md`, `CLAUDE.md`, `engines/test.js`, `loadtest-real-diag.js`, `loadtest-real-fixed.js`.
5. `engines/test.js` cannot run (`Cannot find module './engine'`).
6. `"test"` script in `package.json:7` is a placeholder; real command is `node test.js`.

---

## 7. Answers from Param (2026-11-10)
These are decisions, not code changes. Nothing below has been done yet.
1. `LESSON_12.md` and the old `PROJECT_CONTEXT` copies were deleted on purpose. `PROJECT_CONTEXT (5).md` is the official context file. It was renamed to `PROJECT_CONTEXT.md`, so `CLAUDE.md:2` is now correct.
2. Deploy order: follow the context file (build, then migrate). `DEPLOY.md:39-41` is wrong.
3. No guard for a missing `JWT_SECRET` in production (`server.js:16` falls back to a default). Known gap.
4. `engines/test.js` is a mistake and can be deleted.
5. `loadtest-real-fixed.js` is the current load test.
6. Scorer retry: duplicate-id check prevents double counting, but long DB outages still have gaps (no backoff or queue cap seen in `scorer.html:197`).
7. After a full reboot the app can crash-loop before Postgres is ready (no healthcheck, `docker-compose.yml:11-13`).
8. Team names for the points table come from the admin only.
9. `FLUSHALL` after deploy is a habit, not a need, and it carries a small risk during live events.
10. When docs disagree, trust `PROJECT_CONTEXT.md`.
