# Contributing to College Live Score

Welcome. This guide is for a friend who knows web development but has not seen this project before. Read it once before you touch anything.

---

## 1. What this project is

**College Live Score** is a live-score website for a college sports month: about 20 games, many matches at the same time, up to 10,000 students watching on their phones.

A volunteer scorer enters events (a cricket ball, a table tennis point) on a phone. Students watching on their own phones see the score within a few seconds. The admin creates matches and assigns scorers through an admin panel.

**Goal: reliable and simple.** Not feature-rich — events score for a few hours, then it is over. Uptime and correctness matter more than anything.

**Owner:** Param Vadhadiya (3rd year B.Tech CSE, solo developer).

---

## 2. Quick start on a laptop

### What you need

- Node.js 22+
- Docker Desktop (running)
- A local PostgreSQL instance (the project uses a Windows Postgres service by default) or Docker for Postgres too
- A local Redis instance (`docker start redis` or similar)

### Setup steps (Windows PowerShell, inside the project folder)

1. **Install dependencies**

   ```powershell
   npm install
   ```

2. **Create your `.env` file.** Copy `.env.example` to `.env` and use its LAPTOP block, like this:

   ```
   DATABASE_URL=postgres://livescore:<your-local-db-password>@localhost:5432/livescore
   REDIS_URL=redis://localhost:6379
   JWT_SECRET=<any-long-random-string-for-local-use>
   ```

   Never commit `.env`. Check: `git check-ignore -v .env` must print a rule. (`.gitignore` lists `.env`.)

3. **Start Redis** (if not already running):

   ```powershell
   docker start redis
   ```

   > **Note:** `docker start redis` assumes you already have a Redis container named `redis`. If not, run `docker run -d --name redis -p 6379:6379 redis:7` once.

4. **Apply database migrations:**

   ```powershell
   node migrate.js
   ```

   Must print `applied 001_init.sql` … `applied 004_admin_home.sql` (or `Database is up to date` if already applied).

5. **(Optional) Seed demo data:**

   ```powershell
   node seed.js
   ```

   Creates demo users and two table tennis matches. Demo passwords are intentionally weak — never use `seed.js` on the real server.

6. **Run the tests:**

   ```powershell
   node test.js
   ```

   Must print: `All tests passed`

   Integration test (the real server against a throwaway Postgres and Redis in Docker; does not touch your own database):

   ```powershell
   docker compose -f docker-compose.test.yml up -d --wait
   npm run test:integration
   docker compose -f docker-compose.test.yml down
   ```

   Must print: `All integration tests passed`. It refuses to run on a database whose name does not end in `_test`.

7. **Start the server:**

   ```powershell
   node server.js
   ```

   Open `http://localhost:3000` (student home), `http://localhost:3000/scorer.html` (scorer), `http://localhost:3000/admin.html` (admin).

> **Important:** `node test.js` is the one command you must run before every pull request. The test suite covers all scoring rules, undo, the cricket engine (400 random games), points-table logic, login limiting, and request limits.

---

## 3. How we work

### Branches and pull requests

- Branch off `main` for every change.
- Keep pull requests small — one feature or one fix per PR.
- A PR must pass `node test.js` with `All tests passed` before review.
- The owner reviews every PR before merge.

### What contributors never get

- SSH or console access to the production server.
- The production `.env` (DB password, JWT secret).
- Admin or scorer passwords for the live event.

This is not distrust — it limits the blast radius if anything goes wrong.

### Files you must never commit

| File / Pattern | Why |
|---|---|
| `.env` | Contains the database password and JWT secret |
| `backups/`, `*.sql.gz` | Contain password hashes and all scores |
| `*.pem` | SSH key files |

### Migrations are forward-only

- Migrations live in `migrations/` and are numbered (`001_init.sql`, `002_add_sport.sql`, …).
- `migrate.js` applies each file in alphabetical order and records it in `schema_migrations`.
- **Never edit a migration that was already applied.** It has already run on the production database. Changes to it are silently ignored there.
- To change the schema: add a new numbered file (`005_your_change.sql`). Write it with `IF NOT EXISTS` or similar guards so it is safe to run twice.

### Deploying (owner only, on the Ubuntu server)

One order, always (full text and reasons: `DEPLOY.md` section B):

```
./scripts/backup.sh
git pull
docker compose build
docker compose run --rm app ls migrations
docker compose run --rm app node migrate.js
docker compose up -d
docker compose ps
docker compose exec -T app wget -qO- http://localhost:3000/ready; echo
```

Build first (migration files live inside the image), migrate second, start new code last. Migrations must only add things. Never `docker compose down -v`.

---

## 4. Code rules

### Folder map

