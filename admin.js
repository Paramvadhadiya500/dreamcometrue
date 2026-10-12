// Admin API: create and edit matches, manage scorers. Every route needs a logged-in admin.
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getEngine } = require("./engines");
const cricket = require("./engines/cricket");

const SPORT_LABELS = { cricket: "Cricket", table_tennis: "Table Tennis", simple: "Other" };
const SPORT_PREFIX = { cricket: "cr", table_tennis: "tt", simple: "sm" };

class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- checking what the admin typed ----------
function text(value, label, { max = 40, required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new Problem(label + " must be text");
  const t = value.replace(/\s+/g, " ").trim();
  if (/[\u0000-\u001f\u007f]/.test(t)) throw new Problem(label + " has invalid characters");
  if (required && !t) throw new Problem(label + " is required");
  if (t.length > max) throw new Problem(label + " is too long (at most " + max + " characters)");
  return t;
}

function parseMatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Problem("bad request");

  const sport = body.sport;
  if (typeof sport !== "string" || !getEngine(sport)) throw new Problem("choose a sport");

  const competition = text(body.competition, "Competition");
  const stage = body.stage === undefined || body.stage === null || body.stage === "" ? "group" : body.stage;
  if (stage !== "group" && stage !== "knockout") throw new Problem("stage must be group or knockout");

  const teamA = text(body.teamA, "Team A");
  const teamB = text(body.teamB, "Team B");
  if ((teamA || teamB) && (!teamA || !teamB)) throw new Problem("give both team names, or leave both empty");
  if (teamA && teamA.toLowerCase() === teamB.toLowerCase()) throw new Problem("the two teams must be different");

  const venue = text(body.venue, "Venue");

  let name = text(body.name, "Match name", { max: 80 });
  if (!name) {
    if (!teamA) throw new Problem("give a match name, or both team names");
    name = ((competition || SPORT_LABELS[sport]) + ": " + teamA + " vs " + teamB).slice(0, 80);
  }

  let startTime = null;
  if (body.startTime !== undefined && body.startTime !== null && body.startTime !== "") {
    if (typeof body.startTime !== "string") throw new Problem("date and time is not valid");
    const d = new Date(body.startTime);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 2020 || d.getFullYear() > 2100) {
      throw new Problem("date and time is not valid");
    }
    startTime = d;
  }

  let bestOf = 3;
  let config = {};
  if (sport === "table_tennis") {
    bestOf = body.bestOf === undefined || body.bestOf === null ? 3 : body.bestOf;
    if (![1, 3, 5, 7].includes(bestOf)) throw new Problem("best of must be 1, 3, 5 or 7");
  } else if (sport === "cricket") {
    const c = body.config && typeof body.config === "object" ? body.config : {};
    config = {
      overs: c.overs,
      players: c.players,
      firstBatting: c.firstBatting === undefined ? "A" : c.firstBatting,
      freeHit: c.freeHit === undefined ? true : c.freeHit,
    };
    const problem = cricket.checkConfig(config);
    if (problem) throw new Problem(problem);
  }

  let scorers;
  if (body.scorers !== undefined) {
    if (!Array.isArray(body.scorers) || body.scorers.length > 50 || body.scorers.some((x) => typeof x !== "string")) {
      throw new Problem("scorers must be a list of usernames");
    }
    scorers = [...new Set(body.scorers)];
  }

  return { name, sport, competition, stage, teamA, teamB, venue, startTime, bestOf, config, scorers };
}

function checkMatchId(id) {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Problem("match not found", 404);
  return id;
}

function checkUsername(u) {
  if (typeof u !== "string" || !/^[a-z0-9_]{3,20}$/.test(u)) {
    throw new Problem("username: 3 to 20 characters, only lowercase letters, digits and _");
  }
  return u;
}

const newPassword = () => crypto.randomBytes(6).toString("hex");   // 12 letters and digits

