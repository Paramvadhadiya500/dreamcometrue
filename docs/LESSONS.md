# Lessons — Mistakes We Made and What We Learned

This file is a record of real mistakes made while building College Live Score. Each entry explains what happened, why it happened, and the rule we now follow.

---

## 1. `.env` was committed to Git

**What happened:** The `.env` file (containing the database password and JWT secret) was added to the Git repository. When `git pull` ran on the server, it overwrote the server's real `.env` with the laptop version.

**Why:** No `.gitignore` rule was in place at the time.

**The fix:** `.gitignore` now lists `.env`. Verify with `git check-ignore -v .env` — it must print a rule. Run `git rm --cached .env` if it was ever tracked.

**Rule:** `.env` must never appear in `git status`. Check this before every commit.

---

## 2. `.gitignore` was broken by leading spaces

**What happened:** `.gitignore` was copied from chat text. Every line had three leading spaces, so Git treated every pattern as literal text. Nothing was actually ignored.

**Why:** Chat text can include invisible formatting characters. Copy-pasting code from a chat window is unreliable.

**The fix:** Download files directly instead of copying text from chat. After any change to `.gitignore`, verify with `git check-ignore -v <file>`.

**Rule:** Download files. Do not copy code out of chat.

---

## 3. `*.sql` in `.gitignore` blocked the migration files

**What happened:** A `*.sql` pattern in `.gitignore` was intended to ignore SQL backup dumps. It also matched `migrations/*.sql`, so the migration files were never pushed to GitHub.

**Why:** The pattern was too broad.

**The fix:** `.gitignore` now ignores `*.sql.gz` (backups are always gzipped) rather than `*.sql`. The migration files are tracked normally.

**Rule:** Be specific with `.gitignore` patterns. Test that migration files appear in `git status` after adding them.

---

## 4. `migrate.js` looked in the wrong folder

**What happened:** `migrate.js` searched for `.sql` files relative to the working directory. When run from a different folder (or inside Docker) it found nothing and printed "up to date" without applying any migrations.

**Why:** `fs.readdirSync("migrations")` resolves relative to the current directory, not the script's location.

**The fix:** `migrate.js` now uses `path.join(__dirname, "migrations")` so it always finds the right folder regardless of where it is run from.

**Rule:** Use `__dirname` when a script needs to find files next to itself.

---

## 5. New code was deployed before the migration ran

**What happened:** The server was updated with `git pull` and `docker compose up -d --build`, but `node migrate.js` was not run. The new code referenced a database column (`sport`) that did not exist yet. Every request crashed.

**Why:** The deploy order was wrong.

**The fix:** The deploy order in `DEPLOY.md` (section B) is now explicit: build the image first (the migration files live inside the image), run the migration, and only then restart the app with the new code.

**Rule:** Deploy order is always: backup → `git pull` → `docker compose build` → `docker compose run --rm app node migrate.js` → `docker compose up -d` → check `docker compose ps` and `/health`. Never skip the migration step, and never start new code before the migration has run.

---

## 6. Data created on the laptop did not appear on the server

**What happened:** Matches were created by running SQL on the laptop database. They never appeared on the server because the two databases are completely separate.

**Why:** Git carries code, not data.

**The fix:** Create data on the server with `docker compose run --rm app node add-match.js ...` and `add-user.js ...`.

**Rule:** Code travels through Git. Data does not. Everything that must exist on the server must be created there.

---

## 7. Placeholder passwords were used as real passwords

**What happened:** Passwords like `CHOOSE-A-PASSWORD1` and `admin123` from lesson instructions were left in place on the real server. The admin panel was accessible over plain HTTP (passwords not encrypted over the network).

**Why:** It was easy to forget to change them before the event.

**The fix:** `check-passwords.js` lists accounts that still use known or demo passwords. `scripts/security-check.sh` includes this check and fails the whole check if any active account is weak.

**Rule:** Run `node check-passwords.js` before every event. No `WEAK` lines allowed on active accounts.

---

## 8. The Docker image was not rebuilt before running the migration

**What happened:** `docker compose run --rm app node migrate.js` was run without first running `docker compose up -d --build`. The container was running old code that did not include new migration files or new application code.

**Why:** `docker compose up -d` without `--build` reuses the existing image.

**The fix:** build the image before the migration. (Superseded: the one correct order is in lesson 5 and `DEPLOY.md` section B: `docker compose build`, then `migrate.js`, then `up -d`. Do not use `up -d --build` before the migration.)

