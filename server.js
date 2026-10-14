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
const { createHome } = require("./home");
const { competitionOf } = require("./standings");
const { createAdminRouter } = require("./admin");
const { FailureLimiter } = require("./rateLimit");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const app = express();
app.disable("x-powered-by");
// Behind Caddy the real visitor address is in X-Forwarded-For. TRUST_PROXY=1 means "one proxy (Caddy) sits in front".
// Leave it unset when running without a proxy, otherwise a visitor could fake their address.
const proxyHops = Number.parseInt(process.env.TRUST_PROXY || "0", 10);
if (proxyHops > 0) app.set("trust proxy", proxyHops);
app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 10000 });   // no message from a phone needs more than 10 KB

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

// Team names shown to students; "Team A" / "Team B" when the admin gave none.
function teamNames(match) {
  return { A: (match.team_a || "").trim() || "Team A", B: (match.team_b || "").trim() || "Team B" };
}

function buildState(match, events) {
  const engine = getEngine(match.sport);
  if (!engine) throw new Error("unknown sport: " + match.sport);
  const s = engine.compute(effectivePoints(events), match);
  const last = events.length ? Number(events[events.length - 1].seq) : 0;
  const names = teamNames(match);
  const state = { matchId: match.id, name: match.name, sport: match.sport, teamA: names.A, teamB: names.B, ...s, version: last };
  // the cricket engine writes "Team A won by ..."; show the real team names instead
  if (typeof state.resultText === "string") {
    state.resultText = state.resultText.replace(/\bTeam ([AB])\b/g, (_, t) => names[t]);
  }
  return state;
}

async function loadStateFromDb(matchId) {
  const m = await pool.query("SELECT id, name, best_of, sport, config, team_a, team_b FROM matches WHERE id = $1", [matchId]);
  if (m.rowCount === 0) return null;
  const ev = await pool.query("SELECT seq, type, team, value, data FROM events WHERE match_id = $1 ORDER BY seq", [matchId]);
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
async function applyAction({ id, matchId, type, team, value, data }, username) {
  const client = await pool.connect();
  const fail = async (error) => {
    await client.query("ROLLBACK");
    return { ok: false, error };
  };
  try {
    await client.query("BEGIN");
    const m = await client.query(
      "SELECT id, name, best_of, sport, config, team_a, team_b FROM matches WHERE id = $1 FOR UPDATE", [matchId]
    );
    if (m.rowCount === 0) return await fail("unknown match");
    const engine = getEngine(m.rows[0].sport);
    if (!engine) return await fail("unknown sport");

    const ev = await client.query(
      "SELECT seq, type, team, value, data FROM events WHERE match_id = $1 ORDER BY seq", [matchId]
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
      const problem = engine.validate({ type, team, value, data }, state);   // the sport's own rules
      if (problem) return await fail(problem);
    }

    const savedTeam = type === "point" ? team : null;
    const savedValue = type === "point" && Number.isInteger(value) ? value : null;
    // only the engine's cleaned copy is stored, never the raw input from the phone
    const savedData = type !== "undo" && engine.clean ? engine.clean({ type, team, value, data }) || null : null;
    const ins = await client.query(
      "INSERT INTO events (id, match_id, type, team, value, data, by_user) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING seq",
      [id, matchId, type, savedTeam, savedValue, savedData ? JSON.stringify(savedData) : null, username]
    );
    ev.rows.push({ seq: ins.rows[0].seq, type, team: savedTeam, value: savedValue, data: savedData });
    state = buildState(m.rows[0], ev.rows);

    await client.query("COMMIT");
    return { ok: true, state };
  } catch (e) {
    console.error("applyAction failed:", e);
    try { await client.query("ROLLBACK"); } catch (_) {}
    return { ok: false, error: "server error", retry: true };
  } finally {
    client.release();
  }
}

// ---------- who is calling (for the HTTP routes) ----------
async function userFromRequest(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  let payload;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET);
  } catch (e) {
    return null;                                           // bad or expired token
  }
  if (!payload || typeof payload.username !== "string") return null;
  const r = await pool.query("SELECT username, role, active FROM users WHERE username = $1", [payload.username]);
  if (r.rowCount === 0 || !r.rows[0].active) return null;
  return { username: r.rows[0].username, role: r.rows[0].role };
}

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const user = await userFromRequest(req);
      if (!user) return res.status(401).json({ error: "login required" });
      if (!roles.includes(user.role)) return res.status(403).json({ error: "not allowed" });
      req.user = user;
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "server error" });
    }
  };
}

// the matches a scorer may score (an admin may score all of them)
async function listMatchesFor(username, role) {
  const r = role === "admin"
    ? await pool.query("SELECT id, name, sport FROM matches ORDER BY start_time ASC NULLS LAST, created_at ASC, id ASC")
    : await pool.query(
        `SELECT m.id, m.name, m.sport FROM matches m
         JOIN match_scorers ms ON ms.match_id = m.id
         WHERE ms.username = $1
         ORDER BY m.start_time ASC NULLS LAST, m.created_at ASC, m.id ASC`, [username]);
  return r.rows;
}

