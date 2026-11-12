# Changelog: what changed, why, and how to undo it

Newest first. One entry per change: code (with its commit) AND changes made by hand on the server or in AWS.
Rule (also in `CLAUDE.md`): after every change, add an entry here. Never write secrets here
(no passwords, no keys, no ping URLs, no bucket name: this repo is public).
Older history (before 2026-11-10): `git log 84620c3`.

Each entry: **What** / **Why** / **Checked** / **Undo**.

---

## 2026-11-12 - Test for the inner safety net of `applyAction`
- **What:** new case 8 in `test-integration.js`. In the TEST database only, a temporary trigger refuses to save one action, so the error happens in the middle of `applyAction` (the INSERT), after login, permission check and match read. Checks: the phone gets `{ok:false, error:"server error", retry:true}`; the server log says `applyAction failed:` (the inner net answered, not the outer one); a retry with the same id gets the same answer and nothing is saved (a "stuck" entry); Postgres shows no server connection left inside the failed transaction; 12 more actions on the same match work; after the trigger is removed, the same id saves normally. The trigger is always removed (`finally`). No server code changed.
- **Why:** the outage test (case 6) fails earlier, in the permission check, so this branch (`server.js` applyAction `catch`: ROLLBACK + `retry:true`) had never run in a test.
- **Checked:** 3 clean runs in a row passed; Node 22.23: passed; `node test.js`: All tests passed. 3 deliberate breaks of `server.js`, each failed case 8: answer without `retry`; no inner net (error goes to the outer one); `ROLLBACK` removed. The last one was first NOT caught (a retry happened to reuse the broken connection and the pool threw it away, so later actions worked by luck); the direct Postgres check was added and then caught it. `server.js` restored with `git checkout` each time.
- **Undo:** `git revert <this commit>` (test file only; nothing to deploy).

## 2026-11-12 - Deployed the security update on the server (by hand)
- **What:** normal deploy of `fa473f9` (only the app restarted). This `git pull` also removed the no-longer-tracked `node_modules` folder from `~/dreamcometrue` (expected; the app uses the one inside its image).
- **Checked:** GitHub run for `fa473f9`: all 3 jobs green. Server: `git log` shows `fa473f9`; inside the app `body-parser 2.4.0, qs 6.17.1`; `/ready` ok; `security-check.sh` 27 passed, 0 warnings, 0 failed; the user logged in on the admin page and the scorer page.
- **Undo:** see the security update entry below.