**Rule:** Always build before `migrate.js`, and start the new code (`up -d`) only after the migration.

---

## 9. The load-test script counted the "current score" message as a slow delivery

**What happened:** The original `loadtest-real.js` measured how long each `score:update` socket event took to arrive. When a probe watcher joined a match, the server immediately sent the current score (this is by design — the page should not be blank). The script counted this initial message as a "delivery" from the most recent scorer action, and measured its latency from when that action was scored. For watchers who joined after the score had already been sent, the gap was many seconds. The test failed for the wrong reason.

**Why:** The script did not distinguish between the "you just joined" snapshot and a live update caused by a new scorer action.

**The fix:** `loadtest-real-fixed.js` ignores any `score:update` that arrives within 3 seconds of a watcher joining or switching match. Only updates that arrive more than 3 seconds after joining are counted as live deliveries. Additionally, probe watchers never switch matches (they would otherwise lose the baseline they are measuring against).

**Rule:** When measuring end-to-end latency over a socket, exclude the initial state snapshot. A watcher that just joined should not count as "late". Keep the fixed version (`loadtest-real-fixed.js`) in the repo.

---

## 10. Hourly backup produced 0-byte files while the database was stopped

**What happened:** The hourly backup cron ran `pg_dump` while the database container was stopped. The dump produced an empty file (or a file with only the gzip header). The cron recorded success because `gzip` returned exit code 0.

**Why (suspected):** The database was stopped at the time the cron fired. `gzip` succeeded even on empty input.

**The fix:** `scripts/backup.sh` now checks the file size after writing: if it is under 300 bytes it prints an error and exits with code 1. The cron will record the failure in its log instead of silently keeping an empty file.

**Rule:** Backups must fail loudly. After `backup.sh` runs, check that the file is non-empty. Never keep a 0-byte backup.

---

## 11. The memory formula under-estimated real Caddy memory by about 2×

**What happened:** The capacity formula in `docs/ARCHITECTURE.md` (and earlier in `PROJECT_CONTEXT.md`) estimated Caddy's idle memory at about 47 MB. At 5,000 simulated students, the real server used about 945 MB for Caddy alone — roughly twice what the formula predicted.

**Why:** The formula was based on measurements at smaller scale. Caddy's memory grows faster than linearly at higher connection counts.

**The fix:** The formula has been updated with the measured numbers. The recommendation is to always measure the real server with `./scripts/watch-load.sh` and trust the live numbers over any formula.

**Rule:** Treat capacity numbers as estimates, not guarantees. Always run a real load test before an event. Use the live memory numbers from `watch-load.sh`, not the formula.

---

## 12. Big load tests from a home laptop hit the home network, not the server

**What happened:** A large load test was run from a laptop on a home internet connection. The test failed — but not because the server was overloaded. The laptop's home network upload bandwidth was the bottleneck. The server looked healthy; the test results were meaningless.

**Why:** A home connection has much less upload bandwidth than a cloud data centre. Sending traffic for thousands of simulated users saturates the home router before the server feels any load.

**The fix and rule:** Run large load tests (more than about 1,000 simulated users) from a machine in the same cloud region as the server (for example a second EC2 instance in Mumbai). Also: a single 2-CPU machine was overloaded at 5,000 simulated users. Use `--procs 2` or `--procs 3`, or use multiple load machines. The test script now reports "load machine overloaded" as a FAIL.

**Rule:** Test from the cloud, in the same region. Check the load machine's own CPU (`load machine: cpu XX%` in the test output). If it is above about 80%, the results are not reliable.

---

## 13. `watch-load.sh` shows 0 connections

**What happened:** `watch-load.sh` uses `ss` (a Linux socket-statistics tool) to count open connections to ports 80 and 443. On the server, it always showed 0 connections, even during a live load test.

**Why:** Docker uses network namespaces. Connections that go through Caddy inside a Docker container are not visible to `ss` on the host. The host sees the Docker bridge interface, not the connections inside the container's network namespace.

**The fix (partial):** This is a known limitation. The workaround is to count connections from inside the Caddy container:
```bash
docker compose exec caddy sh -c "ss -Htn state established '( sport = :443 or sport = :80 )' | wc -l"
```
Or to rely on `docker stats` (which `watch-load.sh` already shows) for memory and CPU. A proper fix would rewrite the connection counter to run inside the container.

**Rule:** When a tool shows an unexpected zero on a Docker host, check whether Docker networking is hiding the data. Test by running the same command inside the container.

