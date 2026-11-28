const assert = require("assert");
const { computeTableTennis, effectivePoints } = require("./engine");
const { getEngine } = require("./engines");

// helper: build a list of points, A first then B
const pts = (a, b) => [
  ...Array(a).fill({ type: "point", team: "A" }),
  ...Array(b).fill({ type: "point", team: "B" }),
];

// ---------- table tennis (Lessons 3 and 6) ----------
let s = computeTableTennis(pts(11, 0));
assert.strictEqual(s.gamesA, 1);
assert.strictEqual(s.pointsA, 0);

s = computeTableTennis([...pts(10, 10), { type: "point", team: "A" }]);
assert.strictEqual(s.gamesA, 0);
assert.strictEqual(s.pointsA, 11);

s = computeTableTennis([...pts(10, 10), { type: "point", team: "A" }, { type: "point", team: "A" }]);
assert.strictEqual(s.gamesA, 1);

s = computeTableTennis([...pts(11, 0), ...pts(11, 0)]);
assert.strictEqual(s.winner, "A");
assert.strictEqual(s.status, "finished");

s = computeTableTennis(pts(15, 13));                      // 15-13 finishes a game
assert.strictEqual(s.gamesA, 1);

const log = [
  { type: "point", team: "A" },
  { type: "point", team: "B" },
  { type: "undo" },
  { type: "point", team: "A" },
];
s = computeTableTennis(effectivePoints(log));
assert.strictEqual(s.pointsA, 2);
assert.strictEqual(s.pointsB, 0);
assert.strictEqual(effectivePoints([{ type: "undo" }]).length, 0);
// kabaddi "raid started" is never taken back by UNDO: UNDO takes back the newest other entry
{
  const { canUndo } = require("./engine");
  const A = { type: "point", team: "A" }, RS = { type: "raid_start", data: { team: "B" } }, U = { type: "undo" };
  assert.deepStrictEqual(effectivePoints([A, RS, U]), [RS], "undo skips the raid start and takes the point");
  assert.deepStrictEqual(effectivePoints([RS, U]), [RS], "only a raid start: nothing to take back");
  assert.deepStrictEqual(effectivePoints([A, A, RS, U, U]), [RS]);
  assert.deepStrictEqual(effectivePoints([A, U, A]), [A], "other sports: unchanged");
  assert.strictEqual(canUndo([RS]), false);
  assert.strictEqual(canUndo([A, U]), false);
  assert.strictEqual(canUndo([A, RS]), true);
  assert.strictEqual(canUndo([]), false);
}

// ---------- simple score mode (Lesson 9) ----------
const simple = getEngine("simple");
const sp = (team, value) => ({ type: "point", team, value });

let st = simple.compute([sp("A", 2), sp("B", 3), sp("A", 1)]);
assert.strictEqual(st.scoreA, 3);
assert.strictEqual(st.scoreB, 3);
assert.strictEqual(st.status, "live");
assert.strictEqual(st.winner, null);

// finish decides the winner
st = simple.compute([sp("A", 2), sp("B", 3), { type: "finish" }]);
assert.strictEqual(st.status, "finished");
assert.strictEqual(st.winner, "B");

// equal score at the end is a draw
st = simple.compute([sp("A", 2), sp("B", 2), { type: "finish" }]);
assert.strictEqual(st.winner, "draw");

// undo cancels the last action, even a "finish"
st = simple.compute(effectivePoints([sp("A", 2), { type: "finish" }, { type: "undo" }]));
assert.strictEqual(st.status, "live");
st = simple.compute(effectivePoints([sp("A", 2), sp("B", 3), { type: "undo" }]));
assert.strictEqual(st.scoreB, 0);

// validation
const live = { status: "live" };
assert.strictEqual(simple.validate(sp("A", 2), live), null);
assert.strictEqual(simple.validate(sp("C", 2), live), "bad team");
assert.strictEqual(simple.validate(sp("A", 0), live), "bad value");
assert.strictEqual(simple.validate(sp("A", 11), live), "bad value");
assert.strictEqual(simple.validate(sp("A", 1.5), live), "bad value");
assert.strictEqual(simple.validate(sp("A", 2), { status: "finished" }), "match already finished");
assert.strictEqual(simple.validate({ type: "finish" }, live), null);
assert.strictEqual(simple.validate({ type: "finish" }, { status: "finished" }), "match already finished");
assert.strictEqual(simple.validate({ type: "dance" }, live), "unknown action");

// table tennis refuses "finish", registry refuses unknown sports
const tt = getEngine("table_tennis");
assert.strictEqual(tt.validate({ type: "finish" }, { winner: null }), "unknown action");
assert.strictEqual(getEngine("quidditch"), null);
assert.strictEqual(getEngine("constructor"), null);


// ======================= cricket (Lesson 10) =======================
const cricket = getEngine("cricket");
assert.ok(cricket, "cricket engine is registered");

const cfg = (o) => ({ config: { overs: 2, players: 4, firstBatting: "A", freeHit: true, ...o } });
const ball = (runs = 0, extra = null, wicket = null) => ({ type: "ball", data: { runs, extra, wicket: wicket ? { kind: wicket } : null } });
const balls = (n, runs = 0) => Array(n).fill(0).map(() => ball(runs));
const endInn = { type: "end_innings" };
const abandon = { type: "finish" };
const toss = (winner, choice) => ({ type: "toss", data: { winner, choice } });
const run = (events, o) => cricket.compute(effectivePoints(events), cfg(o));

// ---- basic scoring and overs ----
let c = run([ball(1), ball(4), ball(0), ball(6), ball(2), ball(0)]);
assert.strictEqual(c.innings[0].runs, 13);
assert.strictEqual(c.innings[0].overs, "1.0");
assert.strictEqual(c.innings[0].legalBalls, 6);
assert.deepStrictEqual(c.innings[0].recent, ["1", "4", "0", "6", "2", "0"]);
c = run([ball(1), ball(2)]);
assert.strictEqual(c.innings[0].overs, "0.2");
assert.strictEqual(c.innings[0].runRate, 9);                   // 3 runs from 2 balls = 9 per over
c = run([...balls(6, 1), ball(4)]);                            // a new over starts a fresh list
assert.deepStrictEqual(c.innings[0].recent, ["4"]);

// ---- wide: 1 penalty + extra runs, not a legal ball ----
c = run([ball(0, "wide"), ball(2, "wide")]);
assert.strictEqual(c.innings[0].runs, 4);
assert.strictEqual(c.innings[0].legalBalls, 0);
assert.strictEqual(c.innings[0].extras.wides, 4);
assert.deepStrictEqual(c.innings[0].recent, ["Wd", "Wd+2"]);

// ---- no ball: 1 penalty + bat runs, not a legal ball, then a free hit ----
c = run([ball(4, "noball")]);
assert.strictEqual(c.innings[0].runs, 5);
assert.strictEqual(c.innings[0].legalBalls, 0);
assert.strictEqual(c.innings[0].extras.noBalls, 1);
assert.strictEqual(c.freeHit, true);
assert.strictEqual(cricket.validate({ type: "ball", data: { runs: 0, wicket: { kind: "bowled" } } }, c), "free hit: only a run out is possible");
assert.strictEqual(cricket.validate({ type: "ball", data: { runs: 1, wicket: { kind: "runout" } } }, c), null);
assert.strictEqual(run([ball(0, "noball"), ball(0, "wide")]).freeHit, true);     // a wide keeps the free hit
assert.strictEqual(run([ball(0, "noball"), ball(0, "noball")]).freeHit, true);   // so does another no ball
assert.strictEqual(run([ball(0, "noball"), ball(1)]).freeHit, false);            // a legal ball ends it
assert.strictEqual(run([ball(0, "noball")], { freeHit: false }).freeHit, false); // rule switched off

// ---- byes and leg byes: legal balls, counted as extras ----
c = run([ball(2, "bye"), ball(1, "legbye")]);
assert.strictEqual(c.innings[0].runs, 3);
assert.strictEqual(c.innings[0].legalBalls, 2);
assert.strictEqual(c.innings[0].extras.byes, 2);
assert.strictEqual(c.innings[0].extras.legByes, 1);
assert.strictEqual(c.innings[0].extras.total, 3);
assert.deepStrictEqual(c.innings[0].recent, ["B2", "Lb1"]);

// ---- wickets; all out ends the innings (4 players = 3 wickets) ----
c = run([ball(0, null, "bowled"), ball(1), ball(0, null, "caught")]);
assert.strictEqual(c.innings[0].wickets, 2);
assert.strictEqual(c.inning, 1);
assert.deepStrictEqual(c.innings[0].recent, ["W", "1", "W"]);
c = run([ball(2), ball(0, null, "bowled"), ball(0, null, "lbw"), ball(0, null, "caught")]);
assert.strictEqual(c.innings[0].status, "done");
assert.strictEqual(c.innings[0].endReason, "all out");
assert.strictEqual(c.inning, 2);
assert.strictEqual(c.target, 3);
assert.deepStrictEqual(c.innings[0].recent, ["2", "W", "W", "W"]);

// ---- overs used up end the innings; wides do not count as balls ----
c = run([...balls(11, 1), ball(0, "wide"), ball(1)]);          // 11 + 1 (wide) + 1 = 13 runs
assert.strictEqual(c.innings[0].legalBalls, 12);
assert.strictEqual(c.innings[0].runs, 13);
assert.strictEqual(c.innings[0].endReason, "overs complete");
assert.strictEqual(c.target, 14);

// ---- scorer ends the innings early; chase information ----
c = run([ball(4), ball(6), endInn]);
assert.strictEqual(c.innings[0].runs, 10);
assert.strictEqual(c.innings[0].endReason, "ended by scorer");
assert.strictEqual(c.inning, 2);
assert.strictEqual(c.target, 11);
assert.strictEqual(c.need, 11);
assert.strictEqual(c.ballsLeft, 12);
assert.strictEqual(c.requiredRate, 5.5);                        // 11 runs from 2 overs
c = run([ball(4), ball(6), endInn, ball(3)]);
assert.strictEqual(c.need, 8);
assert.strictEqual(c.ballsLeft, 11);
assert.strictEqual(c.requiredRate, 4.36);                       // 8 * 6 / 11

// ---- results ----
const innA = [ball(4), ball(6), endInn];                        // A scores 10, so B needs 11

c = run([...innA, ball(6), ball(4), ball(1)]);                  // chase completed with all wickets in hand
assert.strictEqual(c.status, "finished");
assert.strictEqual(c.winner, "B");
assert.strictEqual(c.resultText, "Team B won by 3 wickets");

c = run([...innA, ball(0, null, "bowled"), ball(6), ball(5)]);
assert.strictEqual(c.winner, "B");
assert.strictEqual(c.resultText, "Team B won by 2 wickets");

c = run([...innA, ball(0, null, "bowled"), ball(0, null, "bowled"), ball(0, null, "bowled")]);
assert.strictEqual(c.innings[1].endReason, "all out");
assert.strictEqual(c.winner, "A");
assert.strictEqual(c.resultText, "Team A won by 10 runs");

c = run([...innA, ...balls(11, 0), ball(5)]);                   // 5 runs from 12 balls, falls short
assert.strictEqual(c.innings[1].endReason, "overs complete");
assert.strictEqual(c.resultText, "Team A won by 5 runs");

c = run([...innA, ball(6), ball(3), ...balls(10, 0)]);          // 9 runs, one short
assert.strictEqual(c.resultText, "Team A won by 1 run");

c = run([...innA, ...balls(10, 0), ball(6), ball(4)]);          // 10 runs, level
assert.strictEqual(c.winner, "tie");
assert.strictEqual(c.resultText, "Match tied");

c = run([ball(4), ball(6), endInn, ball(6), ball(4), ball(1)], { players: 2 });   // one wicket in total
assert.strictEqual(c.resultText, "Team B won by 1 wicket");

c = run([ball(4), endInn, ball(4), ball(1)], { firstBatting: "B" });
assert.strictEqual(c.innings[0].battingTeam, "B");
assert.strictEqual(c.innings[1].battingTeam, "A");
assert.strictEqual(c.winner, "A");
assert.strictEqual(c.resultText, "Team A won by 3 wickets");

// ---- nothing counts after the match is over ----
c = run([...innA, ball(6), ball(4), ball(1), ball(6)]);
assert.strictEqual(c.innings[1].runs, 11);
assert.strictEqual(cricket.validate({ type: "ball", data: { runs: 1 } }, c), "match already finished");
assert.strictEqual(cricket.validate({ type: "finish" }, c), "match already finished");

// ---- abandoning the match ----
c = run([ball(1), abandon]);
assert.strictEqual(c.status, "finished");
assert.strictEqual(c.winner, null);
assert.strictEqual(c.resultText, "Match abandoned (no result)");
assert.strictEqual(run([abandon, ball(6)]).innings[0].runs, 0);

// ---- end innings needs at least one ball (after the toss) ----
c = run([toss("A", "bat")]);
assert.strictEqual(cricket.validate({ type: "end_innings" }, c), "no balls bowled in this innings yet");
c = run([ball(1)]);
assert.strictEqual(cricket.validate({ type: "end_innings" }, c), null);
assert.strictEqual(cricket.validate({ type: "dance" }, c), "unknown action");

// ---- undo ----
c = run([ball(1), ball(0, null, "bowled"), ball(0, null, "bowled"), ball(0, null, "bowled"), { type: "undo" }]);
assert.strictEqual(c.inning, 1);                                // the last wicket was taken back
assert.strictEqual(c.innings[0].wickets, 2);
assert.strictEqual(c.innings[0].status, "live");
c = run([ball(3), endInn, { type: "undo" }]);                   // end innings taken back
assert.strictEqual(c.inning, 1);
c = run([ball(3), endInn, ball(6), { type: "undo" }, { type: "undo" }]);
assert.strictEqual(c.inning, 1);
assert.strictEqual(c.innings[0].runs, 3);

// ---- checking a ball ----
const bad = (data, text) => assert.strictEqual(cricket.parseBall(data).error, text);
const good = (data) => assert.ok(cricket.parseBall(data).ball, JSON.stringify(data));
bad(null, "bad ball");
bad("4", "bad ball");
bad([], "bad ball");
bad({ runs: 7 }, "bad runs");
bad({ runs: -1 }, "bad runs");
bad({ runs: 1.5 }, "bad runs");
bad({ runs: "4" }, "bad runs");
bad({}, "bad runs");
bad({ runs: 1, extra: "foo" }, "bad extra");
bad({ runs: 0, extra: "bye" }, "bye needs at least 1 run");
bad({ runs: 0, extra: "legbye" }, "bye needs at least 1 run");
bad({ runs: 0, wicket: { kind: "foo" } }, "bad wicket");
bad({ runs: 0, wicket: "bowled" }, "bad wicket");
bad({ runs: 0, extra: "wide", wicket: { kind: "bowled" } }, "that wicket is not possible on a wide");
bad({ runs: 0, extra: "noball", wicket: { kind: "caught" } }, "only a run out is possible on this ball");
bad({ runs: 1, extra: "bye", wicket: { kind: "stumped" } }, "only a run out is possible on this ball");
bad({ runs: 1, wicket: { kind: "bowled" } }, "runs do not count with this wicket");
bad({ runs: 1, extra: "wide", wicket: { kind: "stumped" } }, "runs do not count with this wicket");
good({ runs: 0 });
good({ runs: 6, extra: null });
good({ runs: 2, wicket: { kind: "runout" } });
good({ runs: 1, extra: "noball", wicket: { kind: "runout" } });
good({ runs: 0, extra: "wide", wicket: { kind: "stumped" } });
good({ runs: 1, extra: "bye", wicket: { kind: "runout" } });
good({ runs: 0, wicket: { kind: "hitwicket" } });

// ---- the cleaned copy that is stored ----
assert.deepStrictEqual(cricket.clean({ type: "ball", data: { runs: 1, hack: "x" } }), { runs: 1, extra: null, wicket: null });
assert.deepStrictEqual(cricket.clean({ type: "ball", data: { runs: 0, extra: "wide", wicket: { kind: "stumped", who: "x" } } }),
  { runs: 0, extra: "wide", wicket: { kind: "stumped" } });
assert.strictEqual(cricket.clean({ type: "finish" }), null);
assert.strictEqual(cricket.clean({ type: "ball", data: { runs: 99 } }), null);

