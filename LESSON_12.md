# Lesson 12: HTTPS and hardening (full notes)

Last updated: 2026-10-13. Keep this file in the project root and read it again before the event.

Where each command runs is written in brackets: **[laptop]** is Windows PowerShell in your project folder, **[server]** is the Ubuntu server over SSH in `~/dreamcometrue`.

---

## 1. In one minute

| What we added | Why | How you know it works |
|---|---|---|
| **HTTPS** through Caddy (bare IP address, domain, or plain HTTP as a fallback) | Without it, scorer and admin passwords travel unencrypted over the college Wi-Fi | The browser shows a padlock and `http://` redirects to `https://` |
| **Login protection** | Stops someone guessing passwords | 6th wrong password in a row gets "too many failed attempts" |
| **Request limits** (join, message size, JSON size) | One bad phone cannot overload the server | `node test.js` and the security check |
| **Security headers** (set by Caddy) | Blocks some common browser attacks | `./scripts/security-check.sh` |
| **Weak-password finder** (`check-passwords.js`) | Finds accounts that still use `admin123` or the placeholder passwords from the lessons | It prints `WEAK` next to the username |
| **Automatic backups** (`install-cron.sh`) | A backup every hour during the event, old ones deleted after 7 days | `crontab -l` shows the lines, new files appear in `~/backups` |
| **Security check** (`security-check.sh`) | One command that says PASS / WARN / FAIL before the event | No FAIL lines |
| **Rehearsal plan** (section 10) | The real problems appear in a rehearsal, not in tests | You finish every scenario in the list |

---

## 2. Files in this lesson

**New**
- `rateLimit.js` counts failed logins in a sliding window
- `check-passwords.js` finds accounts with known or easy passwords
- `scripts/install-cron.sh` installs automatic backups
- `scripts/security-check.sh` the PASS / WARN / FAIL check
- `LESSON_12.md` this file

**Changed (replace the old file)**
- `server.js` login limits, join limit, size limits, trusted proxy setting
- `Caddyfile` site address and certificate profile from `.env`, security headers
- `docker-compose.yml` passes `DOMAIN`, `ACME_PROFILE` and `TRUST_PROXY`
- `.env.example` the new settings with comments
- `test.js` now also tests the login limiter
- `DEPLOY.md`, `PROJECT_CONTEXT.md` updated notes

**Unchanged:** everything else (engines, admin.js, home.js, pages, migrations).

> Download the files from the chat. Do not copy code out of the chat text: leading spaces broke `.gitignore` once.

---

## 3. Deploy: laptop, then GitHub, then server

### 3.1 Laptop [laptop]
```powershell
node test.js                  # must print: All tests passed
git status                    # new and changed files are listed; .env must NOT be listed
git add .
git commit -m "Lesson 12: HTTPS settings, login protection, security tools"
git push
```
Check on github.com that `rateLimit.js`, `check-passwords.js` and `scripts/security-check.sh` are there.

### 3.2 Server: update the code, still on plain HTTP [server]
Your `.env` has `DOMAIN=` empty, so after this step the site behaves as before (plain HTTP), only safer.
```bash
cd ~/dreamcometrue
./scripts/backup.sh
git pull
chmod +x scripts/*.sh
docker compose pull caddy
docker compose up -d --build
docker compose ps
docker compose exec caddy caddy version
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/home
```
- `docker compose ps` shows 4 containers running.
- `caddy version` should say **v2.11 or newer** (needed for IP address certificates).
- The `curl` prints `200`.

If `git pull` complains about local changes, do not force it. Send the message to your assistant.

### 3.3 Passwords [server]
```bash
docker compose run --rm app node check-passwords.js
```
Every `WEAK` line must be fixed in the admin page: **Scorers, New password** (for `admin`, use `docker compose run --rm app node add-user.js admin admin "<new password>"`). Run the check again until it says `No active account uses a known password.`

### 3.4 Automatic backups [server]
```bash
./scripts/install-cron.sh           # every hour (use during the event)
crontab -l                          # two lines that end with livescore-backup and livescore-prune
```
After the event, or for normal weeks, switch to once a day: `./scripts/install-cron.sh daily`.