## 2026-11-12 - Security update: `body-parser` 2.4.0, `qs` 6.17.1 (`npm audit fix`)
- **What:** `package-lock.json` only: `body-parser` 2.3.0 -> 2.4.0 and `qs` 6.16.0 -> 6.17.1 (both used by express 5.2.1, inside its allowed ranges). No code change. `npm audit`: 0 vulnerabilities (was 1 high, 1 moderate).
- **Why:** `body-parser` < 2.4.0 (GHSA-27r3-jxmh-p828, high): after reading a compressed request body it left the decompression stream attached with no error handler; the advisory says one request with junk bytes after the compressed data can crash the process, before login or routing (we use it through `express.json()` for `/login` and the admin API). `qs` <= 6.16.0 (GHSA-6pq8-jhm2-2vcw, moderate): `qs.stringify` with `arrayFormat: 'comma'` can throw; our code never calls it, so low risk, but fixed with the same update.
- **Honest note:** I could not make the crash happen here. 8 kinds of bad compressed bodies (gzip, deflate, brotli; all at once or split) on Node 22.23 and Node 26 with 2.3.0: the server answered 200 or 400 and stayed up. I read the 2.3.0 -> 2.4.0 code change: 2.4.0 now detaches, silences and destroys that stream after reading. Updating anyway because it is the maintainers' patch and a minor version step. A test that passed before the update was dropped, because it proved nothing.
- **Checked:** laptop and Node 22.23 (clean `npm ci` from the new lock): `node test.js` and `test-integration.js` all passed. Production image: `check-image-user.sh` OK; server started; `/ready` 200; `/login` normal 200, broken JSON 400 "bad request", gzip-compressed login 200; no crash lines in the log.
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d`.

## 2026-11-12 - Deployed the `dotenv` removal on the server (by hand)
- **What:** normal deploy of `a2ac227` (only the app restarted).
- **Checked:** GitHub run for `a2ac227`: all 3 jobs green. Server: `git log` shows `a2ac227`; inside the app `require('dotenv')` fails ("dotenv gone"); `/ready` ok; `security-check.sh` 27 passed, 0 warnings, 0 failed.
- **Undo:** see the `dotenv` entry below.

## 2026-11-12 - `node_modules` is no longer stored in Git
- **What:** `git rm -r --cached node_modules`: Git stops tracking the 4124 package files (about 18 MB) that were committed by accident in `a231348` (2026-10-11), before `.gitignore` listed `node_modules`. The files on the laptop are untouched; `.gitignore` keeps the folder out from now on. Old copies stay in Git history (removing them would need a history rewrite and a force push: not done).
- **Why:** `package-lock.json` already fixes every version and `npm ci` recreates the folder; the tracked copy made every package change a diff of thousands of files (the `dotenv` removal deleted ~1250 lines in it), held Windows-only files and old package code in a public Linux repo, and could be used by mistake instead of a clean install. The website never used it: the Docker image excludes it (`.dockerignore`) and installs its own copy with `npm ci`, and no server script runs `node` outside Docker.
- **Server note:** the next `git pull` on the server deletes the `node_modules` folder from `~/dreamcometrue`. That is expected and harmless (the app runs from its image).
- **Checked:** Git tracks 0 files under `node_modules`; the laptop still has all 4124; `git status` does not show the folder (ignored); `node test.js`: All tests passed. A fresh clone of this commit (no `node_modules` at all): production image builds, `check-image-user.sh` OK, server starts, `/ready` ok.
- **Undo:** `git revert <this commit>` (puts the files back under Git; nothing to do on the server).

## 2026-11-12 - Removed the unused `dotenv` package
- **What:** `npm uninstall dotenv`: removed from `package.json` and `package-lock.json` (npm also wrote the existing `engines: 22.x` into the lock file). The `dotenv` files under `node_modules/` that were tracked in Git are deleted too. `docs/CODEMAP.md`: the "UNSURE whether something else loads .env" note now says `npm start` loads it with Node's own `--env-file` and `dotenv` was removed.
- **Why:** no file used it (`npm start` already uses `node --env-file=.env`); unused code in the image and one more package to get security warnings about.
- **Checked:** search of all code, scripts and docs: no `require("dotenv")`, no `-r dotenv`; `npm ls dotenv`: only our own package needed it. Node 22.23 in Docker: clean `npm ci` from the new lock, `dotenv` not installed, `node test.js` and `test-integration.js` all passed. Production image: builds, `check-image-user.sh` OK, `dotenv` not in it, server starts and `/ready` -> ok. Laptop `node test.js`: All tests passed. Not checked: `npm start` itself (unchanged; it never used `dotenv`).
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d`.

## 2026-11-12 - Deployed the score history on the server (by hand)
- **What:** normal deploy of `7603c08` (steps 1-3 of the score history; backup, `git pull`, `build`, `migrate.js`, `up -d`; only the app restarted, db and redis stayed healthy).
- **Checked:** GitHub run for `7603c08`: all 3 jobs green. Server: `/ready` -> `{"ok":true,"failed":[]}`; `security-check.sh` 27 passed, 0 warnings, 0 failed; the user opened History on the live admin page and reported it right, on the laptop and on a phone.
- **Undo:** `git revert 7603c08 9faf4be f2d3611`, `docker compose build`, `docker compose up -d`.