// ---- match settings ----
assert.strictEqual(cricket.checkConfig({ overs: 5, players: 6, firstBatting: "A", freeHit: true }), null);
assert.ok(cricket.checkConfig({ overs: 0, players: 6, firstBatting: "A", freeHit: true }));
assert.ok(cricket.checkConfig({ overs: 51, players: 6, firstBatting: "A", freeHit: true }));
assert.ok(cricket.checkConfig({ overs: 5, players: 1, firstBatting: "A", freeHit: true }));
assert.ok(cricket.checkConfig({ overs: 5, players: 12, firstBatting: "A", freeHit: true }));
assert.ok(cricket.checkConfig({ overs: 5, players: 6, firstBatting: "C", freeHit: true }));
assert.ok(cricket.checkConfig({ overs: 5, players: 6, firstBatting: "A", freeHit: "yes" }));
assert.ok(cricket.checkConfig(null));
assert.deepStrictEqual(cricket.normalizeConfig({}), { overs: 10, players: 11, firstBatting: "A", freeHit: true });
assert.deepStrictEqual(cricket.normalizeConfig(null), { overs: 10, players: 11, firstBatting: "A", freeHit: true });
assert.deepStrictEqual(cricket.normalizeConfig({ overs: 99 }), { overs: 10, players: 11, firstBatting: "A", freeHit: true });
assert.deepStrictEqual(cricket.normalizeConfig({ overs: 5, hack: 1 }), { overs: 5, players: 11, firstBatting: "A", freeHit: true });

// ---- college rules: overs from category and stage ----
// Boys / Male Faculty: 12 overs, Semi Final and Final 14.  Girls: 10, Semi Final and Final 12.
{
  const expect = {
    boys:           { group: 12, quarter_final: 12, semi_final: 14, final: 14, knockout: 12 },
    male_faculty:   { group: 12, quarter_final: 12, semi_final: 14, final: 14, knockout: 12 },
    girls:          { group: 10, quarter_final: 10, semi_final: 12, final: 12, knockout: 10 },
    female_faculty: { group: null, quarter_final: null, semi_final: null, final: null, knockout: null },
    mix:            { group: null, quarter_final: null, semi_final: null, final: null, knockout: null },
    "":             { group: null, quarter_final: null, semi_final: null, final: null, knockout: null },
  };
  for (const [category, byStage] of Object.entries(expect)) {
    for (const [stage, overs] of Object.entries(byStage)) {
      assert.strictEqual(cricket.collegeOvers(category, stage), overs, "overs for " + category + " / " + stage);
    }
  }
  assert.strictEqual(cricket.collegeOvers("boys", "unknown"), null, "unknown stage: no rule");
  assert.strictEqual(cricket.collegeOvers("toString", "group"), null, "not fooled by object built-ins");
  assert.strictEqual(cricket.collegeOvers(undefined, undefined), null);

  // the engine really stops at the college numbers (12 overs = 72 balls, 14 overs = 84 balls)
  for (const overs of [10, 12, 14]) {
    const balls1 = overs * 6;
    let s = run(balls(balls1 - 1, 1), { overs, players: 11 });
    assert.strictEqual(s.inning, 1, overs + " overs: one ball before the end, still innings 1");
    s = run(balls(balls1, 1), { overs, players: 11 });
    assert.strictEqual(s.inning, 2, overs + " overs: innings 1 ends after " + balls1 + " legal balls");
    assert.strictEqual(s.innings[0].overs, overs + ".0");
    assert.strictEqual(s.innings[0].endReason, "overs complete");
    assert.strictEqual(s.maxOvers, overs);
    assert.strictEqual(s.ballsLeft, balls1, "the chasing team gets the same " + overs + " overs");
    // second innings: same runs -> tie, one less -> team A wins by 1 run
    const tie = run([...balls(balls1, 1), ...balls(balls1, 1)], { overs, players: 11 });
    assert.strictEqual(tie.status, "finished");
    assert.strictEqual(tie.winner, "tie");
    const win = run([...balls(balls1, 1), ...balls(balls1 - 1, 1), ball(0)], { overs, players: 11 });
    assert.strictEqual(win.resultText, "Team A won by 1 run");
  }
}

// ---- the toss: the scorer records it before the first ball ----
{
  // before the toss: nothing but the toss (or abandon) is allowed
  let s = run([]);
  assert.strictEqual(s.needsToss, true);
  assert.strictEqual(s.toss, null);
  assert.strictEqual(cricket.validate(ball(1), s), "record the toss first");
  assert.strictEqual(cricket.validate(endInn, s), "record the toss first");
  assert.strictEqual(cricket.validate(abandon, s), null, "rain before the toss: abandon still works");
  assert.strictEqual(cricket.validate(toss("A", "bat"), s), null);
  // bad toss data is refused
  for (const data of [null, {}, { winner: "C", choice: "bat" }, { winner: "A", choice: "field" }, { winner: "A" }, [1], "A"]) {
    assert.strictEqual(cricket.validate({ type: "toss", data }, s), "bad toss", "refused: " + JSON.stringify(data));
  }

  // winner + choice decide who bats first (the admin setting firstBatting is not used then)
  const cases = [["A", "bat", "A"], ["A", "bowl", "B"], ["B", "bat", "B"], ["B", "bowl", "A"]];
  for (const [winner, choice, bats] of cases) {
    for (const adminFirst of ["A", "B"]) {
      s = run([toss(winner, choice), ball(4)], { firstBatting: adminFirst });
      assert.strictEqual(s.innings[0].battingTeam, bats, winner + " won, chose to " + choice + ": " + bats + " bats first");
      assert.strictEqual(s.innings[1].battingTeam, bats === "A" ? "B" : "A");
      assert.deepStrictEqual(s.toss, { winner, choice });
      assert.strictEqual(s.needsToss, false);
    }
  }
  // B won and chose to bowl: A bats first and the result names the right team
  s = run([toss("B", "bowl"), ...balls(12, 1), ...balls(12, 0)]);
  assert.strictEqual(s.resultText, "Team A won by 12 runs");

  // after the toss: balls are allowed, a second toss is not
  s = run([toss("A", "bowl")]);
  assert.strictEqual(s.needsToss, false);
  assert.strictEqual(s.status, "live");
  assert.strictEqual(cricket.validate(ball(1), s), null);
  assert.strictEqual(cricket.validate(toss("B", "bat"), s), "toss already recorded");
  assert.strictEqual(cricket.validate(toss("B", "bat"), run([toss("A", "bowl"), ball(1)])), "toss already recorded");

  // undo takes the toss back: the toss is needed again
  s = run([toss("A", "bat"), { type: "undo" }]);
  assert.strictEqual(s.needsToss, true);
  assert.strictEqual(s.toss, null);
  s = run([toss("A", "bat"), { type: "undo" }, toss("B", "bat"), ball(2)]);
  assert.strictEqual(s.innings[0].battingTeam, "B", "the corrected toss counts");

  // an OLD match (balls but no toss, from before this change) keeps working with the admin setting
  s = run([ball(1), ball(2)], { firstBatting: "B" });
  assert.strictEqual(s.needsToss, false);
  assert.strictEqual(s.innings[0].battingTeam, "B");
  assert.strictEqual(cricket.validate(ball(1), s), null);
  assert.strictEqual(cricket.validate(toss("A", "bat"), s), "toss already recorded", "no toss in the middle of a match");

  // abandoned before the toss: finished, no toss needed any more
  s = run([abandon]);
  assert.strictEqual(s.status, "finished");
  assert.strictEqual(s.needsToss, false);

  // the stored copy is cleaned (extra fields dropped)
  assert.deepStrictEqual(cricket.clean({ type: "toss", data: { winner: "B", choice: "bowl", hack: 1 } }), { winner: "B", choice: "bowl" });
  assert.strictEqual(cricket.clean({ type: "toss", data: { winner: "X" } }), null);

  // headline for the match lists
  const names = { A: "CSE", B: "ECE" };
  assert.strictEqual(cricket.headline(run([]), names), "Waiting for the toss");
  assert.strictEqual(cricket.headline(run([toss("B", "bowl")]), names), "ECE won the toss and chose to bowl");
  assert.strictEqual(cricket.headline(run([toss("B", "bowl"), ball(4)]), names), "CSE 4/0 (0.1 ov)");
}

// ---- random matches: 400 full games, checking the arithmetic independently ----
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(12345);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const kinds = ["bowled", "caught", "lbw", "stumped", "runout", "hitwicket"];
const extras = [null, null, null, null, null, null, "wide", "wide", "noball", "bye", "legbye"];

let finishedGames = 0, validBalls = 0, rejectedBalls = 0;
for (let g = 0; g < 400; g++) {
  const o = { overs: 1 + Math.floor(rand() * 3), players: 2 + Math.floor(rand() * 4), firstBatting: pick(["A", "B"]), freeHit: rand() < 0.5 };
  const maxW = o.players - 1;
  const events = [toss(pick(["A", "B"]), pick(["bat", "bowl"]))];     // every real match starts with the toss
  for (let step = 0; step < 400; step++) {
    const before = run(events, o);
    const r = rand();
    let ev;
    if (r < 0.02) ev = endInn;
    else if (r < 0.025) ev = abandon;
    else {
      const extra = pick(extras);
      const wicket = rand() < 0.15 ? pick(kinds) : null;
      let runs = Math.floor(rand() * 7);
      if (wicket && wicket !== "runout" && rand() < 0.8) runs = 0;
      if ((extra === "bye" || extra === "legbye") && runs === 0 && rand() < 0.8) runs = 1;
      ev = ball(runs, extra, wicket);
    }
    const problem = cricket.validate({ type: ev.type, data: ev.data }, before);
    if (problem) { rejectedBalls++; if (before.status === "finished") break; continue; }
    validBalls++;
    events.push(ev);
    const after = run(events, o);
    assert.deepStrictEqual(after, run(events, o));                 // same events, same answer

    if (ev.type === "ball") {
      const cur = before.inning - 1;
      const b = ev.data;
      const total = b.extra === "wide" || b.extra === "noball" ? 1 + b.runs : b.runs;
      const legal = !(b.extra === "wide" || b.extra === "noball");
      assert.strictEqual(after.innings[cur].runs, before.innings[cur].runs + total);
      assert.strictEqual(after.innings[cur].legalBalls, before.innings[cur].legalBalls + (legal ? 1 : 0));
      assert.strictEqual(after.innings[cur].wickets, before.innings[cur].wickets + (b.wicket ? 1 : 0));
    }
    for (const inn of after.innings) {
      assert.ok(inn.legalBalls <= o.overs * 6, "never more balls than overs allow");
      assert.ok(inn.wickets <= maxW, "never more wickets than players allow");
      assert.strictEqual(inn.extras.total, inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes);
      assert.ok(inn.extras.total <= inn.runs, "extras are part of the runs");
    }
    if (after.inning === 2 && after.status === "live") {
      assert.strictEqual(after.need, after.target - after.innings[1].runs);
      assert.ok(after.need > 0);
      assert.strictEqual(after.ballsLeft, o.overs * 6 - after.innings[1].legalBalls);
    }
    if (after.status === "finished") {
      finishedGames++;
      if (after.winner === "A" || after.winner === "B") {
        assert.ok(after.resultText.startsWith("Team " + after.winner + " won by"));
      }
      assert.strictEqual(cricket.validate({ type: "ball", data: { runs: 1 } }, after), "match already finished");
      break;
    }
  }
}
assert.ok(finishedGames > 300, "most random games reach a result (got " + finishedGames + ")");
assert.ok(validBalls > 5000 && rejectedBalls > 100, "the random test used both valid and invalid actions");



// ======================= Lesson 11: results, headlines, points table =======================
const { buildStandings, competitionOf, POINTS } = require("./standings");
const names = { A: "CSE", B: "ECE" };

// ---- result() and headline() of every sport ----
const ttEngine = getEngine("table_tennis");
let ttState = ttEngine.compute(pts(11, 0), { best_of: 3 });
assert.strictEqual(ttEngine.headline(ttState, names), "CSE 1-0 ECE (0-0 in this game)");
ttState = ttEngine.compute([...pts(11, 0), ...pts(11, 0)], { best_of: 3 });
assert.deepStrictEqual(ttEngine.result(ttState), { finished: true, winner: "A", forA: 2, forB: 0 });
assert.strictEqual(ttEngine.headline(ttState, names), "CSE 2-0 ECE");
assert.strictEqual(ttEngine.result(ttEngine.compute(pts(3, 1), {})).finished, false);

const sEngine = getEngine("simple");
let sState = sEngine.compute([sp("A", 2), sp("B", 3), { type: "finish" }]);
assert.strictEqual(sEngine.headline(sState, names), "CSE 2 - 3 ECE");
assert.deepStrictEqual(sEngine.result(sState), { finished: true, winner: "B", forA: 2, forB: 3 });
assert.strictEqual(sEngine.result(sEngine.compute([sp("A", 2)])).winner, null);
assert.strictEqual(sEngine.result(sEngine.compute([sp("A", 2), sp("B", 2), { type: "finish" }])).winner, "draw");

// cricket: team B bats first here, so results must still be per TEAM, not per innings
const crB = (events) => cricket.compute(effectivePoints(events), { config: { overs: 2, players: 4, firstBatting: "B", freeHit: true } });
let cs = crB([ball(6), ball(4), endInn, ball(6), ball(4), ball(1)]);       // B 10, A chases and reaches 11
assert.deepStrictEqual(cricket.result(cs), { finished: true, winner: "A", noResult: false, forA: 11, forB: 10, ballsA: 3, ballsB: 2 });
assert.strictEqual(cricket.headline(cs, names), "ECE 10/0, CSE 11/0 (0.3 ov)");
cs = crB([ball(6), ball(4), endInn, ball(2)]);
assert.strictEqual(cricket.headline(cs, names), "ECE 10/0, CSE 2/0 (0.1 ov), need 9 from 11 balls");
cs = crB([ball(3)]);
assert.strictEqual(cricket.headline(cs, names), "ECE 3/0 (0.1 ov)");
cs = crB([ball(0, null, "bowled"), ball(0, null, "bowled"), ball(0, null, "bowled"), ball(5), endInn]);   // B all out for 0
let rr = cricket.result(crB([ball(0, null, "bowled"), ball(0, null, "bowled"), ball(0, null, "bowled"), ball(5), ball(1)]));
assert.strictEqual(rr.ballsB, 12);                                           // all out = full 2 overs counted
assert.strictEqual(rr.winner, "A");
rr = cricket.result(crB([ball(2), abandon]));
assert.strictEqual(rr.noResult, true);
assert.strictEqual(rr.winner, null);
rr = cricket.result(crB([ball(4), endInn, ...balls(11, 0), ball(4)]));       // 4 v 4 after the full 2 overs (12 balls): tie
assert.strictEqual(rr.winner, "draw");
assert.strictEqual(rr.noResult, false);

// ---- competition names ----
assert.strictEqual(competitionOf({ competition: "", sport: "cricket" }), "Cricket");
assert.strictEqual(competitionOf({ competition: "  Boys   Cricket ", sport: "cricket" }), "Boys Cricket");
assert.strictEqual(competitionOf({ competition: "", sport: "simple" }), "Other");
assert.deepStrictEqual(POINTS, { win: 2, draw: 1, loss: 0 });

// ---- points table: cricket with net run rate ----
const done = (o) => ({ stage: "group", competition: "Cricket", sport: "cricket", ...o });
const crMatches = [
  done({ teamA: "CSE", teamB: "ECE", result: { finished: true, winner: "A", forA: 150, forB: 140, ballsA: 120, ballsB: 120 } }),
  done({ teamA: "ME", teamB: "CSE", result: { finished: true, winner: "B", forA: 100, forB: 101, ballsA: 120, ballsB: 90 } }),
  done({ teamA: "ECE", teamB: "CE", result: { finished: true, winner: "draw", forA: 120, forB: 120, ballsA: 120, ballsB: 120 } }),
  done({ teamA: "CE", teamB: "ME", result: { finished: true, winner: null, noResult: true, forA: 5, forB: 0, ballsA: 6, ballsB: 0 } }),
  done({ teamA: "CSE", teamB: "CE", result: null }),                                       // not started: ignored
  done({ teamA: "CSE", teamB: "CE", result: { finished: false, winner: null } }),           // live: ignored
  done({ teamA: "CSE", teamB: "ME", stage: "knockout", result: { finished: true, winner: "A", forA: 9, forB: 1, ballsA: 6, ballsB: 6 } }),  // knockout: ignored
  done({ teamA: "", teamB: "", result: { finished: true, winner: "A", forA: 9, forB: 1, ballsA: 6, ballsB: 6 } }),                          // no team names: ignored
  done({ teamA: "CSE", teamB: " cse ", result: { finished: true, winner: "A", forA: 9, forB: 1, ballsA: 6, ballsB: 6 } }),                  // same team twice: ignored
];
let table = buildStandings(crMatches);
assert.strictEqual(table.length, 1);
assert.strictEqual(table[0].name, "Cricket");
assert.strictEqual(table[0].hasNrr, true);
assert.deepStrictEqual(table[0].rows.map((r) => r.team), ["CSE", "CE", "ECE", "ME"]);
assert.deepStrictEqual(table[0].rows.map((r) => r.points), [4, 2, 1, 1]);
const byTeam = Object.fromEntries(table[0].rows.map((r) => [r.team, r]));
assert.deepStrictEqual([byTeam.CSE.played, byTeam.CSE.won, byTeam.CSE.drawn, byTeam.CSE.lost], [2, 2, 0, 0]);
assert.deepStrictEqual([byTeam.CE.played, byTeam.CE.won, byTeam.CE.drawn, byTeam.CE.lost], [2, 0, 2, 0]);
assert.deepStrictEqual([byTeam.ME.played, byTeam.ME.won, byTeam.ME.drawn, byTeam.ME.lost], [2, 0, 1, 1]);
assert.strictEqual(byTeam.CSE.nrr, 1.171);        // 251 in 210 balls minus 240 in 240 balls
assert.strictEqual(byTeam.ECE.nrr, -0.25);
assert.strictEqual(byTeam.ME.nrr, -1.733);        // the abandoned match does not count
assert.strictEqual(byTeam.CE.nrr, 0);
assert.strictEqual(byTeam.CSE.diff, 251 - 240);