### 3.5 Switch HTTPS on (section 4), then check [server]
```bash
./scripts/security-check.sh
```
No `FAIL` lines allowed. Read every `WARN` and decide.

---

## 4. HTTPS in detail

### 4.1 How it works
- Caddy is the front door (ports 80 and 443). It gets a free certificate from Let's Encrypt for the address in `DOMAIN` and renews it by itself.
- Port 80 then only redirects to HTTPS. Port 443 carries the web pages and the WebSocket (`wss://`) for live scores.
- The app and the database are never reachable from the internet; only Caddy has `ports:` in `docker-compose.yml`.

### 4.2 Choose one address (`.env` on the server)

| Option | `.env` lines | Good for | Notes |
|---|---|---|---|
| **A. Bare IP address** | `DOMAIN=52.66.126.144` and `ACME_PROFILE=shortlived` | Now, with no domain | Let's Encrypt began issuing certificates for IP addresses in 2026. They are valid only about 6 days and Caddy renews them automatically. Students open `https://52.66.126.144`. **Not tested against Let's Encrypt in this course**: see 4.5 if it fails. |
| **B. Domain or college subdomain** | `DOMAIN=score.yourcollege.ac.in` and `ACME_PROFILE=classic` | The real event | Best choice: students trust and remember a name. Ask college IT for an A record that points to your Elastic IP. |
| **C. sslip.io name** | `DOMAIN=52.66.126.144.sslip.io` and `ACME_PROFILE=classic` | Fallback if A fails | A free service that turns the IP into a name. Depends on a third party. |
| **Plain HTTP** | `DOMAIN=` (empty) or `DOMAIN=:80` | Rollback, testing | Passwords are not encrypted. |

Never use the bare IP with the `classic` profile: the certificate request fails.

### 4.3 Switch on [server]
```bash
cd ~/dreamcometrue
nano .env                       # set DOMAIN and ACME_PROFILE as in the table; save with Ctrl+O, Enter, Ctrl+X
docker compose up -d
docker compose logs -f caddy    # wait for a line saying the certificate was obtained; stop with Ctrl+C
```
Do this at a quiet time. If the certificate is not issued, browsers will show an error until you roll back.

### 4.4 Check
1. Open `https://<your address>` in a browser: padlock, the home page loads.
2. Open `http://<your address>`: it jumps to `https://`.
3. Log in on `/scorer.html` and score a point from your phone on mobile data. A second phone must see it within about 5 seconds.
4. `./scripts/security-check.sh` shows PASS for HTTPS and the headers.

