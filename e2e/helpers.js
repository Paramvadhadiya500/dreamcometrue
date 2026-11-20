// Shared helpers for the Playwright end-to-end tests (e2e/*.spec.js) and e2e/global-setup.js.
// Same idea as test-integration.js: the REAL server.js, started as a child process, against the
// throwaway Postgres + Redis from docker-compose.test.yml (or the CI services). Dev only.
//
// Safety: refuses to run unless the database name ends in "_test".
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { io } = require("socket.io-client");

const ROOT = path.join(__dirname, "..");
const DB_URL = process.env.TEST_DATABASE_URL || "postgres://livescore:test@127.0.0.1:55432/livescore_test";
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:56379";
const JWT_SECRET = "e2e-test-secret-".padEnd(64, "x");   // test value only, not a secret
const PASSWORD = "e2e-test-password";                     // test value only, not a secret
const SCORER = "e2e_scorer";
const PORT = Number(process.env.E2E_PORT || 3100);        // your dev server owns 3000
const BASE_URL = "http://127.0.0.1:" + PORT;
const RUN = Date.now().toString(36);                      // fresh match ids every run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkTestDb() {
  const name = decodeURIComponent(new URL(DB_URL).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error("Refusing to run: the database name must end in _test (got '" + name + "').");
  }
}

// Throws if something already listens on 127.0.0.1:port (for example a Docker test copy of the app).
// Without this check our server could start on [::]:port while the browser talks to the OTHER program.
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () => reject(new Error("port " + port + " is already in use. Stop that program, or set E2E_PORT to another port.")));
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}

function runNode(file, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

async function migrate() {
  const m = await runNode("migrate.js", { DATABASE_URL: DB_URL });
  if (m.code !== 0) {
    throw new Error("migrate.js failed (did you start docker-compose.test.yml?)\n" + m.out);
  }
}

// Starts server.js on `port`. Returns { url, log, stop() }. `log` keeps every line the server prints.
async function startServer(port) {
  await assertPortFree(port);
  const log = [];
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), DATABASE_URL: DB_URL, REDIS_URL, JWT_SECRET, TRUST_PROXY: "" },
  });
  const keep = (d) => log.push(...String(d).split("\n").filter(Boolean));
  proc.stdout.on("data", keep);
  proc.stderr.on("data", keep);

  const stop = () => new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    proc.once("exit", () => resolve());
    proc.kill();
  });

  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) {
      throw new Error("server.js stopped during start (code " + proc.exitCode + ")\n" + log.slice(-15).join("\n"));
    }
    if (log.some((l) => l.includes("http://localhost:" + port))) return { url: "http://127.0.0.1:" + port, log, stop };
    await sleep(100);
  }
  await stop();
  throw new Error("server.js did not start within 15 s\n" + log.slice(-15).join("\n"));
}

const openDb = () => new Pool({ connectionString: DB_URL });

async function addScorer(pool) {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active) VALUES ($1, $2, 'scorer', TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'scorer', active = TRUE`,
    [SCORER, bcrypt.hashSync(PASSWORD, 4)]
  );
}

// A new 'simple' match (points only) that the test scorer may score. Returns { id, teamA, teamB }.
// Team names are unique to this match: the test database keeps old matches until `down`,
// and a Playwright locator that finds two cards stops with a "strict mode" error.
let matchCount = 0;
async function addMatch(pool, { competition = "E2E Test" } = {}) {
  const tag = RUN + "-" + ++matchCount;
  const m = { id: "e2e-" + tag, teamA: "Red " + tag, teamB: "Blue " + tag };
  await pool.query(
    "INSERT INTO matches (id, name, sport, team_a, team_b, competition) VALUES ($1, $2, 'simple', $3, $4, $5)",
    [m.id, "E2E match " + tag, m.teamA, m.teamB, competition]
  );
  await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [SCORER, m.id]);
  return m;
}

// /api/home is cached for 3 s (home.js) and a match added straight into the database does not clear
// that cache. Wait until the list really contains the match, so the page sees it on its FIRST load
// (otherwise the card appears only at the page's next 10 s poll).
async function waitUntilOnHome(url, matchId) {
  for (let i = 0; i < 50; i++) {
    const home = await (await fetch(url + "/api/home")).json();
    if (home.matches.some((m) => m.id === matchId)) return;
    await sleep(100);
  }
  throw new Error("match " + matchId + " did not appear in /api/home within 5 s");
}

// Logs in as the test scorer and connects like the scorer phone does. Returns the socket.
async function scorerSocket(url) {
  const res = await fetch(url + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: SCORER, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error("scorer login failed: " + res.status);
  const { token } = await res.json();
  return new Promise((resolve, reject) => {
    const s = io(url, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

// Sends one point and waits for the server's answer. Throws if the server did not accept it.
let actionCount = 0;
async function sendPoint(socket, matchId, team = "A", value = 1) {
  const id = "e2e-" + RUN + "-a" + ++actionCount;
  const ack = await socket.timeout(10000).emitWithAck("score:action", { id, matchId, type: "point", team, value });
  if (!ack.ok) throw new Error("point not accepted: " + JSON.stringify(ack));
  return ack.state;
}

module.exports = {
  BASE_URL, PORT, checkTestDb, migrate, startServer, openDb, addScorer, addMatch, waitUntilOnHome,
  scorerSocket, sendPoint,
};