// team names are matched without caring about capital letters or extra spaces
table = buildStandings([
  { stage: "group", competition: "", sport: "simple", teamA: "CSE", teamB: "ECE", result: { finished: true, winner: "A", forA: 30, forB: 20 } },
  { stage: "group", competition: "", sport: "simple", teamA: " cse", teamB: "ME", result: { finished: true, winner: "draw", forA: 25, forB: 25 } },
  { stage: "group", competition: "", sport: "simple", teamA: "ECE", teamB: "ME", result: { finished: true, winner: "B", forA: 10, forB: 12 } },
]);
assert.strictEqual(table[0].name, "Other");
assert.strictEqual(table[0].hasNrr, false);
assert.strictEqual(table[0].rows[0].nrr, null);
assert.deepStrictEqual(table[0].rows.map((r) => [r.team, r.points, r.diff]), [["CSE", 3, 10], ["ME", 3, 2], ["ECE", 0, -12]]);

// equal points and wins: the score difference decides, then the name
table = buildStandings([
  { stage: "group", competition: "TT", sport: "table_tennis", teamA: "B", teamB: "A", result: { finished: true, winner: "draw", forA: 1, forB: 1 } },
  { stage: "group", competition: "TT", sport: "table_tennis", teamA: "C", teamB: "D", result: { finished: true, winner: "draw", forA: 2, forB: 0 } },
]);
assert.deepStrictEqual(table[0].rows.map((r) => r.team), ["C", "A", "B", "D"]);

// several competitions come out in name order; nothing finished gives an empty list
table = buildStandings([
  { stage: "group", competition: "Zed", sport: "simple", teamA: "X", teamB: "Y", result: { finished: true, winner: "A", forA: 1, forB: 0 } },
  { stage: "group", competition: "Alpha", sport: "simple", teamA: "X", teamB: "Y", result: { finished: true, winner: "A", forA: 1, forB: 0 } },
]);
assert.deepStrictEqual(table.map((t) => t.name), ["Alpha", "Zed"]);
assert.deepStrictEqual(buildStandings([]), []);

// categories: the same teams in Boys and Girls give two separate tables
assert.strictEqual(competitionOf({ competition: "", sport: "cricket", category: "boys" }), "Cricket (Boys)");
assert.strictEqual(competitionOf({ competition: "", sport: "simple", category: "mix" }), "Other (Mix)");
assert.strictEqual(competitionOf({ competition: "Chess", sport: "simple", category: "female_faculty" }), "Chess (Female Faculty)");
assert.strictEqual(competitionOf({ competition: "Cricket (boys)", sport: "cricket", category: "boys" }), "Cricket (boys)", "not added twice");
assert.strictEqual(competitionOf({ competition: "Cricket", sport: "cricket", category: "" }), "Cricket", "no category: same as before");
assert.strictEqual(competitionOf({ competition: "Cricket", sport: "cricket", category: "nonsense" }), "Cricket");
table = buildStandings([
  done({ category: "boys", teamA: "CSE", teamB: "ME", result: { finished: true, winner: "A", forA: 50, forB: 40, ballsA: 72, ballsB: 72 } }),
  done({ category: "girls", teamA: "CSE", teamB: "ME", result: { finished: true, winner: "B", forA: 30, forB: 31, ballsA: 60, ballsB: 50 } }),
]);
assert.deepStrictEqual(table.map((t) => t.name), ["Cricket (Boys)", "Cricket (Girls)"]);
assert.strictEqual(table[0].rows[0].team, "CSE", "boys: CSE won");
assert.strictEqual(table[1].rows[0].team, "ME", "girls: ME won");
assert.strictEqual(table[0].rows[0].played, 1, "the girls match is not counted for the boys");
// Semi Final and Final do not count in the points table (only Group does)
for (const stage of ["quarter_final", "semi_final", "final"]) {
  assert.deepStrictEqual(buildStandings([done({ stage, category: "boys", teamA: "A", teamB: "B",
    result: { finished: true, winner: "A", forA: 1, forB: 0, ballsA: 6, ballsB: 6 } })]), [], stage + " is not counted");
}
assert.deepStrictEqual(buildStandings([{ stage: "group", competition: "X", sport: "simple", teamA: "A", teamB: "B", result: null }]), []);


// ======================= Lesson 12: failed-login limiter =======================
const { FailureLimiter } = require("./rateLimit");
{
  const MIN = 60 * 1000;
  const lim = new FailureLimiter({ windowMs: 10 * MIN, max: 3, autoPrune: false });
  const t0 = 1_000_000;
  assert.strictEqual(lim.blockedFor("a", t0), 0);                        // nobody is blocked at the start
  lim.fail("a", t0); lim.fail("a", t0 + 1000);
  assert.strictEqual(lim.blockedFor("a", t0 + 2000), 0);                 // 2 failures: still allowed
  lim.fail("a", t0 + 2000);
  assert.strictEqual(lim.blockedFor("a", t0 + 3000), 10 * MIN - 3000);   // 3 failures: blocked until the first one is 10 minutes old
  assert.strictEqual(lim.blockedFor("b", t0 + 3000), 0);                 // other keys are not affected
  assert.strictEqual(lim.blockedFor("a", t0 + 10 * MIN - 1), 1);
  assert.strictEqual(lim.blockedFor("a", t0 + 10 * MIN), 0);             // the first failure aged out: allowed again
  lim.fail("a", t0 + 10 * MIN + 5);                                      // the window slides: 3 failures are 2 recent + 1 new
  assert.ok(lim.blockedFor("a", t0 + 10 * MIN + 6) > 0);
  lim.reset("a");
  assert.strictEqual(lim.blockedFor("a", t0 + 10 * MIN + 7), 0);         // a good login clears the count
  for (let i = 0; i < 50; i++) lim.fail("many", t0 + i);                 // far more failures than the limit
  assert.ok(lim.map.get("many").length <= 3, "only the last few times are kept");
  assert.strictEqual(lim.blockedFor("many", t0 + 100), 10 * MIN - 53);   // blocked until the 3rd-last failure (at t0+47) is 10 minutes old
  lim.prune(t0 + 30 * MIN);
  assert.strictEqual(lim.map.size, 0, "old entries are removed");
  const small = new FailureLimiter({ windowMs: MIN, max: 1, maxKeys: 5, autoPrune: false });
  for (let i = 0; i < 20; i++) small.fail("k" + i, t0);
  assert.ok(small.map.size <= 5, "the number of remembered keys is capped");
}

// ======================= Volleyball (best of 3 / 5, rally scoring) =======================
{
  const vb = getEngine("volleyball");
  assert.ok(vb, "the registry returns the volleyball engine");
  assert.strictEqual(getEngine("nope"), null);

  const P = (t) => ({ type: "point", team: t, value: 1 });
  const undo = { type: "undo" };
  const fin = (w) => ({ type: "finish", data: { winner: w } });
  // one set that ends a:b. The points alternate first, so the set does not end too early.
  const setEv = (a, b) => {
    const ev = [], m = Math.min(a, b);
    for (let i = 0; i < m; i++) ev.push(P("A"), P("B"));
    for (let i = 0; i < a - m; i++) ev.push(P("A"));
    for (let i = 0; i < b - m; i++) ev.push(P("B"));
    return ev;
  };
  const run = (events, config) => vb.compute(effectivePoints(events), { config });

  // ---- a normal set: to 25, win by 2, no cap ----
  let v = run(setEv(25, 23));
  assert.deepStrictEqual([v.setsA, v.setsB, v.pointsA, v.pointsB, v.currentSet], [1, 0, 0, 0, 2]);
  assert.deepStrictEqual(v.finishedSets, [[25, 23]]);
  assert.strictEqual(v.status, "live");
  assert.strictEqual(v.target, 25);
  assert.strictEqual(v.isDeciding, false);
  v = run(setEv(25, 24));
  assert.deepStrictEqual([v.setsA, v.setsB, v.pointsA, v.pointsB], [0, 0, 25, 24], "25-24 does not end a set");
  v = run(setEv(26, 24));
  assert.deepStrictEqual([v.setsA, v.setsB], [1, 0], "26-24 ends a set");
  v = run(setEv(30, 28));
  assert.deepStrictEqual([v.setsA, v.setsB], [1, 0], "no cap: 30-28 ends a set");
  v = run(setEv(23, 25));
  assert.deepStrictEqual([v.setsA, v.setsB], [0, 1], "team B can win a set");

  // ---- deciding set: to 15, win by 2 ----
  const oneAll = [...setEv(25, 20), ...setEv(20, 25)];
  v = run(oneAll);
  assert.deepStrictEqual([v.setsA, v.setsB, v.currentSet, v.isDeciding, v.target], [1, 1, 3, true, 15]);
  v = run([...oneAll, ...setEv(15, 13)]);
  assert.strictEqual(v.status, "finished");
  assert.strictEqual(v.winner, "A");
  assert.deepStrictEqual(v.finishedSets, [[25, 20], [20, 25], [15, 13]]);
  v = run([...oneAll, ...setEv(15, 14)]);
  assert.deepStrictEqual([v.status, v.pointsA, v.pointsB], ["live", 15, 14], "15-14 does not end the deciding set");
  v = run([...oneAll, ...setEv(16, 14)]);
  assert.strictEqual(v.winner, "A");
  v = run([...oneAll, ...setEv(13, 15)]);
  assert.strictEqual(v.winner, "B");
  v = run([...oneAll, ...setEv(14, 15)]);
  assert.strictEqual(v.status, "live");
  v = run([...setEv(25, 20)]);
  assert.strictEqual(v.isDeciding, false);
  assert.strictEqual(v.target, 25, "after 1-0 the next set is still to 25");

  // ---- whole matches: best of 3 ----
  v = run([...setEv(25, 10), ...setEv(25, 12)]);
  assert.deepStrictEqual([v.status, v.winner, v.setsA, v.setsB, v.ended], ["finished", "A", 2, 0, "normal"]);
  assert.strictEqual(v.resultText, "Team A won 2-0");
  v = run([...setEv(25, 10), ...setEv(20, 25), ...setEv(10, 15)]);
  assert.deepStrictEqual([v.status, v.winner, v.setsA, v.setsB], ["finished", "B", 1, 2]);
  assert.strictEqual(v.resultText, "Team B won 2-1");

  // ---- best of 5 ----
  const bo5 = { bestOf: 5 };
  v = run([...setEv(25, 1), ...setEv(25, 1), ...setEv(25, 1)], bo5);
  assert.deepStrictEqual([v.status, v.winner, v.setsA, v.setsB, v.setsToWin], ["finished", "A", 3, 0, 3]);
  v = run([...setEv(25, 1), ...setEv(25, 1)], bo5);
  assert.strictEqual(v.status, "live", "2-0 is not enough in best of 5");
  const twoAll = [...setEv(25, 20), ...setEv(25, 20), ...setEv(20, 25), ...setEv(20, 25)];
  v = run(twoAll, bo5);
  assert.deepStrictEqual([v.setsA, v.setsB, v.isDeciding, v.target, v.currentSet], [2, 2, true, 15, 5]);
  v = run([...twoAll, ...setEv(15, 10)], bo5);
  assert.deepStrictEqual([v.status, v.winner, v.setsA, v.setsB], ["finished", "A", 3, 2]);
  v = run([...setEv(25, 20), ...setEv(25, 20), ...setEv(20, 25)], bo5);
  assert.deepStrictEqual([v.isDeciding, v.target], [false, 25], "2-1 in best of 5 is not a deciding set");

  // ---- nothing counts after the match is over ----
  const done = [...setEv(25, 10), ...setEv(25, 12)];
  assert.deepStrictEqual(run([...done, P("B"), P("B"), P("A")]), run(done), "extra events are ignored");
  assert.strictEqual(vb.validate(P("A"), run(done)), "match already finished");
  assert.strictEqual(vb.validate(fin("A"), run(done)), "match already finished");

  // ---- undo ----
  v = run([P("A"), P("A"), P("B"), undo]);
  assert.deepStrictEqual([v.pointsA, v.pointsB], [2, 0], "undo in the middle of a set");
  v = run([...setEv(25, 23), undo]);
  assert.deepStrictEqual([v.setsA, v.pointsA, v.pointsB, v.finishedSets.length], [0, 24, 23, 0], "undo of the set-winning point reopens the set");
  v = run([...setEv(25, 20), ...setEv(25, 20), undo]);
  assert.deepStrictEqual([v.status, v.winner, v.setsA, v.pointsA, v.pointsB], ["live", null, 1, 24, 20], "undo of the match-winning point reopens the match");
  v = run([...done, fin("B"), undo]);
  assert.strictEqual(v.status, "finished", "undo of a finish goes back to the earlier finished state");
  v = run([...setEv(25, 20), fin("B"), undo]);
  assert.deepStrictEqual([v.status, v.winner, v.setsA], ["live", null, 1], "undo of a walkover reopens the match");
  v = run([P("A"), undo, undo]);
  assert.deepStrictEqual([v.pointsA, v.status], [0, "live"], "extra undo does not break compute");

  // ---- walkover (scorer finishes early and picks the winner) ----
  v = run([...setEv(25, 20), P("B"), fin("B")]);
  assert.deepStrictEqual([v.status, v.winner, v.ended, v.setsA, v.setsB, v.pointsB], ["finished", "B", "walkover", 1, 0, 1]);
  assert.strictEqual(v.resultText, "Team B won (walkover)");
  assert.strictEqual(run([fin("A"), P("B")]).winner, "A", "no scoring after a walkover");

  // ---- checking an action ----
  const live = run([P("A")]);
  assert.strictEqual(vb.validate(P("A"), live), null);
  assert.strictEqual(vb.validate({ type: "point", team: "B" }, live), null, "value may be missing");
  assert.strictEqual(vb.validate({ type: "point", team: "B", value: null }, live), null);
  assert.strictEqual(vb.validate({ type: "point", team: "B", value: 2 }, live), "bad value");
  assert.strictEqual(vb.validate({ type: "point", team: "B", value: 0 }, live), "bad value");
  assert.strictEqual(vb.validate({ type: "point", team: "C", value: 1 }, live), "bad team");
  assert.strictEqual(vb.validate({ type: "point", value: 1 }, live), "bad team");
  assert.strictEqual(vb.validate({ type: "ball", data: {} }, live), "unknown action");
  assert.strictEqual(vb.validate({ type: "end_innings" }, live), "unknown action");
  assert.strictEqual(vb.validate({ type: "finish" }, live), "choose the winner");
  assert.strictEqual(vb.validate({ type: "finish", data: {} }, live), "choose the winner");
  assert.strictEqual(vb.validate({ type: "finish", data: { winner: "C" } }, live), "choose the winner");
  assert.strictEqual(vb.validate({ type: "finish", data: { winner: "draw" } }, live), "choose the winner");
  assert.strictEqual(vb.validate({ type: "finish", data: [] }, live), "choose the winner");
  assert.strictEqual(vb.validate(fin("A"), live), null);
  assert.strictEqual(vb.validate(fin("B"), live), null);

  // ---- the cleaned copy that is stored ----
  assert.deepStrictEqual(vb.clean({ type: "finish", data: { winner: "A", junk: "x".repeat(100) } }), { winner: "A" });
  assert.strictEqual(vb.clean({ type: "finish", data: { winner: "Z" } }), null);
  assert.strictEqual(vb.clean({ type: "finish" }), null);
  assert.strictEqual(vb.clean({ type: "point", team: "A", value: 1, data: { winner: "A" } }), null);

  // ---- match settings ----
  const def = { bestOf: 3, setPoints: 25, decidingPoints: 15, winBy: 2 };
  assert.deepStrictEqual(vb.normalizeConfig(undefined), def);
  assert.deepStrictEqual(vb.normalizeConfig(null), def);
  assert.deepStrictEqual(vb.normalizeConfig({}), def);
  assert.deepStrictEqual(vb.normalizeConfig({ bestOf: 5 }), { ...def, bestOf: 5 });
  assert.deepStrictEqual(vb.normalizeConfig({ bestOf: 5, hack: 1 }), { ...def, bestOf: 5 }, "unknown keys are dropped");
  assert.deepStrictEqual(vb.normalizeConfig({ bestOf: 4 }), def, "invalid settings fall back to the defaults");
  assert.deepStrictEqual(vb.normalizeConfig([1, 2]), def);
  assert.deepStrictEqual(vb.normalizeConfig("x"), def);
  assert.strictEqual(vb.checkConfig(def), null);
  assert.strictEqual(vb.checkConfig({ ...def, bestOf: 5 }), null);
  assert.strictEqual(vb.checkConfig({ ...def, setPoints: 21, decidingPoints: 15 }), null);
  assert.strictEqual(vb.checkConfig({ ...def, winBy: 1 }), null);
  const badCfg = [null, undefined, [], "x", 5, { ...def, bestOf: 1 }, { ...def, bestOf: 2 }, { ...def, bestOf: 4 }, { ...def, bestOf: 7 },
    { ...def, bestOf: "3" }, { ...def, bestOf: 3.5 }, { ...def, bestOf: null }, { ...def, setPoints: 4 }, { ...def, setPoints: 51 },
    { ...def, setPoints: "25" }, { ...def, setPoints: 25.5 }, { ...def, decidingPoints: 4 }, { ...def, decidingPoints: 26 },
    { ...def, setPoints: 21, decidingPoints: 25 }, { ...def, winBy: 0 }, { ...def, winBy: 3 }, { ...def, winBy: "2" }];
  for (const c of badCfg) assert.strictEqual(typeof vb.checkConfig(c), "string", "rejected: " + JSON.stringify(c));
  // settings really change the rules
  v = run([...setEv(21, 19)], { bestOf: 3, setPoints: 21, decidingPoints: 15, winBy: 2 });
  assert.strictEqual(v.setsA, 1);
  v = run([...setEv(25, 24)], { bestOf: 3, setPoints: 25, decidingPoints: 15, winBy: 1 });
  assert.strictEqual(v.setsA, 1, "win by 1");

  // ---- result() and headline() ----
  const nm = { A: "CSE", B: "ECE" };
  let st = run([...setEv(25, 20), P("A"), P("B"), P("A")]);
  assert.deepStrictEqual(vb.result(st), { finished: false, winner: null, forA: 1, forB: 0 });
  assert.strictEqual(vb.headline(st, nm), "CSE 1-0 ECE (set 2: 2-1)");
  st = run([...oneAll, P("A")]);
  assert.strictEqual(vb.headline(st, nm), "CSE 1-1 ECE (deciding set: 1-0)");
  st = run([...setEv(25, 20), ...setEv(20, 25), ...setEv(15, 9)]);
  assert.deepStrictEqual(vb.result(st), { finished: true, winner: "A", forA: 2, forB: 1 });
  assert.strictEqual(vb.headline(st, nm), "CSE 2-1 ECE");
  st = run([...setEv(25, 20), fin("B")]);
  assert.deepStrictEqual(vb.result(st), { finished: true, winner: "B", forA: 1, forB: 0 }, "a walkover keeps the sets as recorded");
  assert.strictEqual(vb.headline(st, nm), "ECE won (walkover), sets 1-0");
  st = run([]);
  assert.deepStrictEqual(vb.result(st), { finished: false, winner: null, forA: 0, forB: 0 });
  assert.strictEqual(vb.headline(st, nm), "CSE 0-0 ECE (set 1: 0-0)");

  // ---- points table: forA / forB are sets ----
  const vbDone = (a, b, evs) => ({ stage: "group", competition: "", sport: "volleyball", teamA: a, teamB: b, result: vb.result(run(evs)) });
  const vbTable = buildStandings([
    vbDone("CSE", "ECE", [...setEv(25, 10), ...setEv(25, 12)]),                       // CSE 2-0
    vbDone("ECE", "ME", [...setEv(25, 10), ...setEv(20, 25), ...setEv(15, 5)]),       // ECE 2-1
    { stage: "group", competition: "", sport: "volleyball", teamA: "ME", teamB: "CSE", result: vb.result(run(setEv(25, 20))) }, // not finished: ignored
  ]);
  assert.strictEqual(vbTable.length, 1);
  assert.strictEqual(vbTable[0].name, "Volleyball");
  const vbRows = Object.fromEntries(vbTable[0].rows.map((r) => [r.team, r]));
  assert.deepStrictEqual([vbRows.CSE.points, vbRows.CSE.won, vbRows.CSE.diff], [2, 1, 2]);
  assert.deepStrictEqual([vbRows.ECE.points, vbRows.ECE.won, vbRows.ECE.lost, vbRows.ECE.diff], [2, 1, 1, -1]);
  assert.deepStrictEqual([vbRows.ME.points, vbRows.ME.lost, vbRows.ME.diff], [0, 1, -1]);
  assert.strictEqual(vbTable[0].hasNrr, false);

  // ---- random matches: 400 games, invariants checked after EVERY event ----
  const vr = rng(2026);
  let vbFinished = 0, vbUndos = 0;
  for (let g = 0; g < 400; g++) {
    const bestOf = vr() < 0.5 ? 3 : 5;
    const toWin = (bestOf + 1) / 2;
    const cfg = { bestOf };
    const events = [];
    const kept = [];                                          // my own copy of the events that still count
    let state = run(events, cfg);
    for (let step = 0; step < 3000 && state.status !== "finished"; step++) {
      if (kept.length > 0 && vr() < 0.08) {
        events.push(undo); kept.pop(); vbUndos++;
      } else {
        const e = P(vr() < 0.5 ? "A" : "B");
        assert.strictEqual(vb.validate(e, state), null);
        events.push(e); kept.push(e);
      }
      state = run(events, cfg);
      assert.deepStrictEqual(state, vb.compute(kept, { config: cfg }), "undo equals a fresh replay");
      assert.ok(state.pointsA >= 0 && state.pointsB >= 0);
      assert.strictEqual(state.finishedSets.length, state.setsA + state.setsB);
      assert.ok(state.finishedSets.length <= 2 * toWin - 1);
      let wa = 0, wb = 0;
      for (const [a, b] of state.finishedSets) {
        assert.ok(Math.abs(a - b) >= 2 && Math.max(a, b) >= 15, "a finished set has a 2 point lead and 15+ points");
        if (a > b) wa++; else wb++;
      }
      assert.deepStrictEqual([wa, wb], [state.setsA, state.setsB]);
      assert.ok(state.setsA <= toWin && state.setsB <= toWin && !(state.setsA === toWin && state.setsB === toWin));
      assert.strictEqual(state.status === "finished", state.setsA === toWin || state.setsB === toWin);
      assert.strictEqual(state.winner, state.setsA === toWin ? "A" : state.setsB === toWin ? "B" : null);
      if (state.status === "live") {
        const lead = Math.abs(state.pointsA - state.pointsB);
        assert.ok(!(Math.max(state.pointsA, state.pointsB) >= state.target && lead >= 2), "a live set is never already won");
        assert.strictEqual(state.isDeciding, state.setsA === toWin - 1 && state.setsB === toWin - 1);
        assert.strictEqual(state.target, state.isDeciding ? 15 : 25);
        assert.strictEqual(state.currentSet, state.setsA + state.setsB + 1);
      }
    }
    if (state.status === "finished") {
      vbFinished++;
      assert.strictEqual(vb.validate(P("A"), state), "match already finished");
      assert.deepStrictEqual(run([...events, P("A"), P("B")], cfg), state, "nothing counts after the match");
    }
  }
  assert.ok(vbFinished >= 390, "almost all random matches finish (" + vbFinished + ")");
  assert.ok(vbUndos > 500, "the random test really used undo");
}

