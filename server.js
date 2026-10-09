const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { computeTableTennis, effectivePoints } = require("./engine");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const app = express();
app.use(express.json());
app.use(express.static("public"));
const httpServer = createServer(app);
const io = new Server(httpServer);

// ---------- state: database is the truth, this Map is only a cache ----------
const stateCache = new Map();

function buildState(match, events) {
  const s = computeTableTennis(effectivePoints(events), match.best_of);
  const last = events.length ? Number(events[events.length - 1].seq) : 0;
  return { matchId: match.id, name: match.name, ...s, version: last };
}

async function loadState(matchId) {
  const m = await pool.query("SELECT id, name, best_of FROM matches WHERE id = $1", [matchId]);
  if (m.rowCount === 0) return null;
  const ev = await pool.query("SELECT seq, type, team FROM events WHERE match_id = $1 ORDER BY seq", [matchId]);
  return buildState(m.rows[0], ev.rows);
}

function cacheState(state) {
  const old = stateCache.get(state.matchId);
  if (!old || state.version >= old.version) stateCache.set(state.matchId, state);
}

async function getState(matchId) {
  if (stateCache.has(matchId)) return stateCache.get(matchId);
  const s = await loadState(matchId);
  if (s) cacheState(s);
  return s;
}

// ---------- permissions (asked from the database every time) ----------
async function canScore(user, matchId) {
  if (!user.username) return false;                      // anonymous student
  const r = await pool.query(
    `SELECT u.role, u.active,
            EXISTS (SELECT 1 FROM match_scorers ms
                    WHERE ms.username = u.username AND ms.match_id = $2) AS assigned
     FROM users u WHERE u.username = $1`,
    [user.username, matchId]
  );
  if (r.rowCount === 0) return false;
  const u = r.rows[0];
  if (!u.active) return false;                           // disabled account
  return u.role === "admin" || (u.role === "scorer" && u.assigned);
}

// ---------- one scorer action = one transaction ----------
async function applyAction({ id, matchId, type, team }, username) {
  const client = await pool.connect();
  const fail = async (error) => {
    await client.query("ROLLBACK");
    return { ok: false, error };
  };
  try {
    await client.query("BEGIN");

    // Lock this match's row. Other actions for the SAME match wait here;
    // actions for other matches are not blocked.
    const m = await client.query(
      "SELECT id, name, best_of FROM matches WHERE id = $1 FOR UPDATE", [matchId]
    );
    if (m.rowCount === 0) return await fail("unknown match");

    const ev = await client.query(
      "SELECT seq, type, team FROM events WHERE match_id = $1 ORDER BY seq", [matchId]
    );
    let state = buildState(m.rows[0], ev.rows);

    const dup = await client.query("SELECT 1 FROM events WHERE id = $1", [id]);
    if (dup.rowCount > 0) {
      await client.query("ROLLBACK");
      return { ok: true, duplicate: true, state };
    }

    if (type === "point") {
      if (team !== "A" && team !== "B") return await fail("bad team");
      if (state.winner) return await fail("match already finished");
    } else if (type === "undo") {
      if (effectivePoints(ev.rows).length === 0) return await fail("nothing to undo");
    } else {
      return await fail("unknown action");
    }

    const savedTeam = type === "point" ? team : null;
    const ins = await client.query(
      "INSERT INTO events (id, match_id, type, team, by_user) VALUES ($1, $2, $3, $4, $5) RETURNING seq",
      [id, matchId, type, savedTeam, username]
    );

    ev.rows.push({ seq: ins.rows[0].seq, type, team: savedTeam });
    state = buildState(m.rows[0], ev.rows);

    await client.query("COMMIT");
    return { ok: true, state };
  } catch (e) {
    console.error("applyAction failed:", e);
    try { await client.query("ROLLBACK"); } catch (_) { }
    return { ok: false, error: "server error", retry: true };   // temporary: phone should retry
  } finally {
    client.release();
  }
}

// ---------- login ----------
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(401).json({ error: "wrong username or password" });
    }

    const r = await pool.query(
      "SELECT username, password_hash, role, active FROM users WHERE username = $1", [username]
    );
    const u = r.rows[0];

    // always run one bcrypt compare, so unknown usernames take the same time
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !u.active || !ok) {
      return res.status(401).json({ error: "wrong username or password" });
    }

    const list = u.role === "admin"
      ? await pool.query("SELECT id, name FROM matches ORDER BY id")
      : await pool.query(
        `SELECT m.id, m.name FROM matches m
           JOIN match_scorers ms ON ms.match_id = m.id
           WHERE ms.username = $1 ORDER BY m.id`, [u.username]);

    const token = jwt.sign({ username: u.username }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, username: u.username, role: u.role, matches: list.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- socket authentication ----------
io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    socket.data.user = { role: "student" };
    return next();
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return next(new Error("invalid token"));             // bad or expired token
  }

  try {
    const r = await pool.query("SELECT role, active FROM users WHERE username = $1", [payload.username]);
    if (r.rowCount === 0 || !r.rows[0].active) return next(new Error("invalid token"));
    socket.data.user = { username: payload.username, role: r.rows[0].role };
    next();
  } catch (e) {
    console.error(e);
    next(new Error("server error"));                     // database problem, NOT a bad token
  }
});

// ---------- socket events ----------
io.on("connection", (socket) => {
  socket.on("join-match", async (matchId) => {
    if (typeof matchId !== "string") return;
    try {
      for (const room of [...socket.rooms]) {
        if (room !== socket.id) socket.leave(room);
      }
      socket.join(matchId);                 // join FIRST so no update is missed
      const state = await getState(matchId);
      if (!state) { socket.leave(matchId); return; }
      socket.emit("score:update", state);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("score:action", async (msg, ack) => {
    if (typeof ack !== "function") return;
    try {
      const { id, matchId, type, team } = msg || {};
      if (typeof id !== "string" || id.length === 0 || id.length > 64 ||
        typeof matchId !== "string" || typeof type !== "string") {
        return ack({ ok: false, error: "bad request" });
      }

      if (!(await canScore(socket.data.user, matchId))) {
        console.log("blocked:", socket.data.user, "->", matchId);
        return ack({ ok: false, error: "not allowed" });
      }

      const result = await applyAction({ id, matchId, type, team }, socket.data.user.username);

      if (result.ok) {
        cacheState(result.state);
        if (!result.duplicate) io.to(matchId).emit("score:update", result.state);
      }
      ack(result);
    } catch (e) {
      console.error(e);
      ack({ ok: false, error: "server error", retry: true });
    }
  });
});

httpServer.listen(3000, () => console.log("http://localhost:3000"));