# Roadmap — College Live Score

This is not a promise. It is a list of things the owner wants to do, roughly grouped by urgency. Items marked **[newcomer-friendly]** are good first tasks for a contributor.

Last updated: 2026-11-12. What was finished and when: see "Done" at the end and `docs/CHANGELOG.md`.

---

## Now — before the event (highest priority)

These are needed for the first real sports month.

| Item | Why | Notes |
|---|---|---|
| **Real domain name** | HTTPS is on, but on the bare server IP address. Let's Encrypt gives an IP address only a 6-day certificate (`Caddyfile`, `shortlived`): if one renewal fails, every browser shows an error within days. A domain gets a normal 90-day certificate. | Buy a domain, point its DNS A record at the server IP, then in the server `.env` set `DOMAIN=<domain>` and `ACME_PROFILE=classic`, then `docker compose up -d caddy`. Rollback: `DEPLOY.md` section E. Update the UptimeRobot monitor to the new address. |
| **Full mock event (rehearsal)** | Real problems appear in rehearsal, not in tests. The rehearsal list is section 10 of the old Lesson 12 notes: `git show 84620c3^:LESSON_12.md` (the file was removed from the repo in `84620c3`). | Needs at least 3 scorers with real phones, real server, and a person with a stopwatch. Run `./scripts/security-check.sh` on the server the day before (it also checks for demo passwords). |
| **Official load-test pass at 2,000 students** | 500, 1,000 and 2,000 have informally passed but should be re-confirmed on the final server size. 5,000 looks healthy but is not an official pass. | Run `loadtest-real-fixed.js` from an EC2 machine in Mumbai (same region as the server). |

---

## Next — after the first event, before the next one

These improve reliability and coverage.

| Item | Why | Notes | Newcomer? |
|---|---|---|---|
| **Football engine** | Football is a common college sport. Halves, goals, possibly yellow/red cards. | Build `engines/football.js` with `compute`, `validate`, `result`, `headline`. Add tests. | **[newcomer-friendly]** |
| **More sport engines (target ~15–20 total)** | The sports month has 20+ events. Currently only cricket, table tennis, volleyball and "simple" are engines (`engines/`). | Use `simple` for any sport where a scorer just adds points. Add specific engines only where the rules need it (halves, sets, etc.). | Partly newcomer-friendly |
| **Generic "simple" scoring for remaining sports** | Most outdoor sports (kabaddi, basketball, throwball, …) can use the existing `simple` engine. | Confirm with the owner which sports need a specific engine and which can use `simple`. | |
| **Official load-test pass at 5,000 students** | The 5,000-student run looked healthy but was not declared a formal pass. | Repeat on a 4 GiB server in the same region. Use `loadtest-real-fixed.js` and `--procs 2`. | |
| **Keep load-test tools in the repo** | `loadtest-real-fixed.js` and `loadtest-real-diag.js` exist in the repo. Keep them maintained and document how to run them. Update the capacity numbers table in `docs/ARCHITECTURE.md` after each real test. | | |
| **Fix `watch-load.sh` connection counter** | The `ss` command reads host network stats but Docker hides the connections. The counter always shows 0. | Run `ss` inside the Caddy container instead, or drop the counter. See `docs/LESSONS.md`. | **[newcomer-friendly]** |

---

## Later — production hardening and scaling

These are important for a production-quality service but are not urgent for the first event.

| Item | Why | Notes | Newcomer? |
|---|---|---|---|
| **Staging environment** | CI now tests every push, but a tested commit still goes straight to production. A staging environment (a second, cheap EC2 instance) would catch deploy and real-network problems before they reach students. | Could be as simple as a second Docker Compose stack on a small instance, torn down after testing. | |
| **Content-Security-Policy header** | A CSP prevents certain XSS attacks. It is not set yet because it needs careful testing to avoid breaking the pages on real phones. | Test thoroughly in a staging environment before enabling on production. | |
| **Admin audit page** | The `events` table already records `by_user` for every action. An admin page to browse recent actions would help investigate disputes. | Read-only DB query, displayed in the admin panel. | **[newcomer-friendly]** |
| **Login rate-limit counters in Redis** | Currently the counters are in memory. Restarting the app clears them; two servers would not share them. | Move `FailureLimiter` to Redis if the server is ever scaled horizontally. | |
| **Longer HSTS** | The current `Strict-Transport-Security` is `max-age=86400` (1 day). After HTTPS is stable, raise it to a year. | Only after HTTPS has been confirmed stable for several weeks. | |
| **Team list / name management** | Currently team names are typed free-form. The same team can appear as "CSE" and "CSE Department" and they will count as different teams in the points table. | A managed list of team names for each competition. Big UI change. | |
| **10,000-student load test** | The 10,000 figure is calculated, not measured. A real test at that scale requires a 4 GiB server and multiple load machines. | Coordinate with the owner for a quiet time on the server. | |
| **CloudFront for `/api/home`** | At very high traffic the home-page endpoint could be fronted by a CDN to reduce server load. | Only if the server is genuinely struggling at event load. Probably unnecessary at current scale. | |

---

## Done (details and undo steps in `docs/CHANGELOG.md`)

| Item | When | What exists now |
|---|---|---|
| HTTPS | code 2026-10-15 (Lesson 12); confirmed live 2026-11-11 | Caddy + Let's Encrypt on the server IP address (a real domain is still in "Now") |
| No demo / weak passwords | 2026-11-11 | `scripts/security-check.sh` runs `check-passwords.js`; last run: 0 failed |
| Hourly backups that can be trusted | 2026-11-10 | Cron installed and checked; only complete backups are kept; the newest 3 are never pruned; restore drill passed (`docs/BACKUPS.md`) |
| Backups off the server | 2026-11-11 | Every backup is copied to a private S3 bucket (30 days); healthchecks.io emails when backups stop |
| Uptime alerts | 2026-11-11 | `/ready` checks Postgres and Redis; UptimeRobot emails when it fails (`docs/MONITORING.md`) |
| CI | 2026-11-11 | GitHub Actions on every push: `node test.js` and the integration test (`test-integration.js`) on Node 22.23 |
| Scorer phone never loses an entry silently | 2026-11-11 | Backoff, rejected-entry list, stuck-entry button, per-scorer entries (`public/queue.js`) |

---

## Ideas / maybe someday

- Super over for cricket.
- DLS / rain rules for cricket.
- Player names and individual statistics.
- A publicly shared scoreboard embed (iframe) for departments.
- Results archive from past years.