// ======================= Basketball (FIBA: 4 quarters, overtime until someone wins) =======================
{
  const bb = getEngine("basketball");
  assert.ok(bb, "the registry returns the basketball engine");

  const P = (t, v) => ({ type: "point", team: t, value: v });
  const END = { type: "end_period" };
  const undo = { type: "undo" };
  const fin = (w) => ({ type: "finish", data: { winner: w } });
  const run = (events, config) => bb.compute(effectivePoints(events), { config });
  const quarters = (n) => Array(n).fill(END);

  // ---- a fresh match ----
  let b = run([]);
  assert.deepStrictEqual([b.scoreA, b.scoreB, b.period, b.isOvertime, b.periodName, b.status, b.winner],
    [0, 0, 1, false, "Quarter 1", "live", null]);
  assert.deepStrictEqual([b.currentA, b.currentB, b.periods], [0, 0, []]);
  assert.deepStrictEqual([b.quarterMinutes, b.overtimeMinutes, b.periodMinutes], [10, 5, 10]);

  // ---- 1, 2 and 3 points ----
  b = run([P("A", 2), P("A", 3), P("B", 1), P("B", 2)]);
  assert.deepStrictEqual([b.scoreA, b.scoreB, b.currentA, b.currentB], [5, 3, 5, 3]);

  // ---- quarters: the scorer ends each one; points per quarter are kept ----
  b = run([P("A", 2), END, P("B", 3), P("B", 2)]);
  assert.deepStrictEqual([b.period, b.periodName, b.scoreA, b.scoreB, b.currentA, b.currentB], [2, "Quarter 2", 2, 5, 0, 5]);
  assert.deepStrictEqual(b.periods, [[2, 0]]);
  b = run(quarters(3));
  assert.deepStrictEqual([b.period, b.status], [4, "live"], "an empty quarter (0-0) can be ended");

  // ---- end of quarter 4: someone is ahead, the match is over ----
  b = run([P("A", 2), ...quarters(3), P("B", 3), END]);
  assert.deepStrictEqual([b.status, b.winner, b.ended, b.scoreA, b.scoreB], ["finished", "B", "normal", 2, 3]);
  assert.deepStrictEqual(b.periods, [[2, 0], [0, 0], [0, 0], [0, 3]]);
  assert.strictEqual(b.resultText, "Team B won 3-2");
  b = run([P("A", 3), ...quarters(4)]);
  assert.strictEqual(b.resultText, "Team A won 3-0", "the winner's score comes first");

  // ---- end of quarter 4 level: overtime (5 min), again and again until someone wins ----
  const level = [P("A", 2), P("B", 2), ...quarters(4)];
  b = run(level);
  assert.deepStrictEqual([b.status, b.period, b.isOvertime, b.periodName, b.periodMinutes], ["live", 5, true, "Overtime 1", 5]);
  b = run([...level, P("A", 1), P("B", 1), END]);
  assert.deepStrictEqual([b.status, b.period, b.periodName], ["live", 6, "Overtime 2"], "still level after overtime 1");
  b = run([...level, P("A", 1), P("B", 1), END, P("B", 2), END]);
  assert.deepStrictEqual([b.status, b.winner, b.scoreA, b.scoreB, b.periods.length], ["finished", "B", 3, 5, 6]);
  assert.strictEqual(b.resultText, "Team B won 5-3 (after overtime)");

  // ---- nothing counts after the match is over ----
  const done = [P("A", 2), ...quarters(4)];
  assert.deepStrictEqual(run([...done, P("B", 3), END, END]), run(done), "extra events are ignored");
  assert.strictEqual(bb.validate(P("A", 2), run(done)), "match already finished");
  assert.strictEqual(bb.validate(END, run(done)), "match already finished");
  assert.strictEqual(bb.validate(fin("A"), run(done)), "match already finished");

  // ---- undo ----
  b = run([P("A", 3), P("B", 2), undo]);
  assert.deepStrictEqual([b.scoreA, b.scoreB], [3, 0], "undo takes back the last basket");
  b = run([P("A", 3), END, undo]);
  assert.deepStrictEqual([b.period, b.currentA, b.periods], [1, 3, []], "undo of End quarter reopens the quarter");
  b = run([...done, undo]);
  assert.deepStrictEqual([b.status, b.winner, b.period], ["live", null, 4], "undo of the last End quarter reopens the match");
  b = run([P("A", 2), fin("B"), undo]);
  assert.deepStrictEqual([b.status, b.winner], ["live", null], "undo of a walkover reopens the match");
  b = run([P("A", 2), undo, undo]);
  assert.deepStrictEqual([b.scoreA, b.status], [0, "live"], "extra undo does not break compute");

  // ---- walkover (scorer finishes early and picks the winner; the points stay as recorded) ----
  b = run([P("A", 2), END, P("B", 1), fin("B")]);
  assert.deepStrictEqual([b.status, b.winner, b.ended, b.scoreA, b.scoreB], ["finished", "B", "walkover", 2, 1]);
  assert.strictEqual(b.resultText, "Team B won (walkover)");
  assert.strictEqual(run([fin("A"), P("B", 3)]).scoreB, 0, "no scoring after a walkover");

  // ---- checking an action ----
  const live = run([P("A", 2)]);
  for (const v of [1, 2, 3]) {
    assert.strictEqual(bb.validate(P("A", v), live), null);
    assert.strictEqual(bb.validate(P("B", v), live), null);
  }
  for (const v of [0, 4, -4, 2.5, -1.5, "2", "-1", null, undefined, true]) {
    assert.strictEqual(bb.validate(P("A", v), live), "points must be 1, 2 or 3 (or -1, -2, -3 to correct a mistake)", "rejected value " + String(v));
  }
  assert.strictEqual(bb.validate(P("C", 2), live), "bad team");

  // ---- corrections: -1 / -2 / -3 take points away (in the current quarter); never below 0 for the match ----
  assert.strictEqual(bb.validate(P("A", -1), live), null);
  assert.strictEqual(bb.validate(P("A", -2), live), null);
  assert.strictEqual(bb.validate(P("A", -3), live), "cannot take away 3 points: Team A has only 2");
  assert.strictEqual(bb.validate(P("B", -1), live), "cannot take away 1 point: Team B has only 0");
  b = run([P("A", 3), P("B", 2), P("A", -1)]);
  assert.deepStrictEqual([b.scoreA, b.scoreB, b.currentA], [2, 2, 2], "a 3 that should have been a 2");
  b = run([P("A", 2), END, P("B", 1), P("A", -2), P("B", 2)]);
  assert.deepStrictEqual([b.scoreA, b.scoreB, b.currentA, b.currentB, b.periods], [0, 3, -2, 3, [[2, 0]]],
    "a basket given to the wrong team in quarter 1, fixed in quarter 2: totals right, quarter 2 shows -2 for A");
  b = run([P("A", 2), P("A", -2), undo]);
  assert.strictEqual(b.scoreA, 2, "undo of a correction gives the points back");
  // a correction can change who wins at the end of quarter 4
  b = run([P("A", 3), P("B", 2), END, END, END, P("A", -1), END]);
  assert.deepStrictEqual([b.status, b.period, b.isOvertime], ["live", 5, true], "corrected to 2-2: overtime");
  assert.strictEqual(bb.validate(P("A", -1), run(done)), "match already finished");
  // the stored copy of a bad correction is never applied (the server never stores one; compute ignores it anyway)
  assert.strictEqual(run([P("A", 1), P("A", -3)]).scoreA, 1, "a correction below 0 is ignored by compute");

  // ---- END QUARTER says which quarter it ends: a second press for the same quarter is refused ----
  const ENDQ = (n) => ({ type: "end_period", data: { period: n } });
  assert.strictEqual(bb.validate(ENDQ(1), run([])), null);
  assert.strictEqual(bb.validate(ENDQ(1), run([ENDQ(1)])), "Quarter 1 has already ended");
  assert.strictEqual(bb.validate(ENDQ(2), run([ENDQ(1)])), null);
  assert.strictEqual(bb.validate(ENDQ(4), run(level)), "Quarter 4 has already ended", "level after quarter 4: overtime now");
  assert.strictEqual(bb.validate(ENDQ(5), run(level)), null, "overtime 1 is period 5");
  assert.strictEqual(bb.validate(ENDQ(5), run([...level, END])), "Overtime 1 has already ended");
  assert.strictEqual(bb.validate(ENDQ(3), run([ENDQ(1)])), "Quarter 3 has not started yet");
  for (const bad of [0, -1, 1.5, "1", null, true]) {
    assert.strictEqual(bb.validate({ type: "end_period", data: { period: bad } }, live), "bad quarter number", "rejected period " + String(bad));
  }
  assert.strictEqual(bb.validate({ type: "end_period", data: [] }, live), null, "no quarter number (an old open page): still allowed");
  assert.strictEqual(bb.validate({ type: "end_period", data: {} }, live), null);
  b = run([ENDQ(1), ENDQ(2)]);
  assert.strictEqual(b.period, 3, "the quarter number is only checked, compute ends the period as before");
  assert.strictEqual(bb.validate({ type: "point", value: 2 }, live), "bad team");
  assert.strictEqual(bb.validate(END, live), null);
  assert.strictEqual(bb.validate(END, run([])), null, "a quarter can end 0-0");
  assert.strictEqual(bb.validate({ type: "ball", data: {} }, live), "unknown action");
  assert.strictEqual(bb.validate({ type: "end_innings" }, live), "unknown action");
  assert.strictEqual(bb.validate({ type: "toss", data: { winner: "A", choice: "bat" } }, live), "unknown action");
  assert.strictEqual(bb.validate({ type: "finish" }, live), "choose the winner");
  assert.strictEqual(bb.validate({ type: "finish", data: { winner: "draw" } }, live), "choose the winner");
  assert.strictEqual(bb.validate({ type: "finish", data: [] }, live), "choose the winner");
  assert.strictEqual(bb.validate(fin("A"), live), null);

  // ---- the cleaned copy that is stored ----
  assert.deepStrictEqual(bb.clean({ type: "finish", data: { winner: "B", junk: "x".repeat(100) } }), { winner: "B" });
  assert.strictEqual(bb.clean({ type: "finish", data: { winner: "Z" } }), null);
  assert.strictEqual(bb.clean({ type: "end_period", data: { winner: "A" } }), null, "end_period stores only a quarter number");
  assert.deepStrictEqual(bb.clean({ type: "end_period", data: { period: 2, junk: "x" } }), { period: 2 });
  assert.strictEqual(bb.clean({ type: "end_period", data: { period: "2" } }), null);
  assert.strictEqual(bb.clean({ type: "end_period" }), null);
  assert.strictEqual(bb.clean({ type: "point", team: "A", value: 2, data: { x: 1 } }), null);

  // ---- match settings (minutes are shown only; there is no clock) ----
  const def = { quarterMinutes: 10, overtimeMinutes: 5 };
  assert.deepStrictEqual(bb.normalizeConfig(undefined), def);
  assert.deepStrictEqual(bb.normalizeConfig({}), def);
  assert.deepStrictEqual(bb.normalizeConfig({ quarterMinutes: 7 }), { ...def, quarterMinutes: 7 });
  assert.deepStrictEqual(bb.normalizeConfig({ quarterMinutes: 7, hack: 1 }), { ...def, quarterMinutes: 7 }, "unknown keys are dropped");
  assert.deepStrictEqual(bb.normalizeConfig({ quarterMinutes: 0 }), def, "invalid settings fall back to the defaults");
  assert.deepStrictEqual(bb.normalizeConfig([1]), def);
  assert.strictEqual(bb.checkConfig(def), null);
  assert.strictEqual(bb.checkConfig({ quarterMinutes: 7, overtimeMinutes: 5 }), null);
  const badCfg = [null, [], "x", { ...def, quarterMinutes: 0 }, { ...def, quarterMinutes: 21 }, { ...def, quarterMinutes: "7" },
    { ...def, quarterMinutes: 7.5 }, { ...def, overtimeMinutes: 0 }, { ...def, overtimeMinutes: 11 }, { ...def, overtimeMinutes: null }];
  for (const c of badCfg) assert.strictEqual(typeof bb.checkConfig(c), "string", "rejected: " + JSON.stringify(c));
  b = run([], { quarterMinutes: 7, overtimeMinutes: 5 });
  assert.deepStrictEqual([b.quarterMinutes, b.periodMinutes], [7, 7]);

  // ---- college rule: 7 min quarters up to the quarter final, 10 min in the semi final and final ----
  assert.strictEqual(bb.collegeQuarterMinutes("group"), 7);
  assert.strictEqual(bb.collegeQuarterMinutes("quarter_final"), 7);
  assert.strictEqual(bb.collegeQuarterMinutes("knockout"), 7, "old 'knockout' matches are before the semi final");
  assert.strictEqual(bb.collegeQuarterMinutes("semi_final"), 10);
  assert.strictEqual(bb.collegeQuarterMinutes("final"), 10);
  assert.strictEqual(bb.collegeQuarterMinutes("toString"), 7, "not fooled by object built-ins");
  assert.strictEqual(bb.collegeQuarterMinutes(undefined), 7);

  // ---- result() and headline() ----
  const nm = { A: "CSE", B: "ECE" };
  let st = run([P("A", 2), END, P("B", 3)]);
  assert.deepStrictEqual(bb.result(st), { finished: false, winner: null, forA: 2, forB: 3 });
  assert.strictEqual(bb.headline(st, nm), "CSE 2-3 ECE (Q2)");
  st = run([...level, P("A", 1)]);
  assert.strictEqual(bb.headline(st, nm), "CSE 3-2 ECE (OT1)");
  st = run(done);
  assert.deepStrictEqual(bb.result(st), { finished: true, winner: "A", forA: 2, forB: 0 });
  assert.strictEqual(bb.headline(st, nm), "CSE 2-0 ECE");
  st = run([...level, P("B", 2), END]);
  assert.strictEqual(bb.headline(st, nm), "CSE 2-4 ECE (OT)");
  st = run([P("A", 2), fin("B")]);
  assert.deepStrictEqual(bb.result(st), { finished: true, winner: "B", forA: 2, forB: 0 }, "a walkover keeps the points as recorded");
  assert.strictEqual(bb.headline(st, nm), "ECE won (walkover), 2-0");
  assert.strictEqual(bb.headline(run([]), nm), "CSE 0-0 ECE (Q1)");

  // ---- points table: win 2, loss 0; forA / forB are points, so ties are split by point difference ----
  const bbDone = (a, c, evs) => ({ stage: "group", competition: "", sport: "basketball", category: "boys", teamA: a, teamB: c, result: bb.result(run(evs)) });
  const bbTable = buildStandings([
    bbDone("CSE", "ECE", [P("A", 3), P("A", 2), ...quarters(4)]),       // CSE 5-0
    bbDone("ECE", "ME", [P("A", 2), ...quarters(4)]),                    // ECE 2-0
    bbDone("ME", "CSE", [P("B", 2), ...quarters(3)]),                    // not finished: ignored
  ]);
  assert.strictEqual(bbTable.length, 1);
  assert.strictEqual(bbTable[0].name, "Basketball (Boys)");
  const bbRows = Object.fromEntries(bbTable[0].rows.map((r) => [r.team, r]));
  assert.deepStrictEqual([bbRows.CSE.points, bbRows.CSE.won, bbRows.CSE.diff], [2, 1, 5]);
  assert.deepStrictEqual([bbRows.ECE.points, bbRows.ECE.won, bbRows.ECE.lost, bbRows.ECE.diff], [2, 1, 1, -3]);
  assert.deepStrictEqual([bbRows.ME.points, bbRows.ME.lost], [0, 1]);
  assert.strictEqual(bbTable[0].rows[0].team, "CSE", "same points and wins: the better point difference is first");

  // ---- random matches: 400 games, invariants checked after EVERY event ----
  const br = rng(2027);
  let bbFinished = 0, bbUndos = 0, bbOvertimes = 0, bbFixes = 0, bbRefusedEnds = 0;
  for (let g = 0; g < 400; g++) {
    const events = [];
    const kept = [];
    let state = run(events);
    for (let step = 0; step < 3000 && state.status !== "finished"; step++) {
      const x = br();
      let e;
      if (kept.length > 0 && x < 0.08) { events.push(undo); kept.pop(); bbUndos++; }
      else if (x < 0.1) {
        // a second press for a quarter that already ended (the old number) must be refused
        if (state.period > 1) {
          assert.strictEqual(typeof bb.validate(ENDQ(state.period - 1), state), "string");
          bbRefusedEnds++;
        }
        continue;
      } else if (x < 0.14) {
        // a correction: allowed exactly when the team keeps 0 or more points
        const t = br() < 0.5 ? "A" : "B";
        const v = -(1 + Math.floor(br() * 3));
        const has = t === "A" ? state.scoreA : state.scoreB;
        const ok = bb.validate(P(t, v), state) === null;
        assert.strictEqual(ok, has + v >= 0, "correction " + v + " with " + has + " points");
        if (!ok) continue;
        e = P(t, v); bbFixes++;
        events.push(e); kept.push(e);
      } else {
        e = x < 0.25 ? ENDQ(state.period) : P(br() < 0.5 ? "A" : "B", 1 + Math.floor(br() * 3));
        assert.strictEqual(bb.validate(e, state), null);
        events.push(e); kept.push(e);
      }
      state = run(events);
      assert.ok(state.scoreA >= 0 && state.scoreB >= 0, "a total is never below 0");
      assert.deepStrictEqual(state, bb.compute(kept, { config: undefined }), "undo equals a fresh replay");
      const sumA = state.periods.reduce((t, p) => t + p[0], 0) + state.currentA;
      const sumB = state.periods.reduce((t, p) => t + p[1], 0) + state.currentB;
      assert.deepStrictEqual([sumA, sumB], [state.scoreA, state.scoreB], "quarter scores add up to the total");
      assert.strictEqual(state.isOvertime, state.period > 4);
      if (state.status === "live") {
        assert.strictEqual(state.periods.length, state.period - 1);
        if (state.period > 4) {
          // every overtime starts level: the score at the end of quarter 4 and each earlier overtime was level
          let a = 0, c = 0;
          state.periods.forEach((p, i) => { a += p[0]; c += p[1]; if (i >= 3) assert.strictEqual(a, c, "overtime only after a level score"); });
        }
      } else {
        assert.ok(state.periods.length >= 4);
        assert.notStrictEqual(state.scoreA, state.scoreB, "a finished match is never a draw");
        assert.strictEqual(state.winner, state.scoreA > state.scoreB ? "A" : "B");
        if (state.periods.length > 4) bbOvertimes++;
      }
    }
    if (state.status === "finished") {
      bbFinished++;
      assert.strictEqual(bb.validate(P("A", 2), state), "match already finished");
    }
  }
  assert.ok(bbFinished >= 390, "almost all random matches finish (" + bbFinished + ")");
  assert.ok(bbUndos > 500, "the random test really used undo");
  assert.ok(bbOvertimes > 0, "the random test really reached overtime (" + bbOvertimes + ")");
  assert.ok(bbFixes > 300, "the random test really used corrections (" + bbFixes + ")");
  assert.ok(bbRefusedEnds > 100, "the random test really tried old END QUARTER presses (" + bbRefusedEnds + ")");
}