// ---------- login (with limits on failed attempts) ----------
// 5 wrong passwords for one username from one address, or 40 wrong attempts from one address, block that address for 10 minutes.
const loginByUser = new FailureLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
const loginByAddress = new FailureLimiter({ windowMs: 10 * 60 * 1000, max: 40 });

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const address = req.ip || "unknown";
    const userKey = address + "|" + (typeof username === "string" ? username.toLowerCase().slice(0, 40) : "");

    const wait = Math.max(loginByAddress.blockedFor(address), loginByUser.blockedFor(userKey));
    if (wait > 0) {
      res.set("Retry-After", String(Math.ceil(wait / 1000)));
      return res.status(429).json({ error: "too many failed attempts. Try again in " + Math.ceil(wait / 60000) + " minute(s)" });
    }
    const failed = () => {
      loginByAddress.fail(address);
      loginByUser.fail(userKey);
      return res.status(401).json({ error: "wrong username or password" });
    };

    if (typeof username !== "string" || typeof password !== "string") return failed();
    const r = await pool.query(
      "SELECT username, password_hash, role, active FROM users WHERE username = $1", [username]
    );
    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !u.active || !ok) return failed();
    loginByUser.reset(userKey);                           // a good login clears the count for this user
    const matches = await listMatchesFor(u.username, u.role);
    const token = jwt.sign({ username: u.username }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, username: u.username, role: u.role, matches });
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

// ---------- when the admin changes a match: refresh caches and tell the viewers ----------
const home = createHome({ pool, getState, getEngine });
const matchMetaCache = new Map();                          // matchId -> { at, data }

async function afterMatchChange(matchId, { removed = false } = {}) {
  home.invalidate();
  matchMetaCache.delete(matchId);
  matchListCache = { at: 0, rows: [] };
  try { await cache.del("state:" + matchId); } catch (e) { console.error("cache delete failed:", e.message); }
  if (removed) return;
  try {
    const state = await loadStateFromDb(matchId);
    if (state) {
      await cacheState(state);
      io.to(matchId).emit("score:update", state);          // names on open pages update at once
    }
  } catch (e) {
    console.error("refresh after admin change failed:", e.message);
  }
}

app.use("/api/admin", createAdminRouter({ pool, requireAdmin: requireRole("admin"), afterMatchChange }));

// ---------- pages for students ----------
app.get("/api/home", async (req, res) => {
  try {
    const data = await home.get();
    res.set("Cache-Control", "public, max-age=3");
    res.type("application/json").send(data.homeJson);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/api/standings", async (req, res) => {
  try {
    const data = await home.get();
    res.set("Cache-Control", "public, max-age=3");
    res.type("application/json").send(data.standingsJson);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// details of one match (names, place, time), cached for 10 seconds
app.get("/api/match/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return res.status(404).json({ error: "match not found" });
    const hit = matchMetaCache.get(id);
    if (hit && Date.now() - hit.at < 10000) return res.json(hit.data);
    const r = await pool.query(
      "SELECT id, name, sport, team_a, team_b, competition, stage, venue, start_time FROM matches WHERE id = $1", [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "match not found" });
    const m = r.rows[0];
    const data = {
      id: m.id,
      name: m.name,
      sport: m.sport,
      competition: competitionOf({ competition: m.competition, sport: m.sport }),
      stage: m.stage,
      venue: m.venue,
      startTime: m.start_time ? new Date(m.start_time).toISOString() : null,
      teamA: (m.team_a || "").trim() || "Team A",
      teamB: (m.team_b || "").trim() || "Team B",
    };
    matchMetaCache.set(id, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// the scorer's current list of matches (so a new assignment shows up without logging in again)
app.get("/api/my-matches", requireRole("scorer", "admin"), async (req, res) => {
  try {
    res.json(await listMatchesFor(req.user.username, req.user.role));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// unknown API paths answer with JSON, and bad JSON in a request gets a clear message
app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "bad request" });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "request too large" });
  console.error(err);
  res.status(500).json({ error: "server error" });
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
// one connection may join a match at most 30 times in 10 seconds (a normal page does it once or twice)
function allowJoin(socket) {
  const now = Date.now();
  const times = socket.data.joins || (socket.data.joins = []);
  while (times.length && times[0] <= now - 10000) times.shift();
  if (times.length >= 30) return false;
  times.push(now);
  return true;
}

io.on("connection", (socket) => {
  socket.on("join-match", async (matchId) => {
    if (typeof matchId !== "string" || !allowJoin(socket)) return;
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
      const { id, matchId, type, team, value, data } = msg || {};
      if (typeof id !== "string" || id.length === 0 || id.length > 64 ||
          typeof matchId !== "string" || typeof type !== "string") {
        return ack({ ok: false, error: "bad request" });
      }
      if (data !== undefined && data !== null &&
          (typeof data !== "object" || Array.isArray(data) || JSON.stringify(data).length > 500)) {
        return ack({ ok: false, error: "bad request" });
      }
      if (!(await canScore(socket.data.user, matchId))) {
        console.log("blocked:", socket.data.user, "->", matchId);
        return ack({ ok: false, error: "not allowed" });
      }

      const result = await applyAction({ id, matchId, type, team, value, data }, socket.data.user.username);

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
