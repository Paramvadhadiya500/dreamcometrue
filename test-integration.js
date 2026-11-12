// Integration test of the scoring write path (applyAction in server.js) against a REAL Postgres and Redis.
// Black-box: starts the real server.js as a child process and talks to it like a scorer phone (socket.io-client).
// No server code is changed for this test.
//
// Laptop (PowerShell, in the project folder):
//   docker compose -f docker-compose.test.yml up -d --wait
//   npm run test:integration
//   docker compose -f docker-compose.test.yml down
// CI: .github/workflows/test.yml starts its own Postgres and Redis and sets TEST_DATABASE_URL / TEST_REDIS_URL.
//
// Safety: it only runs against a database whose name ends in "_test". It adds test users and matches there.
// `node test.js` stays database-free; this file is separate.
const assert = require("assert");
const net = require("net");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { io } = require("socket.io-client");

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://livescore:test@127.0.0.1:55432/livescore_test";
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:56379";
const JWT_SECRET = "integration-test-secret-".padEnd(64, "x");   // test value only
const PASSWORD = "integration-test-pw";
const RUN = Date.now().toString(36);                              // fresh match ids every run

const dbName = decodeURIComponent(new URL(DB_URL).pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  console.error("Refusing to run: the database name must end in _test (got '" + dbName + "').");
  process.exit(1);
}
const adminUrl = new URL(DB_URL);
adminUrl.pathname = "/postgres";                                   // used only to switch the test database off and on

const pool = new Pool({ connectionString: DB_URL });
pool.on("error", () => {});                                        // case 6 kills these connections on purpose
const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });

let server = null;
let serverLog = [];
let baseUrl = "";
const sockets = [];

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function runNode(file, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file], { cwd: __dirname, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

async function waitForDb() {
  for (let i = 0; i < 30; i++) {
    try { await pool.query("SELECT 1"); return; } catch (e) { await sleep(1000); }
  }
  throw new Error("test Postgres does not answer at " + new URL(DB_URL).host + " (did you start docker-compose.test.yml?)");
}

async function startServer() {
  const port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), DATABASE_URL: DB_URL, REDIS_URL, JWT_SECRET, TRUST_PROXY: "" },
  });
  const keep = (d) => { serverLog.push(...String(d).split("\n").filter(Boolean)); };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error("server.js exited during start (code " + server.exitCode + ")");
    if (serverLog.some((l) => l.includes("http://localhost:"))) return;
    await sleep(100);
  }
  throw new Error("server.js did not start within 15 s");
}