## 2026-11-12 - Admin page: History button per match (history step 3)
- **What:** `public/admin.html`: a **History** button on every match that has scoring actions. It opens a box above the match list: a summary ("7 actions · rahul 6, neha 1 · 1 undone"), then every action newest first: date and time (when the server received it) and who; the action in words (an undone action is struck through with "undone at <time>", an undo says what it cancelled and "action from <time>"); "Score after: ...". Refresh (also updates the counts on the match cards) and Close. Closes itself on log out and when its match is deleted. Text only (`textContent`), no new `innerHTML`.
- **Why:** an admin can answer "what happened in this match, and who pressed it?" on event day without SQL on the server.
- **Checked:** laptop test copy (separate compose project, port 3100) in Chrome with a cricket match (2 scorers, wicket then undo, wide, no ball) and a kabaddi match (undo): every row, undo mark and score after was correct; Refresh showed a newly scored action and the card count followed; Close; no console errors; no errors in the app log. Page script syntax check OK. `node test.js` and `npm run test:integration`: all passed. NOT checked: phone-width view (the browser tool could not resize the window) - look once on a phone after deploy.
- **Limits:** only scoring actions (admin edits, deletes and password resets are not recorded); a deleted match loses its history; the time is when the server received the action, not when the phone was tapped; "who" is the login, so a shared account cannot tell people apart.
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d`.

## 2026-11-12 - Admin API: score history of one match (history step 2; no page button yet)
- **What:** `admin.js`: new read-only `GET /api/admin/matches/:id/history` (admins only, like every `/api/admin` route). Answers `{ match, total, truncated, rows }` built by `audit.js`, newest first; at most the first 3000 actions (`truncated: true` beyond that); `Cache-Control: no-store`. Two plain SELECTs, nothing is written. New case 7 in `test-integration.js`.
- **Why:** step 2 of the score history (the page uses it in step 3).
- **Checked:** `npm run test:integration`: All integration tests passed (case 7: texts, who, undo marked, score after, admin 200 / scorer 403 / no login 401 / unknown and malformed id 404, a 3001-action match -> 3000 rows + `truncated`). 3 deliberate breaks (admin check removed, events read newest first, `truncated` never set) each failed case 7; restored. Speed: a 609-action cricket match builds in 16 ms. `node test.js`: All tests passed.
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d`.

