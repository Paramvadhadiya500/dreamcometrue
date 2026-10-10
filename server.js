const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { effectivePoints } = require("./engine");
const { getEngine } = require("./engines");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const app = express();
app.use(express.json());
app.use(express.static("public"));
const httpServer = createServer(app);
const io = new Server(httpServer);

// ---------- Redis: one client for the score cache, two for the Socket.IO adapter ----------
const cache = createClient({ url: REDIS_URL, disableOfflineQueue: true }); // fail fast if Redis is down
const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();
for (const c of [cache, pubClient, subClient]) {
  c.on("error", (e) => console.error("redis error:", e.message));
}

// ---------- score cache (shared by all servers) ----------
const CACHE_TTL = 60; // seconds: if Redis misses a write during an outage, a stale score lives at most this long

// Only store a state if it is newer than what is already there.
const SET_IF_NEWER = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local v = cjson.decode(cur).version
  if v > tonumber(ARGV[2]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

function buildState(match, events) {
  const engine = getEngine(match.sport);
  if (!engine) throw new Error("unknown sport: " + match.sport);
  const s = engine.compute(effectivePoints(events), match);
  const last = events.length ? Number(events[events.length - 1].seq) : 0;
  return { matchId: match.id, name: match.name, sport: match.sport, ...s, version: last };
}

async function loadStateFromDb(matchId) {
  const m = await pool.query("SELECT id, name, best_of, sport FROM matches WHERE id = $1", [matchId]);
  if (m.rowCount === 0) return null;
  const ev = await pool.query("SELECT seq, type, team, value FROM events WHERE match_id = $1 ORDER BY seq", [matchId]);
  return buildState(m.rows[0], ev.rows);
}

async function cacheState(state) {
  try {
    await cache.eval(SET_IF_NEWER, {
      keys: ["state:" + state.matchId],
      arguments: [JSON.stringify(state), String(state.version), String(CACHE_TTL)],
    });
  } catch (e) {
    console.error("cache write failed:", e.message);   // not fatal: the DB still has everything
  }
}

const inflight = new Map();   // matchId -> promise of a DB load already running

async function getState(matchId) {
  try {
    const hit = await cache.get("state:" + matchId);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    console.error("cache read failed:", e.message);   // Redis down: fall back to the DB
  }

  // 3000 students arriving at once must cause ONE database load, not 3000
  if (inflight.has(matchId)) return inflight.get(matchId);
  const p = loadStateFromDb(matchId)
    .then(async (s) => { if (s) await cacheState(s); return s; })
    .finally(() => inflight.delete(matchId));
  inflight.set(matchId, p);
  return p;
}

// ---------- permissions (asked from the database every time) ----------
async function canScore(user, matchId) {
  if (!user.username) return false;
  const r = await pool.query(
    `SELECT u.role, u.active,
            EXISTS (SELECT 1 FROM match_scorers ms
                    WHERE ms.username = u.username AND ms.match_id = $2) AS assigned
     FROM users u WHERE u.username = $1`,
    [user.username, matchId]
  );
  if (r.rowCount === 0) return false;
  const u = r.rows[0];
  if (!u.active) return false;
  return u.role === "admin" || (u.role === "scorer" && u.assigned);
}

// ---------- one scorer action = one transaction ----------
async function applyAction({ id, matchId, type, team, value }, username) {
  const client = await pool.connect();
  const fail = async (error) => {
    await client.query("ROLLBACK");
    return { ok: false, error };
  };
  try {
    await client.query("BEGIN");
    const m = await client.query(
      "SELECT id, name, best_of, sport FROM matches WHERE id = $1 FOR UPDATE", [matchId]
    );
    if (m.rowCount === 0) return await fail("unknown match");
    const engine = getEngine(m.rows[0].sport);
    if (!engine) return await fail("unknown sport");

    const ev = await client.query(
      "SELECT seq, type, team, value FROM events WHERE match_id = $1 ORDER BY seq", [matchId]
    );
    let state = buildState(m.rows[0], ev.rows);

    const dup = await client.query("SELECT 1 FROM events WHERE id = $1", [id]);
    if (dup.rowCount > 0) {
      await client.query("ROLLBACK");
      return { ok: true, duplicate: true, state };
    }

    if (type === "undo") {
      if (effectivePoints(ev.rows).length === 0) return await fail("nothing to undo");
    } else {
      const problem = engine.validate({ type, team, value }, state);   // the sport's own rules
      if (problem) return await fail(problem);
    }

    const savedTeam = type === "point" ? team : null;
    const savedValue = type === "point" && Number.isInteger(value) ? value : null;
    const ins = await client.query(
      "INSERT INTO events (id, match_id, type, team, value, by_user) VALUES ($1, $2, $3, $4, $5, $6) RETURNING seq",
      [id, matchId, type, savedTeam, savedValue, username]
    );
    ev.rows.push({ seq: ins.rows[0].seq, type, team: savedTeam, value: savedValue });
    state = buildState(m.rows[0], ev.rows);

    await client.query("COMMIT");
    return { ok: true, state };
  } catch (e) {
    console.error("applyAction failed:", e);
    try { await client.query("ROLLBACK"); } catch (_) { }
    return { ok: false, error: "server error", retry: true };
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
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !u.active || !ok) {
      return res.status(401).json({ error: "wrong username or password" });
    }
    const list = u.role === "admin"
      ? await pool.query("SELECT id, name, sport FROM matches ORDER BY id")
      : await pool.query(
        `SELECT m.id, m.name, m.sport FROM matches m
           JOIN match_scorers ms ON ms.match_id = m.id
           WHERE ms.username = $1 ORDER BY m.id`, [u.username]);
    const token = jwt.sign({ username: u.username }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, username: u.username, role: u.role, matches: list.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- list of matches for the student page (cached for 10 seconds) ----------
let matchListCache = { at: 0, rows: [] };
app.get("/api/matches", async (req, res) => {
  try {
    if (Date.now() - matchListCache.at > 10000) {
      const r = await pool.query("SELECT id, name, sport FROM matches ORDER BY id");
      matchListCache = { at: Date.now(), rows: r.rows };
    }
    res.json(matchListCache.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- simple health check (useful later for the load balancer) ----------
app.get("/health", (req, res) => res.json({ ok: true, port: PORT }));

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
    return next(new Error("invalid token"));
  }
  try {
    const r = await pool.query("SELECT role, active FROM users WHERE username = $1", [payload.username]);
    if (r.rowCount === 0 || !r.rows[0].active) return next(new Error("invalid token"));
    socket.data.user = { username: payload.username, role: r.rows[0].role };
    next();
  } catch (e) {
    console.error(e);
    next(new Error("server error"));
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
      socket.join(matchId);
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
      const { id, matchId, type, team, value } = msg || {};
      if (typeof id !== "string" || id.length === 0 || id.length > 64 ||
        typeof matchId !== "string" || typeof type !== "string") {
        return ack({ ok: false, error: "bad request" });
      }
      if (!(await canScore(socket.data.user, matchId))) {
        console.log("blocked:", socket.data.user, "->", matchId);
        return ack({ ok: false, error: "not allowed" });
      }

      const result = await applyAction({ id, matchId, type, team, value }, socket.data.user.username);

      if (result.ok) {
        await cacheState(result.state);
        // with the Redis adapter this reaches students on EVERY server
        if (!result.duplicate) io.to(matchId).emit("score:update", result.state);
      }
      ack(result);
    } catch (e) {
      console.error(e);
      ack({ ok: false, error: "server error", retry: true });
    }
  });
});

// ---------- start ----------
async function main() {
  await Promise.all([cache.connect(), pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  httpServer.listen(PORT, () => console.log("http://localhost:" + PORT));
}
main().catch((e) => { console.error("startup failed:", e.message); process.exit(1); });