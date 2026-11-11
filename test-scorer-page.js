// Tests the REAL scorer page script (the last inline <script> of public/scorer.html) with a fake page,
// a fake socket and a controllable clock. No browser, database or network needed. Run by test.js.
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "public", "scorer.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const pageJs = blocks[blocks.length - 1][1];
const queueJs = fs.readFileSync(path.join(__dirname, "public", "queue.js"), "utf8");

function makeWorld({ storageBlocked = false, preset = {} } = {}) {
  let clock = 1_000_000;
  const timers = []; let tid = 0;
  const els = {};
  const el = (id) => els[id] || (els[id] = mkEl(id));
  function mkEl(id) {
    const e = { id, style: {}, className: "", value: "", disabled: false, children: [], options: [] };
    let text = "";
    Object.defineProperty(e, "textContent", { get: () => text, set: (v) => { text = String(v); e.children = []; } });
    Object.defineProperty(e, "innerHTML", { set: () => { text = ""; e.children = []; e.options = []; e.value = ""; } });
    e.appendChild = (c) => { e.children.push(c); if (id === "match") { e.options.push(c); if (!e.value) e.value = c.value; } };
    e.all = () => [text, ...e.children.map((c) => c.textContent)].join(" ");
    return e;
  }
  const store = {};
  Object.assign(store, preset);
  const localStorage = storageBlocked
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} }
    : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const handlers = {}, sent = [], plainEmits = [];
  const socket = {
    connected: false,
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: (...a) => plainEmits.push(a),
    timeout: () => ({ emit: (ev, payload, cb) => sent.push({ ev, payload, cb }) }),
    disconnect: () => {},
  };
  let confirmAnswer = true; const confirms = [];
  class FakeDate extends Date { static now() { return clock; } }
  const ctx = {
    document: { getElementById: el, createElement: () => mkEl("new") },
    io: () => socket,
    confirm: (m) => { confirms.push(m); return confirmAnswer; },
    fetch: async (url) => url === "/login"
      ? { status: 200, ok: true, json: async () => ({ token: "t", username: "rahul", role: "scorer", matches: [{ id: "m1", name: "Match 1" }] }) }
      : { status: 200, ok: true, json: async () => [{ id: "m1", name: "Match 1" }] },
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, fn, at: clock + ms, ms, interval: false }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn, ms) => { timers.push({ id: ++tid, fn, at: clock + ms, ms, interval: true }); return tid; },
    clearInterval: (id) => ctx.clearTimeout(id),
    Date: FakeDate, Math, JSON, Object, Array, String, Number, console, Promise, Error,
  };
  ctx.window = ctx; ctx.localStorage = localStorage;
  vm.createContext(ctx);
  vm.runInContext(queueJs, ctx);
  vm.runInContext(pageJs, ctx);
  return {
    ctx, el, store, sent, plainEmits, timers, confirms,
    get clock() { return clock; },
    advance(ms) { clock += ms; },
    setConfirm(v) { confirmAnswer = v; },
    connect() { socket.connected = true; handlers.connect(); },
    disconnect() { socket.connected = false; handlers.disconnect && handlers.disconnect(); },
    fireRetry() { const t = timers.filter((x) => !x.interval).sort((a, b) => a.at - b.at)[0]; assert.ok(t, "a retry is scheduled"); clock = Math.max(clock, t.at); ctx.clearTimeout(t.id); t.fn(); return t.ms; },
    retryPending() { return timers.some((x) => !x.interval); },
    ack(res) { const s = sent.shift(); assert.ok(s, "something was sent"); s.cb(res === "TIMEOUT" ? new Error("timeout") : null, res === "TIMEOUT" ? undefined : res); return s.payload; },
    render() { ctx.render(); },
  };
}

const session = JSON.stringify({ token: "t", username: "rahul", role: "scorer", matches: [{ id: "m1", name: "Match 1" }] });
const ok = () => {};   // silent on success; an assert throws on failure