// ======================= Kabaddi (AKFI: 2 halves, raids, all out, super tackle) =======================
require("./test-kabaddi")();

// ======================= Football (IFAB + college: goals, penalties, cards, extra time, shootout) =======================
require("./test-football")();

// ======================= Startup guard: JWT_SECRET =======================
const { checkJwtSecret, DEV_SECRET } = require("./config");
{
  const S32 = "x".repeat(32), S31 = "x".repeat(31), S64 = "a".repeat(64);
  const prod = (extra) => ({ NODE_ENV: "production", ...extra });

  // production: missing, default, or short secret stops the server
  for (const env of [prod({}), prod({ JWT_SECRET: "" }), prod({ JWT_SECRET: DEV_SECRET }), prod({ JWT_SECRET: S31 })]) {
    const r = checkJwtSecret(env);
    assert.ok(r.problem, "a weak secret is reported");
    assert.strictEqual(r.fatal, true, "production refuses to start with a weak secret");
  }
  // production: a strong secret is used as it is
  for (const s of [S32, S64]) {
    const r = checkJwtSecret(prod({ JWT_SECRET: s }));
    assert.deepStrictEqual(r, { secret: s, problem: null, fatal: false });
  }
  // laptop (no NODE_ENV): never fatal; a missing secret falls back to the dev value, a set one is used
  const dev = checkJwtSecret({});
  assert.strictEqual(dev.fatal, false);
  assert.ok(dev.problem, "the laptop still gets a warning");
  assert.strictEqual(dev.secret, DEV_SECRET);
  const devShort = checkJwtSecret({ JWT_SECRET: "short" });
  assert.strictEqual(devShort.fatal, false);
  assert.strictEqual(devShort.secret, "short", "a set secret is used even if short (same as before)");
  assert.strictEqual(checkJwtSecret({ NODE_ENV: "development", JWT_SECRET: S31 }).fatal, false);
  // the message never contains the secret itself
  assert.ok(!checkJwtSecret(prod({ JWT_SECRET: "abc-secret-value" })).problem.includes("abc-secret-value"));
}

// ======================= db.js: a Postgres restart must not crash the app =======================
{
  // the pool connects lazily, so a dummy address is enough: no database is contacted here
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/none";
  const pool = require("./db");
  assert.ok(pool.listenerCount("error") >= 1, "db.js listens for pool errors (without it, a Postgres restart kills the process)");
  assert.doesNotThrow(() => pool.emit("error", new Error("simulated lost connection (this line is expected in the test output)")));
  assert.strictEqual(pool.options.connectionTimeoutMillis, 5000, "a hung database fails after 5 s instead of waiting forever");
  pool.end();
}

// ======================= Scorer phone queue (public/queue.js) =======================
const { createQueue } = require("./public/queue");
{
  const memStore = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
  const E = (id, extra) => ({ id, matchId: "m1", type: "point", team: "A", value: 1, ...extra });
  let clock = 1000;
  const st = memStore();
  const q = createQueue({ storage: st, now: () => clock, random: () => 0 });

  assert.deepStrictEqual(q.add(E("a1"), "rahul"), { ok: true });
  q.add(E("a2"), "rahul");
  assert.strictEqual(q.status("rahul").waiting, 2);
  // pending(): this user's waiting entries, as copies (the scorer page checks for a waiting toss)
  {
    const q2 = createQueue({ storage: memStore(), now: () => 1 });
    q2.add(E("t1", { type: "toss", matchId: "m2" }), "rahul");
    q2.add(E("t2"), "neha");
    assert.deepStrictEqual(q2.pending("rahul"), [{ matchId: "m2", type: "toss", data: null }]);
    assert.deepStrictEqual(q2.pending("neha"), [{ matchId: "m1", type: "point", data: null }]);
    q2.pending("rahul")[0].type = "changed";
    assert.strictEqual(q2.pending("rahul")[0].type, "toss", "a copy: changing it does not change the queue");
    // with the data (football follows its waiting shootout kicks), also a copy
    q2.add(E("k1", { type: "kick", data: { team: "B", outcome: "saved" } }), "rahul");
    assert.deepStrictEqual(q2.pending("rahul")[1], { matchId: "m1", type: "kick", data: { team: "B", outcome: "saved" } });
    q2.pending("rahul")[1].data.team = "A";
    assert.strictEqual(q2.pending("rahul")[1].data.team, "B", "the data is a copy too");
  }
  assert.deepStrictEqual(Object.keys(q.payload(q.head("rahul"))).sort(), ["data", "id", "matchId", "team", "type", "value"],
    "only the fields the server knows are sent");

  // no answer: retried with the SAME id, waiting 2, 4, 8, 16, 30, 30 seconds
  const delays = [];
  for (let i = 0; i < 6; i++) {
    const r = q.result(q.head("rahul"), null);
    assert.strictEqual(r.action, "retry");
    assert.strictEqual(q.head("rahul").id, "a1", "same entry, same id on every retry");
    delays.push(r.delay);
  }
  assert.deepStrictEqual(delays, [2000, 4000, 8000, 16000, 30000, 30000]);
  assert.strictEqual(q.status("rahul").stuck, false, "no answer (bad network) never counts as stuck");
  clock += 45000;
  assert.strictEqual(q.status("rahul").oldestMs, 45000);

  // a good answer removes the entry; the next one starts fresh
  assert.strictEqual(q.result(q.head("rahul"), { ok: true, state: {} }).action, "sent");
  assert.strictEqual(q.head("rahul").id, "a2");
  assert.strictEqual(q.result(q.head("rahul"), null).delay, 2000, "backoff starts again at 2 s");

  // an answer without a clear ok is NOT treated as success
  assert.strictEqual(q.result(q.head("rahul"), {}).action, "retry");
  assert.strictEqual(q.result(q.head("rahul"), undefined).action, "retry");
  assert.strictEqual(q.result(q.head("rahul"), { ok: false, error: "server error", retry: true }).action, "retry");

  // a clear "no" from the server: kept in the rejected list, the rest continues
  q.add(E("a3"), "rahul");
  assert.strictEqual(q.result(q.head("rahul"), { ok: false, error: "match already finished" }).action, "rejected");
  assert.strictEqual(q.head("rahul").id, "a3");
  assert.deepStrictEqual(q.rejected().map((x) => [x.id, x.error]), [["a2", "match already finished"]]);

  // an old answer for an entry that is no longer first is ignored
  assert.strictEqual(q.result(E("a2"), { ok: true }).action, "ignored");
  assert.strictEqual(q.head("rahul").id, "a3");

  // page reload: a new queue on the same storage still has everything
  const q2 = createQueue({ storage: st, now: () => clock, random: () => 0 });
  assert.strictEqual(q2.head("rahul").id, "a3");
  assert.strictEqual(q2.rejected().length, 1);
  q2.ackRejected();
  assert.strictEqual(q2.rejected().length, 0, "the scorer tapped 'OK, I saw it'");

  // stuck entry: 20 server "try again" answers in a row -> stuck, but never dropped by itself
  for (let i = 0; i < 19; i++) q2.result(q2.head("rahul"), { ok: false, retry: true, error: "server error" });
  assert.strictEqual(q2.status("rahul").stuck, false);
  q2.result(q2.head("rahul"), { ok: false, retry: true, error: "server error" });
  assert.strictEqual(q2.status("rahul").stuck, true);
  assert.strictEqual(q2.head("rahul").id, "a3", "a stuck entry stays until the scorer decides");
  q2.skipHead("rahul");
  assert.strictEqual(q2.head("rahul"), null);
  assert.deepStrictEqual(q2.rejected().map((x) => x.id), ["a3"], "a skipped entry is listed as not counted");

  // another scorer's entries on the same phone are not sent under this login
  q2.add(E("n1"), "neha");
  q2.add(E("n2"), "neha");
  assert.strictEqual(q2.head("rahul"), null);
  assert.deepStrictEqual(q2.status("rahul").others, { neha: 2 });
  assert.strictEqual(q2.head("neha").id, "n1", "they are sent when neha logs in again");
  q2.discardOthers("rahul");
  assert.deepStrictEqual(q2.status("rahul").others, {});
  assert.deepStrictEqual(q2.rejected().slice(-2).map((x) => x.id), ["n1", "n2"], "discarded entries are listed, not silently lost");
  q2.add(E("n3"), "neha");
  q2.adoptOthers("rahul");
  assert.strictEqual(q2.head("rahul").id, "n3", "'send them as me'");

  // entries saved by the OLD page (no user field) belong to whoever is logged in
  const old = memStore();
  old.setItem("scorer-queue", JSON.stringify([{ id: "old1", matchId: "m1", type: "point", team: "A", value: 1 }]));
  assert.strictEqual(createQueue({ storage: old, now: () => clock }).head("anyone").id, "old1");

  // limits: warn at warnAt, refuse new taps at maxSize, never drop to make room
  const q4 = createQueue({ storage: memStore(), now: () => clock, warnAt: 3, maxSize: 5 });
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(q4.add(E("x" + i), "rahul"), { ok: true });
  assert.strictEqual(q4.status("rahul").warn, true);
  assert.deepStrictEqual(q4.add(E("x5"), "rahul"), { ok: false, reason: "full" });
  assert.strictEqual(q4.status("rahul").waiting, 5, "nothing was thrown away");
  assert.strictEqual(q4.head("rahul").id, "x0");
  assert.strictEqual(createQueue({ storage: memStore() }).status("rahul").warn, false);

  // the rejected list keeps only the newest 20
  const q6 = createQueue({ storage: memStore(), now: () => clock });
  for (let i = 0; i < 25; i++) { q6.add(E("r" + i), "rahul"); q6.result(q6.head("rahul"), { ok: false, error: "not allowed" }); }
  assert.strictEqual(q6.rejected().length, 20);
  assert.strictEqual(q6.rejected()[19].id, "r24");

  // phone storage blocked (private mode): still works in memory, and says so
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  const q5 = createQueue({ storage: blocked, now: () => clock });
  assert.deepStrictEqual(q5.add(E("p1"), "rahul"), { ok: true });
  assert.strictEqual(q5.status("rahul").storageOk, false);
  assert.strictEqual(q.status("rahul").storageOk, true);
}