```
server.js         Main entry point: Express routes, Socket.IO events, Redis wiring
home.js           Builds /api/home and /api/standings (cached 3 s, compressed)
admin.js          Admin API router (/api/admin/*)
standings.js      Pure points-table logic (no database calls)
engine.js         Table tennis rules + effectivePoints() (undo handling)
engines/
  index.js        Registry: getEngine(sport) -> engine object or null
  tableTennis.js  Table tennis adapter (wraps engine.js)
  simple.js       Generic score engine (any sport with additive points)
  cricket.js      Cricket engine
db.js             PostgreSQL pool (reads DATABASE_URL)
rateLimit.js      In-memory sliding-window failure counter
migrate.js        Applies migrations in order
test.js           Unit tests (no database needed)
test-integration.js  Scoring write path against a real Postgres + Redis (see section 2, step 6)
docker-compose.test.yml  Throwaway Postgres + Redis for test-integration.js (high ports, data in memory)
loadtest-real.js  Realistic traffic simulator (use on a load machine, not in production)
scripts/          Server-side shell scripts (backup, restore, snapshot, security-check, …)
migrations/       Numbered SQL files
public/           Static HTML pages (index, match, scorer, admin)
```

### Naming

- Files: `camelCase.js` for Node modules, `kebab-case.sh` for scripts.
- Database columns: `snake_case`. JavaScript object keys that mirror DB columns: also `snake_case` from queries; camelCase in constructed objects (e.g. `teamA`, `startTime`).
- Socket event names: `noun:verb` style (`score:action`, `score:update`, `join-match`).

### Engine registry (`engines/index.js`)

The registry maps a sport string to an engine object:

```js
const engines = {
  table_tennis: require('./tableTennis'),
  simple:       require('./simple'),
  cricket:      require('./cricket'),
};
function getEngine(sport) {
  return Object.hasOwn(engines, sport) ? engines[sport] : null;
}
```

Each engine must export:
- `compute(events, match) -> state` — replays the event log and returns the current state.
- `validate(action, state) -> string | null` — returns an error message or `null` if the action is allowed. The server handles `undo` itself; engines do not need to validate it.
- `result(state) -> { finished, winner, forA, forB, ... }` — facts for the points table.
- `headline(state, names) -> string` — one-line score for the home page list. `names` is `{ A: "...", B: "..." }`.
- `clean(action) -> data | null` — *(optional)* sanitises the action's `data` field before it is stored. Return only the fields you trust.
- `checkConfig(config) -> string | null`, `normalizeConfig(config) -> config` — *(cricket only; include in new engines if they have match settings)*.

### Errors and validation

- `validate()` returns a plain string message on failure, `null` on success.
- HTTP routes return `{ error: "..." }` JSON with the appropriate status code.
- Socket actions use an ack callback: `ack({ ok: false, error: "..." })` on failure.
- Use `console.error(e)` for unexpected server-side errors; never swallow errors silently.
- Never show raw error messages from the database or Node to the client.

### What to avoid

- Do not call `effectivePoints` inside an engine's `compute`. The server calls it before passing the event list; `compute` receives the already-filtered list.
- Do not make database calls inside an engine. Engines are pure functions.
- Do not use `innerHTML` on user-supplied text. All pages use `textContent` to prevent XSS.
- Do not add `ports:` in `docker-compose.yml` for `db` or `redis`. They must stay off the internet.
- Do not set `TRUST_PROXY=1` on a local laptop (only the server behind Caddy should use it).

---

## 5. How to add a sport engine

> **Note:** The engine interface is still evolving. Cricket added `parseBall`, `checkConfig`, and `normalizeConfig` that the other engines do not have. Check the latest engine files before you start, and confirm the interface with the owner.

### Steps

1. Create `engines/<yourSport>.js`. Implement `compute`, `validate`, `result`, and `headline` (see section 4 above).
2. Add one line to `engines/index.js`:
   ```js
   your_sport: require('./yourSport'),
   ```
3. Add a migration if the sport needs settings stored in `matches.config`.
4. Add tests to `test.js`. At minimum:
   - A basic scoring sequence that reaches a winner.
   - An undo that reverses the last action.
   - Validation of an invalid action.
   - `result()` and `headline()` on a finished state.
5. Run `node test.js` and confirm `All tests passed`.
6. Test manually: create a match with the new sport via the admin panel, score a point, check the home page.

### What the scorer page needs

The cricket scorer page (`public/scorer.html`) has cricket-specific UI. For a new sport with a simple "add points" interface, the existing generic mode may be enough. For sports with structured actions (like cricket balls), you will need new scorer UI — confirm scope with the owner first.

---

## 6. Good first tasks for a newcomer

These are small, safe, and self-contained:

1. **Add a `checkConfig` / `normalizeConfig` to `simple.js`** — the simple engine currently has no config validation. Model it on the cricket engine. Add tests.

2. **Write a football engine** (halves, goals, possibly cards as a future add-on) — `compute`, `validate`, `result`, `headline`. The halftime/full-time logic is the main challenge. Add tests.

3. **Write tests for `home.js` logic** — the `buildStandings` function in `standings.js` is well-tested, but the `createHome` function is not unit-tested directly. Add lightweight tests.

4. **Fix the `watch-load.sh` connection counter** — `ss` reads host network stats, but Docker bridges hide connections from the host so it always prints 0. The fix is to count connections from inside the Caddy container (e.g. `docker compose exec caddy sh -c "..."`) or drop the counter. See `docs/LESSONS.md` for context.

5. **Add a `docs/` subfolder index** — create `docs/README.md` that links to `ARCHITECTURE.md`, `LESSONS.md`, and `ROADMAP.md` with a one-sentence description of each.