// ---------- the router ----------
function createAdminRouter({ pool, requireAdmin, afterMatchChange }) {
  const router = express.Router();
  router.use(requireAdmin);

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof Problem) return res.status(e.status).json({ error: e.message });
      console.error("admin error:", e);
      res.status(500).json({ error: "server error" });
    }
  };

  // every scorer name must exist, be a scorer, and be unique
  async function checkScorers(client, names) {
    if (!names || names.length === 0) return;
    const r = await client.query("SELECT username FROM users WHERE role = 'scorer' AND username = ANY($1::text[])", [names]);
    if (r.rowCount !== names.length) throw new Problem("one of the scorers does not exist");
  }

  async function setScorers(client, matchId, names) {
    await client.query("DELETE FROM match_scorers WHERE match_id = $1", [matchId]);
    for (const u of names) {
      await client.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [u, matchId]);
    }
  }

  // ----- overview: everything the admin page needs in one call -----
  router.get("/overview", wrap(async (req, res) => {
    const matches = await pool.query(
      `SELECT m.id, m.name, m.sport, m.best_of, m.config, m.team_a, m.team_b, m.competition, m.stage, m.venue, m.start_time,
              (SELECT count(*) FROM events e WHERE e.match_id = m.id)::int AS events
       FROM matches m
       ORDER BY m.start_time ASC NULLS LAST, m.created_at ASC, m.id ASC
       LIMIT 1000`
    );
    const assigned = await pool.query("SELECT match_id, username FROM match_scorers ORDER BY username");
    const users = await pool.query(
      `SELECT u.username, u.role, u.active,
              (SELECT count(*) FROM match_scorers s WHERE s.username = u.username)::int AS matches
       FROM users u ORDER BY u.role, u.username`
    );

    const byMatch = {};
    for (const a of assigned.rows) (byMatch[a.match_id] = byMatch[a.match_id] || []).push(a.username);

    const teams = new Set();
    const competitions = new Set();
    const list = matches.rows.map((m) => {
      if (m.team_a) teams.add(m.team_a);
      if (m.team_b) teams.add(m.team_b);
      if (m.competition) competitions.add(m.competition);
      return {
        id: m.id,
        name: m.name,
        sport: m.sport,
        bestOf: m.best_of,
        config: m.sport === "cricket" ? cricket.normalizeConfig(m.config) : {},
        teamA: m.team_a,
        teamB: m.team_b,
        competition: m.competition,
        stage: m.stage,
        venue: m.venue,
        startTime: m.start_time ? new Date(m.start_time).toISOString() : null,
        events: m.events,
        scorers: byMatch[m.id] || [],
      };
    });

    res.json({
      matches: list,
      users: users.rows,
      teams: [...teams].sort((a, b) => a.localeCompare(b)),
      competitions: [...competitions].sort((a, b) => a.localeCompare(b)),
    });
  }));

  // ----- create a match -----
  router.post("/matches", wrap(async (req, res) => {
    const m = parseMatch(req.body);
    const client = await pool.connect();
    try {
      let id = null;
      for (let attempt = 0; attempt < 5 && id === null; attempt++) {
        const candidate = SPORT_PREFIX[m.sport] + "-" + crypto.randomBytes(3).toString("hex");
        await client.query("BEGIN");
        try {
          await checkScorers(client, m.scorers);
          await client.query(
            `INSERT INTO matches (id, name, sport, best_of, config, team_a, team_b, competition, stage, venue, start_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [candidate, m.name, m.sport, m.bestOf, JSON.stringify(m.config), m.teamA, m.teamB, m.competition, m.stage, m.venue, m.startTime]
          );
          if (m.scorers) await setScorers(client, candidate, m.scorers);
          await client.query("COMMIT");
          id = candidate;
        } catch (e) {
          await client.query("ROLLBACK");
          if (e && e.code === "23505") continue;           // that id exists already: try another one
          throw e;
        }
      }
      if (id === null) throw new Problem("could not create the match, please try again", 500);
      await afterMatchChange(id);
      res.json({ ok: true, id });
    } finally {
      client.release();
    }
  }));

  // ----- edit a match -----
  router.put("/matches/:id", wrap(async (req, res) => {
    const id = checkMatchId(req.params.id);
    const m = parseMatch(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const cur = await client.query("SELECT id, sport, best_of, config FROM matches WHERE id = $1 FOR UPDATE", [id]);
        if (cur.rowCount === 0) throw new Problem("match not found", 404);

        const ev = await client.query("SELECT count(*)::int AS n FROM events WHERE match_id = $1", [id]);
        if (ev.rows[0].n > 0) {
          const old = cur.rows[0];
          const sameSettings =
            old.sport === m.sport &&
            old.best_of === m.bestOf &&
            (m.sport !== "cricket" || JSON.stringify(cricket.normalizeConfig(old.config)) === JSON.stringify(m.config));
          if (!sameSettings) throw new Problem("scoring has started, so the sport and its settings can no longer be changed", 409);
        }

        await checkScorers(client, m.scorers);
        await client.query(
          `UPDATE matches SET name = $2, sport = $3, best_of = $4, config = $5, team_a = $6, team_b = $7,
                  competition = $8, stage = $9, venue = $10, start_time = $11
           WHERE id = $1`,
          [id, m.name, m.sport, m.bestOf, JSON.stringify(m.config), m.teamA, m.teamB, m.competition, m.stage, m.venue, m.startTime]
        );
        if (m.scorers) await setScorers(client, id, m.scorers);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    } finally {
      client.release();
    }
    await afterMatchChange(id);
    res.json({ ok: true, id });
  }));

  // ----- delete a match (a match with scores needs the word DELETE as confirmation) -----
  router.delete("/matches/:id", wrap(async (req, res) => {
    const id = checkMatchId(req.params.id);
    const confirm = req.body && req.body.confirm;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const cur = await client.query("SELECT id FROM matches WHERE id = $1 FOR UPDATE", [id]);
        if (cur.rowCount === 0) throw new Problem("match not found", 404);
        const ev = await client.query("SELECT count(*)::int AS n FROM events WHERE match_id = $1", [id]);
        if (ev.rows[0].n > 0 && confirm !== "DELETE") {
          throw new Problem("this match has " + ev.rows[0].n + " scoring actions. Send confirm: DELETE to delete it with its scores", 409);
        }
        await client.query("DELETE FROM events WHERE match_id = $1", [id]);
        await client.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
        await client.query("DELETE FROM matches WHERE id = $1", [id]);
        await client.query("COMMIT");
        if (ev.rows[0].n > 0) console.log("admin", req.user.username, "deleted match", id, "with", ev.rows[0].n, "events");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    } finally {
      client.release();
    }
    await afterMatchChange(id, { removed: true });
    res.json({ ok: true });
  }));

  // ----- scorers -----
  router.post("/users", wrap(async (req, res) => {
    const username = checkUsername(req.body && req.body.username);
    const password = newPassword();
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      "INSERT INTO users (username, password_hash, role, active) VALUES ($1, $2, 'scorer', TRUE) ON CONFLICT (username) DO NOTHING",
      [username, hash]
    );
    if (r.rowCount === 0) throw new Problem("that username already exists", 409);
    res.json({ ok: true, username, password });          // the password is shown ONCE
  }));

  router.post("/users/:username/reset", wrap(async (req, res) => {
    const username = checkUsername(req.params.username);
    const password = newPassword();
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query("UPDATE users SET password_hash = $2, active = TRUE WHERE username = $1 AND role = 'scorer'", [username, hash]);
    if (r.rowCount === 0) throw new Problem("scorer not found", 404);
    res.json({ ok: true, username, password });
  }));

  router.post("/users/:username/active", wrap(async (req, res) => {
    const username = checkUsername(req.params.username);
    const active = req.body && req.body.active;
    if (typeof active !== "boolean") throw new Problem("active must be true or false");
    const r = await pool.query("UPDATE users SET active = $2 WHERE username = $1 AND role = 'scorer'", [username, active]);
    if (r.rowCount === 0) throw new Problem("scorer not found", 404);
    res.json({ ok: true, username, active });
  }));

  return router;
}

module.exports = { createAdminRouter };
