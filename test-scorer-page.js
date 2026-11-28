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
// ---- 9. cricket toss: the toss box comes first, ball buttons after; undo brings the box back; offline ----
{
  const cricket = require("./engines/cricket");
  const { effectivePoints } = require("./engine");
  let version = 0;
  const crState = (events) => ({ matchId: "m1", name: "Match 1", sport: "cricket", teamA: "CSE", teamB: "ECE",
    ...cricket.compute(effectivePoints(events), { config: { overs: 12, players: 11 } }), version: ++version });
  const tossEv = { type: "toss", data: { winner: "B", choice: "bowl" } };
  const shown = (w, id) => w.el(id).style.display === "block";

  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.showState(crState([]));
  assert.ok(shown(w, "crToss"), "before the toss: the toss box shows");
  assert.ok(!shown(w, "crControls"), "before the toss: no ball buttons");
  assert.strictEqual(w.el("tossA").textContent, "CSE");
  assert.strictEqual(w.el("tossB").textContent, "ECE");
  assert.strictEqual(w.el("tossStart").disabled, true, "Start needs a winner and a choice");
  w.ctx.pickToss("winner", "B");
  assert.strictEqual(w.el("tossStart").disabled, true);
  w.ctx.pickToss("choice", "bowl");
  assert.strictEqual(w.el("tossStart").disabled, false);
  assert.strictEqual(w.el("tossSummary").textContent, "ECE won the toss and chose to bowl. CSE bats first.");

  w.setConfirm(false); w.ctx.startMatch();
  assert.strictEqual(w.sent.length, 0, "Cancel in the confirm box sends nothing");
  assert.ok(shown(w, "crToss"));
  w.setConfirm(true); w.ctx.startMatch();
  assert.ok(w.confirms.at(-1).startsWith("ECE won the toss and chose to bowl. CSE bats first."));
  assert.strictEqual(w.sent.length, 1);
  // compared as JSON: objects made inside the page's vm context have another Object prototype
  assert.strictEqual(JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.data]), JSON.stringify(["toss", { winner: "B", choice: "bowl" }]));
  assert.ok(!shown(w, "crToss") && shown(w, "crControls"), "right after Start: ball buttons, without waiting for the server");
  w.ack({ ok: true });
  w.ctx.showState(crState([tossEv]));
  assert.ok(!shown(w, "crToss") && shown(w, "crControls"), "server confirms the toss: ball buttons stay");
  assert.ok(w.el("crBig").textContent.startsWith("CSE 0/0"), "CSE bats first");

  // UNDO of the toss: the server says a toss is needed again -> the box comes back, empty
  w.ctx.showState(crState([tossEv, { type: "undo" }]));
  assert.ok(shown(w, "crToss") && !shown(w, "crControls"), "toss undone: the toss box is back");
  assert.strictEqual(w.el("tossStart").disabled, true, "the old choice is not kept");

  // abandoned before the toss: neither box
  w.ctx.showState(crState([{ type: "finish" }]));
  assert.ok(!shown(w, "crToss") && !shown(w, "crControls"), "finished: no toss box, no ball buttons");
  ok("cricket toss: box first, confirm, ball buttons after, undo brings it back");

  // offline: the toss waits on the phone, but the scorer can go on (the queue sends it before the balls)
  const w2 = makeWorld({ preset: { "scorer-session": session } });
  w2.connect();
  w2.ctx.showState(crState([]));
  w2.disconnect();
  w2.ctx.pickToss("winner", "A"); w2.ctx.pickToss("choice", "bat"); w2.ctx.startMatch();
  assert.strictEqual(w2.sent.length, 0, "offline: nothing sent yet");
  assert.ok(!shown(w2, "crToss") && shown(w2, "crControls"), "offline: ball buttons anyway");
  w2.ctx.recordBall(4);
  const w3 = makeWorld({ preset: { ...w2.store } });           // reload while still offline
  w3.connect();
  assert.strictEqual(w3.sent[0].payload.type, "toss", "the toss is sent first");
  w3.ctx.showState(crState([]));                               // the server has not got it yet
  assert.ok(!shown(w3, "crToss"), "after reload: the waiting toss still counts");
  assert.ok(w3.ctx.entryText({ matchId: "m1", type: "toss", data: { winner: "A", choice: "bat" } }).endsWith("Toss: team A won, chose to bat"));
  ok("offline toss: waits in order before the balls; reload keeps it");
}

