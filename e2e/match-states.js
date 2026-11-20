// Real match states for the match page tests, made by the REAL sport engines (the same way server.js
// buildState() makes them), so the tests can show any sport and situation without a scorer or a database.
// showState(page, state) hands a state to the page's own "score:update" handler, as if the server sent it.
const { getEngine } = require("../engines");
const { effectivePoints } = require("../engine");

let version = 0;
function stateFor(sport, events, { config = {}, bestOf = 3, teamA = "CSE", teamB = "ECE", name = "Final", id = "fx-" + sport } = {}) {
  const rows = events.map((e, i) => ({ seq: String(i + 1), type: e.type, team: e.team || null,
    value: e.value === undefined ? null : e.value, data: e.data || null }));
  const s = getEngine(sport).compute(effectivePoints(rows), { config, best_of: bestOf });
  return { matchId: id, name, sport, teamA, teamB, ...s, version: ++version };
}

const point = (team, value) => ({ type: "point", team, value });
// points that alternate A, B, A, B ... until team B has `b`, then the rest to A: rally(11, 7) = a game A wins 11-7
const rally = (a, b) => [...Array(b)].flatMap(() => [point("A"), point("B")]).concat([...Array(a - b)].map(() => point("A")));
const ball = (runs, extra = null, kind = null) => ({ type: "ball", data: { runs, extra, wicket: kind ? { kind } : null } });

const states = {
  simpleLive: () => stateFor("simple", [point("A", 2), point("B", 1), point("A", 1)]),
  simpleFinished: () => stateFor("simple", [point("A", 2), point("B", 1), { type: "finish" }]),
  tableTennis: () => stateFor("table_tennis", [...rally(11, 7), ...rally(5, 3)]),               // games 1-0, now 5-3
  volleyball: () => stateFor("volleyball", [...rally(25, 20), ...rally(12, 10)], { config: { bestOf: 3 } }),   // sets 1-0, now 12-10
  cricketChase: () => stateFor("cricket", [
    ...[4, 1, 0, 6, 2, 1, 0, 4, 1, 1, 0, 2].map((r) => ball(r)),                             // innings 1: 2 overs, 22 runs
    ball(1), ball(0, null, "bowled"), ball(1, "noball"),                                      // innings 2: a wicket, then a no ball
  ], { config: { overs: 2, players: 4, firstBatting: "A", freeHit: true } }),
};

async function showState(page, state) {
  await page.evaluate((s) => socket.listeners("score:update").forEach((f) => f(s)), state);
}

// Opens the match page for a match that does not exist on the server (so the server sends nothing itself)
// with a fake /api/match answer for the place/time line.
async function openFixturePage(page, id, meta = { competition: "Football", stage: "group", venue: "Main ground", startTime: null }) {
  await page.route("**/api/match/*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(meta) }));
  await page.goto("/match.html?id=" + id);
  await page.waitForFunction(() => typeof socket !== "undefined" && socket.connected);
}

module.exports = { stateFor, states, showState, openFixturePage, point, ball };