// ---------- score history for the admin page (audit.js) ----------
{
  const { buildHistory } = require("./audit");
  const at = (n) => new Date(Date.UTC(2026, 10, 12, 10, 0, n));     // event n saved at 10:00:n UTC
  // rows as Postgres gives them: seq as a string (BIGSERIAL), value may be null, data parsed JSON
  const evs = (list) => list.map((e, i) => ({ seq: String(i + 1), type: e.type, team: e.team || null,
    value: e.value === undefined ? null : e.value, data: e.data || null, by_user: e.by || "rahul", created_at: at(i + 1) }));
  const hist = (sport, list, extra = {}) => {
    const match = { id: "m1", name: "M", sport, best_of: 3, config: {}, team_a: "CSE", team_b: "ECE", ...extra };
    return buildHistory(match, evs(list), getEngine(sport));
  };
  const bySeq = (h) => Object.fromEntries(h.rows.map((r) => [r.seq, r]));

  // simple sport: points, undo cancels the newest still-counted action, double undo, undo of a finish
  const h1 = hist("simple", [
    { type: "point", team: "A", value: 2 },            // 1
    { type: "point", team: "B", by: "neha" },          // 2 (value null = 1)
    { type: "undo" },                                  // 3 cancels 2
    { type: "point", team: "A", value: 1 },            // 4
    { type: "finish" },                                // 5
    { type: "undo" },                                  // 6 cancels 5 (the finish)
    { type: "undo" },                                  // 7 cancels 4
  ]);
  assert.strictEqual(h1.total, 7);
  assert.deepStrictEqual(h1.rows.map((r) => r.seq), [7, 6, 5, 4, 3, 2, 1], "newest first, seq as numbers");
  const s1 = bySeq(h1);
  assert.deepStrictEqual([s1[1].text, s1[1].after, s1[1].by, s1[1].at], ["+2 for CSE", "CSE 2 - 0 ECE", "rahul", "2026-11-12T10:00:01.000Z"]);
  assert.deepStrictEqual([s1[2].text, s1[2].after, s1[2].by], ["+1 for ECE", "CSE 2 - 1 ECE", "neha"]);
  assert.deepStrictEqual([s1[2].undone, s1[2].undoneBySeq], [true, 3]);
  assert.deepStrictEqual([s1[3].text, s1[3].undoesSeq, s1[3].after], ["UNDO (cancels: +1 for ECE)", 2, "CSE 2 - 0 ECE"]);
  assert.deepStrictEqual([s1[5].text, s1[5].undone, s1[5].undoneBySeq], ["Finish match", true, 6]);
  assert.deepStrictEqual([s1[6].text, s1[6].undoesSeq], ["UNDO (cancels: Finish match)", 5]);
  assert.deepStrictEqual([s1[7].undoesSeq, s1[4].undone, s1[4].undoneBySeq, s1[7].after], [4, true, 7, "CSE 2 - 0 ECE"]);
  assert.deepStrictEqual([s1[1].undone, s1[1].undoneBySeq, s1[1].undoesSeq], [false, null, null], "a counted action");

  // no team names: "Team A" / "Team B", like the student page
  assert.strictEqual(hist("simple", [{ type: "point", team: "B", value: 3 }], { team_a: "", team_b: " " }).rows[0].after, "Team A 0 - 3 Team B");
  assert.strictEqual(hist("simple", [{ type: "point", team: "B", value: 3 }], { team_a: "", team_b: "" }).rows[0].text, "+3 for Team B");

  // an undo with nothing to cancel (the server refuses it, but old data must not break the page)
  const h2 = bySeq(hist("simple", [{ type: "undo" }]));
  assert.deepStrictEqual([h2[1].text, h2[1].undoesSeq], ["UNDO (nothing to cancel)", null]);

  // an unknown type is shown as it is, and does not break the list
  assert.strictEqual(hist("simple", [{ type: "something_new" }]).rows[0].text, "something_new");

  // cricket: every kind of ball in words, the score after each one, and undo of a wicket
  const b = (runs, extra = null, kind = null) => ({ type: "ball", data: { runs, extra, wicket: kind ? { kind } : null } });
  const h3 = bySeq(hist("cricket", [
    b(0), b(4), b(1, "wide"), b(2, "noball"), b(1, "legbye"), b(0, null, "caught"), { type: "undo" },
    b(2, "bye"), b(1), { type: "end_innings" },
  ], { config: { overs: 2, players: 4, firstBatting: "A", freeHit: true } }));
  assert.deepStrictEqual([h3[1].text, h3[1].after], ["Dot ball", "CSE 0/0 (0.1 ov)"]);
  assert.deepStrictEqual([h3[2].text, h3[2].after], ["4 runs", "CSE 4/0 (0.2 ov)"]);
  assert.deepStrictEqual([h3[3].text, h3[3].after], ["Wide + 1", "CSE 6/0 (0.2 ov)"]);
  assert.deepStrictEqual([h3[4].text, h3[4].after], ["No ball + 2 off the bat", "CSE 9/0 (0.2 ov)"]);
  assert.deepStrictEqual([h3[5].text, h3[5].after], ["1 leg bye", "CSE 10/0 (0.3 ov)"]);
  assert.deepStrictEqual([h3[6].text, h3[6].after, h3[6].undone], ["Dot ball + WICKET (Caught)", "CSE 10/1 (0.4 ov)", true]);
  assert.deepStrictEqual([h3[7].text, h3[7].after], ["UNDO (cancels: Dot ball + WICKET (Caught))", "CSE 10/0 (0.3 ov)"]);
  assert.deepStrictEqual([h3[8].text, h3[9].text, h3[10].text], ["2 byes", "1 run", "End innings"]);

  // cricket toss: in words, its undo, and the corrected toss decides who bats
  const hT = bySeq(hist("cricket", [
    { type: "toss", data: { winner: "A", choice: "bat" } }, { type: "undo" },
    { type: "toss", data: { winner: "B", choice: "bowl" } }, b(4),
  ], { config: { overs: 2, players: 4 } }));
  assert.deepStrictEqual([hT[1].text, hT[1].after, hT[1].undone], ["Toss: CSE won, chose to bat", "CSE won the toss and chose to bat", true]);
  assert.deepStrictEqual([hT[2].text, hT[2].after], ["UNDO (cancels: Toss: CSE won, chose to bat)", "Waiting for the toss"]);
  assert.deepStrictEqual([hT[3].text, hT[3].after], ["Toss: ECE won, chose to bowl", "ECE won the toss and chose to bowl"]);
  assert.deepStrictEqual([hT[4].text, hT[4].after], ["4 runs", "CSE 4/0 (0.1 ov)"], "ECE chose to bowl, so CSE bats");

  // volleyball: finish with a winner (walkover)
  const h4 = hist("volleyball", [{ type: "finish", data: { winner: "B" } }], { config: { bestOf: 3 } });
  assert.deepStrictEqual([h4.rows[0].text, h4.rows[0].after], ["Finish match (ECE wins)", "ECE won (walkover), sets 0-0"]);

  // basketball: a 3-pointer, then the end of quarter 1 (newest row first)
  const hb = hist("basketball", [{ type: "point", team: "A", value: 3 }, { type: "end_period" }], { config: { quarterMinutes: 7, overtimeMinutes: 5 } });
  assert.deepStrictEqual([hb.rows[1].text, hb.rows[1].after], ["+3 for CSE", "CSE 3-0 ECE (Q1)"]);
  assert.deepStrictEqual([hb.rows[0].text, hb.rows[0].after], ["End quarter / overtime", "CSE 3-0 ECE (Q2)"]);
  // with the quarter number (new pages), and a correction
  const hb2 = hist("basketball", [{ type: "point", team: "A", value: 3 }, { type: "point", team: "A", value: -1 },
    { type: "end_period", data: { period: 1 } }, { type: "end_period", data: { period: 5 } }], { config: { quarterMinutes: 7, overtimeMinutes: 5 } });
  assert.deepStrictEqual([hb2.rows[2].text, hb2.rows[2].after], ["-1 for CSE (correction)", "CSE 2-0 ECE (Q1)"]);
  assert.strictEqual(hb2.rows[1].text, "End Quarter 1");
  assert.strictEqual(hb2.rows[0].text, "End Overtime 1");

  // kabaddi: raids, technical point, court fix, breaks, halves in words (newest row first)
  const raid = (team, out, bonus, caught) => ({ type: "raid", data: { team, out, bonus, caught } });
  const hk = hist("kabaddi", [raid("A", 2, true, false), raid("B", 0, false, false), raid("B", 0, true, true),
    { type: "point", team: "B", value: 1 }, { type: "point", team: "B", value: -1 }, { type: "court", data: { team: "A", change: -1 } },
    { type: "break", data: { kind: "timeout", team: "B" } }, { type: "break", data: { kind: "other", text: "Rain delay" } },
    { type: "break", data: { kind: "over" } }, { type: "end_period", data: { period: 1 } }, raid("A", 1, false, false)],
    { config: { halfMinutes: 15, knockout: false } });
  assert.deepStrictEqual(hk.rows.map((r) => r.text).reverse(), [
    "Raid by CSE: 2 out + bonus", "Raid by ECE: empty raid", "Raid by ECE: raider caught + bonus",
    "Technical point +1 for ECE", "-1 for ECE (correction)", "Players on court for CSE: -1",
    "Break: timeout ECE", "Break: Rain delay", "Break over", "End Half 1", "Raid by CSE: 1 out"]);
  assert.deepStrictEqual(hk.rows.map((r) => r.after).reverse(), [
    "CSE 3-0 ECE (H1)", "CSE 3-0 ECE (H1)", "CSE 4-1 ECE (H1)", "CSE 4-2 ECE (H1)", "CSE 4-1 ECE (H1)", "CSE 4-1 ECE (H1)",
    "CSE 4-1 ECE (H1)", "CSE 4-1 ECE (H1)", "CSE 4-1 ECE (H1)", "CSE 4-1 ECE (half time)", "CSE 5-1 ECE (H2)"]);
  // kabaddi raid start: in words, and UNDO skips it (takes back the raid before it)
  const hk2 = bySeq(hist("kabaddi", [raid("A", 1, false, false), { type: "raid_start", data: { team: "B" } }, { type: "undo" },
    { type: "raid_start", data: { cancel: true } }], { config: { halfMinutes: 15, knockout: false } }));
  assert.deepStrictEqual([hk2[2].text, hk2[2].undone], ["Raid started: ECE", false]);
  assert.deepStrictEqual([hk2[1].undone, hk2[1].undoneBySeq, hk2[3].text], [true, 3, "UNDO (cancels: Raid by CSE: 1 out)"]);
  assert.strictEqual(hk2[4].text, "Raid cancelled");

  // football: every action in words, and the score after it (seq comes as TEXT from Postgres: the engine copes)
  const fbCfg = { config: { halfMinutes: 15, players: 6, knockout: true } };
  const fbList = [{ type: "period_start", data: { period: 1 } },                                 // 1
    { type: "goal", data: { team: "A", kind: "normal", shirt: 9, name: "Rahul" } },             // 2
    { type: "goal", data: { team: "B", kind: "own_goal", shirt: 4 } },                          // 3
    { type: "card", data: { team: "B", color: "yellow", shirt: 5 } },                           // 4
    { type: "penalty_start", data: { team: "B" } },                                             // 5
    { type: "penalty", data: { team: "B", outcome: "saved" } },                                 // 6
    { type: "remove", data: { seq: 3 } },                                                       // 7
    { type: "end_period", data: { period: 1 } }, { type: "period_start", data: { period: 2 } },  // 8, 9
    { type: "goal", data: { team: "B", kind: "free_kick", shirt: 7 } },                         // 10
    { type: "end_period", data: { period: 2 } }, { type: "extra_time" },                        // 11, 12
    { type: "end_period", data: { period: 3 } }, { type: "period_start", data: { period: 4 } },  // 13, 14
    { type: "end_period", data: { period: 4 } }, { type: "shootout_start", data: { kicks: 3, first: "B" } },   // 15, 16
    { type: "kick", data: { team: "B", outcome: "scored" } }];                                   // 17
  const hf = bySeq(hist("football", fbList.map((e, i) => ({ ...e, seq: String(i + 1) })), fbCfg));
  assert.deepStrictEqual(Object.values(hf).sort((a, b) => a.seq - b.seq).map((r) => r.text), [
    "Kick-off: 1st half", "GOAL CSE #9 Rahul", "GOAL ECE #4 (own goal)", "Yellow card ECE #5", "Penalty to ECE",
    "Penalty ECE: saved", "Remove entry #3", "End 1st half", "Kick-off: 2nd half", "GOAL ECE #7 (free kick)", "End 2nd half",
    "Extra time", "End Extra time 1st half", "Kick-off: Extra time 2nd half", "End Extra time 2nd half",
    "Penalty shootout: 3 kicks each, ECE first", "Shootout kick ECE: scored"]);
  assert.deepStrictEqual([hf[3].after, hf[7].after, hf[8].after, hf[11].after, hf[12].after, hf[17].after],
    ["CSE 1-1 ECE (H1)", "CSE 1-0 ECE (H1)", "CSE 1-0 ECE (half time)", "CSE 1-1 ECE (full time)", "CSE 1-1 ECE (extra time)",
      "CSE 1-1 ECE (penalties 0-1)"]);

  // table tennis: a point has no value
  const h5 =hist("table_tennis", [{ type: "point", team: "A" }]);
  assert.deepStrictEqual([h5.rows[0].text, h5.rows[0].after], ["+1 for CSE", "CSE 0-0 ECE (1-0 in this game)"]);

  // an engine that throws must not break the history: the row just has no score
  const broken = { compute() { throw new Error("boom"); }, headline() { return "x"; } };
  const h6 = buildHistory({ sport: "simple", team_a: "", team_b: "" }, evs([{ type: "point", team: "A" }]), broken);
  assert.deepStrictEqual([h6.rows[0].text, h6.rows[0].after], ["+1 for Team A", null]);
}