// ---- 10. basketball: +1/+2/+3, End quarter asks first (and says when it ends the match or starts overtime), finish ----
{
  const basketball = require("./engines/basketball");
  const { effectivePoints } = require("./engine");
  let version = 0;
  const bbState = (events) => ({ matchId: "m1", name: "Match 1", sport: "basketball", teamA: "CSE", teamB: "ECE",
    ...basketball.compute(effectivePoints(events), { config: { quarterMinutes: 7, overtimeMinutes: 5 } }), version: ++version });
  const P = (t, v) => ({ type: "point", team: t, value: v });
  const END = { type: "end_period" };
  const shown = (w, id) => w.el(id).style.display === "block";

  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.showState(bbState([]));
  assert.ok(shown(w, "bbView") && shown(w, "bbControls"), "basketball view and buttons");
  for (const id of ["ttView", "simpleView", "crView", "ttControls", "simpleControls", "crControls", "crToss"]) {
    assert.ok(!shown(w, id), "other sports hidden: " + id);
  }
  // the number is the whole button text (never cut off); the team name is shown once above its row
  assert.strictEqual(w.el("bbA3").textContent, "+3");
  assert.strictEqual(w.el("bbB1").textContent, "+1");
  assert.strictEqual(w.el("bbNameA").textContent, "CSE");
  assert.strictEqual(w.el("bbNameB").textContent, "ECE");
  assert.ok(!shown(w, "bbFix"), "the correction buttons are hidden until asked for");
  assert.strictEqual(w.el("bbPeriod").textContent, "Quarter 1 (7 min)");
  assert.strictEqual(w.el("bbEnd").textContent, "END QUARTER 1");
  assert.strictEqual(w.el("bbFinB").textContent, "Finish: ECE wins");

  // a 3-pointer is sent as point A 3
  w.ctx.act("point", "A", 3);
  assert.strictEqual(JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.team, w.sent[0].payload.value]), JSON.stringify(["point", "A", 3]));
  w.ack({ ok: true });

  // scores and quarter scores on screen
  w.ctx.showState(bbState([P("A", 3), END, P("B", 2)]));
  assert.deepStrictEqual([w.el("bbA").textContent, w.el("bbB").textContent], ["3", "2"]);
  assert.strictEqual(w.el("bbPeriod").textContent, "Quarter 2 (7 min)");
  assert.strictEqual(w.el("bbQuarters").textContent, "Q1 3-0 · Q2 0-2 (now)");

  // End quarter: Cancel sends nothing; OK sends end_period
  w.setConfirm(false); w.ctx.endPeriod();
  assert.strictEqual(w.sent.length, 0, "Cancel sends nothing");
  assert.ok(w.confirms.at(-1).startsWith("End Quarter 2?"), w.confirms.at(-1));
  w.setConfirm(true); w.ctx.endPeriod();
  assert.strictEqual(JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.data]), JSON.stringify(["end_period", { period: 2 }]),
    "END QUARTER says which quarter it ends");
  assert.strictEqual(w.el("bbEnd").textContent, "END QUARTER 3", "the button moves on at once, before the server answers");
  assert.strictEqual(w.el("bbPeriod").textContent, "Quarter 3 (7 min)");
  w.ack({ ok: true });

  // quarter 4, not level: the confirm says it ENDS the match and who wins
  w.ctx.showState(bbState([P("A", 3), END, END, END]));
  w.setConfirm(false); w.ctx.endPeriod();
  assert.ok(w.confirms.at(-1).includes("This ENDS THE MATCH: CSE wins 3-0."), w.confirms.at(-1));
  // quarter 4, level: the confirm says overtime starts
  w.ctx.showState(bbState([P("A", 2), P("B", 2), END, END, END]));
  w.ctx.endPeriod();
  assert.ok(w.confirms.at(-1).includes("The score is level, so a 5-minute overtime starts."), w.confirms.at(-1));
  // in overtime
  w.ctx.showState(bbState([P("A", 2), P("B", 2), END, END, END, END]));
  assert.strictEqual(w.el("bbPeriod").textContent, "Overtime 1 (5 min)");
  assert.strictEqual(w.el("bbEnd").textContent, "END OVERTIME 1");

  // finish early with a winner
  w.setConfirm(true); w.ctx.finishWithWinner("B");
  assert.ok(w.confirms.at(-1).includes("give the win to ECE"));
  assert.strictEqual(JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.data]), JSON.stringify(["finish", { winner: "B" }]));
  w.ack({ ok: true });

  // offline: END QUARTER waits on the phone; the screen counts it, so a second press ends the NEXT quarter (not the same one twice)
  const w2 = makeWorld({ preset: { "scorer-session": session } });
  w2.connect();
  w2.ctx.showState(bbState([P("A", 2)]));
  w2.disconnect();
  w2.setConfirm(true);
  w2.ctx.endPeriod();
  assert.strictEqual(w2.el("bbEnd").textContent, "END QUARTER 2", "offline: the button shows the next quarter");
  assert.ok(w2.confirms.at(-1).startsWith("End Quarter 1?"));
  w2.ctx.endPeriod();
  assert.ok(w2.confirms.at(-1).startsWith("End Quarter 2?"), "the second press asks about quarter 2");
  w2.ctx.act("undo");                                             // UNDO while still offline takes the waiting END QUARTER 2 back
  assert.strictEqual(w2.el("bbEnd").textContent, "END QUARTER 2");
  const w3 = makeWorld({ preset: { ...w2.store } });              // reload while offline: the waiting entries still count
  w3.ctx.showState(bbState([P("A", 2)]));
  assert.strictEqual(w3.el("bbEnd").textContent, "END QUARTER 2");
  w3.connect();
  const periods = [];
  while (w3.sent.length) { const s = w3.ack({ ok: true }); if (s.type === "end_period") periods.push(s.data.period); }
  assert.deepStrictEqual(periods, [1, 2], "sent in order with their quarter numbers (then the UNDO)");

  // corrections: hidden behind "Fix a mistake", ask first, send a negative point
  w.ctx.showState(bbState([P("A", 3), P("B", 2)]));
  w.ctx.toggleFix();
  assert.ok(shown(w, "bbFix"), "Fix a mistake opens the correction buttons");
  assert.strictEqual(w.el("bbFixA2").textContent, "-2");
  w.setConfirm(false); w.ctx.fixPoints("A", 2);
  assert.strictEqual(w.sent.length, 0, "Cancel sends nothing");
  assert.ok(w.confirms.at(-1).startsWith("CORRECTION: take 2 points away from CSE?"), w.confirms.at(-1));
  w.setConfirm(true); w.ctx.fixPoints("A", 2);
  assert.strictEqual(JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.team, w.sent[0].payload.value]), JSON.stringify(["point", "A", -2]));
  assert.ok(!shown(w, "bbFix"), "the correction box closes after one use");
  w.ack({ ok: true });
  assert.ok(w.ctx.entryText({ matchId: "m1", type: "point", team: "A", value: -2 }).endsWith("-2 for team A (correction)"));
  assert.ok(w.ctx.entryText({ matchId: "m1", type: "end_period", data: { period: 5 } }).endsWith("End Overtime 1"));

  // finished: no scoring buttons, UNDO stays, result shown
  w.ctx.showState(bbState([P("A", 3), END, END, END, END]));
  assert.ok(!shown(w, "bbControls") && shown(w, "undoRow"), "finished: only UNDO");
  assert.strictEqual(w.el("status").textContent, "FINISHED. Team A won 3-0");
  assert.ok(w.ctx.entryText({ matchId: "m1", type: "end_period" }).endsWith("End quarter / overtime"));
  ok("basketball: +1/+2/+3, End quarter confirm texts, overtime, finish, finished screen");
}