async function addUser(username, role) {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active) VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = TRUE`,
    [username, bcrypt.hashSync(PASSWORD, 4), role]
  );
}

async function addMatch(name, scorers) {
  const id = "it-" + RUN + "-" + name;
  await pool.query("INSERT INTO matches (id, name, sport) VALUES ($1, $2, 'simple')", [id, "Integration " + name]);
  for (const u of scorers) await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [u, id]);
  return id;
}

async function login(username) {
  const res = await fetch(baseUrl + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  return { status: res.status, body: await res.json() };
}

// resolves with the connected socket, or rejects with the server's connect error message
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(baseUrl, { auth: token ? { token } : {}, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", (e) => reject(e));
  });
}

async function scorer(username) {
  const r = await login(username);
  assert.strictEqual(r.status, 200, "login of " + username + " failed: " + JSON.stringify(r.body));
  return connect(r.body.token);
}

// a student page: joins the match and records every score:update it gets
async function viewer(matchId) {
  const s = await connect(null);
  const updates = [];
  const first = new Promise((resolve) => s.once("score:update", resolve));
  s.on("score:update", (st) => updates.push(st));
  s.emit("join-match", matchId);
  const state = await first;
  updates.length = 0;                                              // count only what comes after the join
  return { state, updates };
}

let idCount = 0;
const newId = () => "it-" + RUN + "-" + ++idCount;

function act(sock, matchId, action) {
  return sock.timeout(15000).emitWithAck("score:action", { matchId, ...action });
}
const point = (team = "A", value = 1) => ({ id: newId(), type: "point", team, value });

async function rowCount(sql, params) {
  return Number((await pool.query(sql, params)).rows[0].n);
}
const eventsOf = (matchId) => rowCount("SELECT count(*) AS n FROM events WHERE match_id = $1", [matchId]);
const rowsWithId = (id) => rowCount("SELECT count(*) AS n FROM events WHERE id = $1", [id]);

// ---------- the cases ----------
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("1. duplicate id: second send is answered duplicate, stored once, broadcast once", async () => {
  const match = await addMatch("dup", ["it_scorer1"]);
  const s1 = await scorer("it_scorer1");
  const v = await viewer(match);
  assert.strictEqual(v.state.scoreA, 0);

  const action = point("A", 1);
  const a1 = await act(s1, match, action);
  assert.strictEqual(a1.ok, true, JSON.stringify(a1));
  assert.strictEqual(a1.duplicate, undefined);
  assert.strictEqual(a1.state.scoreA, 1);

  const a2 = await act(s1, match, action);                         // same id again (phone retry)
  assert.deepStrictEqual([a2.ok, a2.duplicate], [true, true], JSON.stringify(a2));
  assert.strictEqual(a2.state.scoreA, 1, "a duplicate must not add a point");

  await sleep(300);
  assert.strictEqual(await eventsOf(match), 1);
  assert.strictEqual(v.updates.length, 1, "viewer must get exactly one score:update, got " + v.updates.length);
  assert.strictEqual(v.updates[0].scoreA, 1);
});

test("2a. two scorers, 20 parallel actions each: 40 rows, every ack a different score, final 40", async () => {
  const match = await addMatch("two", ["it_scorer1", "it_scorer2"]);
  const [s1, s2] = await Promise.all([scorer("it_scorer1"), scorer("it_scorer2")]);
  const sends = [];
  for (let i = 0; i < 20; i++) {
    sends.push(act(s1, match, point("A", 1)));
    sends.push(act(s2, match, point("A", 1)));
  }
  const acks = await Promise.all(sends);
  for (const a of acks) assert.strictEqual(a.ok, true, JSON.stringify(a));

  // the row lock (FOR UPDATE) puts the actions in a line: each one sees the one before it
  const scores = acks.map((a) => a.state.scoreA).sort((x, y) => x - y);
  assert.deepStrictEqual(scores, Array.from({ length: 40 }, (_, i) => i + 1));

  assert.strictEqual(await eventsOf(match), 40);
  assert.strictEqual(await rowCount("SELECT count(DISTINCT seq) AS n FROM events WHERE match_id = $1", [match]), 40);
  const v = await viewer(match);
  assert.strictEqual(v.state.scoreA, 40);
});

test("2b. the same id from two scorers at the same moment: one row, one answer is duplicate", async () => {
  const match = await addMatch("same", ["it_scorer1", "it_scorer2"]);
  const [s1, s2] = await Promise.all([scorer("it_scorer1"), scorer("it_scorer2")]);
  const action = point("B", 2);
  const [a1, a2] = await Promise.all([act(s1, match, action), act(s2, match, action)]);
  assert.strictEqual(a1.ok, true, JSON.stringify(a1));
  assert.strictEqual(a2.ok, true, JSON.stringify(a2));
  assert.strictEqual([a1, a2].filter((a) => a.duplicate === true).length, 1);
  assert.strictEqual(await rowsWithId(action.id), 1);
  assert.strictEqual(a1.state.scoreB, 2);
  assert.strictEqual(a2.state.scoreB, 2);
});

test("3. undo: takes the last point back; undo with nothing to undo is rejected", async () => {
  const match = await addMatch("undo", ["it_scorer1"]);
  const s1 = await scorer("it_scorer1");

  const empty = await act(s1, match, { id: newId(), type: "undo" });
  assert.deepStrictEqual(empty, { ok: false, error: "nothing to undo" });

  assert.strictEqual((await act(s1, match, point("A", 3))).state.scoreA, 3);
  const u = await act(s1, match, { id: newId(), type: "undo" });
  assert.strictEqual(u.ok, true, JSON.stringify(u));
  assert.strictEqual(u.state.scoreA, 0);
  assert.strictEqual(await eventsOf(match), 2, "an undo is stored as its own row (point + undo)");

  const again = await act(s1, match, { id: newId(), type: "undo" });
  assert.deepStrictEqual(again, { ok: false, error: "nothing to undo" });
});

test("4. finished match (what the simple engine says today): no new points, undo reopens it", async () => {
  const match = await addMatch("fin", ["it_scorer1"]);
  const s1 = await scorer("it_scorer1");
  await act(s1, match, point("A", 1));
  const f = await act(s1, match, { id: newId(), type: "finish" });
  assert.strictEqual(f.ok, true, JSON.stringify(f));
  assert.deepStrictEqual([f.state.status, f.state.winner], ["finished", "A"]);

  assert.deepStrictEqual(await act(s1, match, point("B", 1)), { ok: false, error: "match already finished" });
  assert.deepStrictEqual(await act(s1, match, { id: newId(), type: "finish" }), { ok: false, error: "match already finished" });
  assert.strictEqual(await eventsOf(match), 2, "rejected actions must not be stored");

  const u = await act(s1, match, { id: newId(), type: "undo" });   // undo the finish
  assert.strictEqual(u.ok, true, JSON.stringify(u));
  assert.deepStrictEqual([u.state.status, u.state.winner], ["live", null]);
  const p = await act(s1, match, point("B", 1));
  assert.strictEqual(p.ok, true, JSON.stringify(p));
  assert.strictEqual(p.state.scoreB, 1);
});

test("5a. a scorer not assigned to the match is refused; an admin may score any match", async () => {
  const match = await addMatch("perm", ["it_scorer1"]);
  const outsider = await scorer("it_outsider");
  assert.deepStrictEqual(await act(outsider, match, point()), { ok: false, error: "not allowed" });
  assert.strictEqual(await eventsOf(match), 0);

  const adm = await scorer("it_admin");
  const a = await act(adm, match, point());
  assert.strictEqual(a.ok, true, JSON.stringify(a));
  assert.strictEqual(await eventsOf(match), 1);
});

test("5b. a disabled user: open socket refused, token refused, login refused", async () => {
  const match = await addMatch("disabled", ["it_disabled"]);
  const r = await login("it_disabled");
  assert.strictEqual(r.status, 200);
  const s = await connect(r.body.token);
  assert.strictEqual((await act(s, match, point())).ok, true);

  await pool.query("UPDATE users SET active = FALSE WHERE username = 'it_disabled'");
  assert.deepStrictEqual(await act(s, match, point()), { ok: false, error: "not allowed" });
  assert.strictEqual(await eventsOf(match), 1);

  await assert.rejects(connect(r.body.token), /invalid token/);
  assert.strictEqual((await login("it_disabled")).status, 401);
});

test("6. database outage: action answered retry:true, server stays up, same id succeeds after", async () => {
  const match = await addMatch("outage", ["it_scorer1"]);
  const s1 = await scorer("it_scorer1");
  assert.strictEqual((await act(s1, match, point())).ok, true);    // the server now has open DB connections

  // switch the test database off: no new connections, and every open one is killed (like a Postgres restart)
  const action = point("A", 5);
  await admin.query(`ALTER DATABASE "${dbName}" WITH ALLOW_CONNECTIONS false`);
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [dbName]);
    await sleep(500);
    assert.strictEqual(server.exitCode, null, "server.js died when its database connections were killed");

    const down = await act(s1, match, action);
    assert.deepStrictEqual(down, { ok: false, error: "server error", retry: true });
  } finally {
    await admin.query(`ALTER DATABASE "${dbName}" WITH ALLOW_CONNECTIONS true`);
  }

  // the phone retries with the SAME id
  const up = await act(s1, match, action);
  assert.strictEqual(up.ok, true, JSON.stringify(up));
  assert.strictEqual(up.duplicate, undefined, "the failed try must not have been stored");
  assert.strictEqual(up.state.scoreA, 6);
  assert.strictEqual(await rowsWithId(action.id), 1);
  assert.strictEqual(server.exitCode, null);
});

async function getJson(path, token) {
  const res = await fetch(baseUrl + path, { headers: token ? { Authorization: "Bearer " + token } : {} });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

test("7. admin score history: who did what, undo marked, score after; admins only", async () => {
  const match = await addMatch("hist", ["it_scorer1"]);
  const s1 = await scorer("it_scorer1");
  const adm = await scorer("it_admin");
  assert.strictEqual((await act(s1, match, point("A", 2))).ok, true);
  assert.strictEqual((await act(s1, match, point("B", 1))).ok, true);
  assert.strictEqual((await act(s1, match, { id: newId(), type: "undo" })).ok, true);
  assert.strictEqual((await act(adm, match, point("A", 1))).ok, true);

  const adminToken = (await login("it_admin")).body.token;
  const h = await getJson("/api/admin/matches/" + match + "/history", adminToken);
  assert.strictEqual(h.status, 200, JSON.stringify(h.body));
  assert.strictEqual(h.headers.get("cache-control"), "no-store");
  assert.deepStrictEqual([h.body.match.id, h.body.total, h.body.truncated], [match, 4, false]);
  const rows = h.body.rows;
  assert.deepStrictEqual(rows.map((r) => r.text),
    ["+1 for Team A", "UNDO (cancels: +1 for Team B)", "+1 for Team B", "+2 for Team A"]);
  assert.deepStrictEqual(rows.map((r) => r.by), ["it_admin", "it_scorer1", "it_scorer1", "it_scorer1"]);
  assert.deepStrictEqual(rows.map((r) => r.undone), [false, false, true, false]);
  assert.strictEqual(rows[1].undoesSeq, rows[2].seq);
  assert.deepStrictEqual(rows.map((r) => r.after), ["Team A 3 - 0 Team B", "Team A 2 - 0 Team B", "Team A 2 - 1 Team B", "Team A 2 - 0 Team B"]);
  for (const r of rows) assert.ok(Math.abs(Date.parse(r.at) - Date.now()) < 120000, "time is when the server saved it: " + r.at);

  // only admins
  const scorerToken = (await login("it_scorer1")).body.token;
  assert.deepStrictEqual((await getJson("/api/admin/matches/" + match + "/history", scorerToken)).status, 403);
  assert.deepStrictEqual((await getJson("/api/admin/matches/" + match + "/history")).status, 401);
  // unknown or malformed match id
  const unknown = await getJson("/api/admin/matches/it-no-such-match/history", adminToken);
  assert.deepStrictEqual([unknown.status, unknown.body.error], [404, "match not found"]);
  assert.strictEqual((await getJson("/api/admin/matches/BAD_ID!/history", adminToken)).status, 404);

  // a very long match: only the first 3000 actions are listed, and the page is told
  const big = await addMatch("big", []);
  await pool.query(
    `INSERT INTO events (id, match_id, type, team, value, by_user)
     SELECT $1 || g, $2, 'point', 'A', 1, 'it_scorer1' FROM generate_series(1, 3001) g`, ["it-" + RUN + "-big-", big]);
  const hb = await getJson("/api/admin/matches/" + big + "/history", adminToken);
  assert.strictEqual(hb.status, 200, JSON.stringify(hb.body).slice(0, 200));
  assert.deepStrictEqual([hb.body.total, hb.body.truncated, hb.body.rows.length], [3001, true, 3000]);
  assert.strictEqual(hb.body.rows[0].after, "Team A 3000 - 0 Team B");
});

test("8. the save itself fails (inner safety net in applyAction): retry:true, nothing saved, match not left locked", async () => {
  const match = await addMatch("inner", ["it_scorer1"]);
  const s1 = await scorer("it_scorer1");
  assert.strictEqual((await act(s1, match, point("A", 1))).ok, true);

  // A database rule in the TEST database only: refuse to save this one action. Login, permission check and reading
  // the match all still work, so the error happens in the middle of applyAction (the INSERT), not before it.
  const poison = point("A", 5);
  await pool.query(`CREATE OR REPLACE FUNCTION it_refuse_one_event() RETURNS trigger AS $$
    BEGIN IF NEW.id = '${poison.id}' THEN RAISE EXCEPTION 'test: this event is refused on purpose'; END IF; RETURN NEW; END
    $$ LANGUAGE plpgsql`);
  await pool.query("DROP TRIGGER IF EXISTS it_refuse_one_event ON events");
  await pool.query("CREATE TRIGGER it_refuse_one_event BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION it_refuse_one_event()");
  try {
    const logBefore = serverLog.length;
    const first = await act(s1, match, poison);
    assert.deepStrictEqual(first, { ok: false, error: "server error", retry: true });
    assert.ok(serverLog.slice(logBefore).some((l) => l.startsWith("applyAction failed:")),
      "the inner safety net (server.js applyAction catch) must be the one that answered");
    // ROLLBACK ended the failed transaction: no connection of the server is left inside it (holding the match lock)
    const stuck = await pool.query(
      "SELECT state FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'");
    assert.deepStrictEqual(stuck.rows, [], "a server connection was left inside the failed transaction");

    // a phone retries with the same id: same answer every time (a "stuck" entry), still nothing saved
    assert.deepStrictEqual(await act(s1, match, poison), { ok: false, error: "server error", retry: true });
    assert.strictEqual(await rowsWithId(poison.id), 0);

    // ROLLBACK released the match lock and left every DB connection clean: other actions on this match still work
    for (let i = 0; i < 12; i++) {
      const ok = await act(s1, match, point("B", 1));
      assert.strictEqual(ok.ok, true, "action " + i + " after the failed save: " + JSON.stringify(ok));
    }
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS it_refuse_one_event ON events");
    await pool.query("DROP FUNCTION IF EXISTS it_refuse_one_event()");
  }

  // the rule is gone: the SAME id now saves normally
  const later = await act(s1, match, poison);
  assert.strictEqual(later.ok, true, JSON.stringify(later));
  assert.strictEqual(later.duplicate, undefined);
  assert.deepStrictEqual([later.state.scoreA, later.state.scoreB], [6, 12]);
  assert.strictEqual(await rowsWithId(poison.id), 1);
  assert.strictEqual(server.exitCode, null);
});

// ---------- run ----------
async function main() {
  const watchdog = setTimeout(() => { console.error("FAIL: integration tests took over 3 minutes"); finish(1); }, 180000);

  await waitForDb();
  const m = await runNode("migrate.js", { DATABASE_URL: DB_URL });
  if (m.code !== 0) throw new Error("migrate.js failed:\n" + m.out);
  for (const [u, role] of [["it_scorer1", "scorer"], ["it_scorer2", "scorer"], ["it_outsider", "scorer"],
                           ["it_disabled", "scorer"], ["it_admin", "admin"]]) {
    await addUser(u, role);
  }
  await startServer();

  for (const c of cases) {
    try {
      await c.fn();
      console.log("ok   " + c.name);
    } catch (e) {
      console.log("FAIL " + c.name);
      console.log("     " + (e && e.message ? e.message : e));
      console.log("---- last lines of server.js output ----");
      console.log(serverLog.slice(-25).join("\n"));
      clearTimeout(watchdog);
      return finish(1);
    }
  }
  clearTimeout(watchdog);
  console.log("All integration tests passed");
  return finish(0);
}

async function finish(code) {
  for (const s of sockets) s.close();
  if (server && server.exitCode === null) server.kill();
  await Promise.allSettled([pool.end(), admin.end()]);
  process.exit(code);
}

main().catch((e) => {
  console.error("FAIL (setup): " + (e && e.message ? e.message : e));
  if (serverLog.length) console.error(serverLog.slice(-25).join("\n"));
  finish(1);
});