// ---------- student home page: how long to wait before the next /api/home request ----------
{
  const { nextDelay } = require("./public/js/home-logic");
  // random = 0.5 is the middle of the +-20 % spread: the exact base wait
  assert.strictEqual(nextDelay(0, true, 0.5), 10000, "worked, a match is live: 10 s");
  assert.strictEqual(nextDelay(0, false, 0.5), 60000, "worked, nothing live: 60 s");
  assert.deepStrictEqual([1, 2, 3, 4, 5, 10].map((f) => nextDelay(f, true, 0.5)),
    [10000, 20000, 40000, 60000, 60000, 60000], "errors in a row: 10, 20, 40, then 60 s at most");
  assert.strictEqual(nextDelay(1, false, 0.5), 10000, "after an error: 10 s even when nothing is live");
  assert.strictEqual(nextDelay(1000, true, 0.5), 60000, "very many errors: still 60 s (no Infinity, no overflow)");
  // the spread: random 0 -> 80 %, random just under 1 -> just under 120 %
  assert.strictEqual(nextDelay(0, true, 0), 8000);
  assert.strictEqual(nextDelay(4, true, 0), 48000);
  assert.strictEqual(nextDelay(0, true, 0.9999), 12000);     // 11999.6 rounded
  assert.strictEqual(nextDelay(4, true, 0.9999), 71998);
  for (let i = 0; i < 1000; i++) {
    const r = Math.random(), f = Math.floor(Math.random() * 8), live = Math.random() < 0.5;
    const w = nextDelay(f, live, r);
    assert.ok(w >= 8000 && w <= 72000, "every wait between 8 and 72 s, got " + w);
  }
}

// ---------- student home page: card signature (same signature = keep the card on screen) ----------
{
  const { cardSignature, CARD_FIELDS } = require("./public/js/home-logic");
  const m = { id: "cr-1", name: "Final", sport: "cricket", competition: "Cricket", stage: "knockout", venue: "Ground 1",
    startTime: "2026-12-01T09:00:00.000Z", hasTeams: true, teamA: "CSE", teamB: "ECE", status: "live",
    headline: "CSE 45/2 (6.3)", resultText: "" };
  assert.strictEqual(cardSignature(m), cardSignature({ ...m }), "same data, same signature");
  for (const f of CARD_FIELDS) {
    const changed = { ...m, [f]: typeof m[f] === "boolean" ? !m[f] : m[f] + "x" };
    assert.notStrictEqual(cardSignature(changed), cardSignature(m), "a change of " + f + " must change the signature");
  }
  assert.strictEqual(cardSignature({ ...m, sport: "kabaddi" }), cardSignature(m), "a field the card does not show does not matter");
  assert.strictEqual(cardSignature({ ...m, venue: undefined }), cardSignature({ ...m, venue: null }), "missing and null are the same");
  // no mix-up between fields: ["a b", ""] must differ from ["a", "b"] (JSON keeps them apart; a plain join would not)
  assert.notStrictEqual(cardSignature({ ...m, teamA: "A B", teamB: "" }), cardSignature({ ...m, teamA: "A", teamB: "B" }));

  // the classic bug: card() shows a field that is not in the signature -> that card never updates.
  // Read card() from the page's code and check every m.<field> it uses (the id is the key, not shown text).
  const page = require("fs").readFileSync(require("path").join(__dirname, "public", "js", "home.js"), "utf8").replace(/\r\n/g, "\n");
  const cardSource = page.match(/\nfunction card\(m\) \{([\s\S]*?)\n\}/);
  assert.ok(cardSource, "card(m) found in public/js/home.js");
  const used = new Set([...cardSource[1].matchAll(/\bm\.([A-Za-z]+)/g)].map((x) => x[1]));
  used.delete("id");
  assert.ok(used.size >= 8, "card() reads the match fields");
  for (const f of used) assert.ok(CARD_FIELDS.includes(f), "card() shows m." + f + " but it is not in CARD_FIELDS");
}

// ---------- match page: screen-reader sentence and its throttle (public/js/match-logic.js) ----------
{
  const { scoreSentence, createAnnouncer } = require("./public/js/match-logic");
  const { effectivePoints: eff } = require("./engine");
  const st = (sport, list, extra = {}) => {
    const rows = list.map((e, i) => ({ seq: String(i + 1), type: e.type, team: e.team || null, value: e.value === undefined ? null : e.value, data: e.data || null }));
    return { sport, teamA: "CSE", teamB: "ECE", ...getEngine(sport).compute(eff(rows), { config: extra.config || {}, best_of: 3 }) };
  };
  const p = (team, value) => ({ type: "point", team, value });
  const bl = (runs, extra = null, kind = null) => ({ type: "ball", data: { runs, extra, wicket: kind ? { kind } : null } });

  assert.strictEqual(scoreSentence(st("simple", [p("A", 3), p("B", 1)])), "CSE 3, ECE 1.");
  assert.strictEqual(scoreSentence(st("simple", [p("A", 2), p("B", 1), { type: "finish" }])), "Match finished. CSE won. CSE 2, ECE 1.");
  assert.strictEqual(scoreSentence(st("simple", [p("A", 1), p("B", 1), { type: "finish" }])), "Match finished. Draw. CSE 1, ECE 1.");
  assert.strictEqual(scoreSentence({ ...st("simple", [p("A", 1)]), teamA: "", teamB: "" }), "Team A 1, Team B 0.");
  const tt = st("table_tennis", [...Array(11)].map(() => p("A")).concat([p("B"), p("B"), p("A")]));
  assert.strictEqual(scoreSentence(tt), "Games: CSE 1, ECE 0. Current game: 1 to 2.");
  const vb = st("volleyball", [...Array(25)].map(() => p("A")).concat([p("B")]), { config: { bestOf: 3 } });
  assert.strictEqual(scoreSentence(vb), "Sets: CSE 1, ECE 0. Set 2: 0 to 1.");
  const crCfg = { config: { overs: 2, players: 4, firstBatting: "A", freeHit: true } };
  assert.strictEqual(scoreSentence(st("cricket", [bl(4), bl(1)], crCfg)), "CSE 5 for 0 after 0.2 overs.");
  const chase = st("cricket", [...[4, 1, 0, 6, 2, 1, 0, 4, 1, 1, 0, 2].map((r) => bl(r)), bl(1), bl(0, null, "bowled"), bl(1, "noball")], crCfg);
  assert.strictEqual(scoreSentence(chase), "ECE 3 for 1 after 0.2 overs. Need 20 from 10 balls. Free hit.");

  // basketball: total score, the quarter now; the "current" and "history" lines of the board
  const { basketballLines } = require("./public/js/match-logic");
  const bbCfg = { config: { quarterMinutes: 7, overtimeMinutes: 5 } };
  const E = { type: "end_period" };
  const bb1 = st("basketball", [p("A", 3), E, p("B", 2), p("A", 1)], bbCfg);
  assert.strictEqual(scoreSentence(bb1), "CSE 4, ECE 2. Quarter 2.");
  assert.deepStrictEqual(basketballLines(bb1), { current: "Quarter 2 (7 min)", history: "Q1 3-0" });
  assert.deepStrictEqual(basketballLines(st("basketball", [], bbCfg)), { current: "Quarter 1 (7 min)", history: "" });
  const bbOt = st("basketball", [p("A", 2), p("B", 2), E, E, E, E, p("B", 3)], bbCfg);
  assert.strictEqual(scoreSentence(bbOt), "CSE 2, ECE 5. Overtime 1.");
  assert.deepStrictEqual(basketballLines(bbOt), { current: "Overtime 1 (5 min)", history: "Q1 2-2, Q2 0-0, Q3 0-0, Q4 0-0" });
  const bbDone = st("basketball", [p("A", 2), p("B", 2), E, E, E, E, p("B", 3), E], bbCfg);
  assert.strictEqual(scoreSentence(bbDone), "Match finished. Team B won 5-2 (after overtime). CSE 2, ECE 5.");
  assert.deepStrictEqual(basketballLines(bbDone), { current: null, history: "Q1 2-2, Q2 0-0, Q3 0-0, Q4 0-0, OT1 0-3" });

  // kabaddi: the half now, the break banner, players on court (number + dots), the big moments (newest first, at most 6)
  const { kabaddiLines } = require("./public/js/match-logic");
  const kbCfg = { config: { halfMinutes: 15, knockout: false } };
  const kbKO = { config: { halfMinutes: 20, knockout: true } };
  const raid = (team, out, bonus = false, caught = false) => ({ type: "raid", data: { team, out, bonus, caught } });
  const H = (n) => ({ type: "end_period", data: { period: n } });
  const kb1 = st("kabaddi", [raid("A", 3), raid("B", 0, false, true)], kbCfg);   // CSE 3 out, then ECE's raider caught
  assert.strictEqual(scoreSentence(kb1), "CSE 4, ECE 0. Half 1.");
  assert.deepStrictEqual(kabaddiLines(kb1), { current: "Half 1 (15 min)", history: "", banner: "",
    courtA: 7, courtB: 3, dotsA: "●●●●●●●", dotsB: "●●●○○○○",
    danger: ["ECE: 3 on court - SUPER TACKLE on!"],
    raiding: null,
    table: [["Raid", 3, 0], ["Tackle", 1, 0], ["All out", 0, 0], ["Technical", 0, 0]],
    moments: ["SUPER RAID · CSE +3 (3 out) · H1 · 3-0"] });
  const kbHT = st("kabaddi", [raid("A", 3), H(1)], kbCfg);
  assert.strictEqual(scoreSentence(kbHT), "CSE 3, ECE 0. HALF TIME.");
  assert.deepStrictEqual([kabaddiLines(kbHT).current, kabaddiLines(kbHT).history, kabaddiLines(kbHT).banner], ["Half 2 (15 min)", "H1 3-0", "HALF TIME"]);
  assert.strictEqual(kabaddiLines(st("kabaddi", [{ type: "break", data: { kind: "timeout", team: "B" } }], kbCfg)).banner, "TIMEOUT: ECE");
  assert.strictEqual(kabaddiLines(st("kabaddi", [{ type: "break", data: { kind: "other", text: "Rain delay" } }], kbCfg)).banner, "BREAK: Rain delay");
  const kbLevel = [raid("A", 1), raid("B", 1), H(1), H(2)];
  const kbTie = st("kabaddi", kbLevel, kbKO);
  assert.strictEqual(scoreSentence(kbTie), "CSE 1, ECE 1. Level after 2 halves: tie-break.");
  assert.deepStrictEqual([kabaddiLines(kbTie).current, kabaddiLines(kbTie).history, kabaddiLines(kbTie).banner],
    [null, "H1 1-1, H2 0-0", "Level after 2 halves: tie-break"]);
  const kbDraw = st("kabaddi", kbLevel, kbCfg);
  assert.strictEqual(scoreSentence(kbDraw), "Match finished. Draw 1-1. CSE 1, ECE 1.");
  assert.deepStrictEqual([kabaddiLines(kbDraw).current, kabaddiLines(kbDraw).banner], [null, ""]);
  const kbMany = kabaddiLines(st("kabaddi", Array(8).fill(p("A", 1)), kbCfg));
  assert.strictEqual(kbMany.moments.length, 6, "at most 6 moments");
  assert.strictEqual(kbMany.moments[0], "Technical point · CSE +1 · H1 · 8-0", "newest first");
  assert.deepStrictEqual(kbMany.danger, [], "7 on court each: no danger line");
  assert.deepStrictEqual(kabaddiLines({ ...kb1, teamA: "", highlights: [{ kind: "all_out", team: "A", half: 2, scoreA: 9, scoreB: 4 }] }).moments,
    ["ALL OUT · Team A · H2 · 9-4"], "an old saved state without points still shows");
  // moments with their points
  const kbBig = st("kabaddi", [raid("A", 2, true), raid("A", 5)], kbCfg);                    // 2 out + bonus, then 5 out = ALL OUT
  assert.deepStrictEqual(kabaddiLines(kbBig).moments,
    ["ALL OUT · CSE +2 · H1 · 10-0", "SUPER RAID · CSE +5 (5 out) · H1 · 10-0", "SUPER RAID · CSE +3 (2 out + bonus) · H1 · 3-0"]);
  const kbST = st("kabaddi", [raid("A", 4), raid("A", 0, false, true)], kbCfg);              // ECE has 3: super tackle
  assert.strictEqual(kabaddiLines(kbST).moments[0], "SUPER TACKLE · ECE +2 · H1 · 4-2");
  // danger line: 3 or fewer on court = a tackle by them is a SUPER TACKLE; 1 left = ALL OUT danger
  assert.deepStrictEqual(kabaddiLines(st("kabaddi", [raid("A", 6), ...Array(5).fill({ type: "court", data: { team: "A", change: -1 } })], kbCfg)).danger,
    ["CSE: 2 on court - SUPER TACKLE on!", "ECE: last player on court - ALL OUT danger, SUPER TACKLE on!"]);
  assert.deepStrictEqual(kabaddiLines({ ...kbHT, status: "finished" }).danger, [], "no danger line after the match");
  assert.deepStrictEqual(kabaddiLines(kbTie).danger, [], "no danger line at the tie-break");
  // points table: corrections row only when there is one; no table before the first point or for an old saved state
  assert.deepStrictEqual(kabaddiLines(st("kabaddi", [p("A", 1), p("A", -1), raid("B", 7)], kbCfg)).table,
    [["Raid", 0, 7], ["Tackle", 0, 0], ["All out", 0, 2], ["Technical", 1, 0], ["Corrections", -1, 0]]);
  assert.deepStrictEqual(kabaddiLines(st("kabaddi", [], kbCfg)).table, []);
  assert.deepStrictEqual(kabaddiLines({ ...kb1, pointsBy: undefined }).table, []);

  // the big pop-up: only for moments that are NEW since the last state (not on opening, not resent, not after UNDO)
  const { kabaddiPop } = require("./public/js/match-logic");
  const kb0 = st("kabaddi", [], kbCfg);
  assert.strictEqual(kabaddiPop(null, kbBig), null, "page just opened: no pop-up for old moments");
  assert.strictEqual(kabaddiPop(kb0, st("kabaddi", [raid("A", 2, true)], kbCfg)), "SUPER RAID! CSE +3");
  assert.strictEqual(kabaddiPop(st("kabaddi", [raid("A", 2, true)], kbCfg), kbBig), "SUPER RAID + ALL OUT! CSE +7", "two moments in one raid");
  assert.strictEqual(kabaddiPop(st("kabaddi", [raid("A", 4)], kbCfg), kbST), "SUPER TACKLE! ECE +2");
  assert.strictEqual(kabaddiPop(kbBig, kbBig), null, "the same state again (reconnect): nothing");
  assert.strictEqual(kabaddiPop(kbBig, st("kabaddi", [raid("A", 2, true)], kbCfg)), null, "UNDO: nothing");
  assert.strictEqual(kabaddiPop(kb0, st("kabaddi", [p("B", 1)], kbCfg)), "TECHNICAL POINT! ECE +1");
  assert.strictEqual(kabaddiPop(kb0, st("kabaddi", [raid("A", 2)], kbCfg)), null, "a normal raid: no pop-up");
  assert.strictEqual(kabaddiPop(kb0, { ...kb0, sport: "basketball" }), null);

  // RAID STARTED: the "raiding now" box with its badges; do-or-die moments, pop-ups, table row, sentence
  const RS = (team) => ({ type: "raid_start", data: { team } });
  const emp = (t) => raid(t, 0);
  assert.strictEqual(kabaddiLines(kb0).raiding, null);
  assert.deepStrictEqual(kabaddiLines(st("kabaddi", [RS("A")], kbCfg)).raiding, { title: "CSE RAIDING NOW", badges: [] });
  const kbDodNow = st("kabaddi", [raid("A", 4), emp("B"), emp("A"), emp("B"), RS("B")], kbCfg);   // ECE: do-or-die; CSE has 7
  assert.deepStrictEqual(kabaddiLines(kbDodNow).raiding, { title: "ECE RAIDING NOW", badges: ["DO-OR-DIE RAID"] });
  assert.strictEqual(scoreSentence(kbDodNow), "CSE 4, ECE 0. ECE raiding now, do-or-die raid.");
  const kbSTnow = st("kabaddi", [raid("A", 4), RS("A")], kbCfg);                                  // ECE has 3
  assert.deepStrictEqual(kabaddiLines(kbSTnow).raiding, { title: "CSE RAIDING NOW", badges: ["SUPER TACKLE CHANCE (ECE 3 on court)"] });
  const dodEv = [emp("A"), emp("B"), emp("A"), emp("B")];
  const kbDodOut = st("kabaddi", [...dodEv, emp("A")], kbCfg);
  assert.strictEqual(kabaddiLines(kbDodOut).moments[0], "DO-OR-DIE OUT · ECE +1 · H1 · 0-1");
  assert.deepStrictEqual(kabaddiLines(kbDodOut).table,
    [["Raid", 0, 0], ["Tackle", 0, 0], ["All out", 0, 0], ["Do-or-die out", 0, 1], ["Technical", 0, 0]]);
  assert.strictEqual(kabaddiPop(st("kabaddi", dodEv, kbCfg), kbDodOut), "DO-OR-DIE OUT! ECE +1");
  const kbDodWin = st("kabaddi", [...dodEv, raid("A", 2)], kbCfg);
  assert.strictEqual(kabaddiLines(kbDodWin).moments[0], "DO-OR-DIE SUCCESS · CSE +2 · H1 · 2-0");
  assert.strictEqual(kabaddiPop(st("kabaddi", dodEv, kbCfg), kbDodWin), "DO-OR-DIE SUCCESS! CSE +2");
  assert.strictEqual(kabaddiPop(st("kabaddi", dodEv, kbCfg), st("kabaddi", [...dodEv, RS("A")], kbCfg)), null, "a raid start is no moment");

  // the toss on the match page
  const { tossLine } = require("./public/js/match-logic");
  const tossB = { type: "toss", data: { winner: "B", choice: "bowl" } };
  assert.strictEqual(tossLine(st("cricket", [], crCfg)), "Waiting for the toss");
  assert.strictEqual(scoreSentence(st("cricket", [], crCfg)), "CSE against ECE. Waiting for the toss.");
  assert.strictEqual(tossLine(st("cricket", [tossB], crCfg)), "ECE won the toss and chose to bowl");
  assert.strictEqual(scoreSentence(st("cricket", [tossB], crCfg)), "ECE won the toss and chose to bowl. CSE 0 for 0 after 0.0 overs.");
  assert.strictEqual(tossLine(st("cricket", [tossB, bl(4)], crCfg)), "ECE won the toss and chose to bowl", "the line stays during the match");
  assert.strictEqual(scoreSentence(st("cricket", [tossB, bl(4)], crCfg)), "CSE 4 for 0 after 0.1 overs.", "after the first ball: score only");
  assert.strictEqual(tossLine(st("cricket", [bl(4)], crCfg)), "", "old match without a toss: no line");
  assert.strictEqual(tossLine({ ...st("cricket", [tossB], crCfg), teamA: "", teamB: "" }), "Team B won the toss and chose to bowl");

  // the throttle, with a fake clock: at most one sentence per 8 s, the newest wins
  let clock = 0, timers = [];
  const said = [];
  const announce = createAnnouncer({ minGapMs: 8000, now: () => clock, say: (t) => said.push(clock + ": " + t),
    setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; } });
  const runTo = (t) => { clock = t; for (const x of timers.splice(0).filter((y) => y.at <= t)) x.fn(); };
  announce("one");                                   // first: at once
  assert.deepStrictEqual(said, ["0: one"]);
  clock = 1000; announce("two");
  clock = 3000; announce("three");                   // two and three wait; three is newer
  assert.deepStrictEqual(said, ["0: one"], "nothing more within 8 s");
  runTo(8000);
  assert.deepStrictEqual(said, ["0: one", "8000: three"], "after the gap only the newest");
  runTo(20000); announce("four");                    // a quiet time: at once again
  assert.deepStrictEqual(said.slice(-1), ["20000: four"]);
  announce("four"); clock = 30000; announce("four");  // the same sentence is never said twice in a row
  assert.strictEqual(said.length, 3);
  clock = 30001; announce("five");                   // and a skipped repeat did not start a new 8 s gap
  assert.deepStrictEqual(said.slice(-1), ["30001: five"]);
  clock = 31000; announce("six"); clock = 32000; announce("five");   // changed and changed back within the gap
  runTo(38001);
  assert.strictEqual(said.length, 4, "back to what was said last: nothing to say");
  clock = 38500; announce("seven");                  // that silent moment must not start a new 8 s wait
  assert.deepStrictEqual(said.slice(-1), ["38500: seven"], "said at once (last real sentence was 8.5 s ago)");

  // the connection bar text
  const { connectionText } = require("./public/js/match-logic");
  assert.strictEqual(connectionText(false, false, "14:05:12"), "", "all fine: no bar");
  assert.strictEqual(connectionText(false, false, null), "", "all fine before the first score too");
  assert.strictEqual(connectionText(false, true, null), "Cannot reach the server. Trying again...");
  assert.strictEqual(connectionText(false, true, "14:05:12"), "Reconnecting... The score below is from 14:05:12.");
  assert.strictEqual(connectionText(true, false, "14:05:12"), "No internet connection. The score below is from 14:05:12.",
    "offline wins, even while the old connection does not know it yet");
  assert.strictEqual(connectionText(true, true, null), "No internet connection.");
}