// ---- 11. kabaddi: the raid form, its limits and summary, END HALF, breaks, fixes, tie-break ----
{
  const kabaddi = require("./engines/kabaddi");
  const { effectivePoints } = require("./engine");
  let version = 0;
  const GROUP = { halfMinutes: 15, knockout: false };
  const KO = { halfMinutes: 15, knockout: true };
  const kbState = (events, config = GROUP) => ({ matchId: "m1", name: "Match 1", sport: "kabaddi", teamA: "CSE", teamB: "ECE",
    ...kabaddi.compute(effectivePoints(events), { config }), version: ++version });
  const R = (team, out = 0, bonus = false, caught = false) => ({ type: "raid", data: { team, out, bonus, caught } });
  const END = (n) => ({ type: "end_period", data: { period: n } });
  const BRK = (data) => ({ type: "break", data });
  const shown = (w, id) => w.el(id).style.display === "block";
  const last = (w) => JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.team, w.sent[0].payload.value, w.sent[0].payload.data]);
  const text = (w, id) => w.el(id).textContent;
  // tap "RAID STARTED" for a team: the page sends raid_start at once; when it is first in the queue, the fake server answers it
  const team = (w, t) => {
    w.ctx.pickRaid("team", t);
    if (w.sent.length && w.sent[0].payload.type === "raid_start") w.ack({ ok: true });
  };

  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.showState(kbState([]));
  assert.ok(shown(w, "kbView") && shown(w, "kbControls") && shown(w, "kbPlay") && !shown(w, "kbTie"), "kabaddi view and raid form");
  assert.ok(!shown(w, "bbControls") && !shown(w, "simpleControls") && !shown(w, "simpleView"), "no other sport's buttons");
  assert.deepStrictEqual([text(w, "kbRaidA"), text(w, "kbRaidB"), text(w, "kbFinB"), text(w, "kbToA")], ["CSE", "ECE", "Finish: ECE wins", "Timeout: CSE"]);
  assert.deepStrictEqual([text(w, "kbHalf"), text(w, "kbEnd"), text(w, "kbCourt")], ["Half 1 (15 min)", "END HALF 1", "On court: CSE 7 · ECE 7"]);
  assert.strictEqual(text(w, "kbSummary"), "Tap who raided");
  assert.strictEqual(w.el("kbSave").disabled, true, "SAVE RAID waits for the raiding team");
  w.ctx.saveRaid();
  assert.strictEqual(w.sent.length, 0);

  // a raid: CSE raids, 2 out + bonus. Tapping the team sends "raid started" at once (students see "CSE RAIDING NOW")
  w.ctx.pickRaid("team", "A");
  assert.strictEqual(last(w), JSON.stringify(["raid_start", null, null, { team: "A" }]));
  w.ack({ ok: true });
  w.ctx.pickRaid("team", "A");
  assert.strictEqual(w.sent.length, 0, "tapping the same team again sends nothing");
  w.ctx.pickRaid("out", 2); w.ctx.pickRaid("bonus", true);
  assert.deepStrictEqual([w.el("kbRaidA").className, w.el("kbRaidB").className, w.el("kbOut2").className, w.el("kbBonusYes").className],
    ["teamA on", "teamB", "on", "on"], "the chosen buttons are marked");
  assert.strictEqual(text(w, "kbSummary"), "CSE +3 (2 out + bonus)");
  w.ctx.saveRaid();
  assert.strictEqual(last(w), JSON.stringify(["raid", null, null, { team: "A", out: 2, bonus: true, caught: false }]));
  assert.strictEqual(text(w, "kbSent"), "Sent: CSE raid: 2 out + bonus");
  assert.strictEqual(text(w, "kbSummary"), "Tap who raided", "the form is fresh for the next raid");
  assert.ok(text(w, "kbStale").startsWith("1 entry is still waiting to be sent"), text(w, "kbStale"));
  assert.strictEqual(w.el("kbSave").disabled, true, "after a save SAVE RAID is closed until a team is chosen");
  w.ctx.saveRaid();
  assert.strictEqual(w.sent.length, 1, "a double tap on SAVE RAID sends the raid once");
  w.ctx.pickRaid("team", "B");
  w.ctx.saveRaid();
  assert.strictEqual(text(w, "pending"), "3 entries waiting to be sent", "a fast next raid is NOT dropped (no timer): raid A, start B, raid B");
  w.ack({ ok: true });
  assert.strictEqual(last(w), JSON.stringify(["raid_start", null, null, { team: "B" }]));
  w.ack({ ok: true });
  assert.strictEqual(last(w), JSON.stringify(["raid", null, null, { team: "B", out: 0, bonus: false, caught: false }]), "then it is sent");
  w.ack({ ok: true });
  assert.strictEqual(text(w, "kbStale"), "", "all sent: the numbers are up to date again");

  // the server's new state: ECE has 5 on court
  w.ctx.showState(kbState([R("A", 2, true)]));
  assert.deepStrictEqual([text(w, "kbCourt"), text(w, "kbHalves"), text(w, "kbLast"), text(w, "kbA")],
    ["On court: CSE 7 · ECE 5", "H1 3-0 (now)", "Last raid: CSE raid: 2 out + bonus", "3"]);
  team(w, "A");
  assert.deepStrictEqual([w.el("kbOut5").disabled, w.el("kbOut6").disabled, w.el("kbOut7").disabled], [false, true, true], "ECE has only 5 on court");
  assert.strictEqual(w.el("kbBonusYes").disabled, true, "no bonus with fewer than 6 defenders");
  team(w, "B");
  assert.deepStrictEqual([w.el("kbOut7").disabled, w.el("kbBonusYes").disabled], [false, false], "CSE has 7");
  w.ctx.pickRaid("out", 7); w.ctx.pickRaid("bonus", true);
  assert.strictEqual(text(w, "kbSummary"), "ECE +10 (7 out + bonus + ALL OUT +2)", "the biggest raid");
  team(w, "A");
  assert.deepStrictEqual([w.el("kbOut0").className, w.el("kbBonusNo").className], ["on", "on"], "7 out and bonus are reset: ECE has only 5");
  w.ctx.pickRaid("out", 5);
  assert.strictEqual(text(w, "kbSummary"), "CSE +7 (5 out + ALL OUT +2)");
  w.ctx.pickRaid("caught", true);
  assert.strictEqual(w.el("kbOut0").className, "on", "raider OUT: nobody he touched is out");
  for (let n = 1; n <= 7; n++) assert.strictEqual(w.el("kbOut" + n).disabled, true, "out " + n + " closed when the raider is OUT");
  assert.strictEqual(text(w, "kbSummary"), "Raider OUT: ECE +1");
  w.ctx.pickRaid("caught", false);
  assert.strictEqual(w.el("kbOut1").disabled, false);
  assert.strictEqual(text(w, "kbSummary"), "Empty raid: no points");

  // super tackle + all out predicted: ECE has 3 on court, CSE has 1
  w.ctx.showState(kbState([R("A", 4), ...Array(6).fill({ type: "court", data: { team: "A", change: -1 } })]));
  w.ctx.pickRaid("caught", true);
  assert.strictEqual(text(w, "kbSummary"), "Raider OUT: ECE +4 SUPER TACKLE + ALL OUT");
  team(w, "B");
  w.ctx.pickRaid("bonus", true);
  assert.strictEqual(text(w, "kbSummary"), "Raider OUT: CSE +2 SUPER TACKLE", "CSE (1 on court) tackles: super tackle; no bonus with 1 defender");
  assert.strictEqual(w.el("kbBonusNo").className, "on");
  // bonus + raider OUT (the referee gave the bonus first): both shown
  w.ctx.showState(kbState([]));
  team(w, "A"); w.ctx.pickRaid("bonus", true); w.ctx.pickRaid("caught", true);
  assert.strictEqual(text(w, "kbSummary"), "Raider OUT: ECE +1, CSE +1 bonus");
  w.ctx.saveRaid();
  assert.strictEqual(last(w), JSON.stringify(["raid", null, null, { team: "A", out: 0, bonus: true, caught: true }]));
  assert.strictEqual(text(w, "kbSent"), "Sent: CSE raid: raider OUT + bonus");
  w.ack({ ok: true });
  w.advance(700);

  // END HALF: asks first and says what happens
  w.setConfirm(false);
  w.ctx.showState(kbState([R("A", 3), END(1), R("B", 1)]));
  assert.deepStrictEqual([text(w, "kbHalf"), text(w, "kbEnd"), text(w, "kbHalves")], ["Half 2 (15 min)", "END HALF 2", "H1 3-0 · H2 0-1 (now)"]);
  w.ctx.endHalf();
  assert.strictEqual(w.confirms.at(-1), "End Half 2? This ENDS THE MATCH: CSE wins 3-1. You can still press UNDO afterwards.");
  assert.strictEqual(w.sent.length, 0, "Cancel sends nothing");
  w.ctx.showState(kbState([R("A", 1), R("B", 1), END(1)]));
  w.ctx.endHalf();
  assert.ok(w.confirms.at(-1).includes("The score is level: the match ends as a DRAW."), w.confirms.at(-1));
  w.ctx.showState(kbState([R("A", 1), R("B", 1), END(1)], KO));
  w.ctx.endHalf();
  assert.ok(w.confirms.at(-1).includes("The score is level: next you enter the tie-break winner."), w.confirms.at(-1));
  w.ctx.showState(kbState([]));
  w.setConfirm(true);
  w.ctx.endHalf();
  assert.strictEqual(w.confirms.at(-1), "End Half 1? Half time starts. You can still press UNDO afterwards.");
  assert.strictEqual(last(w), JSON.stringify(["end_period", null, null, { period: 1 }]));
  assert.strictEqual(text(w, "kbEnd"), "END HALF 2", "the button moves on at once");
  w.ack({ ok: true });
  w.ctx.showState(kbState([END(1)]));
  assert.ok(shown(w, "kbBreakNow") && text(w, "kbBreakNow") === "HALF TIME", "half time banner");

  // tie-break: a level knockout match asks only for the winner
  const levelKO = [R("A", 1), R("B", 1), END(1), END(2)];
  w.ctx.showState(kbState(levelKO, KO));
  assert.ok(shown(w, "kbControls") && shown(w, "kbTie") && !shown(w, "kbPlay"), "only the tie-break question");
  assert.deepStrictEqual([text(w, "kbHalf"), text(w, "kbTieA"), text(w, "kbTieB"), text(w, "kbHalves")], ["Tie-break", "CSE", "ECE", "H1 1-1 · H2 0-0"]);
  w.setConfirm(false); w.ctx.tieBreakWinner("B");
  assert.strictEqual(w.confirms.at(-1), "ECE won the tie-break? This ENDS THE MATCH. You can still press UNDO afterwards.");
  assert.strictEqual(w.sent.length, 0);
  w.setConfirm(true); w.ctx.tieBreakWinner("B");
  assert.strictEqual(last(w), JSON.stringify(["finish", null, null, { winner: "B" }]));
  w.ack({ ok: true });
  w.ctx.showState(kbState([...levelKO, { type: "finish", data: { winner: "B" } }], KO));
  assert.ok(!shown(w, "kbControls") && shown(w, "undoRow"), "finished: only UNDO");
  assert.strictEqual(text(w, "status"), "FINISHED. Team B won on tie-break (1-1)");

  // breaks: timeout (asks only from the 3rd in a half), other text, break over
  w.ctx.showState(kbState([]));
  assert.deepStrictEqual([w.el("kbOver").disabled, shown(w, "kbBreakNow")], [true, false], "no break on: Break over is closed");
  const asked = w.confirms.length;
  w.ctx.kbTimeout("A");
  assert.strictEqual(w.confirms.length, asked, "the 1st timeout needs no question");
  assert.strictEqual(last(w), JSON.stringify(["break", null, null, { kind: "timeout", team: "A" }]));
  assert.strictEqual(w.el("kbOver").disabled, false, "a break is waiting to be sent: Break over can be pressed");
  w.ack({ ok: true });
  w.ctx.showState(kbState([BRK({ kind: "timeout", team: "A" }), BRK({ kind: "timeout", team: "A" })]));
  assert.strictEqual(text(w, "kbBreakNow"), "TIMEOUT: CSE");
  w.setConfirm(false); w.ctx.kbTimeout("A");
  assert.strictEqual(w.confirms.at(-1), "CSE already had 2 timeouts in this half (AKFI allows 2 of 30 seconds). Show another timeout?");
  assert.strictEqual(w.sent.length, 0);
  w.setConfirm(true);
  w.ctx.breakOver();
  assert.strictEqual(last(w), JSON.stringify(["break", null, null, { kind: "over" }]));
  w.ack({ ok: true });
  w.el("kbBreakText").value = "  Water   break ";
  w.ctx.otherBreak();
  assert.strictEqual(last(w), JSON.stringify(["break", null, null, { kind: "other", text: "Water break" }]));
  assert.strictEqual(w.el("kbBreakText").value, "", "the box is emptied");
  w.ack({ ok: true });
  for (const bad of ["", "   ", "<b>tea</b>", "x".repeat(41), "tea & coffee", "a\nb"]) {
    w.el("kbBreakText").value = bad;
    w.el("err").textContent = "";
    w.ctx.otherBreak();
    assert.strictEqual(w.sent.length, 0, "not sent: " + JSON.stringify(bad));
    assert.strictEqual(text(w, "err"), "Break text: 1 to 40 letters, numbers, spaces and . , ' ! ? : ( ) / -");
  }
  w.ctx.showState(kbState([BRK({ kind: "other", text: "Rain delay" })]));
  assert.strictEqual(text(w, "kbBreakNow"), "BREAK: Rain delay");

  // fix a mistake: hidden until asked for; each asks first, then closes
  assert.ok(!shown(w, "kbFix"));
  w.ctx.toggleKbFix();
  assert.ok(shown(w, "kbFix"));
  assert.deepStrictEqual([text(w, "kbFixNameA"), text(w, "kbFixNameB")], ["CSE", "ECE"]);
  w.setConfirm(false); w.ctx.kbTechnical("A");
  assert.strictEqual(w.confirms.at(-1), "TECHNICAL POINT: +1 for CSE? You can still press UNDO afterwards.");
  assert.ok(w.sent.length === 0 && shown(w, "kbFix"), "Cancel: nothing sent, the box stays open");
  w.setConfirm(true); w.ctx.kbTechnical("A");
  assert.strictEqual(last(w), JSON.stringify(["point", "A", 1, null]));
  assert.ok(!shown(w, "kbFix"), "the box closes after one use");
  w.ack({ ok: true });
  w.ctx.toggleKbFix(); w.ctx.kbMinus("B");
  assert.ok(w.confirms.at(-1).startsWith("CORRECTION: take 1 point away from ECE?"), w.confirms.at(-1));
  assert.strictEqual(last(w), JSON.stringify(["point", "B", -1, null]));
  w.ack({ ok: true });
  w.ctx.toggleKbFix(); w.ctx.kbCourtFix("A", -1);
  assert.ok(w.confirms.at(-1).startsWith("Players on court for CSE: 7 -> 6?"), w.confirms.at(-1));
  assert.strictEqual(last(w), JSON.stringify(["court", null, null, { team: "A", change: -1 }]));
  w.ack({ ok: true });

  // do-or-die: the scorer sees the empty-raid count; the summary says DO-OR-DIE; an empty do-or-die raid asks first
  w.ctx.showState(kbState([R("A"), R("B"), R("A")]));                  // CSE: 2 empty raids, ECE: 1
  assert.strictEqual(text(w, "kbDod"), "Empty raids: CSE 2 (next raid DO-OR-DIE) · ECE 1");
  team(w, "A");
  assert.strictEqual(text(w, "kbSummary"), "DO-OR-DIE, no point: raider OUT, ECE +1");
  w.setConfirm(false); w.ctx.saveRaid();
  assert.strictEqual(w.confirms.at(-1), "DO-OR-DIE raid with no point: the raider is OUT and ECE gets 1 point. Save?");
  assert.strictEqual(w.sent.length, 0, "Cancel: nothing sent, the form stays");
  w.ctx.pickRaid("bonus", true);
  assert.strictEqual(text(w, "kbSummary"), "DO-OR-DIE: CSE +1 (bonus)", "a bonus saves it");
  w.ctx.pickRaid("bonus", false);
  w.setConfirm(true); w.ctx.saveRaid();
  assert.strictEqual(last(w), JSON.stringify(["raid", null, null, { team: "A", out: 0, bonus: false, caught: false }]),
    "stored as an empty raid; the server applies the do-or-die rule");
  w.ack({ ok: true });
  w.ctx.showState(kbState([]));
  assert.strictEqual(text(w, "kbDod"), "", "no empty raids: no line");

  // Cancel raid: only while a raid is started on this phone; sends cancel and empties the form
  assert.strictEqual(w.el("kbCancel").style.display, "none");
  team(w, "B");
  assert.strictEqual(w.el("kbCancel").style.display, "block");
  w.ctx.cancelRaid();
  assert.strictEqual(last(w), JSON.stringify(["raid_start", null, null, { cancel: true }]));
  w.ack({ ok: true });
  assert.deepStrictEqual([text(w, "kbSummary"), w.el("kbCancel").style.display], ["Tap who raided", "none"]);
  // a raid started on another phone (or before a reload): the form picks the team up, nothing is sent
  w.ctx.showState(kbState([{ type: "raid_start", data: { team: "B" } }]));
  assert.deepStrictEqual([w.el("kbRaidB").className, w.sent.length], ["teamB on", 0]);
  w.ctx.cancelRaid();
  w.ack({ ok: true });

  // the texts of waiting / rejected entries
  assert.strictEqual(w.ctx.entryText({ matchId: "m1", type: "raid_start", data: { team: "B" } }), "Match 1: Raid started: team B");
  assert.strictEqual(w.ctx.entryText({ matchId: "m1", type: "raid_start", data: { cancel: true } }), "Match 1: Raid cancelled");
  const et = (x) => w.ctx.entryText({ matchId: "m1", ...x });
  assert.strictEqual(et(R("A", 2, true)), "Match 1: Raid by team A: 2 out + bonus");
  assert.strictEqual(et(R("B", 0, false, true)), "Match 1: Raid by team B: raider OUT");
  assert.strictEqual(et(R("B")), "Match 1: Raid by team B: empty raid");
  assert.strictEqual(et({ type: "court", data: { team: "A", change: -1 } }), "Match 1: Players on court for team A: -1");
  assert.strictEqual(et(BRK({ kind: "timeout", team: "B" })), "Match 1: Break: timeout team B");
  assert.strictEqual(et(BRK({ kind: "other", text: "Rain delay" })), "Match 1: Break: Rain delay");
  assert.strictEqual(et(BRK({ kind: "over" })), "Match 1: Break over");
  assert.strictEqual(et(END(1)), "Match 1: End Half 1", "a kabaddi match: half, not quarter");

  // offline: the limits open (the phone's numbers may be old) and END HALF counts the presses not sent yet
  const w2 = makeWorld({ preset: { "scorer-session": session } });
  w2.connect();
  w2.ctx.showState(kbState([R("A", 2)]));                        // ECE has 5
  w2.disconnect();
  w2.ctx.pickRaid("team", "B"); w2.ctx.pickRaid("out", 1); w2.ctx.saveRaid();
  w2.advance(700);
  w2.ctx.pickRaid("team", "A");
  assert.deepStrictEqual([w2.el("kbOut7").disabled, w2.el("kbBonusYes").disabled], [false, false],
    "entries wait: the phone does not know the players on court, the server checks the raid");
  w2.ctx.pickRaid("out", 5);
  assert.strictEqual(text(w2, "kbSummary"), "CSE +5 (5 out)", "no ALL OUT guessed from old numbers");
  w2.setConfirm(true);
  w2.ctx.endHalf();
  assert.deepStrictEqual([text(w2, "kbEnd"), text(w2, "kbHalf")], ["END HALF 2", "Half 2 (15 min)"]);
  w2.ctx.endHalf();
  assert.ok(w2.confirms.at(-1).startsWith("End Half 2?"));
  assert.deepStrictEqual([text(w2, "kbEnd"), w2.el("kbEnd").disabled], ["END HALF 2 is waiting to be sent", true]);
  const n = w2.confirms.length;
  w2.ctx.endHalf();
  assert.strictEqual(w2.confirms.length, n, "no third END HALF");
  w2.ctx.act("undo");                                             // takes the waiting END HALF 2 back
  assert.deepStrictEqual([text(w2, "kbEnd"), w2.el("kbEnd").disabled], ["END HALF 2", false]);
  w2.connect();
  const types = [];
  while (w2.sent.length) { const p = w2.ack({ ok: true }); types.push(p.type + (p.data && p.data.period ? p.data.period : "")); }
  assert.deepStrictEqual(types, ["raid_start", "raid", "raid_start", "end_period1", "end_period2", "undo"], "sent in order, with the half numbers");

  // another match chosen: the kabaddi screen and the half-filled form go away
  w.ctx.pickRaid("team", "A");
  w.el("match").onchange();
  assert.ok(!shown(w, "kbView") && !shown(w, "kbControls"));
  w.ctx.showState(kbState([]));
  assert.strictEqual(text(w, "kbSummary"), "Tap who raided", "a fresh form");
  ok("kabaddi: raid form, limits, summary, END HALF, tie-break, breaks, fixes, offline");
}

