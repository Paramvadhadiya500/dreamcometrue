#!/usr/bin/env node
"use strict";
// Realistic traffic simulator: behaves like real students, not like a benchmark.
//
//   * students ARRIVE over a ramp-up time (optionally with a "final is starting" spike), stay a while, then leave
//     and are replaced, so the number of people stays steady
//   * "browsers" load the home page and refresh it every 10 seconds (and sometimes open the points table)
//   * "watchers" open a match page, download the page and socket.io script, connect like a real browser
//     (long-polling first, then WebSocket), join the match, stay connected, sometimes switch match,
//     and sometimes lose their connection for a few seconds and reconnect
//   * "scorers" log in and score a cricket ball every 6 to 12 seconds
//   * "probes" (a few watchers) measure how long a score takes from the scorer's tap to the screen
//
// Usage:   node loadtest-real.js --url https://52.66.126.144 --users 3000 --admin-user admin --admin-pass '...'
// Help:    node loadtest-real.js --help

const { fork, execSync } = require("child_process");
const http = require("http");
const https = require("https");
const { performance } = require("perf_hooks");

// ---------------------------------------------------------------- options
const DEFAULTS = {
  url: "", users: 1000, ramp: 60, hold: 120, scorers: 4, "watch-ratio": 0.4, probes: 100, procs: 1,
  poll: 10, session: 480, report: 10, "ws-only": false, insecure: false, spike: false, "dry-run": false,
  yes: false, "no-cleanup": false, matches: "", "admin-user": "", "admin-pass": "",
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error("unexpected text: " + argv[i]);
    const key = argv[i].slice(2);
    if (!(key in DEFAULTS) && key !== "help") throw new Error("unknown option --" + key);
    const next = argv[i + 1];
    if (typeof DEFAULTS[key] === "boolean" || key === "help") { out[key] = true; continue; }
    if (next === undefined || next.startsWith("--")) throw new Error("missing value for --" + key);
    out[key] = typeof DEFAULTS[key] === "number" ? Number(next) : next;
    if (typeof DEFAULTS[key] === "number" && !Number.isFinite(out[key])) throw new Error("--" + key + " must be a number");
    i++;
  }
  return out;
}

const HELP = `
Options (defaults in brackets):
  --url <address>        site to test, e.g. https://52.66.126.144       (required)
  --users <n>            students online at the same time              [1000]
  --ramp <seconds>       time over which the students arrive           [60]
  --hold <seconds>       time to keep the full crowd after the ramp    [120]
  --watch-ratio <0..1>   share of students watching a live match       [0.4]
  --scorers <n>          scorers (creates n test matches)              [4]
  --probes <n>           watchers that measure score delivery time     [100]
  --procs <n>            worker processes (use the number of CPU cores) [1]
  --spike                40% of the students arrive within 15 seconds in the middle of the ramp
  --session <seconds>    average time a student stays                  [480]
  --poll <seconds>       how often a browser refreshes the home page   [10]
  --ws-only              watchers use WebSocket only (lighter for the load machine, less realistic)
  --insecure             accept a self-signed certificate (local tests)
  --admin-user, --admin-pass   admin login: used to create and remove the test matches and scorers
  --matches <id,id,...>  READ-ONLY mode: watch these existing matches, create nothing, no scorers
  --no-cleanup           keep the test matches afterwards (default: they are deleted)
  --dry-run              show the plan and stop
  --yes                  do not wait 5 seconds before starting
Admin login can also come from LT_ADMIN_USER and LT_ADMIN_PASS (keeps the password out of your history).
`;

// ---------------------------------------------------------------- small helpers
const rand = (a, b) => a + Math.random() * (b - a);
const jitter = (ms) => ms * rand(0.8, 1.2);
const expo = (mean) => -Math.log(1 - Math.random()) * mean;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0; }
function pushSample(arr, v, cap) { if (arr.length < cap) arr.push(v); else arr[Math.floor(Math.random() * cap)] = v; }
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "-");