### 4.5 If it does not work
| Symptom | Likely cause | Fix |
|---|---|---|
| Browser says the connection is not private or cannot connect | Certificate not issued yet | `docker compose logs --tail 50 caddy` and read the error |
| Log says it cannot reach the server for validation | Port 80 or 443 closed | AWS Security Group: allow 80 and 443 from anywhere |
| Log mentions `profile` or the setting is not accepted | Old Caddy | `docker compose pull caddy && docker compose up -d caddy`, then `caddy version` |
| Log says too many certificates / rate limit | You recreated the certificate many times | Wait (Let's Encrypt limits repeats for the same address); use option C or plain HTTP meanwhile; never delete the `caddy_data` volume |
| IP certificate refused for any reason | The IP certificate path is new | Use option B or C |

### 4.6 Rollback to plain HTTP (always know this) [server]
```bash
nano .env                       # DOMAIN=:80   (or leave it empty)
docker compose up -d caddy
```

### 4.7 What changes for users after HTTPS
- `https://` is a different "origin" from `http://`: scorers and the admin must **log in again**.
- Update the QR code, posters and WhatsApp messages to the new address.
- The first security header, HSTS, is set for 1 day (`max-age=86400`). After a week of stable HTTPS you can raise it in the `Caddyfile` (for example to `31536000`, one year). Do not raise it before HTTPS is stable.

---

## 5. Login protection

**Rules (in `server.js`, numbers can be changed there):**
- 5 wrong passwords for the same username from the same address in 10 minutes, or 40 wrong attempts from one address in 10 minutes, block that address for up to 10 minutes. The answer is `429` with a `Retry-After` header.
- While blocked, even the correct password is refused. This is on purpose.
- A good login clears the count for that username.
- Capital letters do not help an attacker: the counter ignores capitals in the username.

**`TRUST_PROXY=1`:** behind Caddy, every request reaches the app from Caddy itself. With `TRUST_PROXY=1` (set in `docker-compose.yml`) the app uses the visitor address that Caddy passes on. Caddy replaces any `X-Forwarded-For` header sent by a visitor, so faking it does not work (tested). Never set `TRUST_PROXY` when the app runs without Caddy (for example on your laptop), because then a visitor could fake the header.

**Limits to know:**
- The counters live in memory: restarting the app clears them, and two servers would not share them.
- People on the same college Wi-Fi may share one public address. Forty wrong attempts from that address would block everyone there for 10 minutes. This is unlikely, but it is the price of the rule.
- If you lock yourself out while testing: `docker compose restart app` [server].
- Tokens that already exist keep working while the address is blocked. To cut off a lost phone, disable the scorer in the admin page.

---

## 6. Other protections (already active)

| Protection | Where |
|---|---|
| One connection can ask to join a match at most 30 times in 10 seconds | `server.js` |
| Socket messages larger than 10 KB close the connection | `server.js` |
| JSON requests larger than 20 KB are refused | `server.js` |
| The framework name (`X-Powered-By`) is hidden | `server.js` |
| `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (the admin page cannot be shown inside another site), `Referrer-Policy: no-referrer`, `Strict-Transport-Security` | `Caddyfile` |
| Score actions need a login; every action is checked against the database (role, active, assigned match) | `server.js` |
| User text is shown with `textContent`, never as HTML | all pages |
| Only the proxy publishes ports; the database and Redis are not reachable from outside | `docker-compose.yml` |

Not done: a Content-Security-Policy header (it could break the pages and cannot be tested well without real phones), two-step login, an audit page for the admin (the `events` table already records who entered each action in `by_user`).

---

## 7. Weak-password finder

```bash
docker compose run --rm app node check-passwords.js        # [server]
node check-passwords.js                                     # [laptop, for your local database]
```
- It tries the demo passwords (`admin123`, `rahul123`, `neha123`), the placeholder texts from these lessons (such as `YOUR-REAL-PASSWORD-1` and `CHOOSE-A-PASSWORD1`), common choices like `password123`, and the username with `123` added.
- It prints only usernames. `WEAK` on an active account means exit code 1.
- A disabled account that is weak is listed but does not count.
- It cannot know a weak password it does not guess. A generated password from the admin page (12 random characters) is the safe choice.

---

## 8. Backups

### 8.1 Automatic
`./scripts/install-cron.sh` (hourly) or `./scripts/install-cron.sh daily`. Safe to run again: it replaces only its own two lines. Files are `~/backups/livescore-<date>-<time>.sql.gz`, the log is `~/backups/backup.log`. Files older than 7 days are deleted at 04:30.

### 8.2 Copy a backup off the server [laptop]
A backup on the same server does not help if the server is lost.
```powershell
scp -i C:\path\to\key.pem ubuntu@<server address>:~/backups/<file>.sql.gz .
```
Do this before the event, after the event, and whenever something important happened.

### 8.3 Safe restore drill (does not touch the live database) [server]
Do this once before the event so you know the backup works.
```bash
cd ~/dreamcometrue
F=$(ls -t ~/backups/livescore-*.sql.gz | head -1); echo "using $F"
docker compose exec -T db psql -U livescore -d postgres -c "CREATE DATABASE restore_test;"
gunzip -c "$F" | docker compose exec -T db psql -U livescore -d restore_test -v ON_ERROR_STOP=1 > /dev/null && echo "restore finished"
docker compose exec -T db psql -U livescore -d restore_test -c "SELECT count(*) AS events FROM events;"
docker compose exec -T db psql -U livescore -d postgres -c "DROP DATABASE restore_test;"
```
The count should match your live data. (The same steps were tested on a test database.)

### 8.4 Real restore (replaces the live data) [server]
`./scripts/restore.sh ~/backups/<file>.sql.gz` asks you to type `yes`, stops the app, replaces the database, clears Redis and starts the app. Use it only when data is really lost or wrong.

### 8.5 Other safety copies
- **EBS snapshot** (AWS console, EC2, Volumes, Actions, Create snapshot) before the event.
- **AMI** (server image) after everything works: you can launch an identical server from it.

---

## 9. The security check

```bash
./scripts/security-check.sh        # [server]
```
It prints `PASS`, `WARN` or `FAIL` and never prints a secret. It does these checks:

| Check | FAIL or WARN means |
|---|---|
| `.env` has DB_PASSWORD and a JWT_SECRET of 32+ characters, is readable only by you, and is not tracked by Git | Fix `.env` (`chmod 600 .env`, `git rm --cached .env`) |
| The 4 containers are running | Start them: `docker compose up -d` |
| No database, Redis or app port is open to the internet | Remove `ports:` for those services |
| HTTP redirects to HTTPS, and HTTPS has a certificate your computer trusts | Section 4 |
| The 4 security headers are present and the framework name is hidden | Caddyfile not updated |
| 6 wrong passwords in a row get blocked | Server not updated, or `TRUST_PROXY` wrong |
| No active account has a known password | Section 7 |
| All migration files are applied | `docker compose run --rm app node migrate.js` |
| Automatic backups are scheduled and one is less than 2 hours old | `./scripts/install-cron.sh`, `./scripts/backup.sh` |
| Disk is under 85% full; automatic security updates are active | Free space; `sudo apt install unattended-upgrades` |

The script exits with an error code if any check is `FAIL`. (Tested on my side with a healthy and a broken pretend server; run it once on the real server and tell your assistant if any line looks wrong.)

---

## 10. Mock event: rehearse before the real one

Do this at least 3 days before the sports month, with the real server, the real address and real phones.

**People:** the admin (you), 3 scorers, 10 to 20 students watching on their own phones, one person with a stopwatch.

**Before you start:** `./scripts/security-check.sh` has no FAIL; `./scripts/backup.sh` ran; a backup was copied to your laptop.

| # | Scenario | What to check |
|---|---|---|
| 1 | Admin creates 3 teams, a cricket match, a table tennis match and a kabaddi match, assigns scorers | Scorers see their match within 30 seconds; students see "Coming up" |
| 2 | Play a full short cricket match (2 overs, 3 players) | Wide, no ball with free hit, wicket, all out, chase, result text with real team names |
| 3 | Table tennis with a deuce game and a second game | Score, undo, winner |
| 4 | **Stopwatch test:** a scorer taps, a watcher says "now" when the score changes | Under 5 seconds, every time |
| 5 | A scorer puts the phone in airplane mode for 30 seconds, taps 5 times, turns it back on | "Entries waiting" appears, then all 5 arrive once, no double count |
| 6 | A scorer enters a wrong ball and presses UNDO | Score goes back, history stays |
| 7 | A scorer's phone is "lost": admin disables the scorer | The next tap is refused; assign another scorer; the match continues |
| 8 | Restart the app during a match: `docker compose restart app` | Scorers reconnect and keep scoring; students keep the score |
| 9 | Restart Redis: `docker compose restart redis` | Scoring keeps working (the server falls back to the database) |
| 10 | Load test from outside: `node loadtest.js 500 https://<address> 10` [laptop] | All viewers receive each update; note the worst delay |
| 11 | Safe restore drill (section 8.3) | The restored event count matches |
| 12 | Points table: finish 3 group matches | Points, wins, NRR or difference are what you expect by hand |
| 13 | Wrong password 6 times | Blocked message; you can log in again after 10 minutes or `docker compose restart app` |

Write down every problem. Fix them, then repeat the scenarios that failed.

---

## 11. Event day

**Morning**
1. `./scripts/security-check.sh` (no FAIL) [server].
2. `./scripts/install-cron.sh` (hourly backups) and check one fresh file in `~/backups`.
3. Copy the newest backup to your laptop.
4. Open the student page and the admin page from a phone on mobile data.
5. Every scorer logs in once and sees the right matches; tell them how UNDO works.
6. Print the paper scoresheets: they are the official backup.

**During**
- One person watches `docker compose logs -f app` and the student page.
- Check hourly that a new backup file appears.
- If the site fails: roll back with section 4.6 (plain HTTP) only as a last resort, then announce scores the old way until it is fixed.

**After**
- Final backup, copy it off the server, take an EBS snapshot.
- Keep the data. When you are really finished with the project, follow the "After the event" part of Lesson 8 (terminate the server, release the Elastic IP).

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "too many failed attempts" at login | The login limit | Wait 10 minutes or `docker compose restart app` |
| Everyone is logged out after HTTPS | New origin | Log in again once |
| Page shows old design or no score lines | Old files or cached copy | Replace the files, `node test.js`, Ctrl+Shift+R |
| Cards have no score line | Old engine files | `Select-String -Path engines\*.js -Pattern "function headline"` must find 3 |
| `git pull` overwrote `.env` | `.env` was tracked by Git | `git rm --cached .env`, restore from `~/dreamcometrue.env.backup` or your private notes |
| Login says "server error" | A migration is missing | Rebuild, then `docker compose run --rm app node migrate.js` |
| `502` or empty page from Caddy | The app container is down | `docker compose logs --tail 50 app` |
| Browser warns about the certificate | Certificate not issued, or Caddy used its own test certificate | Section 4.5 |
| Scores are slow at the event | Server too small | Run `docker stats`; consider a larger instance type for the event days |

---

## 13. Command cheat sheet

**[laptop]**
```powershell
node test.js
node migrate.js
git status
git add .
git commit -m "message"
git push
node loadtest.js 500 https://<address> 10
```
**[server]** (after `cd ~/dreamcometrue`)
```bash
./scripts/security-check.sh
./scripts/backup.sh
./scripts/install-cron.sh            # or: daily
./scripts/snapshot.sh                # status report to paste into a new chat
docker compose ps
docker compose logs --tail 50 app    # or: caddy
docker compose restart app
docker compose run --rm app node migrate.js
docker compose run --rm app node check-passwords.js
docker compose run --rm app node add-user.js admin admin "<password of 10+ characters>"
docker compose exec redis redis-cli FLUSHALL
```
**Update after a code change:** `./scripts/backup.sh`, `git pull`, `docker compose up -d --build`, `docker compose run --rm app node migrate.js`, `docker compose exec redis redis-cli FLUSHALL`, then `./scripts/security-check.sh`.

Never run `docker compose down -v` (it deletes the database).

---

## 14. What was tested, and what was not

**Tested on my side**
- All unit tests, including the failed-login limiter.
- The server with a real database and Redis: 118 checks (admin, scoring, home page, points table) and 29 checks for login limits, request limits and join limits.
- The four pages in a simulated browser: 60 checks, plus 34 checks of the cricket scorer.
- A **real Caddy 2.11.7** in front of the server: security headers, gzip, WebSocket and long-polling, scoring, a forged `X-Forwarded-For` (does not get around the login limit), HTTP to HTTPS redirect, and `wss://` with a local test certificate.
- The Caddyfile is valid with `DOMAIN` set to an IP address, a domain and `:80`.
- The weak-password finder against real accounts; the backup scheduler with a pretend `crontab`; the security-check script against a healthy and a broken pretend server; the safe restore drill on a test database.

**NOT tested**
- A real certificate from Let's Encrypt (no internet access from my test environment). The IP address route uses a newer, thinly documented Caddy setting (`profile shortlived`). That is why the rollback and options B and C exist.
- The Docker build and `docker compose` on your server.
- Real phones, your Wi-Fi, and the real event load.

---

## 15. Known gaps and ideas for later

- Football engine (halves, cards) and a proper team list instead of typed team names.
- A page for admins to see recent actions (who entered what).
- Move the login counters to Redis if you ever run two servers.
- Content-Security-Policy and a longer HSTS time once HTTPS has been stable for a while.
- A static copy of the home page on a CDN (CloudFront) if many thousands of students refresh at the same time.
- Monitoring and alerts (for example an uptime check that messages you).

---

## 16. Sources used for the HTTPS part

- Let's Encrypt announcement of the first IP address certificate: https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate.html (check the page for the current status and limits)
- "6-day Certificates With Let's Encrypt and Caddy" (Caddy `profile shortlived` setting): https://cj.rs/blog/6days/
- Caddy automatic HTTPS documentation: https://caddyserver.com/docs/automatic-https
