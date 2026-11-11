# Changelog: what changed, why, and how to undo it

Newest first. One entry per change: code (with its commit) AND changes made by hand on the server or in AWS.
Rule (also in `CLAUDE.md`): after every change, add an entry here. Never write secrets here
(no passwords, no keys, no ping URLs, no bucket name: this repo is public).
Older history (before 2026-11-10): `git log 84620c3`.

Each entry: **What** / **Why** / **Checked** / **Undo**.

---

## 2026-11-11 - Scorer page uses the new queue (step 2, part B)
- **What:** `public/scorer.html` now uses `public/queue.js`. The scorer sees: "N entries waiting to be sent"; after 30 s "Oldest: 45 s. Server is slow, trying again in 8 s." (yellow); after 2 min "NOT sent for 2 min. Check your signal. Do not close this page." (red); "50+ entries waiting. Please check the network."; at 500 "Not sent: 500 entries are already waiting." A red box lists entries that were NOT counted until the scorer taps "OK, I saw it". A stuck entry shows "Skip this entry" (asks first; the skipped entry is listed). Another scorer's entries are kept for them, with "Send them as me" / "Discard" (asks first; listed). Log out warns when entries are waiting. Works (with a warning) when phone storage is blocked. A tap no longer skips the waiting time after a failure; reconnecting sends at once. New `test-scorer-page.js` (run by `node test.js`) runs the real page script with a fake page, socket and clock.
- **Why:** see part A; this makes the fixes visible to the scorer.
- **Checked:** `node test.js` on Node 26 and 22.23: All tests passed; 8 page scenarios (backoff and same id, rejected list, stuck + skip, offline texts and reconnect, reload, other scorer + log out warning, 500 limit, blocked storage); a deliberately broken copy of the page made the tests fail. Browser test on the laptop (Chrome, private test copy in Docker, server stopped/started to simulate a dead network): all 6 parts passed (normal scoring, offline texts at 30 s and 2 min, reload, reject box, log-out warning, other scorer + "Send them as me", phone-size view); the test database had every tap exactly once (0 duplicate ids). Real phone: still to do after deploy.
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d`. Unsent entries survive (same `scorer-queue` key and shape); the old page ignores `scorer-rejected`.

## 2026-11-11 - Scorer queue logic as its own tested file (step 2, part A; not used by the page yet)
- **What:** new `public/queue.js` (`createQueue`): same id on every retry; waits 2, 4, 8, 16, 30 s between tries; only a clear `ok:false` stops an entry and moves it to a "rejected" list kept until the scorer confirms; an unclear answer is retried, never treated as success; warn at 50 waiting, refuse new taps at 500, never drop entries; 20 server "retry" answers = "stuck" (the scorer may skip it, and it is listed); entries remember their scorer; works in memory when phone storage is blocked. Same storage key and item shape as the old page (`scorer-queue`), so a rollback keeps unsent entries. Tests in `test.js`.
- **Why:** today a rejected entry is lost after a message the next tap wipes; one failing entry blocks all others forever; another scorer's old entries are sent under the new login; fixed 2 s retries forever.
- **Checked:** `node test.js`: All tests passed (new section covers every rule above, reload, old-page entries, limits, blocked storage).
- **Undo:** `git revert <this commit>` (nothing uses the file yet).

## 2026-11-11 - Deployed `/ready` and set up UptimeRobot (by hand)
- **What:** server: normal deploy of `db6f4c1` (only the app restarted; db and redis kept running). UptimeRobot: HTTP(s) monitor on `https://<server>/ready`, every 5 minutes, email alerts. A temporary monitor on a missing page was used to test the alert, then deleted.
- **Why:** to get an email when the site, its database or Redis stops answering.
- **Checked:** `/ready` on the server -> `{"ok":true,"failed":[]}`; `security-check.sh` 27 passed, 0 warnings, 0 failed; UptimeRobot monitor Up; the test DOWN email arrived.
- **When stopping the server on purpose:** pause the UptimeRobot monitor and the healthchecks.io check first.
- **Undo:** delete or pause the monitor on uptimerobot.com.