// ================================================================ WORKER: runs the virtual students
function runWorker() {
  const cfg = JSON.parse(process.env.LT_CONFIG);
  const base = new URL(cfg.url);
  const isHttps = base.protocol === "https:";
  const lib = isHttps ? https : http;
  const port = base.port || (isHttps ? 443 : 80);
  const agentOpts = { keepAlive: true, maxSockets: 1, rejectUnauthorized: !cfg.insecure };
  const { io } = require("socket.io-client");

  const S = fresh();
  function fresh() {
    return { reqs: 0, errs: 0, http: [], ack: [], score: [], updates: 0, rejected: 0, ackErrors: 0,
             unexpectedDrops: 0, simulatedBlips: 0, connectErrors: 0, connects: 0, arrivals: 0, leaves: 0, missed: 0, expected: 0, lag: 0 };
  }
  let browsers = 0, watchers = 0, socketsUp = 0, stopping = false;
  const users = new Set();

  // ---- HTTP ----
  function get(agent, path) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let done = false;
      const finish = (status) => {
        if (done) return;
        done = true;
        S.reqs++;
        if (status === 0 || status >= 400) S.errs++;
        pushSample(S.http, performance.now() - t0, 4000);
        resolve(status);
      };
      const req = lib.request({ hostname: base.hostname, port, path, method: "GET", agent, timeout: 15000,
        headers: { "Accept-Encoding": "gzip", "User-Agent": "loadtest-real" } }, (res) => {
        res.on("data", () => {});
        res.on("end", () => finish(res.statusCode));
        res.on("error", () => finish(0));
        res.on("aborted", () => finish(0));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => finish(0));
      req.end();
    });
  }

  // ---- which match does a watcher pick: a few matches are much more popular than others ----
  const matches = cfg.matches;                                    // [{ id, scorer? }]
  const weights = matches.map((_, i) => 1 / (i + 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  function pickMatch() {
    let r = Math.random() * wsum;
    for (let i = 0; i < matches.length; i++) { r -= weights[i]; if (r <= 0) return matches[i].id; }
    return matches[0].id;
  }

  // ---- probes: how long from the scorer's tap until the score arrives on a watcher's screen ----
  const sent = new Map();          // "match:version" -> { t0, expected, got, pending: [arrival times] }
  const probesJoined = new Map();  // match -> number of probe watchers currently joined
  function noteArrival(matchId, version, now, u) {
    const key = matchId + ":" + version;
    let e = sent.get(key);
    if (!e) { e = { t0: 0, expected: -1, got: 0, pending: [] }; sent.set(key, e); }
    e.got++;
    if (e.t0) record(now - e.t0, now, u, matchId, version); else e.pending.push({ at: now, u });
  }
  // DIAGNOSTIC: store the sample and print every slow one with its context (measurement is unchanged)
  function record(v, arrivedAt, u, matchId, version) {
    pushSample(S.score, v, 4000);
    if (v > 3000) console.log("SLOW score " + Math.round(v) + " ms | match " + matchId + " v" + version + " | this watcher joined/switched to this match " + (u && u.joinAt ? ((arrivedAt - u.joinAt) / 1000).toFixed(1) : "?") + " s before the update arrived");
  }
  function noteSent(matchId, version, t0) {
    const key = matchId + ":" + version;
    let e = sent.get(key);
    if (!e) { e = { t0: 0, expected: -1, got: 0, pending: [] }; sent.set(key, e); }
    e.t0 = t0;
    e.expected = probesJoined.get(matchId) || 0;
    for (const p of e.pending) record(p.at - t0, p.at, p.u, matchId, version);
    e.pending = [];
    setTimeout(() => {                                            // after 8 s every probe should have it
      if (e.expected > 0) { S.expected += e.expected; S.missed += Math.max(0, e.expected - e.got); }
      sent.delete(key);
    }, 8000).unref();
  }

  // ---- a student leaves and is replaced, so the crowd stays the same size ----
  function schedule(u, fn, ms) { u.timers.add(setTimeout(fn, ms)); }
  function leave(u) {
    if (u.left) return;
    u.left = true;
    for (const t of u.timers) clearTimeout(t);
    if (u.socket) { u.dropExpected = true; u.socket.close(); }
    if (u.agent) u.agent.destroy();
    if (u.kind === "browser") browsers--; else watchers--;
    if (u.joined && u.probe) probesJoined.set(u.matchId, (probesJoined.get(u.matchId) || 1) - 1);
    users.delete(u);
    S.leaves++;
  }

  async function startUser(kind, probe) {
    const u = { kind, probe, left: false, timers: new Set(), agent: new lib.Agent(agentOpts), socket: null, matchId: "", joined: false };
    users.add(u);
    S.arrivals++;
    if (kind === "browser") browsers++; else watchers++;

    if (kind === "browser") {
      await get(u.agent, "/");
      if (u.left) return;
      await get(u.agent, "/api/home");
      const tick = () => {
        if (u.left || stopping) return;
        get(u.agent, "/api/home");
        if (Math.random() < 0.15) get(u.agent, "/api/standings");
        schedule(u, tick, jitter(cfg.poll * 1000));
      };
      schedule(u, tick, jitter(cfg.poll * 1000));
    } else {
      u.matchId = pickMatch();
      await get(u.agent, "/match.html?id=" + u.matchId);
      if (u.left) return;
      await get(u.agent, "/socket.io/socket.io.js");
      await get(u.agent, "/api/match/" + u.matchId);
      if (u.left) return;
      connectSocket(u);
      // switch to another match now and then
      const maybeSwitch = () => {
        if (u.left || stopping) return;
        if (!probe && Math.random() < 0.08 && matches.length > 1) {   // probes never switch: they only measure
          if (u.joined && u.probe) probesJoined.set(u.matchId, (probesJoined.get(u.matchId) || 1) - 1);
          u.joined = false;
          u.matchId = pickMatch();
          if (u.socket && u.socket.connected) { u.socket.emit("join-match", u.matchId); u.joinAt = Date.now(); }
        }
        // sometimes a phone loses its network for a few seconds
        if (!probe && Math.random() < 0.02 && u.socket && u.socket.connected) { S.simulatedBlips++; u.blip = true; u.socket.io.engine.close(); }
        schedule(u, maybeSwitch, 60000);
      };
      schedule(u, maybeSwitch, jitter(60000));
    }

    if (!probe) {                                                   // probes stay for the whole test
      schedule(u, () => {
        const kindAgain = u.kind;
        leave(u);
        if (!stopping) setTimeout(() => startUser(kindAgain, false), rand(1000, 5000));
      }, Math.max(60000, expo(cfg.session * 1000)));
    }
  }

  function connectSocket(u) {
    const socket = io(cfg.url, {
      forceNew: true, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
      transports: cfg.wsOnly ? ["websocket"] : ["polling", "websocket"], rejectUnauthorized: !cfg.insecure,
    });
    u.socket = socket;
    socket.on("connect", () => {
      socketsUp++; S.connects++;
      socket.emit("join-match", u.matchId);
      u.joinAt = Date.now();
      u.joined = true;
      if (u.probe) probesJoined.set(u.matchId, (probesJoined.get(u.matchId) || 0) + 1);
    });
    socket.on("score:update", (s) => {
      S.updates++;
      // an update that arrives within 3 s of joining is the "current score" the server sends on join, not a live delivery
      if (u.probe && s.matchId === u.matchId && Date.now() - (u.joinAt || 0) > 3000) noteArrival(s.matchId, s.version, Date.now(), u);
    });
    socket.on("disconnect", () => {
      if (u.joined) { u.joined = false; if (u.probe) probesJoined.set(u.matchId, Math.max(0, (probesJoined.get(u.matchId) || 1) - 1)); }
      if (socketsUp > 0) socketsUp--;
      if (u.dropExpected || stopping) return;
      if (u.blip) { u.blip = false; return; }                       // a blip we caused on purpose
      S.unexpectedDrops++;
    });
    socket.on("connect_error", () => { S.connectErrors++; });
  }

  // ---- scorers (only in worker 0) ----
  function startScorer(m, i) {
    const body = JSON.stringify({ username: m.scorer.user, password: m.scorer.pass });
    const agent = new lib.Agent(agentOpts);
    const req = lib.request({ hostname: base.hostname, port, path: "/login", method: "POST", agent,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let token = null;
        try { token = JSON.parse(data).token; } catch (e) { /* handled below */ }
        if (!token) { S.errs++; console.error("scorer login failed for", m.scorer.user, res.statusCode, data.slice(0, 100)); return; }
        runScorer(m, token, i);
      });
    });
    req.on("error", (e) => console.error("scorer login error:", e.message));
    req.end(body);
  }

  function runScorer(m, token, i) {
    const socket = io(cfg.url, { forceNew: true, auth: { token }, transports: ["websocket"], rejectUnauthorized: !cfg.insecure });
    let n = 0, freeHit = false, finished = false, busy = false;
    const sendNext = () => {
      if (stopping) return;
      if (!socket.connected || busy) return;
      busy = true;
      let msg;
      const id = "lt" + i + "-" + Date.now().toString(36) + "-" + (n++);
      if (finished) msg = { id, matchId: m.id, type: "undo" };
      else {
        const r = Math.random();
        let data;
        if (r < 0.05) data = { runs: Math.random() < 0.5 ? 0 : 1, extra: "wide" };
        else if (r < 0.08) data = { runs: Math.floor(Math.random() * 5), extra: "noball" };
        else if (r < 0.13 && !freeHit) data = { runs: 0, wicket: { kind: "bowled" } };
        else data = { runs: [0, 0, 0, 1, 1, 1, 2, 4, 6][Math.floor(Math.random() * 9)], extra: null };
        msg = { id, matchId: m.id, type: "ball", data };
      }
      const t0 = Date.now();
      socket.timeout(5000).emit("score:action", msg, (err, ack) => {
        busy = false;
        if (err || !ack) { S.ackErrors++; return; }
        pushSample(S.ack, Date.now() - t0, 4000);
        if (!ack.ok) { S.rejected++; if (ack.retry) return; }
        if (ack.state) {
          freeHit = !!ack.state.freeHit;
          finished = ack.state.status === "finished";
          noteSent(m.id, ack.state.version, t0);
        }
      });
    };
    const loop = () => { if (stopping) return; sendNext(); setTimeout(loop, rand(6000, 12000)).unref(); };
    socket.on("connect", () => { if (!loop.started) { loop.started = true; setTimeout(loop, rand(1000, 5000)).unref(); } });
    socket.on("connect_error", () => S.connectErrors++);
  }

  // ---- start everything ----
  const total = cfg.users;
  const nWatch = Math.round(total * cfg.watchRatio);
  const kinds = [];
  for (let i = 0; i < total; i++) kinds.push(i < nWatch ? "watcher" : "browser");
  kinds.sort(() => Math.random() - 0.5);
  let probesLeft = cfg.isFirst ? cfg.probes : 0;

  kinds.forEach((kind) => {
    let at;
    if (cfg.spike && cfg.ramp >= 30 && Math.random() < 0.4) at = cfg.ramp / 2 + Math.random() * 15;
    else at = Math.random() * cfg.ramp;
    const probe = kind === "watcher" && probesLeft > 0 && probesLeft-- > 0;
    setTimeout(() => startUser(kind, probe), at * 1000).unref();
  });
  if (cfg.isFirst && cfg.scorers) matches.filter((m) => m.scorer).forEach((m, i) => setTimeout(() => startScorer(m, i), 500 * i).unref());

  // ---- report to the parent once a second; measure how busy this process is ----
  let lastTick = performance.now();
  setInterval(() => { const now = performance.now(); S.lag = Math.max(S.lag, now - lastTick - 250); lastTick = now; }, 250).unref();
  let lastCpu = process.cpuUsage(), lastT = Date.now();
  setInterval(() => {
    const cpu = process.cpuUsage(lastCpu), now = Date.now();
    const cpuPct = ((cpu.user + cpu.system) / 1000 / (now - lastT)) * 100;
    lastCpu = process.cpuUsage(); lastT = now;
    process.send({ type: "stats", S, browsers, watchers, socketsUp, rssMB: process.memoryUsage().rss / 1048576, cpuPct });
    Object.assign(S, fresh());
  }, 1000).unref();

  process.on("message", (m) => {
    if (m === "stop") {
      stopping = true;
      for (const u of [...users]) leave(u);
      setTimeout(() => process.exit(0), 500);
    }
  });
}