## 2026-11-12 - Score history logic as its own tested file (history step 1; not used yet)
- **What:** new `audit.js` (`buildHistory`): turns the stored scoring actions of one match into a list for the admin page, newest first: when the server saved it, who (login), the action in words ("+2 for CSE", "4 runs", "Wide + 1", "Dot ball + WICKET (Caught)", "Finish match (ECE wins)", "UNDO (cancels: +1 for ECE)"), whether it was undone and by which undo, and the score right after it (each sport's own one-line score). Undo pairing is the same rule the score uses (`effectivePoints`). A broken old row shows without a score instead of breaking the list. Tests in `test.js`.
- **Why:** on event day a team may dispute a score; today the only way to look is SQL on the server.
- **Checked:** `node test.js`: All tests passed (simple, cricket, volleyball, table tennis, double undo, undo of a finish, empty team names, unknown type, broken engine). 3 deliberate breaks (undo cancels the oldest, score ignores undo, point value always 1) each made the tests fail; restored.
- **Undo:** `git revert <this commit>` (nothing uses the file yet).

## 2026-11-12 - Deployed "app runs as node" on the server (by hand)
- **What:** normal deploy of `c83395b` (backup, `git pull`, `build`, `migrate.js`, `up -d`; only the app restarted).
- **Checked:** GitHub run for `c83395b`: all 3 jobs green (`unit`, `integration`, `image`). Server, as reported by the user: `docker compose exec -T app whoami` -> `node`; `/ready` ok; `security-check.sh` 0 failed.
- **Undo:** see the entry below.

## 2026-11-12 - The app no longer runs as root inside Docker
- **What:** `Dockerfile`: `USER node` before `CMD`, so the app runs as the image's normal user `node` (uid 1000). Files still belong to root: the app can read them but not change them. New `scripts/check-image-user.sh` (fails if the image runs as root, cannot read its files, or can change `server.js`). New CI job `image`: builds the production image and runs that check.
- **Why:** if a bug ever let an attacker run code in the app, as root they could rewrite the app (for example to record passwords at login). As `node` they cannot.
- **Checked:** laptop: old image -> `root (uid 0)`, check FAILED; new image -> `node (uid 1000)`, reads its files, cannot change `server.js`, check OK. Full test copy from the new image (separate compose project, port 3100): `whoami` = node; `ls migrations`, `migrate.js`, `add-user.js`, `add-match.js`, `check-passwords.js` all worked; `/ready` 200 inside and outside; scorer login + 2 scores ok; `/api/home` 200; no permission errors in the app log. `node test.js`: All tests passed. `actionlint`: no problems. Not checked yet: the GitHub run (needs a push) and the server.
- **Deploy (Ubuntu bash, normal order, no match live):** backup, `git pull`, `docker compose build`, `docker compose run --rm app node migrate.js` (nothing new), `docker compose up -d` (only the app restarts), then `docker compose exec -T app whoami` must print `node` and `/ready` must be ok.
- **Undo:** `git revert <this commit>`, `docker compose build`, `docker compose up -d`.

## 2026-11-12 - Roadmap brought up to date (docs only)
- **What:** `docs/ROADMAP.md`: new "Done" table (HTTPS, no demo passwords, trusted hourly backups, S3 copy + heartbeat, uptime alerts, CI, scorer queue). "Now" is down to: real domain name (the IP address only gets a 6-day certificate), mock event, 2,000-student load test. The rehearsal list now points to `git show 84620c3^:LESSON_12.md` (that file was deleted). Volleyball is listed as an engine. The staging row no longer says tests are run by hand.
- **Why:** it still listed finished work as open (HTTP passwords, off-server backups, monitoring, CI) and pointed to a deleted file.
- **Checked:** every claim against the repo and this changelog (`engines/volleyball.js` exists; `security-check.sh` runs `check-passwords.js`; `git show 84620c3^:LESSON_12.md` has section 10 "Mock event"). `node test.js`: All tests passed.
- **Undo:** `git revert <this commit>`.

## 2026-11-11 - CI runs the integration test (step 3a, part B)
- **What:** `.github/workflows/test.yml` has a second job `integration`: GitHub starts its own Postgres 16 and Redis 7 for the run, then `npm ci` and `node test-integration.js` on Node 22.23. The `unit` job is unchanged. Test password only; no secrets in the workflow.
- **Why:** so every push proves the scoring write path still works on the server's Node version, not only when someone remembers to run it on the laptop.
- **Checked:** `actionlint` 1.7.7 (Docker): no problems. Same test on Node 22.23 in Docker on the laptop: All integration tests passed, `node test.js`: All tests passed. First GitHub run (commit `bbe8735`, pushed 2026-11-12): both jobs `unit` and `integration` green.
- **Undo:** delete the `integration:` job from the file and push.

## 2026-11-11 - Integration test of the scoring write path (step 3a, part A; laptop only, not in CI yet)
- **What:** new `test-integration.js` (`npm run test:integration`) starts the real `server.js` against a throwaway Postgres 16 + Redis 7 from the new `docker-compose.test.yml` (127.0.0.1 ports 55432/56379, data in memory, test password only) and scores like a phone with `socket.io-client`. No server code changed (black-box, decision 6). 8 cases: same id sent twice (stored and broadcast once); 2 scorers x 20 parallel actions (40 rows, each answer one step further: the row lock works); same id from 2 phones at once (1 row); undo and "nothing to undo"; finished match (simple engine: "match already finished", undo reopens it); unassigned scorer and disabled user refused, admin allowed; database switched off -> `retry:true`, server stays up, the same id succeeds afterwards. It refuses to run on a database whose name does not end in `_test`. `.dockerignore` keeps both files out of the image. `CONTRIBUTING.md`: how to run it; fixed "test.js = unit and integration tests".
- **Why:** `applyAction`, the code that writes every score, had no test (problem 9).
- **Checked:** laptop, Node 26: `All integration tests passed` (about 3 s); Node 22.23 in Docker: passed too, 5 clean runs in a row all passed; 8 deliberately broken copies of `server.js`/`db.js` (no duplicate check, no row lock, duplicate broadcast, disabled user allowed, unassigned scorer allowed, no pool error listener, errors without `retry`, undo on empty) each failed the matching case, then were restored with `git checkout`; the no-row-lock break failed 5 of 5 runs; guard refused a database named `livescore`; `node test.js`: All tests passed.
- **Undo:** `git revert <this commit>` (test files only; nothing deployed).

## 2026-11-11 - Deployed the new scorer page and checked it on a real phone (by hand)
- **What:** normal deploy of `7670f29` (only the app restarted). Real-phone check with a temporary test match: scoring with signal, airplane mode + taps + phone locked, back online.
- **Checked:** the user reported the deploy fine and everything working on the phone (entries arrived after airplane mode, texts and buttons fit the screen).
- **Note for match days:** a scorer phone that had the page open before the deploy keeps the old page until it is reloaded; reload once after its waiting entries are sent.
- **Undo:** see the part B entry below.

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