## 2026-11-11 - `/ready` page for the uptime monitor (step 3c)
- **What:** new `ready.js` and `GET /ready` in `server.js`: 200 `{"ok":true,"failed":[]}` when Postgres AND Redis answer within 2 s, otherwise 503 with the failed part (`db` / `redis`). Checks run at most once per 2 s. `security-check.sh` fails if `/ready` is not 200. The deploy check in `DEPLOY.md` and `CONTRIBUTING.md` now uses `/ready` (the old `curl http://localhost/health` only got Caddy's HTTPS redirect). New guide `docs/MONITORING.md` (UptimeRobot). `test.js` now waits for async tests before printing `All tests passed`.
- **Why:** `/health` says "ok" even when the database or Redis is down; nobody was told when the site broke.
- **Checked:** unit tests (all up, one or both failing, a check that throws, a check that never answers -> failed after the limit, 2 s cache). Real app in Docker: all up 200; Redis stopped 503 `["redis"]`; back 200; Postgres stopped 503 `["db"]`; back 200; app never restarted; `/health` 200 throughout.
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d` (only the app restarts).

## 2026-11-11 - Deployed step 1e on the server (by hand)
- **What:** `git pull`, `docker compose build`, `migrate.js` (nothing new), `up -d`. Postgres and Redis were recreated once (about 11 s).
- **Checked:** `docker compose ps`: db and redis `(healthy)`, app started only after them; app log `http://localhost:3000`; `security-check.sh`: 26 passed, 0 warnings, 0 failed.
- **Undo:** see commit `c66d73c` below.

## 2026-11-11 - `c66d73c` A Postgres restart no longer crashes the app; health checks
- **What:** `db.js`: `pool.on("error")` logs a lost connection; `connectionTimeoutMillis: 5000`. `docker-compose.yml`: health checks for `db` (`pg_isready` over TCP) and `redis` (`PING`); the app starts only when both are healthy. `docs/ARCHITECTURE.md`: table "When the database or Redis fails". New test in `test.js`.
- **Why:** proven on the laptop: when Postgres restarted, the process died (`Unhandled 'error' event`), so every viewer and scorer was disconnected. A hung database made requests wait forever. After a reboot the app could start before Redis/Postgres were ready.
- **Checked:** laptop: crash reproduced before the fix, no crash after; paused Postgres -> query fails after 5.0 s; real app in Docker survived a Postgres restart (same process, `/api/home` 200 throughout); start order db -> redis -> app. CI green.
- **Undo:** `git revert c66d73c`, then `docker compose build` and `docker compose up -d` (restarts db/redis once; data is safe in the `pgdata` volume).

## 2026-11-11 - `86798f6` CI on GitHub
- **What:** `.github/workflows/test.yml`: on every push and pull request, GitHub runs `npm ci`, `node test.js` and a syntax check of `scripts/*.sh` on Node 22.23 (same as the Dockerfile).
- **Why:** tests ran only when remembered, only on the laptop (Node 26, not the server's 22).
- **Checked:** same steps in a clean copy of the repo; first GitHub run green.
- **Rule from now on:** deploy only a commit with a green check on GitHub.
- **Undo:** delete the file and push.

## 2026-11-11 - S3 copy and heartbeat alert set up (by hand, AWS console + healthchecks.io + server)
- **What:**
  - S3 bucket `dreamcometrue-backups-...` (name in private notes), region ap-south-1, public access blocked, versioning on, lifecycle rule `delete-after-30-days` on `backups/`.
  - IAM role `livescore-backup-role` attached to the EC2 instance, inline policy `upload-backups-only` (only `s3:PutObject` on `backups/*`; listing/reading is denied on purpose).
  - healthchecks.io check `livescore-backup` (period 1 h, grace 1 h, email alerts).
  - Server file `~/.livescore-backup` (chmod 600, not in Git) with the bucket, region and ping URL.
- **Why:** backups were only on the same server, and nobody noticed when they stopped.
- **Checked:** upload works and listing is denied; `backup.sh` prints "Copied to s3://..."; DOWN and UP emails received; `security-check.sh` 26/0/0; restore drill PASS (users 47, matches 7, events 63, migrations 4).
- **When stopping the server on purpose:** press **Pause** on the healthchecks.io check (it resumes by itself with the next backup).
- **Undo:** remove the two `BACKUP_S3_*` lines (or the ping line) from `~/.livescore-backup`; the bucket and role can stay.

## 2026-11-10 - Server crontab cleaned up (by hand)
- **What:** removed an old hourly line that ran `pg_dump | gzip` directly (no checks, overwrote the same file each hour). Then `./scripts/install-cron.sh` installed the new backup and prune lines.
- **Why:** that old line was the likely source of the empty (0-byte) backups (lesson 10).
- **Checked:** `crontab -l | grep -v '^#'` shows exactly the `livescore-backup` and `livescore-prune` lines.
- **Undo:** not needed.

## 2026-11-10 - `ff5e215` Backups that can be trusted
- **What:** new `scripts/check-backup.sh` (complete-dump check), `scripts/prune-backups.sh` (delete after 7 days, always keep the newest 3 complete ones), `scripts/restore-drill.sh` (restore into a scratch database). `backup.sh` keeps a file only if it is complete, can copy to S3 and ping a heartbeat. `restore.sh` checks the file before dropping the database. `security-check.sh` checks the newest backup. `docs/BACKUPS.md` guide. `.gitattributes`: `.sh` files always LF.
- **Why:** an empty backup could look fine; the old prune could delete every backup; `restore.sh` dropped the database before reading the file; the restore drill was never written.
- **Checked:** laptop (throwaway Postgres): good backup kept; stopped database -> no file, exit 1, `/fail` ping; 4 kinds of broken files rejected; fake S3 success and failure; restore refuses a broken file; drill PASS; prune keeps 3 good ones even when all are old.
- **Undo:** `git revert ff5e215`, then run `./scripts/install-cron.sh` again.

## 2026-11-10 - `219d7d5` All scripts executable in Git
- **What:** 4 scripts were stored as not executable; the server had `chmod +x` on them, so `git status` always showed them changed.
- **Undo:** not needed.

## 2026-11-10 - `c1b1639` App refuses to start with a weak JWT secret (production only)
- **What:** new `config.js` (`checkJwtSecret`); `server.js` exits with a clear message when `NODE_ENV=production` (set by the Dockerfile) and `JWT_SECRET` is missing, the public default, or under 32 characters. Laptop: warning only. Tests in `test.js`.
- **Why:** the app silently used the public default `dev-only-change-me`; with it anyone could make an admin login token.
- **Checked:** server secret confirmed 64 characters BEFORE deploying; laptop: 5 cases (missing, default, 31 chars -> refused; 64 -> starts; laptop -> warning).
- **Undo:** `git revert c1b1639`, `docker compose build`, `docker compose up -d`.

## 2026-11-10 - `6614d19` `.env.example`, Node 22.23 pinned, tighter `.dockerignore`
- **What:** `.env.example` lists every setting (placeholders only). Dockerfile `node:22.23-alpine`, `package.json` engines `22.x`, `.nvmrc`. `.dockerignore` keeps keys, backups, docs and tool folders out of the image.
- **Why:** `.env.example` was missing; the Node version could change without notice; tool folders were copied into the production image.
- **Checked:** `node test.js` on Node 26 and 22.23; image built locally: no `.env`, docs or tool folders, migrations present.
- **Undo:** `git revert 6614d19`, `docker compose build`, `docker compose up -d`.

## 2026-11-10 - `40b0c40` One deploy order in every document
- **What:** `DEPLOY.md`, `CONTRIBUTING.md`, `PROJECT_CONTEXT.md` and `docs/LESSONS.md` now all say: backup, `git pull`, `docker compose build`, `migrate.js`, `up -d`. Removed `seed.js` from the server setup (it creates demo passwords).
- **Why:** `PROJECT_CONTEXT.md` said `up -d --build` before the migration: that starts new code on the old database (lesson 5).
- **Undo:** `git revert 40b0c40`.