// ---------- student home page: "Updated ... ago" ----------
{
  const { agoText } = require("./public/js/home-logic");
  const cases = [[0, "Updated just now"], [9999, "Updated just now"], [10000, "Updated 10 s ago"], [19999, "Updated 10 s ago"],
    [35000, "Updated 30 s ago"], [59999, "Updated 50 s ago"], [60000, "Updated 1 min ago"], [119999, "Updated 1 min ago"],
    [130000, "Updated 2 min ago"], [3599999, "Updated 59 min ago"], [3600000, "Updated over an hour ago"],
    [-5000, "Updated just now"]];                                   // the phone's clock jumped back
  for (const [ms, text] of cases) assert.strictEqual(agoText(ms), text, ms + " ms");
}

// ---------- admin API: category, stage and college overs (admin.js parseMatch) ----------
{
  const { parseMatch } = require("./admin");
  const crBody = (o) => ({ sport: "cricket", teamA: "CSE", teamB: "ME", category: "boys", stage: "group",
    config: { players: 11, firstBatting: "A", freeHit: true }, ...o });
  const problem = (body) => { try { parseMatch(body); return null; } catch (e) { return e.message; } };

  // overs not sent: the college number is used
  assert.strictEqual(parseMatch(crBody({})).config.overs, 12, "boys group = 12");
  assert.strictEqual(parseMatch(crBody({ stage: "quarter_final" })).config.overs, 12, "boys quarter final = 12");
  assert.strictEqual(parseMatch(crBody({ stage: "semi_final" })).config.overs, 14, "boys semi final = 14");
  assert.strictEqual(parseMatch(crBody({ stage: "final" })).config.overs, 14, "boys final = 14");
  assert.strictEqual(parseMatch(crBody({ category: "girls" })).config.overs, 10, "girls group = 10");
  assert.strictEqual(parseMatch(crBody({ category: "girls", stage: "final" })).config.overs, 12, "girls final = 12");
  assert.strictEqual(parseMatch(crBody({ category: "male_faculty", stage: "semi_final" })).config.overs, 14, "male faculty semi final = 14");
  // the admin can still change the overs (for example a match shortened by rain)
  assert.strictEqual(parseMatch(crBody({ config: { overs: 8, players: 11 } })).config.overs, 8);
  // old matches and scripts: no category, overs default 10 as before
  assert.strictEqual(parseMatch(crBody({ category: undefined })).config.overs, 10);
  assert.strictEqual(parseMatch(crBody({ category: "" })).category, "");

  // cricket is only for Boys, Girls and Male Faculty
  assert.match(problem(crBody({ category: "female_faculty" })), /cricket is only for/);
  assert.match(problem(crBody({ category: "mix" })), /cricket is only for/);
  // the other sports take all 5 categories
  for (const category of ["boys", "girls", "male_faculty", "female_faculty", "mix"]) {
    for (const sport of ["simple", "table_tennis", "volleyball"]) {
      assert.strictEqual(parseMatch({ sport, teamA: "X", teamB: "Y", category }).category, category, sport + " " + category);
    }
  }
  // basketball: only Boys and Girls; quarter minutes always from the stage (the admin cannot change them)
  const bbBody = (o) => ({ sport: "basketball", teamA: "CSE", teamB: "ME", category: "boys", stage: "group", ...o });
  assert.deepStrictEqual(parseMatch(bbBody({})).config, { quarterMinutes: 7, overtimeMinutes: 5 }, "group = 7 min");
  assert.strictEqual(parseMatch(bbBody({ stage: "quarter_final" })).config.quarterMinutes, 7);
  assert.strictEqual(parseMatch(bbBody({ stage: "semi_final" })).config.quarterMinutes, 10);
  assert.strictEqual(parseMatch(bbBody({ stage: "final", category: "girls" })).config.quarterMinutes, 10);
  assert.deepStrictEqual(parseMatch(bbBody({ config: { quarterMinutes: 3, overtimeMinutes: 9, hack: 1 } })).config,
    { quarterMinutes: 7, overtimeMinutes: 5 }, "minutes sent by the page are ignored");
  assert.strictEqual(parseMatch(bbBody({ category: "" })).category, "", "scripts may leave the category empty");
  for (const category of ["male_faculty", "female_faculty", "mix"]) {
    assert.match(problem(bbBody({ category })), /basketball is only for Boys and Girls/);
  }
  // kabaddi: only Boys and Girls; half minutes from category + stage; knockout from the stage (the admin cannot change them)
  const kbBody = (o) => ({ sport: "kabaddi", teamA: "CSE", teamB: "ME", category: "boys", stage: "group", ...o });
  assert.deepStrictEqual(parseMatch(kbBody({})).config, { halfMinutes: 15, knockout: false }, "boys group = 15 min, a draw is possible");
  assert.deepStrictEqual(parseMatch(kbBody({ stage: "quarter_final" })).config, { halfMinutes: 15, knockout: true });
  assert.deepStrictEqual(parseMatch(kbBody({ stage: "semi_final" })).config, { halfMinutes: 15, knockout: true });
  assert.deepStrictEqual(parseMatch(kbBody({ stage: "final" })).config, { halfMinutes: 20, knockout: true });
  assert.deepStrictEqual(parseMatch(kbBody({ category: "girls" })).config, { halfMinutes: 10, knockout: false });
  assert.deepStrictEqual(parseMatch(kbBody({ category: "girls", stage: "semi_final" })).config, { halfMinutes: 10, knockout: true });
  assert.deepStrictEqual(parseMatch(kbBody({ category: "girls", stage: "final" })).config, { halfMinutes: 15, knockout: true });
  assert.deepStrictEqual(parseMatch(kbBody({ stage: "knockout" })).config, { halfMinutes: 15, knockout: true }, "old 'knockout' stage");
  assert.deepStrictEqual(parseMatch(kbBody({ config: { halfMinutes: 3, knockout: true, hack: 1 } })).config,
    { halfMinutes: 15, knockout: false }, "settings sent by the page are ignored");
  assert.strictEqual(parseMatch(kbBody({ category: "" })).config.halfMinutes, 15, "scripts may leave the category empty: Boys numbers");
  for (const category of ["male_faculty", "female_faculty", "mix"]) {
    assert.match(problem(kbBody({ category })), /kabaddi is only for Boys and Girls/);
  }
  // football: only Boys (6-a-side, 2 x 15) and Girls (5-a-side, 2 x 7), every stage the same; knockout from the stage
  const fbBody = (o) => ({ sport: "football", teamA: "CSE", teamB: "ME", category: "boys", stage: "group", ...o });
  assert.deepStrictEqual(parseMatch(fbBody({})).config, { halfMinutes: 15, players: 6, knockout: false }, "boys group: a draw is possible");
  assert.deepStrictEqual(parseMatch(fbBody({ stage: "final" })).config, { halfMinutes: 15, players: 6, knockout: true }, "the final is not longer");
  assert.deepStrictEqual(parseMatch(fbBody({ category: "girls" })).config, { halfMinutes: 7, players: 5, knockout: false });
  assert.deepStrictEqual(parseMatch(fbBody({ category: "girls", stage: "semi_final" })).config, { halfMinutes: 7, players: 5, knockout: true });
  assert.deepStrictEqual(parseMatch(fbBody({ config: { halfMinutes: 45, players: 11, knockout: true } })).config,
    { halfMinutes: 15, players: 6, knockout: false }, "settings sent by the page are ignored");
  assert.strictEqual(parseMatch(fbBody({ category: "" })).config.players, 6, "scripts may leave the category empty: Boys numbers");
  for (const category of ["male_faculty", "female_faculty", "mix"]) {
    assert.match(problem(fbBody({ category })), /football is only for Boys and Girls/);
  }
  // bad values are refused
  assert.match(problem(crBody({ category: "staff" })), /category/);
  assert.match(problem(crBody({ category: 5 })), /category/);
  assert.match(problem(crBody({ category: "toString" })), /category/);
  assert.match(problem(crBody({ stage: "semi" })), /stage/);
  // every stage is accepted, "knockout" too (old matches, load-test scripts); empty = group
  for (const stage of ["group", "quarter_final", "semi_final", "final", "knockout"]) {
    assert.strictEqual(parseMatch(crBody({ stage })).stage, stage);
  }
  assert.strictEqual(parseMatch(crBody({ stage: "" })).stage, "group");
  // the automatic match name includes the category
  assert.strictEqual(parseMatch({ sport: "simple", teamA: "X", teamB: "Y", category: "mix", competition: "Chess" }).name, "Chess (Mix): X vs Y");
}

// ---------- admin API: is a match live? (a scorer of a live match cannot be deleted) ----------
{
  const { matchIsLive } = require("./admin");
  const sm = { sport: "simple", config: {}, best_of: 3 };
  const cr = { sport: "cricket", config: { overs: 2, players: 4 }, best_of: 3 };
  const tt = { sport: "table_tennis", config: {}, best_of: 3 };
  const pt = (team) => ({ type: "point", team, value: 1, data: null });
  assert.strictEqual(matchIsLive(sm, []), false, "not started");
  assert.strictEqual(matchIsLive(sm, [pt("A")]), true, "a point: live");
  assert.strictEqual(matchIsLive(sm, [pt("A"), { type: "finish" }]), false, "finished");
  assert.strictEqual(matchIsLive(sm, [pt("A"), { type: "finish" }, { type: "undo" }]), true, "finish undone: live again");
  assert.strictEqual(matchIsLive(sm, [pt("A"), { type: "undo" }]), true, "everything undone but scoring began: still treated as live");
  assert.strictEqual(matchIsLive(cr, [{ type: "toss", data: { winner: "A", choice: "bat" } }]), true, "cricket: the toss is enough");
  assert.strictEqual(matchIsLive(cr, [{ type: "finish" }]), false, "cricket: abandoned");
  assert.strictEqual(matchIsLive(tt, [...Array(22)].map((_, i) => pt(i % 2 ? "B" : "A"))), true, "table tennis 11-11");
  assert.strictEqual(matchIsLive({ sport: "no_such_sport", config: {} }, [pt("A")]), true, "unknown sport: be safe, say live");
}

// ---------- admin page: no inline code (Phase 8; a CSP would block it) ----------
{
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "public", "admin.html"), "utf8");
  assert.ok(!/<style/i.test(html), "admin.html: no <style> block (use public/css/admin.css)");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "admin.html: every <script> loads a file (src=), no inline script");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "admin.html: no onclick=/onchange=... attributes (use addEventListener)");
  assert.ok(!/\sstyle\s*=/i.test(html), "admin.html: no style=\"...\" attributes (use a CSS rule)");
  assert.ok(!/javascript:/i.test(html), "admin.html: no javascript: links");
  // every element admin.js attaches a listener to must exist, or the whole script stops at that line
  const js = fs.readFileSync(path.join(__dirname, "public", "js", "admin.js"), "utf8");
  const wired = [...js.matchAll(/\$\("([A-Za-z]+)"\)\.addEventListener/g)].map((x) => x[1]);
  assert.strictEqual(wired.length, 13, "the 11 buttons/selects that had on...= attributes, plus Category and Stage (college overs)");
  for (const id of wired) assert.ok(html.includes('id="' + id + '"'), "admin.html has id=\"" + id + "\" (used in admin.js)");
}

// ======================= async tests (the summary line waits for them) =======================
(async () => {
  // ---------- /ready: are the database and Redis answering? ----------
  const { createReadyCheck } = require("./ready");
  const ok = () => Promise.resolve("PONG");
  const broken = () => Promise.reject(new Error("connection refused"));
  const hangs = () => new Promise(() => {});                  // never answers
  const throwsAtOnce = () => { throw new Error("client is closed"); };

  assert.deepStrictEqual(await createReadyCheck({ checks: { db: ok, redis: ok } })(), { ok: true, failed: [] });
  assert.deepStrictEqual(await createReadyCheck({ checks: { db: ok, redis: broken } })(), { ok: false, failed: ["redis"] });
  assert.deepStrictEqual(await createReadyCheck({ checks: { db: broken, redis: broken } })(), { ok: false, failed: ["db", "redis"] });
  assert.deepStrictEqual(await createReadyCheck({ checks: { db: throwsAtOnce, redis: ok } })(), { ok: false, failed: ["db"] });

  const t0 = Date.now();
  const r = await createReadyCheck({ checks: { db: hangs, redis: ok }, timeoutMs: 100 })();
  assert.deepStrictEqual(r, { ok: false, failed: ["db"] }, "a database that never answers counts as failed");
  assert.ok(Date.now() - t0 < 1000, "and the answer comes after the time limit, not never");

  // many visitors at once: the real checks run at most once per cacheMs
  let calls = 0, clock = 1000;
  const counted = () => { calls++; return Promise.resolve(); };
  const check = createReadyCheck({ checks: { db: counted }, cacheMs: 2000, now: () => clock });
  await Promise.all([check(), check(), check()]);
  assert.strictEqual(calls, 1, "3 requests at the same moment run the check once");
  clock += 1999; await check();
  assert.strictEqual(calls, 1, "still cached just before 2 s");
  clock += 1; await check();
  assert.strictEqual(calls, 2, "checked again after 2 s");

  // ---------- the scorer page itself (public/scorer.html + public/queue.js), with a fake page and socket ----------
  await require("./test-scorer-page")();

  console.log("All tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
