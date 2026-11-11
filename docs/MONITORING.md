# Monitoring: know when the site is down before a scorer calls you

## The two check pages

| URL | Answers | Use |
|---|---|---|
| `/health` | always `200 {"ok":true,...}` while the Node app runs. Checks nothing else. | "Is the app process alive?" Used by `security-check.sh` for the HTTPS test. |
| `/ready` | `200 {"ok":true,"failed":[]}` only when Postgres AND Redis answer (2 s each). Otherwise `503 {"ok":false,"failed":["db"]}` or `["redis"]`. | **The uptime monitor watches this one.** |

`/ready` runs its checks at most once every 2 seconds, however often it is called, so it cannot overload the database.
It never shows error details, only which part failed.

Quick check on the server (Ubuntu bash): `docker compose exec -T app wget -qO- http://localhost:3000/ready; echo`

## Uptime monitor (UptimeRobot, free) - about 10 minutes

1. Browser: sign up at https://uptimerobot.com (free plan; check their current plan terms). Confirm your email.
2. **+ New monitor** (or "Add New Monitor").
3. **Monitor type:** HTTP(s).
4. **URL:** `https://<your DOMAIN or server IP>/ready` (the same address as `DOMAIN` in the server `.env`).
5. **Monitoring interval:** 5 minutes.
6. **Alert contacts:** your email (added automatically at sign-up). Tick it.
7. **Create monitor.** Within a few minutes it shows **Up** (green).

A 503 from `/ready`, a timeout, or no answer at all counts as **Down**, and you get an email. When it comes back, you get an **Up** email.

### Test the alert once
Make a second, temporary monitor with the URL `https://<your site>/this-page-does-not-exist` (it answers 404, so it is "down").
You must get a DOWN email within about 5-10 minutes. Then delete that test monitor.
Do NOT test by stopping the database on the live server.

### Two alarms, two jobs
- **healthchecks.io** (see `docs/BACKUPS.md`): emails you when **backups** stop.
- **UptimeRobot**: emails you when **the website** (or its database/Redis) stops answering.

### Planned maintenance or stopping the server
Pause the UptimeRobot monitor (and the healthchecks.io check) first, start them again afterwards.

## What to do when you get a DOWN email
1. Server (Ubuntu bash, `~/dreamcometrue`): `docker compose ps` (all 4 Up? db and redis "(healthy)"?)
2. `docker compose exec -T app wget -qO- http://localhost:3000/ready; echo` (which part failed?)
3. `docker compose logs --tail 50 app` (and `db` or `redis` if that part failed)
4. If a container is stopped: `docker compose up -d`. Never `docker compose down -v`.
5. More: `DEPLOY.md` section D.
