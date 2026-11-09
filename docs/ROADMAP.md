# Roadmap — College Live Score

This is not a promise. It is a list of things the owner wants to do, roughly grouped by urgency. Items marked **[newcomer-friendly]** are good first tasks for a contributor.

---

## Now — before the event (highest priority)

These are needed for the first real sports month.

| Item | Why | Notes |
|---|---|---|
| **HTTPS + domain** | Scorer and admin passwords travel in plain text over HTTP right now. This is a known gap — the event must not go live without HTTPS. | Caddy + Let's Encrypt is already wired up. Set `DOMAIN` in `.env`. See `LESSON_12.md`. |
| **Replace all demo / placeholder passwords** | `seed.js` creates accounts with known weak passwords. Any that remain on the server are a serious risk. | Run `node check-passwords.js` and `scripts/security-check.sh` before the event. |
| **Full mock event (rehearsal)** | Real problems appear in rehearsal, not in tests. The rehearsal list is in `LESSON_12.md` section 10. | Needs at least 3 scorers with real phones, real server, and a person with a stopwatch. |
| **Confirm hourly backup cron** | Backups protect against accidental deletes and wrong data. The cron must be installed and verified before the event. | `./scripts/install-cron.sh` on the server; check `crontab -l` and that a file appears in `~/backups`. |
| **Copy backups off the server** | A backup on the same server does not help if the server is lost. | `scp` to laptop before the event and after every important session. |
| **Official load-test pass at 2,000 students** | 500, 1,000 and 2,000 have informally passed but should be re-confirmed on the final server size. 5,000 looks healthy but is not an official pass. | Run `loadtest-real-fixed.js` from an EC2 machine in Mumbai (same region as the server). |

---

## Next — after the first event, before the next one

These improve reliability and coverage.

| Item | Why | Notes | Newcomer? |
|---|---|---|---|
| **Football engine** | Football is a common college sport. Halves, goals, possibly yellow/red cards. | Build `engines/football.js` with `compute`, `validate`, `result`, `headline`. Add tests. | **[newcomer-friendly]** |
| **More sport engines (target ~15–20 total)** | The sports month has 20+ events. Currently only cricket, table tennis and "simple" are specific engines. | Use `simple` for any sport where a scorer just adds points. Add specific engines only where the rules need it (halves, sets, etc.). | Partly newcomer-friendly |
| **Generic "simple" scoring for remaining sports** | Most outdoor sports (kabaddi, volleyball, basketball, throwball, …) can use the existing `simple` engine. | Confirm with the owner which sports need a specific engine and which can use `simple`. | |
| **Official load-test pass at 5,000 students** | The 5,000-student run looked healthy but was not declared a formal pass. | Repeat on a 4 GiB server in the same region. Use `loadtest-real-fixed.js` and `--procs 2`. | |
| **Keep load-test tools in the repo** | `loadtest-real-fixed.js` and `loadtest-real-diag.js` exist in the repo. Keep them maintained and document how to run them. Update the capacity numbers table in `docs/ARCHITECTURE.md` after each real test. | | |
| **Fix `watch-load.sh` connection counter** | The `ss` command reads host network stats but Docker hides the connections. The counter always shows 0. | Run `ss` inside the Caddy container instead, or drop the counter. See `docs/LESSONS.md`. | **[newcomer-friendly]** |

---

## Later — production hardening and scaling

These are important for a production-quality service but are not urgent for the first event.

| Item | Why | Notes | Newcomer? |
|---|---|---|---|
| **Backups off the server (automated)** | Currently backups are on the same disk as the data. If the server or disk fails, both are lost. | Options: AWS S3, `rclone` to Google Drive, or a scheduled `scp` to a second machine. | |
| **Monitoring and uptime alerts** | The owner finds out the site is down when a scorer calls. | A simple uptime check (e.g. UptimeRobot free tier) that sends a WhatsApp or email alert. | **[newcomer-friendly]** |
| **Staging environment** | Currently code goes straight from laptop to production. A staging environment (a second, cheap EC2 instance) would catch problems before they reach students. | Could be as simple as a second Docker Compose stack on a small instance, torn down after testing. | |
| **CI (automated tests on push)** | Right now `node test.js` is run manually. A GitHub Actions workflow would catch regressions automatically. | A single YAML file in `.github/workflows/`. | **[newcomer-friendly]** |
| **Content-Security-Policy header** | A CSP prevents certain XSS attacks. It is not set yet because it needs careful testing to avoid breaking the pages on real phones. | Test thoroughly in a staging environment before enabling on production. | |
| **Admin audit page** | The `events` table already records `by_user` for every action. An admin page to browse recent actions would help investigate disputes. | Read-only DB query, displayed in the admin panel. | **[newcomer-friendly]** |
| **Login rate-limit counters in Redis** | Currently the counters are in memory. Restarting the app clears them; two servers would not share them. | Move `FailureLimiter` to Redis if the server is ever scaled horizontally. | |
| **Longer HSTS** | The current `Strict-Transport-Security` is `max-age=86400` (1 day). After HTTPS is stable, raise it to a year. | Only after HTTPS has been confirmed stable for several weeks. | |
| **Team list / name management** | Currently team names are typed free-form. The same team can appear as "CSE" and "CSE Department" and they will count as different teams in the points table. | A managed list of team names for each competition. Big UI change. | |
| **10,000-student load test** | The 10,000 figure is calculated, not measured. A real test at that scale requires a 4 GiB server and multiple load machines. | Coordinate with the owner for a quiet time on the server. | |
| **CloudFront for `/api/home`** | At very high traffic the home-page endpoint could be fronted by a CDN to reduce server load. | Only if the server is genuinely struggling at event load. Probably unnecessary at current scale. | |

---

## Ideas / maybe someday

- Super over for cricket.
- DLS / rain rules for cricket.
- Player names and individual statistics.
- A publicly shared scoreboard embed (iframe) for departments.
- Results archive from past years.