// ================================================================ PARENT: setup, report, verdict
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (!args.url) throw new Error("--url is required (see --help)");
  const url = args.url.replace(/\/+$/, "");
  const adminUser = args["admin-user"] || process.env.LT_ADMIN_USER || "";
  const adminPass = args["admin-pass"] || process.env.LT_ADMIN_PASS || "";
  const readOnly = !!args.matches;
  if (args.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  if (args.users < 1 || args["watch-ratio"] < 0 || args["watch-ratio"] > 1 || args.procs < 1) throw new Error("check --users, --watch-ratio and --procs");
  if (!readOnly && (!adminUser || !adminPass)) throw new Error("admin login needed to create test matches: use --admin-user/--admin-pass (or LT_ADMIN_USER/LT_ADMIN_PASS), or use --matches id1,id2 for read-only mode");

  const scorers = readOnly ? 0 : args.scorers;
  const watchers = Math.round(args.users * args["watch-ratio"]);
  console.log("\n=== Realistic load test ===");
  console.log("target:        " + url);
  console.log("students:      " + args.users + " at the same time (" + (args.users - watchers) + " browsing the home page, " + watchers + " watching live matches)");
  console.log("arrival:       over " + args.ramp + " s" + (args.spike ? ", with a spike of 40% in 15 s" : "") + ", then " + args.hold + " s at full size; students stay about " + args.session + " s and are replaced");
  console.log("scorers:       " + scorers + (readOnly ? " (read-only mode, existing matches: " + args.matches + ")" : " (new test matches, deleted at the end)"));
  console.log("watchers use:  " + (args["ws-only"] ? "WebSocket only" : "long-polling then WebSocket (like a real browser)"));
  console.log("load machine:  " + args.procs + " worker process(es)");
  try {
    const nofile = Number(execSync("ulimit -n", { shell: "/bin/sh" }).toString().trim());
    const need = Math.ceil((args.users * 1.6) / args.procs) + 500;
    if (Number.isFinite(nofile) && nofile < need) console.log("WARNING: this machine allows only " + nofile + " open connections per process; you need about " + need + ". Run 'ulimit -n 65535' first (Linux).");
  } catch (e) { /* not Linux: ignore */ }
  if (args["dry-run"]) { console.log("\n(dry run: nothing was started)"); return; }
  if (!args.yes) { console.log("\nThis sends real traffic to " + url + ". Starting in 5 seconds. Press Ctrl+C to cancel."); await sleep(5000); }

  // ---- create the test matches and scorers ----
  let setup = { matches: [], users: [], token: "" };
  const api = async (method, path, body) => {
    const r = await fetch(url + path, { method, headers: { "Content-Type": "application/json", ...(setup.token ? { Authorization: "Bearer " + setup.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {}; try { data = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + (data.error || ""));
    return data;
  };
  const cleanup = async () => {
    if (readOnly || args["no-cleanup"] || !setup.token) return;
    for (const m of setup.matches) { try { await api("DELETE", "/api/admin/matches/" + m.id, { confirm: "DELETE" }); } catch (e) { console.error("cleanup:", e.message); } }
    for (const u of setup.users) { try { await api("POST", "/api/admin/users/" + u + "/active", { active: false }); } catch (e) { console.error("cleanup:", e.message); } }
    console.log("Cleaned up: " + setup.matches.length + " test matches deleted, " + setup.users.length + " test scorers disabled.");
  };

  let matchList = [];
  if (readOnly) {
    matchList = args.matches.split(",").map((s) => ({ id: s.trim() })).filter((m) => m.id);
  } else {
    const login = await api("POST", "/login", { username: adminUser, password: adminPass });
    if (login.role !== "admin") throw new Error("that login is not an admin");
    setup.token = login.token;
    const tag = Math.random().toString(36).slice(2, 6);
    for (let i = 1; i <= Math.max(1, scorers); i++) {
      const user = "lt" + tag + "s" + i;
      const u = await api("POST", "/api/admin/users", { username: user });
      setup.users.push(user);
      const m = await api("POST", "/api/admin/matches", {
        sport: "cricket", competition: "LOADTEST", stage: "knockout", teamA: "LT Alpha " + i, teamB: "LT Beta " + i, venue: "load test",
        config: { overs: 50, players: 11, firstBatting: "A", freeHit: true }, scorers: [user],
      });
      setup.matches.push({ id: m.id });
      matchList.push({ id: m.id, scorer: { user, pass: u.password } });
    }
    console.log("Created " + matchList.length + " test matches (competition LOADTEST). They are deleted at the end.\n");
  }

  // ---- start the workers ----
  const workers = [];
  const latest = [];
  const win = newWindow();
  const all = { http: [], score: [], ack: [], reqs: 0, errs: 0, updates: 0, rejected: 0, ackErrors: 0, unexpectedDrops: 0, simulatedBlips: 0, connectErrors: 0, connects: 0, arrivals: 0, leaves: 0, missed: 0, expected: 0 };
  const hold = { http: [], reqs: 0, errs: 0, score: [], missed: 0, expected: 0, lagMax: 0, cpuMax: 0 };
  const t0 = Date.now();
  const holdFrom = (args.ramp + 15) * 1000;
  const total = (args.ramp + args.hold) * 1000;
  function newWindow() { return { reqs: 0, errs: 0, http: [], ack: [], score: [], updates: 0, drops: 0 }; }

  for (let w = 0; w < args.procs; w++) {
    const share = Math.floor(args.users / args.procs) + (w < args.users % args.procs ? 1 : 0);
    const cfg = { url, users: share, ramp: args.ramp, scorers, watchRatio: args["watch-ratio"], probes: args.probes, poll: args.poll, session: args.session,
      wsOnly: args["ws-only"], insecure: args.insecure, spike: args.spike, isFirst: w === 0, matches: matchList };
    const child = fork(__filename, [], { env: { ...process.env, LT_WORKER: "1", LT_CONFIG: JSON.stringify(cfg) } });
    latest[w] = { browsers: 0, watchers: 0, socketsUp: 0, rssMB: 0, cpuPct: 0, lag: 0 };
    child.on("message", (m) => {
      if (m.type !== "stats") return;
      const S = m.S;
      latest[w] = { browsers: m.browsers, watchers: m.watchers, socketsUp: m.socketsUp, rssMB: m.rssMB, cpuPct: m.cpuPct, lag: S.lag };
      const inHold = Date.now() - t0 >= holdFrom;
      for (const [k, v] of Object.entries({ http: S.http, score: S.score, ack: S.ack })) { for (const x of v) { win[k].push(x); if (all[k].length < 3e6) all[k].push(x); if (inHold && k !== "ack" && hold[k].length < 3e6) hold[k].push(x); } }
      win.reqs += S.reqs; win.errs += S.errs; win.updates += S.updates; win.drops += S.unexpectedDrops;
      for (const k of ["reqs", "errs", "updates", "rejected", "ackErrors", "unexpectedDrops", "simulatedBlips", "connectErrors", "connects", "arrivals", "leaves", "missed", "expected"]) all[k] += S[k];
      if (inHold) { hold.reqs += S.reqs; hold.errs += S.errs; hold.missed += S.missed; hold.expected += S.expected; hold.lagMax = Math.max(hold.lagMax, S.lag); hold.cpuMax = Math.max(hold.cpuMax, m.cpuPct); }
    });
    workers.push(child);
  }

  const sorted = (a) => a.slice().sort((x, y) => x - y);
  let lastReport = Date.now();
  const timer = setInterval(() => {
    const now = Date.now(), secs = (now - lastReport) / 1000; lastReport = now;
    const h = sorted(win.http), sc = sorted(win.score), ak = sorted(win.ack);
    const active = latest.reduce((a, l) => a + l.browsers + l.watchers, 0);
    const socks = latest.reduce((a, l) => a + l.socketsUp, 0);
    const cpu = Math.max(...latest.map((l) => l.cpuPct)), lag = Math.max(...latest.map((l) => l.lag)), rss = latest.reduce((a, l) => a + l.rssMB, 0);
    console.log("[" + fmt((now - t0) / 1000) + "s] students " + active + " (sockets " + socks + ") | http " + fmt(win.reqs / secs) + "/s, errors " + fmt(win.reqs ? (win.errs / win.reqs) * 100 : 0, 1) + "%, p50 " + fmt(pct(h, 50)) + " p95 " + fmt(pct(h, 95)) + " p99 " + fmt(pct(h, 99)) + " ms"
      + " | score p50 " + fmt(pct(sc, 50)) + " p95 " + fmt(pct(sc, 95)) + " max " + fmt(sc[sc.length - 1] || 0) + " ms (n=" + sc.length + ")"
      + " | ack p95 " + fmt(pct(ak, 95)) + " ms | drops " + win.drops + " | load machine: cpu " + fmt(cpu) + "% lag " + fmt(lag) + " ms mem " + fmt(rss) + " MB");
    Object.assign(win, newWindow());
    latest.forEach((l) => (l.lag = 0));
  }, args.report * 1000);

  let stopped = false;
  const finish = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    workers.forEach((w) => w.send("stop"));
    await sleep(1500);
    workers.forEach((w) => { try { w.kill(); } catch (e) { /* already gone */ } });
    await cleanup();

    // ---- verdict (measured while the full crowd was online) ----
    const h = sorted(hold.http.length ? hold.http : all.http), sc = sorted(hold.score.length ? hold.score : all.score);
    const reqs = hold.reqs || all.reqs, errs = hold.reqs ? hold.errs : all.errs;
    const errRate = reqs ? (errs / reqs) * 100 : 0;
    const p95 = pct(h, 95), p99 = pct(h, 99), s95 = pct(sc, 95), smax = sc[sc.length - 1] || 0;
    const missRate = hold.expected ? (hold.missed / hold.expected) * 100 : 0;
    const dropRate = all.connects ? (all.unexpectedDrops / all.connects) * 100 : 0;
    const connErrRate = all.connects + all.connectErrors ? (all.connectErrors / (all.connects + all.connectErrors)) * 100 : 0;
    const checks = [
      ["load machine not overloaded (event-loop delay under 250 ms)", hold.lagMax < 250, "worst delay " + fmt(hold.lagMax) + " ms, busiest worker " + fmt(hold.cpuMax) + "% cpu"],
      ["web requests: errors under 1%", errRate < 1, fmt(errRate, 2) + "% of " + reqs],
      ["web requests: 95% faster than 1000 ms", p95 < 1000, "p95 " + fmt(p95) + " ms"],
      ["web requests: 99% faster than 3000 ms", p99 < 3000, "p99 " + fmt(p99) + " ms"],
      ["live connections: failed connects under 1%", connErrRate < 1, fmt(connErrRate, 2) + "%"],
      ["live connections: unexpected drops under 1%", dropRate < 1, fmt(dropRate, 2) + "% (" + all.unexpectedDrops + " drops, " + all.simulatedBlips + " planned blips)"],
    ];
    if (!readOnly) {
      checks.push(["score reaches the watchers: 95% within 2000 ms", sc.length > 0 && s95 < 2000, "p95 " + fmt(s95) + " ms from " + sc.length + " samples"]);
      checks.push(["score reaches the watchers: slowest under 5000 ms", sc.length > 0 && smax < 5000, "slowest " + fmt(smax) + " ms"]);
      checks.push(["score reaches the watchers: missed updates under 1%", missRate < 1, fmt(missRate, 2) + "% of " + hold.expected]);
    }
    console.log("\n=== Result ===");
    let failed = 0;
    for (const [label, pass, detail] of checks) { console.log((pass ? "PASS  " : "FAIL  ") + label + "  [" + detail + "]"); if (!pass) failed++; }
    console.log("\nstudents arrived: " + all.arrivals + ", left and replaced: " + all.leaves + ", web requests: " + all.reqs + ", score updates delivered: " + all.updates + ", scorer actions rejected: " + all.rejected + ", scorer timeouts: " + all.ackErrors);
    console.log(failed === 0 ? "\nRESULT: PASS" : "\nRESULT: FAIL (" + failed + " check(s) failed)");
    if (checks[0][1] === false) console.log("NOTE: the load machine itself was overloaded, so these numbers are not reliable. Use a bigger machine or more --procs.");
    process.exit(failed === 0 ? 0 : 1);
  };
  process.on("SIGINT", () => { console.log("\nStopping..."); finish(); });
  setTimeout(finish, total + 3000);
}

if (process.env.LT_WORKER) runWorker();
else main().catch((e) => { console.error("Error:", e.message); process.exit(2); });
