// Kabaddi engine tests (AKFI rules + the college's choices). Called from test.js.
// Pure: no database, no server.
const assert = require("assert");
const { effectivePoints } = require("./engine");
const { getEngine } = require("./engines");
const { buildStandings } = require("./standings");

// small random number generator with a seed (same games every run)
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

module.exports = function testKabaddi() {
  const kb = getEngine("kabaddi");
  assert.ok(kb, "the registry returns the kabaddi engine");

  // ---- helpers ----
  const R = (team, out = 0, bonus = false, caught = false) => ({ type: "raid", data: { team, out, bonus, caught } });
  const CAUGHT = (team, bonus = false) => R(team, 0, bonus, true);
  const EMPTY = (team) => R(team);
  const P = (team, value) => ({ type: "point", team, value });
  const COURT = (team, change) => ({ type: "court", data: { team, change } });
  const TIMEOUT = (team) => ({ type: "break", data: { kind: "timeout", team } });
  const OTHER = (text) => ({ type: "break", data: { kind: "other", text } });
  const OVER = { type: "break", data: { kind: "over" } };
  const END = (n) => ({ type: "end_period", data: { period: n } });
  const fin = (w) => ({ type: "finish", data: { winner: w } });
  const undo = { type: "undo" };
  const run = (events, config) => kb.compute(effectivePoints(events), { config });
  const KO = { halfMinutes: 15, knockout: true };
  const court = (s) => [s.onCourtA, s.onCourtB];
  const score = (s) => [s.scoreA, s.scoreB];

  // ---- a fresh match ----
  let k = run([]);
  assert.deepStrictEqual([k.scoreA, k.scoreB, k.half, k.halfName, k.status, k.winner], [0, 0, 1, "Half 1", "live", null]);
  assert.deepStrictEqual([k.onCourtA, k.onCourtB, k.players], [7, 7, 7]);
  assert.deepStrictEqual([k.halves, k.currentA, k.currentB, k.highlights, k.breakNow, k.lastRaid], [[], 0, 0, [], null, null]);
  assert.deepStrictEqual([k.timeoutsA, k.timeoutsB, k.needsTiebreak, k.knockout, k.halfMinutes], [0, 0, false, false, 15]);

  // ---- a safe raid: touch points, players out; the raiding team gets players back ----
  k = run([R("A", 2)]);
  assert.deepStrictEqual([score(k), court(k)], [[2, 0], [7, 5]], "2 touched: A +2, B down to 5 (A is full: nobody to bring back)");
  k = run([R("A", 2), R("B", 1)]);
  assert.deepStrictEqual([score(k), court(k)], [[2, 1], [6, 6]], "B puts 1 out and gets 1 player back");
  k = run([R("A", 3), R("B", 2)]);
  assert.deepStrictEqual(court(k), [5, 6], "revival: B has 4, puts 2 out, gets 2 back");
  assert.deepStrictEqual(k.lastRaid, { team: "B", out: 2, bonus: false, caught: false, raidPoints: 2, defencePoints: 0, superRaid: false, superTackle: false, allOut: false,
    doOrDie: false, doOrDieOut: false });

  // ---- empty raid: nothing changes ----
  k = run([EMPTY("A")]);
  assert.deepStrictEqual([score(k), court(k)], [[0, 0], [7, 7]]);
  assert.strictEqual(k.lastRaid.raidPoints, 0);

  // ---- bonus: +1, no revival; only when the defenders have 6 or more on court ----
  k = run([R("B", 2), R("A", 0, true)]);
  assert.deepStrictEqual([score(k), court(k)], [[1, 2], [5, 7]], "bonus gives a point but brings nobody back");
  k = run([R("A", 1), R("A", 0, true)]);
  assert.deepStrictEqual(score(k), [2, 0], "6 defenders on court: bonus allowed");
  const five = run([R("A", 2)]);
  assert.strictEqual(kb.validate(R("A", 0, true), five), "no bonus: Team B has fewer than 6 players on court");
  assert.strictEqual(kb.validate(R("A", 1, true), five), "no bonus: Team B has fewer than 6 players on court");
  k = run([R("A", 2, true)]);
  assert.deepStrictEqual([score(k), court(k)], [[3, 0], [7, 5]], "touch 2 + bonus = 3");

  // ---- raider caught: defenders +1, they get one player back; touched players are NOT out ----
  k = run([CAUGHT("A")]);
  assert.deepStrictEqual([score(k), court(k)], [[0, 1], [6, 7]]);
  k = run([R("A", 2), CAUGHT("A")]);
  assert.deepStrictEqual([score(k), court(k)], [[2, 1], [6, 6]], "B (5) catches the raider: +1 and one B player comes back");
  assert.strictEqual(kb.validate(R("A", 1, false, true), run([])), "raider caught: the players he touched are not out (enter 0 out)");
  // bonus + caught: the bonus stays (the referee gave it), the defenders get the tackle point
  k = run([CAUGHT("A", true)]);
  assert.deepStrictEqual([score(k), court(k)], [[1, 1], [6, 7]]);

  // ---- super tackle: 3 or fewer defenders catch the raider = 2 points, still only ONE player back ----
  const bDown3 = [R("A", 4)];                                 // B has 3 on court
  k = run([...bDown3, CAUGHT("A")]);
  assert.deepStrictEqual([score(k), court(k)], [[4, 2], [6, 4]], "super tackle: B +2, one B player back");
  assert.strictEqual(k.lastRaid.superTackle, true);
  assert.deepStrictEqual(k.highlights[0], { kind: "super_tackle", team: "B", points: 2, half: 1, scoreA: 4, scoreB: 2 });
  k = run([R("A", 3), CAUGHT("A")]);                          // B had 4: a normal tackle
  assert.deepStrictEqual([score(k), k.lastRaid.superTackle], [[3, 1], false], "4 defenders: normal tackle, 1 point");

  // ---- super raid: 3 or more points in one raid (raider safe); shown only, no extra points ----
  k = run([R("A", 3)]);
  assert.deepStrictEqual([score(k), k.lastRaid.superRaid], [[3, 0], true]);
  assert.deepStrictEqual(k.highlights, [{ kind: "super_raid", team: "A", points: 3, out: 3, bonus: false, half: 1, scoreA: 3, scoreB: 0 }]);
  k = run([R("A", 2, true)]);
  assert.strictEqual(k.lastRaid.superRaid, true, "2 touches + bonus = 3 points = super raid");
  assert.deepStrictEqual(run([R("A", 2)]).highlights, [], "2 points is a normal raid");
  assert.strictEqual(run([CAUGHT("A", true)]).lastRaid.superRaid, false);

  // ---- ALL OUT (lona): the last defender is out: +2 for the raiding team, the whole team comes back ----
  k = run([R("A", 7)]);
  assert.deepStrictEqual([score(k), court(k)], [[9, 0], [7, 7]], "7 touched + 2 all out; B back to 7");
  assert.strictEqual(k.lastRaid.allOut, true);
  assert.deepStrictEqual(k.highlights.map((h) => h.kind), ["all_out", "super_raid"], "newest first");
  k = run([R("A", 7, true)]);
  assert.deepStrictEqual(score(k), [10, 0], "the biggest raid: 7 + bonus 1 + all out 2 = 10 points");
  k = run([R("A", 5), R("A", 2)]);
  assert.deepStrictEqual([score(k), court(k)], [[9, 0], [7, 7]], "all out over two raids");
  // the raider's own team all out: the last raider on court is caught
  const aDown1 = [R("B", 6)];                                 // A has 1 on court
  k = run([...aDown1, CAUGHT("A")]);
  assert.deepStrictEqual([score(k), court(k)], [[0, 6 + 1 + 2], [7, 7]], "tackle 1 (B has 7: not super) + all out 2; A back to 7");
  assert.deepStrictEqual(k.highlights[0], { kind: "all_out", team: "B", points: 2, half: 1, scoreA: 0, scoreB: 9 });
  // super tackle AND all out together: B has 3, A has 1, A's last raider is caught
  k = run([R("A", 4), ...Array(6).fill(COURT("A", -1)), CAUGHT("A")]);     // B has 3, A has 1
  assert.deepStrictEqual([score(k), court(k)], [[4, 2 + 2], [7, 4]], "super tackle 2 + all out 2; A back to 7, one B player back");
  assert.deepStrictEqual(k.highlights.slice(0, 2).map((h) => [h.kind, h.team]), [["all_out", "B"], ["super_tackle", "B"]]);

  // ---- points by type (for the match page table): raid (touch + bonus), tackle, all out, technical, corrections ----
  const zero = { raid: 0, tackle: 0, allOut: 0, doOrDie: 0, technical: 0, correction: 0 };
  assert.deepStrictEqual(run([]).pointsBy, { A: zero, B: zero });
  k = run([CAUGHT("A", true), R("A", 2, true), R("A", 4), CAUGHT("A"), P("A", 1), P("B", 1), P("B", -1)]);
  // A: bonus 1 (raider caught), 2 out + bonus 3, 4 out 4 = raid 8; B: tackle 1, then super tackle 2 (B had 1 on court) = tackle 3
  assert.deepStrictEqual(k.pointsBy.A, { ...zero, raid: 8, technical: 1 });
  assert.deepStrictEqual(k.pointsBy.B, { ...zero, tackle: 3, technical: 1, correction: -1 });
  k = run([R("A", 7), R("B", 6), CAUGHT("A")]);
  assert.deepStrictEqual([k.pointsBy.A, k.pointsBy.B], [{ ...zero, raid: 7, allOut: 2 }, { ...zero, raid: 6, tackle: 1, allOut: 2 }],
    "all out points for both sides");
  assert.deepStrictEqual(k.highlights.slice(0, 1), [{ kind: "all_out", team: "B", points: 2, half: 1, scoreA: 9, scoreB: 9 }]);

  // ---- you cannot put out more players than are on court ----
  assert.strictEqual(kb.validate(R("A", 6), five), "Team B has only 5 players on court");
  assert.strictEqual(kb.validate(R("A", 5), five), null);
  for (const out of [-1, 8, 1.5, "2", null, undefined, true]) {
    assert.strictEqual(kb.validate({ type: "raid", data: { team: "A", out, bonus: false, caught: false } }, run([])), "players out must be a whole number from 0 to 7", "rejected out " + String(out));
  }
  for (const d of [null, [], "x", { team: "C", out: 0, bonus: false, caught: false }, { out: 0, bonus: false, caught: false }]) {
    assert.strictEqual(kb.validate({ type: "raid", data: d }, run([])), "bad team", "rejected raid " + JSON.stringify(d));
  }
  for (const flag of [undefined, null, 1, "yes"]) {
    assert.strictEqual(kb.validate({ type: "raid", data: { team: "A", out: 0, bonus: flag, caught: false } }, run([])), "bad raid");
    assert.strictEqual(kb.validate({ type: "raid", data: { team: "A", out: 0, bonus: false, caught: flag } }, run([])), "bad raid");
  }

  // ---- technical point and corrections ----
  k = run([P("A", 1)]);
  assert.deepStrictEqual([score(k), court(k)], [[1, 0], [7, 7]], "a technical point brings nobody back");
  assert.deepStrictEqual(k.highlights, [{ kind: "technical", team: "A", points: 1, half: 1, scoreA: 1, scoreB: 0 }]);
  k = run([R("A", 2), P("A", -1)]);
  assert.deepStrictEqual([score(k), court(k)], [[1, 0], [7, 5]], "a correction changes points only");
  assert.strictEqual(kb.validate(P("B", -1), run([])), "cannot take away 1 point: Team B has only 0");
  assert.strictEqual(kb.validate(P("A", -1), run([R("A", 1)])), null);
  for (const v of [0, 2, -2, 1.5, "1", null, undefined]) {
    assert.strictEqual(kb.validate(P("A", v), run([])), "points must be +1 (technical point) or -1 (correction)", "rejected value " + String(v));
  }
  assert.strictEqual(kb.validate(P("C", 1), run([])), "bad team");
  assert.strictEqual(run([P("A", -1)]).scoreA, 0, "a stored correction below 0 is ignored by compute");

  // ---- fix players on court (cards, injuries, a wrong entry): +1 / -1, stays 1 to 7, no points ----
  k = run([COURT("A", -1)]);
  assert.deepStrictEqual([score(k), court(k)], [[0, 0], [6, 7]]);
  assert.strictEqual(kb.validate(COURT("A", 1), run([])), "Team A already has 7 players on court");
  assert.strictEqual(kb.validate(COURT("B", -1), run([R("A", 6)])), "Team B must keep at least 1 player on court");
  assert.strictEqual(kb.validate(COURT("A", 1), run([COURT("A", -1)])), null);
  for (const c of [0, 2, -2, "1", null]) {
    assert.strictEqual(kb.validate(COURT("A", c), run([])), "change must be +1 or -1", "rejected change " + String(c));
  }
  assert.strictEqual(kb.validate({ type: "court", data: { team: "X", change: 1 } }, run([])), "bad team");
  assert.strictEqual(kb.validate({ type: "court", data: null }, run([])), "bad team");
  // a fix lowers the count, then bonus is not allowed any more
  assert.strictEqual(kb.validate(R("A", 0, true), run([COURT("B", -1), COURT("B", -1)])), "no bonus: Team B has fewer than 6 players on court");

  // ---- halves: the phone sends the half number, a second press cannot skip a half ----
  k = run([R("A", 2), END(1)]);
  assert.deepStrictEqual([k.half, k.halfName, k.halves, k.currentA, k.currentB], [2, "Half 2", [[2, 0]], 0, 0]);
  assert.deepStrictEqual(court(k), [7, 5], "players on court stay the same after half time (AKFI)");
  assert.deepStrictEqual(k.breakNow, { kind: "half_time" }, "half time is shown by itself");
  assert.strictEqual(kb.validate(END(1), k), "Half 1 has already ended");
  assert.strictEqual(kb.validate(END(2), k), null);
  assert.strictEqual(kb.validate(END(2), run([])), "Half 2 has not started yet");
  for (const bad of [undefined, 0, 3, -1, 1.5, "1", null, true]) {
    assert.strictEqual(kb.validate({ type: "end_period", data: { period: bad } }, run([])), "bad half number", "rejected half " + String(bad));
  }
  assert.strictEqual(kb.validate({ type: "end_period" }, run([])), "bad half number", "kabaddi pages always send the half");
  k = run([R("A", 2), END(1), R("B", 1)]);
  assert.deepStrictEqual([k.currentA, k.currentB, k.breakNow], [0, 1, null], "the first raid of half 2 ends half time");

  // ---- end of half 2: winner, draw (group), or tie-break (knockout) ----
  k = run([R("A", 2), END(1), R("B", 1), END(2)]);
  assert.deepStrictEqual([k.status, k.winner, k.ended, k.half, k.halves, k.breakNow], ["finished", "A", "normal", 2, [[2, 0], [0, 1]], null]);
  assert.strictEqual(k.resultText, "Team A won 2-1");
  k = run([R("B", 3), END(1), R("A", 1), END(2)]);
  assert.strictEqual(k.resultText, "Team B won 3-1", "the winner's score first");
  const levelEnd = [R("A", 1), R("B", 1), END(1), END(2)];
  k = run(levelEnd);
  assert.deepStrictEqual([k.status, k.winner, k.ended, k.resultText], ["finished", "draw", "draw", "Draw 1-1"], "group match level: draw");
  k = run(levelEnd, KO);
  assert.deepStrictEqual([k.status, k.winner, k.needsTiebreak, k.half], ["live", null, true, 2], "knockout level: tie-break needed");
  for (const a of [R("A", 1), P("A", 1), COURT("A", -1), TIMEOUT("A"), OVER, END(2), END(3)]) {
    assert.strictEqual(kb.validate(a, k), "the match is level: choose the tie-break winner", "refused during tie-break: " + JSON.stringify(a));
  }
  assert.strictEqual(kb.validate(fin("B"), k), null);
  k = run([...levelEnd, fin("B")], KO);
  assert.deepStrictEqual([k.status, k.winner, k.ended, score(k), k.needsTiebreak], ["finished", "B", "tiebreak", [1, 1], false]);
  assert.strictEqual(k.resultText, "Team B won on tie-break (1-1)");
  k = run([R("A", 1), END(1), END(2)], KO);
  assert.deepStrictEqual([k.status, k.winner], ["finished", "A"], "a knockout with a winner needs no tie-break");

  // ---- nothing counts after the match is over ----
  const done = [R("A", 2), END(1), END(2)];
  assert.deepStrictEqual(run([...done, R("B", 7), END(2), P("B", 1)]), run(done), "extra events are ignored");
  for (const a of [R("A", 1), P("A", 1), COURT("A", -1), TIMEOUT("A"), OTHER("Rain"), END(2), fin("A")]) {
    assert.strictEqual(kb.validate(a, run(done)), "match already finished");
  }

  // ---- walkover ----
  k = run([R("A", 2), fin("B")]);
  assert.deepStrictEqual([k.status, k.winner, k.ended, score(k)], ["finished", "B", "walkover", [2, 0]]);
  assert.strictEqual(k.resultText, "Team B won (walkover)");
  assert.strictEqual(kb.validate({ type: "finish" }, run([])), "choose the winner");
  assert.strictEqual(kb.validate(fin("draw"), run([])), "choose the winner");

  // ---- breaks: shown only, never scored ----
  k = run([TIMEOUT("A")]);
  assert.deepStrictEqual([k.breakNow, k.timeoutsA, k.timeoutsB], [{ kind: "timeout", team: "A" }, 1, 0]);
  k = run([TIMEOUT("A"), OVER]);
  assert.deepStrictEqual([k.breakNow, k.timeoutsA], [null, 1], "break over: the banner goes, the count stays");
  k = run([TIMEOUT("A"), R("B", 1)]);
  assert.strictEqual(k.breakNow, null, "a raid ends a break");
  k = run([TIMEOUT("B"), P("A", 1), COURT("A", -1)]);
  assert.deepStrictEqual(k.breakNow, { kind: "timeout", team: "B" }, "a technical point or a court fix happens during a break");
  k = run([TIMEOUT("A"), TIMEOUT("A"), TIMEOUT("A")]);
  assert.strictEqual(k.timeoutsA, 3, "a 3rd timeout is counted (the scorer page warns, the app does not block)");
  k = run([TIMEOUT("A"), TIMEOUT("B"), END(1)]);
  assert.deepStrictEqual([k.timeoutsA, k.timeoutsB, k.breakNow], [0, 0, { kind: "half_time" }], "timeouts count per half");
  k = run([OTHER("  Rain   delay ")]);
  assert.deepStrictEqual(k.breakNow, { kind: "other", text: "Rain delay" });
  assert.strictEqual(kb.validate(OVER, run([])), "no break is on");
  assert.strictEqual(kb.validate(OVER, run([END(1)])), null, "half time can be ended with Break over");
  assert.strictEqual(run([END(1), OVER]).breakNow, null);
  assert.strictEqual(kb.validate(TIMEOUT("C"), run([])), "bad team");
  for (const t of ["", "   ", "x".repeat(41), "<script>", "a\nb", 5, null, undefined, "tea & coffee"]) {
    assert.strictEqual(kb.validate(OTHER(t), run([])), "break text: 1 to 40 letters, numbers, spaces and . , ' ! ? : ( ) / -", "rejected text " + JSON.stringify(t));
  }
  for (const t of ["Water break", "Tea break", "Injury (CSE)", "Rain - wait 10 min", "पानी"]) {
    assert.strictEqual(kb.validate(OTHER(t), run([])), null, "allowed text " + t);
  }
  assert.strictEqual(kb.validate({ type: "break", data: { kind: "nap" } }, run([])), "bad break");
  assert.strictEqual(kb.validate({ type: "break" }, run([])), "bad break");

  // ---- unknown actions ----
  for (const a of [{ type: "ball", data: {} }, { type: "end_innings" }, { type: "toss", data: { winner: "A", choice: "bat" } }]) {
    assert.strictEqual(kb.validate(a, run([])), "unknown action");
  }

  // ---- undo ----
  k = run([R("A", 7), undo]);
  assert.deepStrictEqual([score(k), court(k), k.highlights], [[0, 0], [7, 7], []], "undo of an all-out raid");
  k = run([R("A", 2), END(1), undo]);
  assert.deepStrictEqual([k.half, k.currentA, k.breakNow], [1, 2, null], "undo of End half reopens half 1");
  k = run([...done, undo]);
  assert.deepStrictEqual([k.status, k.half], ["live", 2], "undo of End half 2 reopens the match");
  k = run([...levelEnd, fin("A"), undo], KO);
  assert.deepStrictEqual([k.status, k.needsTiebreak], ["live", true], "undo of the tie-break winner");
  k = run([TIMEOUT("A"), undo]);
  assert.deepStrictEqual([k.breakNow, k.timeoutsA], [null, 0]);

  // ---- the cleaned copy that is stored (never the raw input) ----
  assert.deepStrictEqual(kb.clean({ type: "raid", data: { team: "A", out: 2, bonus: true, caught: false, junk: "x".repeat(100) } }),
    { team: "A", out: 2, bonus: true, caught: false });
  assert.strictEqual(kb.clean({ type: "raid", data: { team: "A", out: 9, bonus: false, caught: false } }), null);
  assert.deepStrictEqual(kb.clean(COURT("B", -1)), { team: "B", change: -1 });
  assert.deepStrictEqual(kb.clean(TIMEOUT("A")), { kind: "timeout", team: "A" });
  assert.deepStrictEqual(kb.clean({ type: "break", data: { kind: "timeout", team: "A", text: "x" } }), { kind: "timeout", team: "A" });
  assert.deepStrictEqual(kb.clean(OTHER(" Tea  break ")), { kind: "other", text: "Tea break" });
  assert.deepStrictEqual(kb.clean({ type: "break", data: { kind: "over", team: "A" } }), { kind: "over" });
  assert.deepStrictEqual(kb.clean(END(2)), { period: 2 });
  assert.deepStrictEqual(kb.clean({ type: "finish", data: { winner: "A", x: 1 } }), { winner: "A" });
  assert.strictEqual(kb.clean(P("A", 1)), null, "a point stores team and value in their own columns");
  // compute ignores a broken stored row instead of crashing
  k = kb.compute([{ type: "raid", data: null }, { type: "raid", data: { team: "A", out: 99 } }, { type: "court", data: {} }, { type: "break", data: null }], {});
  assert.deepStrictEqual([score(k), court(k), k.breakNow], [[0, 0], [7, 7], null]);

  // ---- match settings: half minutes (shown only) and knockout (decides draw vs tie-break) ----
  const def = { halfMinutes: 15, knockout: false };
  assert.deepStrictEqual(kb.normalizeConfig(undefined), def);
  assert.deepStrictEqual(kb.normalizeConfig({ halfMinutes: 10, knockout: true, hack: 1 }), { halfMinutes: 10, knockout: true });
  assert.deepStrictEqual(kb.normalizeConfig({ halfMinutes: 0 }), def, "invalid settings fall back to the defaults");
  assert.deepStrictEqual(kb.normalizeConfig([1]), def);
  assert.strictEqual(kb.checkConfig(def), null);
  for (const c of [null, [], { ...def, halfMinutes: 31 }, { ...def, halfMinutes: "15" }, { ...def, knockout: "yes" }, { halfMinutes: 15 }]) {
    assert.strictEqual(typeof kb.checkConfig(c), "string", "rejected: " + JSON.stringify(c));
  }
  assert.strictEqual(run([], { halfMinutes: 10, knockout: false }).halfMinutes, 10);

  // ---- college rule: Boys 15 / Girls 10; only the FINAL is longer: Boys 20 / Girls 15 ----
  assert.strictEqual(kb.collegeHalfMinutes("boys", "group"), 15);
  assert.strictEqual(kb.collegeHalfMinutes("boys", "quarter_final"), 15);
  assert.strictEqual(kb.collegeHalfMinutes("boys", "semi_final"), 15);
  assert.strictEqual(kb.collegeHalfMinutes("boys", "final"), 20);
  assert.strictEqual(kb.collegeHalfMinutes("girls", "group"), 10);
  assert.strictEqual(kb.collegeHalfMinutes("girls", "semi_final"), 10);
  assert.strictEqual(kb.collegeHalfMinutes("girls", "final"), 15);
  assert.strictEqual(kb.collegeHalfMinutes("", "final"), 20, "no category (scripts): the Boys numbers");
  assert.strictEqual(kb.isKnockoutStage("group"), false);
  for (const s of ["quarter_final", "semi_final", "final", "knockout"]) assert.strictEqual(kb.isKnockoutStage(s), true, s);
  assert.strictEqual(kb.isKnockoutStage("toString"), false);
  assert.strictEqual(kb.isKnockoutStage(undefined), false);

  // ---- result() and headline() ----
  const nm = { A: "CSE", B: "ECE" };
  k = run([R("A", 2), CAUGHT("A")]);
  assert.deepStrictEqual(kb.result(k), { finished: false, winner: null, forA: 2, forB: 1 });
  assert.strictEqual(kb.headline(k, nm), "CSE 2-1 ECE (H1)");
  assert.strictEqual(kb.headline(run([R("A", 2), END(1)]), nm), "CSE 2-0 ECE (half time)");
  assert.strictEqual(kb.headline(run([R("A", 2), END(1), R("B", 1)]), nm), "CSE 2-1 ECE (H2)");
  assert.strictEqual(kb.headline(run(done), nm), "CSE 2-0 ECE");
  assert.strictEqual(kb.headline(run(levelEnd), nm), "CSE 1-1 ECE (draw)");
  assert.deepStrictEqual(kb.result(run(levelEnd)), { finished: true, winner: "draw", forA: 1, forB: 1 });
  assert.strictEqual(kb.headline(run(levelEnd, KO), nm), "CSE 1-1 ECE (tie-break)");
  assert.strictEqual(kb.headline(run([...levelEnd, fin("A")], KO), nm), "CSE won on tie-break, 1-1");
  assert.strictEqual(kb.headline(run([R("A", 2), fin("B")]), nm), "ECE won (walkover), 2-0");

  // ---- points table: win 2, draw 1, loss 0; forA / forB are points ----
  const kbDone = (a, c, evs) => ({ stage: "group", competition: "", sport: "kabaddi", category: "girls", teamA: a, teamB: c, result: kb.result(run(evs)) });
  const table = buildStandings([
    kbDone("CSE", "ECE", [R("A", 3), END(1), END(2)]),          // CSE 3-0
    kbDone("ECE", "ME", levelEnd),                              // draw 1-1
    kbDone("ME", "CSE", [R("A", 1), END(1)]),                   // not finished: ignored
  ]);
  assert.strictEqual(table.length, 1);
  assert.strictEqual(table[0].name, "Kabaddi (Girls)");
  const rows = Object.fromEntries(table[0].rows.map((r) => [r.team, r]));
  assert.deepStrictEqual([rows.CSE.points, rows.CSE.won, rows.CSE.diff], [2, 1, 3]);
  assert.deepStrictEqual([rows.ECE.points, rows.ECE.drawn, rows.ECE.lost], [1, 1, 1]);
  assert.deepStrictEqual([rows.ME.points, rows.ME.drawn], [1, 1]);

  // ---- do-or-die raid: after 2 EMPTY raids in a row by a team, its next raid must score (touch or bonus) ----
  const START = (team) => ({ type: "raid_start", data: { team } });
  const CANCEL = { type: "raid_start", data: { cancel: true } };
  k = run([EMPTY("A"), EMPTY("B")]);
  assert.deepStrictEqual([k.emptyRaidsA, k.emptyRaidsB, k.doOrDieA, k.doOrDieB], [1, 1, false, false]);
  k = run([EMPTY("A"), EMPTY("B"), EMPTY("A")]);
  assert.deepStrictEqual([k.emptyRaidsA, k.doOrDieA, k.doOrDieB], [2, true, false], "counted per team");
  assert.strictEqual(run([EMPTY("A"), P("A", 1), EMPTY("A")]).doOrDieA, true, "a technical point is not a raid");
  assert.strictEqual(run([EMPTY("A"), R("B", 1), EMPTY("A")]).doOrDieA, true, "the other team's raids do not reset it");
  assert.strictEqual(run([EMPTY("A"), CAUGHT("A"), EMPTY("A")]).emptyRaidsA, 1, "a caught raider is not an empty raid (the defenders scored)");
  assert.strictEqual(run([EMPTY("A"), R("A", 0, true), EMPTY("A")]).emptyRaidsA, 1, "a bonus is not an empty raid");
  const dod = [EMPTY("A"), EMPTY("B"), EMPTY("A"), EMPTY("B")];         // both teams: the next raid is do-or-die
  // FAILED (empty again): raider OUT, defenders +1, one defender back; the count starts again
  k = run([R("A", 2), ...dod, EMPTY("A")]);
  assert.deepStrictEqual([score(k), court(k)], [[2, 1], [6, 6]], "B (5) gets 1 point and 1 player back; A loses the raider");
  assert.deepStrictEqual(k.lastRaid, { team: "A", out: 0, bonus: false, caught: false, raidPoints: 0, defencePoints: 1,
    superRaid: false, superTackle: false, allOut: false, doOrDie: true, doOrDieOut: true });
  assert.deepStrictEqual(k.highlights[0], { kind: "do_or_die_out", team: "B", points: 1, half: 1, scoreA: 2, scoreB: 1 });
  assert.deepStrictEqual([k.emptyRaidsA, k.doOrDieA, k.doOrDieB], [0, false, true]);
  assert.deepStrictEqual(k.pointsBy.B, { ...zero, doOrDie: 1 });
  k = run([R("A", 4), ...dod, EMPTY("A")]);                             // B has 3 on court
  assert.deepStrictEqual([k.scoreB, k.lastRaid.superTackle], [1, false], "never a super tackle: the raider was not tackled");
  k = run([...Array(6).fill(COURT("A", -1)), ...dod, EMPTY("A")]);      // A's last player fails the do-or-die
  assert.deepStrictEqual([score(k), court(k), k.lastRaid.allOut], [[0, 3], [7, 7], true], "do-or-die out 1 + ALL OUT 2");
  assert.deepStrictEqual(k.highlights.slice(0, 2).map((h) => h.kind), ["all_out", "do_or_die_out"]);
  // SUCCESS: a touch or a bonus saves it
  k = run([...dod, R("A", 2)]);
  assert.deepStrictEqual([k.lastRaid.doOrDie, k.lastRaid.doOrDieOut, k.emptyRaidsA], [true, false, 0]);
  assert.deepStrictEqual(k.highlights[0], { kind: "do_or_die", team: "A", points: 2, half: 1, scoreA: 2, scoreB: 0 });
  k = run([...dod, R("A", 0, true)]);
  assert.deepStrictEqual([score(k), k.highlights[0].kind, k.highlights[0].points], [[1, 0], "do_or_die", 1], "a bonus alone saves it");
  // tackled in a do-or-die raid: a normal tackle (no do-or-die moment)
  k = run([...dod, CAUGHT("A")]);
  assert.deepStrictEqual([score(k), k.highlights.length, k.emptyRaidsA, k.lastRaid.doOrDie, k.lastRaid.doOrDieOut], [[0, 1], 0, 0, true, false]);
  // the count restarts at half time
  k = run([...dod, END(1)]);
  assert.deepStrictEqual([k.emptyRaidsA, k.emptyRaidsB, k.doOrDieA, k.doOrDieB], [0, 0, false, false]);
  // undo of a failed do-or-die brings the do-or-die back
  k = run([...dod, EMPTY("A"), undo]);
  assert.deepStrictEqual([score(k), k.doOrDieA, k.emptyRaidsA], [[0, 0], true, 2]);

  // ---- RAID STARTED: shown live, never scored; ended by the raid, END HALF, a break, or Cancel ----
  assert.strictEqual(run([]).raidingNow, null);
  assert.deepStrictEqual(run([START("A")]).raidingNow, { team: "A", doOrDie: false, superTackleChance: false, defenders: 7 });
  assert.deepStrictEqual(run([...dod, START("B")]).raidingNow, { team: "B", doOrDie: true, superTackleChance: false, defenders: 7 });
  assert.deepStrictEqual(run([R("A", 4), START("A")]).raidingNow, { team: "A", doOrDie: false, superTackleChance: true, defenders: 3 },
    "B has 3: a tackle would be a SUPER TACKLE");
  assert.deepStrictEqual(run([START("A"), START("B")]).raidingNow.team, "B", "tapping the other team changes it");
  for (const after of [R("A", 1), END(1), TIMEOUT("B"), CANCEL]) {
    assert.strictEqual(run([START("A"), after]).raidingNow, null, "ended by " + JSON.stringify(after));
  }
  assert.strictEqual(run([START("A"), P("B", 1), COURT("A", -1)]).raidingNow.team, "A", "a technical point or a court fix does not end it");
  k = run([START("A")]);
  assert.deepStrictEqual([score(k), court(k), k.emptyRaidsA], [[0, 0], [7, 7], 0], "a raid start changes nothing else");
  assert.strictEqual(kb.validate(START("A"), run([])), null);
  assert.strictEqual(kb.validate(START("C"), run([])), "bad team");
  assert.strictEqual(kb.validate({ type: "raid_start", data: null }, run([])), "bad team");
  assert.strictEqual(kb.validate(CANCEL, run([])), "no raid has started");
  assert.strictEqual(kb.validate(CANCEL, run([START("B")])), null);
  assert.strictEqual(kb.validate(START("A"), run(done)), "match already finished");
  assert.strictEqual(kb.validate(START("A"), run(levelEnd, KO)), "the match is level: choose the tie-break winner");
  assert.deepStrictEqual(kb.clean({ type: "raid_start", data: { team: "B", junk: 1 } }), { team: "B" });
  assert.deepStrictEqual(kb.clean({ type: "raid_start", data: { cancel: true, team: "A" } }), { cancel: true });
  assert.strictEqual(kb.clean({ type: "raid_start", data: { team: "X" } }), null);
  // UNDO never takes back a raid start: it takes back the newest SCORING entry
  k = run([R("A", 2), START("B"), undo]);
  assert.deepStrictEqual([score(k), k.raidingNow && k.raidingNow.team], [[0, 0], "B"], "UNDO removed the raid, not the raid start");

  // ---- random matches: 400 games, the rules checked after EVERY event ----
  const rand = rng(2028);
  const pick = (n) => Math.floor(rand() * n);
  let finished = 0, undos = 0, allOuts = 0, superTackles = 0, bonuses = 0, refused = 0, tiebreaks = 0, draws = 0, dodOut = 0, dodWin = 0, starts = 0;
  // UNDO takes back the newest entry that is not a raid start (the same rule as effectivePoints)
  const undoKept = (kept) => { for (let i = kept.length - 1; i >= 0; i--) if (kept[i].type !== "raid_start") { kept.splice(i, 1); return true; } return false; };
  for (let g = 0; g < 400; g++) {
    const config = { halfMinutes: 15, knockout: g % 2 === 0 };
    const events = [];
    const kept = [];
    let state = run(events, config);
    for (let step = 0; step < 4000 && state.status !== "finished"; step++) {
      const x = rand();
      let e;
      if (state.needsTiebreak) {
        e = fin(rand() < 0.5 ? "A" : "B"); tiebreaks++;
      } else if (kept.some((ev) => ev.type !== "raid_start") && x < 0.06) {
        events.push(undo); undoKept(kept); undos++;
        state = run(events, config);
        continue;
      } else if (x < 0.1) {
        // something the rules forbid must be refused (and then not stored)
        const t = rand() < 0.5 ? "A" : "B";
        const def = t === "A" ? state.onCourtB : state.onCourtA;
        const tries = [R(t, def + 1), R(t, 1, false, true), END(state.half + 1)];
        if (state.half > 1) tries.push(END(state.half - 1));
        if (def < 6) tries.push(R(t, 0, true));
        if (!state.breakNow) tries.push(OVER);
        for (const bad of tries) assert.strictEqual(typeof kb.validate(bad, state), "string", "refused: " + JSON.stringify(bad));
        refused++;
        continue;
      } else if (x < 0.13) {
        e = [P("A", 1), P("B", 1), P("A", -1), COURT("B", -1), COURT("A", 1), TIMEOUT("A"), OTHER("Water break"), OVER][pick(8)];
        if (kb.validate(e, state) !== null) continue;          // e.g. a correction at 0, a full court, no break on
      } else if (x < 0.145) {
        e = END(state.half);
      } else if (x < 0.2) {
        e = rand() < 0.15 && state.raidingNow ? CANCEL : START(rand() < 0.5 ? "A" : "B"); starts++;
      } else {
        const t = rand() < 0.5 ? "A" : "B";
        const def = t === "A" ? state.onCourtB : state.onCourtA;
        const caught = rand() < 0.35;
        const bonus = def >= 6 && rand() < 0.15;
        const empty = !caught && !bonus && rand() < 0.4;               // plenty of empty raids: do-or-die must happen
        e = R(t, caught || empty ? 0 : pick(Math.min(def, 3) + 1), bonus, caught);
        if (bonus) bonuses++;
      }
      assert.strictEqual(kb.validate(e, state), null, "allowed: " + JSON.stringify(e));
      const before = state;
      events.push(e); kept.push(e);
      state = run(events, config);

      // the rules, every time
      assert.deepStrictEqual(state, kb.compute(kept, { config }), "undo equals a fresh replay");
      for (const n of [state.emptyRaidsA, state.emptyRaidsB]) assert.ok(n >= 0 && n <= 2, "empty raids 0 to 2");
      for (const n of [state.onCourtA, state.onCourtB]) assert.ok(Number.isInteger(n) && n >= 1 && n <= 7, "on court 1 to 7, not " + n);
      assert.ok(state.scoreA >= 0 && state.scoreB >= 0, "a score is never below 0");
      const sumA = state.halves.reduce((t, h) => t + h[0], 0) + state.currentA;
      const sumB = state.halves.reduce((t, h) => t + h[1], 0) + state.currentB;
      assert.deepStrictEqual([sumA, sumB], score(state), "half scores add up to the total");
      const by = (t) => Object.values(state.pointsBy[t]).reduce((a, b) => a + b, 0);
      assert.deepStrictEqual([by("A"), by("B")], score(state), "points by type add up to the total");
      for (const h of state.highlights) assert.ok(Number.isInteger(h.points) && h.points >= 1, "every moment has its points");
      if (e.type === "raid") {
        const gained = state.scoreA + state.scoreB - before.scoreA - before.scoreB;
        assert.ok(gained >= 0 && gained <= 10, "one raid gives at most 10 points");
        if (state.lastRaid.allOut) allOuts++;
        const was = e.data.team === "A" ? before.doOrDieA : before.doOrDieB;
        assert.strictEqual(state.lastRaid.doOrDie, was, "the raid is do-or-die exactly when the team had 2 empty raids");
        const isEmpty = !e.data.caught && e.data.out === 0 && !e.data.bonus;
        assert.strictEqual(state.lastRaid.doOrDieOut, was && isEmpty, "do-or-die OUT exactly when the do-or-die raid is empty");
        if (state.lastRaid.doOrDieOut) dodOut++;
        else if (was && !e.data.caught) dodWin++;
        assert.strictEqual(state.raidingNow, null, "a raid ends the raid start");
        if (state.lastRaid.superTackle) {
          superTackles++;
          assert.ok((e.data.team === "A" ? before.onCourtB : before.onCourtA) <= 3, "super tackle only with 3 or fewer defenders");
        }
      }
      if (state.status === "finished" && state.ended !== "walkover") {
        assert.strictEqual(state.halves.length, 2);
        if (state.scoreA === state.scoreB) {
          if (config.knockout) assert.strictEqual(state.ended, "tiebreak");
          else { assert.strictEqual(state.winner, "draw"); draws++; }
        } else {
          assert.strictEqual(state.winner, state.scoreA > state.scoreB ? "A" : "B");
        }
      }
    }
    if (state.status === "finished") finished++;
  }
  assert.ok(finished >= 390, "almost all random matches finish (" + finished + ")");
  assert.ok(undos > 500, "the random test really used undo (" + undos + ")");
  assert.ok(allOuts > 100, "the random test really reached ALL OUT (" + allOuts + ")");
  assert.ok(superTackles > 50, "the random test really had super tackles (" + superTackles + ")");
  assert.ok(bonuses > 100, "the random test really used bonus points (" + bonuses + ")");
  assert.ok(refused > 300, "the random test really tried forbidden actions (" + refused + ")");
  assert.ok(tiebreaks > 0, "the random test really reached a knockout tie-break (" + tiebreaks + ")");
  assert.ok(dodOut > 50 && dodWin > 50, "the random test really had failed and saved do-or-die raids (" + dodOut + ", " + dodWin + ")");
  assert.ok(starts > 500, "the random test really used raid starts (" + starts + ")");
  assert.ok(draws > 0, "the random test really reached a group draw (" + draws + ")");
};
