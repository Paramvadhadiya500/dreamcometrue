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
4. Create `.env`:
   ```
   DOMAIN=
   DB_PASSWORD=<openssl rand -hex 16>
   JWT_SECRET=<openssl rand -hex 32>
   ```
5. `docker compose up -d db redis` (wait ~10 seconds)
6. `docker compose run --rm app node migrate.js`
7. EITHER restore the latest backup: `./scripts/restore.sh <backup.sql.gz>`
   OR start fresh: `docker compose run --rm app node seed.js`, then set real passwords with
   `docker compose run --rm app node add-user.js <name> <admin|scorer> '<password 10+ chars>'`
   and disable demo users.
8. `docker compose up -d --build`, then `docker compose ps` (all four running).
9. Open `http://<ip>`, log in on `/scorer.html`.

## B. Normal update
```
git pull
docker compose run --rm app node migrate.js
docker compose up -d --build
```
Take a backup first when the update changes the database: `./scripts/backup.sh`

## C. Backups
- Manual: `./scripts/backup.sh` (files go to ~/backups on the server)
- Hourly cron during events (see lesson 8 step 12)
- Copy backups OFF the server: `scp -i <key>.pem ubuntu@<ip>:~/backups/<file> .`
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

## E. Reminders
- Free plan accounts close when credits or 6 months run out. Check Billing -> Credits.
- Budget alarm set? Elastic IP released only when the project is finished.
- `docker compose down -v` DELETES the database. Never use `-v`.