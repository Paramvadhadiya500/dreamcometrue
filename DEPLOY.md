# Deploy and recovery runbook

Everything needed to rebuild this project from nothing. Keep secrets OUT of this file
(real IP, key file name, passwords live in a private note or password manager).

## What runs where
Phone -> Caddy (port 80) -> Node app (port 3000, Docker network only) -> Postgres + Redis (Docker network only)
All four run with `docker compose` on one EC2 server.

## Values to keep in a PRIVATE note (not in Git)
- AWS region: ap-south-1 (Mumbai) | instance type: ______ | Ubuntu 24.04 LTS | disk: 20 GiB gp3
- Elastic IP: ______ | key pair name + where the .pem file is saved: ______
- Security group: SSH 22 from my IP only, HTTP 80 + HTTPS 443 from anywhere. Nothing else.
- The server's `.env` (DB_PASSWORD, JWT_SECRET). Do NOT change DB_PASSWORD on a running database.
- Admin and scorer passwords.

## A. Rebuild on a new server (about 30 minutes)
1. Launch EC2 as above, attach the Elastic IP (or a new IP).
2. `sudo apt update && sudo apt install -y docker.io docker-compose-v2 git && sudo usermod -aG docker ubuntu`, then log in again.
3. `git clone <repo-url> && cd <repo>`
4. Create `.env` (`.env.example` comes in a later step; until then use this. DOMAIN = your domain name or IP for HTTPS, empty = plain HTTP):
   ```
   DOMAIN=
   ACME_PROFILE=classic
   DB_PASSWORD=<openssl rand -hex 16>
   JWT_SECRET=<openssl rand -hex 32>
   ```
5. `docker compose up -d db redis` (wait ~10 seconds)
6. `docker compose run --rm app node migrate.js`
7. EITHER restore the latest backup: `./scripts/restore.sh <backup.sql.gz>`
   OR start fresh: create your own admin with
   `docker compose run --rm app node add-user.js <name> admin '<password 10+ chars>'`.
   Do NOT run `seed.js` on a server: it creates demo users with known passwords (admin123, rahul123, neha123).
8. `docker compose up -d --build`, then `docker compose ps` (all four running).
9. Open `http://<ip>`, log in on `/scorer.html`.

## B. Normal update
Run on the Ubuntu server, in the project folder, in exactly this order:
```
./scripts/backup.sh
git pull
docker compose build
docker compose run --rm app ls migrations       # the new file must be listed (proves it is inside the image)
docker compose run --rm app node migrate.js     # must print "applied ..." for every new migration file
docker compose up -d
docker compose ps                               # all four running
curl -s http://localhost/health
```
Never `up -d --build` BEFORE `migrate.js`: that starts new code on the old database (lesson 5).
Rule for migrations: they may only ADD things (tables, columns). The old app keeps running until `up -d`, so it must still work on the new schema.
Redis flush is NOT part of a normal deploy (cached scores expire after 60 s). Only if an engine or the state shape changed: `docker compose exec redis redis-cli --scan --pattern 'state:*'` and delete those keys.
Why this order:
- The migration files are copied into the app image when it is built (`Dockerfile`: `COPY . .`, and nothing mounts the source folder). `migrate.js` only sees the files that are inside the LAST BUILT image, so build first. If you migrate before building, it says "up to date" and applies nothing.
- `docker compose build` does not stop the running app. The old app keeps working while the database changes (migrations only add things and can run twice). Only the last step, `up -d`, starts the new code, so new code never runs on an old database.
- Take the backup first. It is cheap, and it is the only way back if a migration goes wrong.

## C. Backups (full guide: `docs/BACKUPS.md`)
- Automatic: `./scripts/install-cron.sh` (hourly) or `./scripts/install-cron.sh daily`. Old backups are deleted after 7 days, but the newest 3 complete ones are always kept.
- Manual: `./scripts/backup.sh` (files go to ~/backups; a file is kept only if it is a complete dump)
- Check one file: `./scripts/check-backup.sh <file>`
- Off the server: automatic copy to S3, and an email alert when backups stop (heartbeat). Setup: `docs/BACKUPS.md` sections 3 and 4.
- Restore drill (safe, never touches live data): `./scripts/restore-drill.sh`
- EBS snapshot and server image (AMI) in the AWS console before big days
- Never commit backups to Git (they contain password hashes and all scores)

## D. Something broke
| Problem | Fix |
|---|---|
| New code is broken | `git checkout <last-good-tag>` then `docker compose up -d --build` |
| App crashes | `docker compose logs --tail 100 app` |
| Wrong or corrupted data | `./scripts/restore.sh <backup.sql.gz>` |
| Server gone | Section A, or launch from the AMI and attach the Elastic IP |
| Cannot SSH | Security group: set SSH to "My IP" again, or use EC2 Instance Connect |
| Lost .env | Make a new JWT_SECRET (scorers log in again). DB_PASSWORD must match the old database volume, otherwise restore a backup into a new database. |

## E. HTTPS, passwords and checks (Lesson 12)
- Switch HTTPS on: set `DOMAIN` (and `ACME_PROFILE`) in `.env`, then `docker compose up -d`. Know the rollback first (next line).
- Rollback to plain HTTP: `DOMAIN=:80` in `.env`, then `docker compose up -d caddy`.
- Weak passwords: `docker compose run --rm app node check-passwords.js`
- Before the event and after every deploy: `./scripts/security-check.sh` (no FAIL allowed).
- Locked out by the login limit while testing: `docker compose restart app`.
- Server size and load test (Lesson 13): `./scripts/snapshot.sh` shows the instance type and memory; `./scripts/add-swap.sh` once; `./scripts/watch-load.sh` while testing; resize for event days: LESSON_13.md sections 5 and 7.

## F. Reminders
- Free plan accounts close when credits or 6 months run out. Check Billing -> Credits.
- Budget alarm set? Elastic IP released only when the project is finished.
- `docker compose down -v` DELETES the database. Never use `-v`.