// ---- 12. football: KICK-OFF, goal / penalty / card forms, END HALF, remove, extra time, shootout (double tap), offline ----
{
  const football = require("./engines/football");
  const { effectivePoints } = require("./engine");
  let version = 0;
  const GROUP = { halfMinutes: 15, players: 6, knockout: false };
  const KNOCK = { halfMinutes: 7, players: 5, knockout: true };
  const fbState = (events, config = GROUP) => ({ matchId: "m1", name: "Match 1", sport: "football", teamA: "CSE", teamB: "ECE",
    ...football.compute(effectivePoints(events.map((e, i) => ({ seq: i + 1, ...e }))), { config }), version: ++version });
  const KO = (n) => ({ type: "period_start", data: { period: n } });
  const END = (n) => ({ type: "end_period", data: { period: n } });
  const G = (team, shirt = 9, kind = "normal") => ({ type: "goal", data: { team, kind, shirt } });
  const shown = (w, id) => w.el(id).style.display === "block";
  const visible = (w, id) => w.el(id).style.display === "inline-block";
  const last = (w) => JSON.stringify([w.sent[0].payload.type, w.sent[0].payload.data]);
  const text = (w, id) => w.el(id).textContent;
  const type = (w, shirt, name = "") => { w.el("fbShirt").value = shirt; w.el("fbPlayerName").value = name; w.ctx.updateFootballUI(); };

  const w = makeWorld({ preset: { "scorer-session": session } });
  w.connect();
  w.ctx.showState(fbState([]));
  assert.ok(shown(w, "fbView") && shown(w, "fbControls") && shown(w, "fbPlay") && !shown(w, "fbDecide") && !shown(w, "fbShoot"), "football view");
  assert.ok(!shown(w, "kbControls") && !shown(w, "simpleControls") && !shown(w, "simpleView"), "no other sport's buttons");
  assert.deepStrictEqual([text(w, "fbNameA"), text(w, "fbNameB"), text(w, "fbFinB"), text(w, "fbPeriod")],
    ["CSE", "ECE", "Finish: ECE wins", "1st half (6-a-side, 2 x 15 min): not kicked off yet"]);
  // before the kick-off: only KICK-OFF and CARD
  assert.ok(visible(w, "fbKickoff") && !visible(w, "fbEnd") && !visible(w, "fbGoalA") && !visible(w, "fbPenB"));
  assert.strictEqual(text(w, "fbKickoff"), "KICK-OFF 1st half");
  w.ctx.fbKickoff();
  assert.strictEqual(last(w), JSON.stringify(["period_start", { period: 1 }]));
  assert.ok(!visible(w, "fbKickoff") && visible(w, "fbEnd") && visible(w, "fbGoalA"), "the kick-off waiting: the phone already plays the half");
  w.ctx.fbKickoff();
  assert.strictEqual(w.sent.length, 1, "a double KICK-OFF tap sends once");
  w.ack({ ok: true });
  w.ctx.showState(fbState([KO(1)]));

  // a goal: GOAL under ECE, shirt number + name, SAVE
  w.ctx.fbOpen("goal", "B");
  assert.ok(shown(w, "fbForm") && !shown(w, "fbTeams") && shown(w, "fbKinds") && !shown(w, "fbColors"), "the goal form");
  assert.deepStrictEqual([text(w, "fbFormTitle"), w.el("fbKind_normal").className, text(w, "fbSummary"), w.el("fbSave").disabled],
    ["GOAL for ECE", "on", "Type the shirt number of the scorer", true]);
  type(w, "100");
  assert.strictEqual(text(w, "fbSummary"), "Shirt number: 1 to 99");
  type(w, "0");
  assert.strictEqual(text(w, "fbSummary"), "Shirt number: 1 to 99");
  type(w, "7", "<b>");
  assert.strictEqual(text(w, "fbSummary"), "Name: up to 20 letters, numbers, spaces and . ' -");
  type(w, "", "Rahul");
  assert.strictEqual(text(w, "fbSummary"), "Type the shirt number (the name is extra)");
  w.ctx.fbPick("kind", "free_kick");
  type(w, " 7 ", "  Ravi   K ");
  assert.deepStrictEqual([text(w, "fbSummary"), w.el("fbSave").disabled, text(w, "fbSave")], ["Will send: GOAL ECE #7 Ravi K (free kick)", false, "SAVE GOAL"]);
  w.ctx.fbSave();
  assert.strictEqual(last(w), JSON.stringify(["goal", { team: "B", kind: "free_kick", shirt: 7, name: "Ravi K" }]));
  assert.deepStrictEqual([shown(w, "fbForm"), text(w, "fbSent")], [false, "Sent: GOAL ECE #7 Ravi K (free kick)"]);
  w.ctx.fbSave();
  assert.strictEqual(w.sent.length, 1, "a double tap on SAVE sends the goal once (the form is closed)");
  w.ack({ ok: true });
  // own goal: the shirt is of the OTHER team's player
  w.ctx.fbOpen("goal", "A");
  w.ctx.fbPick("kind", "own_goal");
  assert.strictEqual(text(w, "fbShirtQ"), "Shirt number of the ECE player who put it in");
  assert.strictEqual(text(w, "fbSummary"), "Type the shirt number of the ECE player");
  type(w, "4");
  w.ctx.fbSave();
  assert.strictEqual(last(w), JSON.stringify(["goal", { team: "A", kind: "own_goal", shirt: 4 }]));
  w.ack({ ok: true });
  // a goal form cancelled sends nothing
  w.ctx.fbOpen("goal", "A");
  w.ctx.fbCancel();
  assert.deepStrictEqual([w.sent.length, shown(w, "fbForm"), shown(w, "fbTeams")], [0, false, true]);

  // a penalty: PENALTY sends "penalty_start" at once (students see "PENALTY TO CSE!"), then the result
  w.ctx.fbOpen("penalty", "A");
  assert.strictEqual(last(w), JSON.stringify(["penalty_start", { team: "A" }]));
  w.ack({ ok: true });
  assert.ok(shown(w, "fbOutcomes") && !shown(w, "fbKinds"));
  assert.strictEqual(text(w, "fbSummary"), "Tap SCORED, SAVED or MISSED");
  w.ctx.fbPick("outcome", "scored");
  assert.strictEqual(text(w, "fbSummary"), "Type the shirt number of the scorer");
  w.ctx.fbPick("outcome", "saved");
  assert.strictEqual(text(w, "fbSummary"), "Will send: Penalty CSE: saved", "a saved penalty needs no shirt");
  w.ctx.fbSave();
  assert.strictEqual(last(w), JSON.stringify(["penalty", { team: "A", outcome: "saved" }]));
  w.ack({ ok: true });
  // Cancel penalty: sends cancel, the banner goes away
  w.ctx.fbOpen("penalty", "B");
  w.ack({ ok: true });
  assert.strictEqual(text(w, "fbFormCancel"), "Cancel penalty (no kick)");
  w.ctx.fbCancel();
  assert.strictEqual(last(w), JSON.stringify(["penalty_start", { cancel: true }]));
  w.ack({ ok: true });
  // a penalty started on another phone (or before a reload): its form opens, nothing is sent
  w.ctx.showState(fbState([KO(1), { type: "penalty_start", data: { team: "B" } }]));
  assert.deepStrictEqual([shown(w, "fbForm"), text(w, "fbFormTitle"), w.sent.length, text(w, "fbPenNow")],
    [true, "PENALTY to ECE (students see it now). What happened?", 0, "PENALTY TO ECE (students see it)"]);
  w.ctx.fbPick("outcome", "scored");
  type(w, "10");
  w.ctx.fbSave();
  assert.strictEqual(last(w), JSON.stringify(["penalty", { team: "B", outcome: "scored", shirt: 10 }]));
  w.ack({ ok: true });

  // a card: colour must be chosen (no default)
  w.ctx.showState(fbState([KO(1)]));
  w.ctx.fbOpen("card", "A");
  type(w, "5");
  assert.strictEqual(text(w, "fbSummary"), "Tap YELLOW or RED");
  w.ctx.fbPick("color", "red");
  assert.strictEqual(text(w, "fbSummary"), "Will send: Red card CSE #5");
  w.ctx.fbSave();
  assert.strictEqual(last(w), JSON.stringify(["card", { team: "A", color: "red", shirt: 5 }]));
  w.ack({ ok: true });

  // the score screen: goals, halves
  const h1 = [KO(1), G("A", 9), G("B", 7, "free_kick")];                // goal seqs 2 and 3
  w.ctx.showState(fbState(h1));
  assert.deepStrictEqual([text(w, "fbA"), text(w, "fbB"), text(w, "fbHalves"), text(w, "fbGoals")],
    ["1", "1", "H1 1-1 (now)", "Last goals: ECE #7 (free kick) · CSE #9"]);

  // remove a wrong goal: the list comes from the server's "removable"
  w.ctx.toggleFbFix();
  assert.ok(shown(w, "fbFix"));
  assert.deepStrictEqual(w.el("fbFixList").children.map((b) => b.textContent),
    ["Remove: GOAL ECE #7 (free kick) (1st half, 1-1)", "Remove: GOAL CSE #9 (1st half, 1-0)"], "newest first");
  w.el("fbFixList").children[0].onclick();
  assert.ok(w.confirms.at(-1).startsWith("REMOVE: GOAL ECE #7 (free kick) (1st half, 1-1)?"));
  assert.strictEqual(last(w), JSON.stringify(["remove", { seq: 3 }]));
  assert.ok(!shown(w, "fbFix"));
  w.ack({ ok: true });

  // END HALF: asks, says what happens, sends the half number; a double tap cannot end the 2nd half
  w.ctx.showState(fbState(h1));
  assert.strictEqual(text(w, "fbEnd"), "END 1ST HALF");
  w.ctx.fbEndHalf();
  assert.ok(w.confirms.at(-1).startsWith("End the 1st half? Half time starts."));
  assert.strictEqual(last(w), JSON.stringify(["end_period", { period: 1 }]));
  assert.deepStrictEqual([visible(w, "fbEnd"), text(w, "fbKickoff")], [false, "KICK-OFF 2nd half"], "the phone is at half time");
  const n = w.sent.length;
  w.ctx.fbEndHalf();
  assert.strictEqual(w.sent.length, n, "a second END tap while waiting sends nothing");
  w.ack({ ok: true });
  w.ctx.showState(fbState([...h1, END(1)]));
  assert.deepStrictEqual([text(w, "fbBreakNow"), shown(w, "fbBreakNow")], ["HALF TIME", true]);
  assert.ok(!visible(w, "fbGoalA") && visible(w, "fbKickoff"), "no goals at half time");
  w.setConfirm(true);
  const h2 = [...h1, END(1), KO(2)];
  w.ctx.showState(fbState(h2));
  w.ctx.fbEndHalf();
  assert.ok(w.confirms.at(-1).includes("The score is level: the match ends as a DRAW."), w.confirms.at(-1));
  w.ack({ ok: true });

  // a knockout match level at full time: EXTRA TIME or SHOOTOUT
  const level = [...h2, END(2)];
  w.ctx.showState(fbState(h2, KNOCK));
  w.ctx.fbEndHalf();
  assert.ok(w.confirms.at(-1).includes("next you choose EXTRA TIME or the PENALTY SHOOTOUT"));
  w.ack({ ok: true });
  w.ctx.showState(fbState(level, KNOCK));
  assert.ok(shown(w, "fbDecide") && !shown(w, "fbPlay") && !shown(w, "fbShoot"));
  assert.deepStrictEqual([w.el("fbEtBtn").style.display, w.el("fbShootBtn").disabled, text(w, "fbBreakNow")], ["inline-block", true, "FULL TIME: LEVEL"]);
  w.ctx.fbExtraTime();
  assert.strictEqual(last(w), JSON.stringify(["extra_time", null]));
  assert.ok(shown(w, "fbPlay") && visible(w, "fbGoalA"), "extra time kicks off at once");
  assert.strictEqual(text(w, "fbEnd"), "END EXTRA TIME 1ST HALF");
  w.ack({ ok: true });
  // after extra time, still level: only the shootout
  const levelET = [...level, { type: "extra_time" }, END(3), KO(4), END(4)];
  w.ctx.showState(fbState(levelET, KNOCK));
  assert.strictEqual(w.el("fbEtBtn").style.display, "none", "no second extra time");
  w.ctx.fbPickShoot("kicks", 3);
  assert.strictEqual(w.el("fbShootBtn").disabled, true, "who kicks first is still missing");
  w.ctx.fbPickShoot("first", "B");
  assert.deepStrictEqual([w.el("fbKicks3").className, w.el("fbFirstB").className, w.el("fbShootBtn").disabled], ["on", "teamB on", false]);
  w.ctx.fbStartShootout();
  assert.ok(w.confirms.at(-1).startsWith("Start the PENALTY SHOOTOUT: 3 kicks each, ECE kicks first?"));
  assert.strictEqual(last(w), JSON.stringify(["shootout_start", { kicks: 3, first: "B" }]));
  assert.ok(shown(w, "fbShoot"), "the phone already shows the shootout");
  assert.strictEqual(text(w, "fbNext"), "Next kick: ECE (kick 1)");
  w.ack({ ok: true });

  // the shootout: a kick, then a double tap within 1.5 s does NOT become the other team's kick
  const so = [...levelET, { type: "shootout_start", data: { kicks: 3, first: "B" } }];
  w.ctx.showState(fbState(so, KNOCK));
  assert.deepStrictEqual([text(w, "fbShootLine"), text(w, "fbNext"), w.el("fbNext").className],
    ["Penalties: CSE 0 - 0 ECE · 3 kicks each", "Next kick: ECE (kick 1)", "bbTeam teamB"]);
  w.ctx.fbKick("scored");
  assert.strictEqual(last(w), JSON.stringify(["kick", { team: "B", outcome: "scored" }]));
  assert.deepStrictEqual([text(w, "fbNext"), w.el("fbKick_saved").disabled, w.el("fbNext").className], ["Next kick: CSE (kick 1)", true, "bbTeam teamA"]);
  w.ctx.fbKick("scored");
  assert.strictEqual(text(w, "pending"), "1 entry waiting to be sent", "a double tap is ignored (it would have been CSE's kick)");
  w.advance(1600);
  w.render();
  assert.strictEqual(w.el("fbKick_saved").disabled, false, "the buttons open again after 1.5 s");
  w.ctx.fbKick("saved");
  assert.strictEqual(text(w, "pending"), "2 entries waiting to be sent");
  assert.deepStrictEqual([text(w, "fbShootA"), text(w, "fbShootB")], ["CSE: X - -", "ECE: O - -"]);
  w.ack({ ok: true });
  w.ctx.showState(fbState([...so, { type: "kick", data: { team: "B", outcome: "scored" } }], KNOCK));   // the server's new state
  assert.strictEqual(last(w), JSON.stringify(["kick", { team: "A", outcome: "saved" }]), "the second kick is CSE's");
  w.advance(1600);
  w.ctx.fbKick("scored");                                        // ECE 2/2, CSE 0/1: CSE can still reach 2
  w.advance(1600);
  w.ctx.fbKick("missed");                                        // CSE 0/2 with 1 left, ECE 2: decided
  assert.ok(shown(w, "fbWait") && !shown(w, "fbShoot"), "decided on the phone: wait for the server's result");
  assert.ok(text(w, "fbWait").startsWith("Waiting for the server (3 entries to send)"), text(w, "fbWait"));
  while (w.sent.length) w.ack({ ok: true });
  w.ctx.showState(fbState(so, KNOCK));
  assert.strictEqual(w.el("fbFixBtn").style.display, "none", "no 'remove' in the shootout");

  // the texts of waiting / rejected entries
  const et = (x) => w.ctx.entryText({ matchId: "m1", ...x });
  assert.strictEqual(et(KO(2)), "Match 1: Kick-off 2nd half");
  assert.strictEqual(et(END(3)), "Match 1: End Extra time 1st half", "a football match: halves, not quarters");
  assert.strictEqual(et({ type: "goal", data: { team: "A", kind: "own_goal", shirt: 4, name: "Ravi" } }), "Match 1: GOAL team A #4 Ravi (own goal)");
  assert.strictEqual(et({ type: "penalty", data: { team: "B", outcome: "missed" } }), "Match 1: Penalty team B: missed");
  assert.strictEqual(et({ type: "card", data: { team: "B", color: "yellow", shirt: 3 } }), "Match 1: Yellow card team B #3");
  assert.strictEqual(et({ type: "kick", data: { team: "A", outcome: "saved" } }), "Match 1: Shootout kick team A: saved");
  assert.strictEqual(et({ type: "shootout_start", data: { kicks: 5, first: "A" } }), "Match 1: Penalty shootout: 5 kicks, team A first");
  assert.strictEqual(et({ type: "remove", data: { seq: 3 } }), "Match 1: Remove a wrong entry");
  assert.strictEqual(et({ type: "penalty_start", data: { cancel: true } }), "Match 1: Penalty cancelled");

  // offline: the phone follows its own waiting entries; after END 2nd half it waits for the server
  const w2 = makeWorld({ preset: { "scorer-session": session } });
  w2.connect();
  w2.ctx.showState(fbState([]));
  w2.disconnect();
  w2.ctx.fbKickoff();
  w2.ctx.fbOpen("goal", "A"); type(w2, "9"); w2.ctx.fbSave();
  w2.ctx.fbEndHalf();
  assert.strictEqual(text(w2, "fbKickoff"), "KICK-OFF 2nd half");
  w2.ctx.fbKickoff();
  assert.strictEqual(text(w2, "fbEnd"), "END 2ND HALF");
  w2.ctx.fbEndHalf();
  assert.ok(w2.confirms.at(-1).includes("entries are still waiting to be sent"), "the question warns that the score may be old");
  assert.ok(shown(w2, "fbWait") && !shown(w2, "fbPlay"), "after END 2nd half only the server knows: draw, win or a decision");
  w2.ctx.act("undo");                                             // takes the waiting END 2nd half back
  assert.ok(!shown(w2, "fbWait") && shown(w2, "fbPlay") && visible(w2, "fbEnd"));
  w2.connect();
  const types = [];
  while (w2.sent.length) { const p = w2.ack({ ok: true }); types.push(p.type + (p.data && p.data.period ? p.data.period : "")); }
  assert.deepStrictEqual(types, ["period_start1", "goal", "end_period1", "period_start2", "end_period2", "undo"], "sent in order, with the half numbers");

  // another match chosen: the football screen and a half-filled form go away
  w.ctx.showState(fbState([KO(1)]));
  w.ctx.fbOpen("goal", "A");
  w.el("match").onchange();
  assert.ok(!shown(w, "fbView") && !shown(w, "fbControls"));
  w.ctx.showState(fbState([KO(1)]));
  assert.ok(!shown(w, "fbForm") && shown(w, "fbTeams"), "a fresh screen");
  ok("football: kick-off, goal / penalty / card forms, END HALF, remove, extra time, shootout double tap, offline");
}

await blockedTest;
};