module.exports = async function runScorerPageTests() {

// ---- 1. normal send, no answer, backoff, same id, taps do not jump the wait ----
{
  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  assert.strictEqual(w.el("pending").textContent, "All entries sent");
  w.ctx.act("point", "A", 1);
  assert.strictEqual(w.sent.length, 1);
  assert.strictEqual(w.el("pending").textContent, "1 entry waiting to be sent");
  assert.deepStrictEqual(Object.keys(w.sent[0].payload).sort(), ["data", "id", "matchId", "team", "type", "value"]);
  const first = w.ack("TIMEOUT");
  assert.ok(w.retryPending(), "retry scheduled after no answer");
  w.ctx.act("point", "A", 1);                       // a second tap while waiting
  assert.strictEqual(w.sent.length, 0, "a new tap does not jump the waiting time");
  assert.strictEqual(w.el("pending").textContent, "2 entries waiting to be sent");
  const d1 = w.fireRetry();
  assert.ok(d1 >= 2000 && d1 <= 2400, "first wait about 2 s (" + d1 + ")");
  assert.strictEqual(w.sent[0].payload.id, first.id, "retry uses the SAME id");
  w.ack("TIMEOUT");
  const d2 = w.fireRetry();
  assert.ok(d2 >= 4000 && d2 <= 4800, "second wait about 4 s (" + d2 + ")");
  w.ack({ ok: true, state: {} });
  assert.strictEqual(w.sent.length, 1, "after success the next entry goes at once");
  w.ack({ ok: true, state: {} });
  assert.strictEqual(w.el("pending").textContent, "All entries sent");
  ok("send, retry with same id, backoff 2 s then 4 s, taps wait their turn");
}

// ---- 2. rejected entry stays visible until confirmed; others continue ----
{
  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.act("point", "B", 2);
  w.ctx.act("point", "A", 1);
  w.ack({ ok: false, error: "match already finished" });
  assert.strictEqual(w.el("rejBox").style.display, "block");
  assert.ok(w.el("rejText").all().includes("NOT counted"));
  assert.ok(w.el("rejText").all().includes("Match 1: +2 for team B (match already finished)"));
  w.ack({ ok: true, state: {} });                       // the next entry was sent anyway
  w.render(); w.render();                               // later taps and screen updates do not hide it
  assert.strictEqual(w.el("rejBox").style.display, "block", "still visible after a later success");
  w.ctx.ackRejected();
  assert.strictEqual(w.el("rejBox").style.display, "none");
  ok("rejected entry listed until 'OK, I saw it'; later entries still sent");
}

// ---- 3. stuck entry: 20 server retries -> box with Skip; skip asks first and lists it ----
{
  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.act("undo");
  for (let i = 0; i < 20; i++) { w.ack({ ok: false, error: "server error", retry: true }); if (i < 19) w.fireRetry(); }
  assert.strictEqual(w.el("stuckBox").style.display, "block");
  assert.ok(w.el("stuckText").textContent.includes("cannot be sent: Match 1: UNDO"));
  w.setConfirm(false); w.ctx.skipStuck();
  assert.strictEqual(w.el("stuckBox").style.display, "block", "Cancel keeps the entry");
  w.setConfirm(true); w.ctx.skipStuck();
  assert.strictEqual(w.el("stuckBox").style.display, "none");
  assert.ok(w.el("rejText").all().includes("UNDO (skipped by the scorer"));
  ok("stuck entry: Skip asks first, then lists it as not counted");
}

// ---- 4. offline: entries wait, texts change at 30 s and 2 min, reconnect sends at once ----
{
  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect(); w.disconnect();
  assert.ok(w.el("conn").textContent.startsWith("OFFLINE"));
  w.ctx.act("point", "A", 1); w.ctx.act("point", "A", 1); w.ctx.act("point", "A", 1);
  assert.strictEqual(w.sent.length, 0, "nothing is sent while offline");
  w.advance(45000); w.render();
  assert.strictEqual(w.el("pending").textContent, "3 entries waiting. Oldest: 45 s.");
  assert.strictEqual(w.el("pending").className, "slow");
  w.advance(90000); w.render();
  assert.strictEqual(w.el("pending").textContent, "3 entries NOT sent for 2 min. Check your signal. Do not close this page.");
  assert.strictEqual(w.el("pending").className, "alarm");
  w.connect();
  assert.strictEqual(w.sent.length, 1, "back online: sending starts at once");
  w.ack({ ok: true }); w.ack({ ok: true }); w.ack({ ok: true });
  assert.strictEqual(w.el("pending").textContent, "All entries sent");
  ok("offline: entries wait; 30 s and 2 min texts; reconnect sends all");
}

// ---- 5. reload: a new page on the same storage keeps waiting and rejected entries ----
{
  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.act("point", "A", 1); w.ack({ ok: false, error: "not allowed" });
  w.ctx.act("point", "B", 1); w.ack("TIMEOUT");
  const w2 = makeWorld({ preset: { ...w.store } });      // like pressing reload
  assert.strictEqual(w2.el("pending").textContent, "1 entry waiting to be sent");
  assert.strictEqual(w2.el("rejBox").style.display, "block");
  w2.connect();
  assert.strictEqual(w2.sent.length, 1);
  ok("reload keeps waiting and rejected entries");
}

// ---- 6. another scorer's entries; log out warning ----
{
  const neha = JSON.stringify([{ id: "n1", matchId: "m1", type: "point", team: "A", value: 1, user: "neha", firstAt: 1, tries: 0 }]);
  const w = makeWorld({ preset: { "scorer-session": session, "scorer-queue": neha } });
  w.connect();
  assert.strictEqual(w.sent.length, 0, "neha's entry is not sent under rahul's login");
  assert.strictEqual(w.el("othersBox").style.display, "block");
  assert.ok(w.el("othersText").textContent.includes("1 unsent entries from neha"));
  w.ctx.adoptOthers();
  assert.strictEqual(w.sent.length, 1, "'Send them as me' sends it");
  w.ctx.act("point", "A", 1);
  w.setConfirm(false); w.ctx.logoutClicked();
  assert.ok(w.confirms.at(-1).includes("unsent entries"), "log out warns about waiting entries");
  assert.strictEqual(w.el("app").style.display !== "none", true, "Cancel keeps the scorer logged in");
  ok("other scorer's entries wait; send-as-me works; log out warns");
}

// ---- 7. storage blocked: log in, score, and see the warning ----
const blockedTest = (async () => {
  const w = makeWorld({ storageBlocked: true });
  assert.strictEqual(w.el("loginBox").style.display, "block", "no saved session: login form");
  await w.ctx.login();
  assert.strictEqual(w.el("app").style.display, "block", "logged in although storage is blocked");
  w.connect();
  w.ctx.act("point", "A", 1);
  assert.strictEqual(w.el("storageWarn").style.display, "block", "the scorer is told not to reload");
  assert.strictEqual(w.sent.length, 1, "scoring still works (in memory)");
  w.ack({ ok: true });
  assert.strictEqual(w.el("pending").textContent, "All entries sent");
  ok("blocked storage: login and scoring work in memory, warning shown");
})();

// ---- 8. queue full: refuses the tap with a message, keeps all ----
{
  const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: "z" + i, matchId: "m1", type: "point", team: "A", value: 1, user: "rahul", firstAt: 1, tries: 0 })));
  const w = makeWorld({ preset: { "scorer-session": session, "scorer-queue": many } });
  assert.ok(w.el("pending").textContent.startsWith("50+ entries waiting. Please check the network."));
  w.ctx.act("point", "A", 1);
  assert.strictEqual(w.el("err").textContent, "Not sent: 500 entries are already waiting. Wait for the network.");
  assert.strictEqual(JSON.parse(w.store["scorer-queue"]).length, 500);
  ok("50+ warning; 500 = new tap refused with a message, nothing dropped");
}
await blockedTest;
};
