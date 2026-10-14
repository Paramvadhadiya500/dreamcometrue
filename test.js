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

// ---- end innings needs at least one ball ----
c = run([]);
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
  const events = [];
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

console.log("All tests passed");
