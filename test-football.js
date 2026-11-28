// Football engine tests (IFAB Laws + the college's choices). Called from test.js.
// Pure: no database, no server.
const assert = require("assert");
const { effectivePoints, canUndo } = require("./engine");
const { getEngine } = require("./engines");
const { buildStandings } = require("./standings");
const fbModule = require("./engines/football");

// small random number generator with a seed (same games every run)
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

module.exports = function testFootball() {
  const fb = getEngine("football");
  assert.ok(fb, "the registry returns the football engine");

  // ---- helpers (seq is given like the database does: 1, 2, 3 ... in order) ----
  const KO = (n = 1) => ({ type: "period_start", data: { period: n } });
  const END = (n) => ({ type: "end_period", data: { period: n } });
  const G = (team, shirt = 9, kind = "normal", name) => ({ type: "goal", data: { team, kind, shirt, ...(name !== undefined ? { name } : {}) } });
  const PS = (team) => ({ type: "penalty_start", data: { team } });
  const PCANCEL = { type: "penalty_start", data: { cancel: true } };
  const PEN = (team, outcome, shirt) => ({ type: "penalty", data: { team, outcome, ...(shirt ? { shirt } : {}) } });
  const CARD = (team, color, shirt = 4, name) => ({ type: "card", data: { team, color, shirt, ...(name ? { name } : {}) } });
  const ET = { type: "extra_time" };
  const SO = (kicks, first) => ({ type: "shootout_start", data: { kicks, first } });
  const K = (team, outcome) => ({ type: "kick", data: { team, outcome } });
  const RM = (seq) => ({ type: "remove", data: { seq } });
  const fin = (w) => ({ type: "finish", data: { winner: w } });
  const undo = { type: "undo" };
  const withSeq = (events) => events.map((e, i) => ({ seq: i + 1, ...e }));
  const GROUP = { halfMinutes: 15, players: 6, knockout: false };
  const KNOCK = { halfMinutes: 7, players: 5, knockout: true };
  const run = (events, config = GROUP) => fb.compute(effectivePoints(withSeq(events)), { config });
  const score = (s) => [s.scoreA, s.scoreB];
  // the validate answer for the next action after these events
  const check = (events, action, config = GROUP) => fb.validate(action, run(events, config));
  // a full regulation match: kick-off, goals of half 1, end, kick-off, goals of half 2, end
  const match = (h1 = [], h2 = []) => [KO(1), ...h1, END(1), KO(2), ...h2, END(2)];

  // ---- college settings ----
  assert.deepStrictEqual([fbModule.collegeHalfMinutes("boys"), fbModule.collegePlayers("boys")], [15, 6], "Boys: 6-a-side, 15 min halves");
  assert.deepStrictEqual([fbModule.collegeHalfMinutes("girls"), fbModule.collegePlayers("girls")], [7, 5], "Girls: 5-a-side, 7 min halves");
  assert.ok(fbModule.isKnockoutStage("semi_final") && fbModule.isKnockoutStage("final") && !fbModule.isKnockoutStage("group"));
  assert.strictEqual(fb.checkConfig(GROUP), null);
  assert.ok(fb.checkConfig({ ...GROUP, halfMinutes: 0 }) && fb.checkConfig({ ...GROUP, players: 2 }) && fb.checkConfig({ ...GROUP, knockout: "yes" }));
  assert.deepStrictEqual(fb.normalizeConfig(null), { halfMinutes: 15, players: 6, knockout: false });
  assert.deepStrictEqual(fb.normalizeConfig({ halfMinutes: 99 }), { halfMinutes: 15, players: 6, knockout: false }, "bad settings -> defaults");

  // ---- a fresh match: nothing has kicked off ----
  let s = run([]);
  assert.deepStrictEqual([score(s), s.period, s.periodName, s.kickedOff, s.playing, s.status, s.winner, s.breakNow],
    [[0, 0], 1, "1st half", false, false, "live", null, null]);
  assert.deepStrictEqual([s.goals, s.cards, s.penalties, s.highlights, s.shootout, s.needsDecision, s.removable], [[], [], [], [], null, false, []]);
  assert.strictEqual(check([], G("A")), "tap KICK-OFF first", "no goal before the kick-off");
  assert.strictEqual(check([], END(1)), "1st half has not kicked off yet");
  assert.strictEqual(check([], KO(2)), "2nd half cannot start yet");
  assert.strictEqual(check([], KO(1)), null);

  // ---- kick-off and goals ----
  s = run([KO(1)]);
  assert.deepStrictEqual([s.kickedOff, s.playing], [true, true]);
  assert.strictEqual(check([KO(1)], KO(1)), "1st half has already kicked off", "a double KICK-OFF tap is refused");
  s = run([KO(1), G("A", 9, "normal", "Rahul"), G("B", 7, "free_kick"), G("A", 4, "own_goal")]);
  assert.deepStrictEqual(score(s), [2, 1]);
  assert.deepStrictEqual(s.goals, [
    { seq: 2, team: "A", kind: "normal", shirt: 9, name: "Rahul", period: 1, scoreA: 1, scoreB: 0 },
    { seq: 3, team: "B", kind: "free_kick", shirt: 7, period: 1, scoreA: 1, scoreB: 1 },
    { seq: 4, team: "A", kind: "own_goal", shirt: 4, period: 1, scoreA: 2, scoreB: 1 },
  ], "every goal with its player, half and the score after it");
  assert.deepStrictEqual(s.highlights.map((h) => [h.kind, h.team, h.goalKind, h.seq]),
    [["goal", "A", "own_goal", 4], ["goal", "B", "free_kick", 3], ["goal", "A", "normal", 2]], "newest first");
  assert.deepStrictEqual([s.currentA, s.currentB], [2, 1]);

  // goal checks
  assert.strictEqual(check([KO(1)], G("C")), "bad team");
  assert.strictEqual(check([KO(1)], { type: "goal", data: { team: "A", kind: "header", shirt: 9 } }), "choose the kind of goal");
  assert.strictEqual(check([KO(1)], G("A", 0)), "shirt number must be 1 to 999");
  assert.strictEqual(check([KO(1)], G("A", 1000)), "shirt number must be 1 to 999");
  assert.strictEqual(check([KO(1)], G("A", 9.5)), "shirt number must be 1 to 999");
  assert.strictEqual(check([KO(1)], G("A", 9, "normal", "<script>")), "name: up to 20 letters, numbers, spaces and . ' -");
  assert.strictEqual(check([KO(1)], G("A", 9, "normal", "x".repeat(21))), "name: up to 20 letters, numbers, spaces and . ' -");
  assert.strictEqual(check([KO(1)], G("A", 9, "normal", "D'Souza Jr. Ravi-K")), null);
  assert.strictEqual(check([KO(1)], G("A", 9, "normal", "")), null, "an empty name is no name");
  assert.strictEqual(check([KO(1)], G("A", 9, "normal", "रवि")), null, "Hindi letters are fine");
  assert.deepStrictEqual(fb.clean(G("A", 9, "normal", "  Ravi   Kumar ")), { team: "A", kind: "normal", shirt: 9, name: "Ravi Kumar" });
  assert.deepStrictEqual(fb.clean(G("A", 9, "normal", "   ")), { team: "A", kind: "normal", shirt: 9 });
  assert.deepStrictEqual(fb.clean({ type: "goal", data: { team: "A", kind: "normal", shirt: 9, extra: "x" } }), { team: "A", kind: "normal", shirt: 9 },
    "only the known fields are stored");

  // ---- halves: half time, END HALF double press, second kick-off ----
  s = run([KO(1), G("A"), END(1)]);
  assert.deepStrictEqual([s.period, s.periodName, s.playing, s.breakNow, s.halves], [2, "2nd half", false, { kind: "half_time" }, [[1, 0]]]);
  assert.strictEqual(check([KO(1), END(1)], END(1)), "1st half has already ended", "a double END HALF tap cannot end half 2");
  assert.strictEqual(check([KO(1), END(1)], END(2)), "2nd half has not kicked off yet");
  assert.strictEqual(check([KO(1), END(1)], G("A")), "the half has not kicked off: tap KICK-OFF first", "no goal at half time");
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-0 ECE (half time)");
  s = run([KO(1), G("A"), END(1), KO(2)]);
  assert.deepStrictEqual([s.breakNow, s.playing, s.currentA], [null, true, 0], "the 2nd half kicked off: banner gone, this half 0-0");
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-0 ECE (H2)");
  assert.strictEqual(fb.headline(run([]), { A: "CSE", B: "ECE" }), "CSE 0-0 ECE");

  // ---- full time: win, group draw ----
  s = run(match([G("A")], [G("B"), G("B")]));
  assert.deepStrictEqual([score(s), s.status, s.winner, s.ended, s.resultText, s.halves], [[1, 2], "finished", "B", "normal", "Team B won 2-1", [[1, 0], [0, 2]]]);
  assert.strictEqual(check(match(), G("A")), "match already finished");
  s = run(match([G("A")], [G("B")]));
  assert.deepStrictEqual([s.winner, s.ended, s.resultText, s.periodName], ["draw", "draw", "Draw 1-1", "2nd half"]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-1 ECE (draw)");
  assert.deepStrictEqual(fb.result(s), { finished: true, winner: "draw", forA: 1, forB: 1 });

  // ---- knockout level: the scorer decides ----
  const level = match([G("A")], [G("B")]);
  s = run(level, KNOCK);
  assert.deepStrictEqual([s.status, s.needsDecision, s.canExtraTime, s.breakNow, s.periodName], ["live", true, true, { kind: "full_time" }, "2nd half"]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-1 ECE (full time)");
  assert.strictEqual(check(level, G("A"), KNOCK), "the match is level: choose extra time or the penalty shootout");
  assert.strictEqual(check(level, KO(3), KNOCK), "the match is level: choose extra time or the penalty shootout");
  assert.strictEqual(check(level, SO(4, "A"), KNOCK), "choose 3 or 5 kicks");
  assert.strictEqual(check(level, SO(5, "X"), KNOCK), "choose who kicks first");
  assert.strictEqual(check(level, ET, KNOCK), null);
  assert.strictEqual(check(level, CARD("A", "red"), KNOCK), null, "a card at full time is still allowed");
  assert.strictEqual(check([KO(1)], ET, KNOCK), "only when a knockout match is level at full time");
  assert.strictEqual(check([KO(1)], K("A", "scored"), KNOCK), "no penalty shootout is on");

  // extra time kicks off at once; extra time half time; a winner after extra time
  s = run([...level, ET], KNOCK);
  assert.deepStrictEqual([s.period, s.periodName, s.isExtraTime, s.playing, s.needsDecision, s.breakNow], [3, "Extra time 1st half", true, true, false, null]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-1 ECE (extra time)");
  s = run([...level, ET, G("B"), END(3)], KNOCK);
  assert.deepStrictEqual([s.period, s.periodName, s.playing, s.breakNow], [4, "Extra time 2nd half", false, { kind: "extra_time_half_time" }]);
  s = run([...level, ET, G("B"), END(3), KO(4), END(4)], KNOCK);
  assert.deepStrictEqual([s.winner, s.ended, s.resultText, s.halves.length], ["B", "extra_time", "Team B won 2-1 after extra time", 4]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-2 ECE (after extra time)");
  // still level after extra time: only the shootout
  const levelET = [...level, ET, END(3), KO(4), END(4)];
  s = run(levelET, KNOCK);
  assert.deepStrictEqual([s.needsDecision, s.canExtraTime, s.periodName], [true, false, "Extra time 2nd half"]);
  assert.strictEqual(check(levelET, ET, KNOCK), "extra time was already played: start the penalty shootout");
  assert.strictEqual(check(levelET, SO(5, "B"), KNOCK), null);
  // extra_time stored twice (a broken old row) does nothing the second time
  assert.strictEqual(run([...levelET, ET], KNOCK).needsDecision, true);

  // ---- the penalty shootout ----
  const shoot = (kicks, first, list) => run([...level, SO(kicks, first), ...list], KNOCK);
  s = shoot(5, "B", []);
  assert.deepStrictEqual([s.shootout, s.needsDecision, s.breakNow, s.removable], [{ kicks: 5, first: "B", A: [], B: [], scoreA: 0, scoreB: 0, next: "B", suddenDeath: false }, false, null, []]);
  assert.strictEqual(check([...level, SO(5, "B")], K("A", "scored"), KNOCK), "it is Team B's kick", "they kick in turn: B first");
  assert.strictEqual(check([...level, SO(5, "B")], K("B", "goal"), KNOCK), "choose scored, saved or missed");
  assert.strictEqual(check([...level, SO(5, "B")], G("B"), KNOCK), "the penalty shootout is on: enter the kicks");
  assert.strictEqual(check([...level, SO(5, "B")], CARD("B", "red"), KNOCK), "the penalty shootout is on: enter the kicks");
  assert.strictEqual(check([...level, SO(5, "B")], K("B", "saved"), KNOCK), null);
  s = shoot(5, "B", [K("B", "scored"), K("A", "saved")]);
  assert.deepStrictEqual([s.shootout.B, s.shootout.A, s.shootout.next, s.shootout.scoreB], [["scored"], ["saved"], "B", 1]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE 1-1 ECE (penalties 0-1)");
  // a kick by the wrong team stored anyway (broken row) is ignored
  assert.deepStrictEqual(shoot(5, "A", [K("B", "scored")]).shootout.B, []);

  // 5 kicks: ends EARLY when the other team cannot catch up (A 3/3, B 0/3 -> B has 2 left: cannot reach 3)
  s = shoot(5, "A", [K("A", "scored"), K("B", "missed"), K("A", "scored"), K("B", "saved"), K("A", "scored"), K("B", "missed")]);
  assert.deepStrictEqual([s.status, s.winner, s.ended, s.resultText], ["finished", "A", "shootout", "Team A won 3-0 on penalties (1-1)"]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE won on penalties 3-0, 1-1");
  assert.deepStrictEqual(fb.result(s), { finished: true, winner: "A", forA: 1, forB: 1 }, "shootout goals are not goals");
  // ... but NOT too early: A 3/3, B 0/2: B still has 3 kicks and can reach 3
  s = shoot(5, "A", [K("A", "scored"), K("B", "missed"), K("A", "scored"), K("B", "missed"), K("A", "scored")]);
  assert.deepStrictEqual([s.status, s.shootout.next], ["live", "B"]);
  // the second team can also lose early after ITS kick: A 2/4 ... B 4/4 after B's 4th: A has 1 left, max 3 < 4
  s = shoot(5, "A", [K("A", "scored"), K("B", "scored"), K("A", "missed"), K("B", "scored"), K("A", "scored"), K("B", "scored"), K("A", "missed"), K("B", "scored")]);
  assert.deepStrictEqual([s.winner, s.resultText], ["B", "Team B won 4-2 on penalties (1-1)"]);
  // first team wins in the last regular round after the second team misses its 5th
  const four = [K("A", "scored"), K("B", "scored"), K("A", "scored"), K("B", "scored"), K("A", "scored"), K("B", "scored"), K("A", "scored"), K("B", "scored")];
  s = shoot(5, "A", [...four, K("A", "scored"), K("B", "missed")]);
  assert.deepStrictEqual([s.winner, s.shootout.suddenDeath], ["A", false], "won in the 5th round: not sudden death");
  // level after 5 each: SUDDEN DEATH, one kick each until one scores more from the same number of kicks
  s = shoot(5, "A", [...four, K("A", "scored"), K("B", "scored")]);
  assert.deepStrictEqual([s.status, s.shootout.suddenDeath, s.shootout.next], ["live", true, "A"]);
  s = shoot(5, "A", [...four, K("A", "scored"), K("B", "scored"), K("A", "missed")]);
  assert.strictEqual(s.status, "live", "A misses its sudden-death kick: B must still score");
  s = shoot(5, "A", [...four, K("A", "scored"), K("B", "scored"), K("A", "missed"), K("B", "missed"), K("A", "scored"), K("B", "saved")]);
  assert.deepStrictEqual([s.winner, s.shootout.suddenDeath, s.resultText], ["A", true, "Team A won 6-5 on penalties (1-1)"]);
  // 3 kicks
  s = shoot(3, "B", [K("B", "scored"), K("A", "missed"), K("B", "scored"), K("A", "missed")]);
  assert.deepStrictEqual([s.winner, s.ended], ["B", "shootout"], "3 kicks: B 2/2, A 0/2 with 1 left: decided");
  s = shoot(3, "B", [K("B", "missed"), K("A", "missed"), K("B", "missed"), K("A", "missed"), K("B", "missed"), K("A", "missed")]);
  assert.deepStrictEqual([s.status, s.shootout.suddenDeath], ["live", true], "0-0 after 3 each: sudden death");
  // the shootout after extra time
  s = run([...levelET, SO(3, "A"), K("A", "scored"), K("B", "missed"), K("A", "scored"), K("B", "missed")], KNOCK);
  assert.deepStrictEqual([s.winner, s.resultText], ["A", "Team A won 2-0 on penalties (1-1)"]);
  // a walkover during the shootout
  s = shoot(5, "A", [K("A", "scored"), fin("B")]);
  assert.deepStrictEqual([s.winner, s.ended, s.resultText], ["B", "walkover", "Team B won (walkover)"]);
  // the helper on its own
  assert.strictEqual(fbModule.shootoutWinner({ kicks: 5, first: "A", A: [], B: [] }), null);

  // ---- in-match penalty: live banner, scored / saved / missed ----
  s = run([KO(1), PS("A")]);
  assert.deepStrictEqual(s.penaltyNow, { team: "A" }, "PENALTY TO A! on the match page");
  s = run([KO(1), PS("A"), PEN("A", "scored", 10)]);
  assert.deepStrictEqual([score(s), s.penaltyNow, s.goals[0].kind, s.goals[0].shirt, s.highlights[0].goalKind], [[1, 0], null, "penalty", 10, "penalty"]);
  s = run([KO(1), PS("B"), PEN("B", "saved")]);
  assert.deepStrictEqual([score(s), s.penaltyNow, s.penalties, s.highlights[0].kind], [[0, 0], null, [{ seq: 3, team: "B", outcome: "saved", period: 1 }], "penalty_saved"]);
  s = run([KO(1), PEN("B", "missed", 8)]);
  assert.deepStrictEqual([s.penalties[0].shirt, s.highlights[0].kind], [8, "penalty_missed"], "a penalty without the banner first is fine");
  s = run([KO(1), PS("B"), PCANCEL]);
  assert.strictEqual(s.penaltyNow, null, "Cancel takes the banner away");
  s = run([KO(1), PS("B"), END(1)]);
  assert.strictEqual(s.penaltyNow, null, "END HALF takes the banner away");
  s = run([KO(1), PS("B"), undo]);
  assert.strictEqual(s.penaltyNow, null, "UNDO takes a penalty start back (it is a normal entry)");
  assert.strictEqual(check([KO(1)], PCANCEL), "no penalty is waiting");
  assert.strictEqual(check([KO(1)], PEN("A", "scored")), "shirt number must be 1 to 999", "a scored penalty needs the shirt");
  assert.strictEqual(check([KO(1)], PEN("A", "saved")), null, "a saved penalty does not");
  assert.strictEqual(check([KO(1)], PEN("A", "saved", 1000)), "shirt number must be 1 to 999");
  assert.strictEqual(check([KO(1)], PEN("A", "wide")), "choose scored, saved or missed");
  assert.strictEqual(check([], PS("A")), "tap KICK-OFF first");

  // ---- cards: shown only ----
  s = run([KO(1), CARD("A", "yellow", 5, "Amit"), CARD("A", "yellow", 5, "Amit"), CARD("B", "red", 3)]);
  assert.deepStrictEqual(s.cards, [
    { seq: 2, team: "A", color: "yellow", shirt: 5, name: "Amit", period: 1 },
    { seq: 3, team: "A", color: "yellow", shirt: 5, name: "Amit", period: 1 },
    { seq: 4, team: "B", color: "red", shirt: 3, period: 1 },
  ], "two yellows stay two yellows: nothing automatic (user's choice)");
  assert.deepStrictEqual(score(s), [0, 0]);
  assert.deepStrictEqual(s.highlights.map((h) => h.kind), ["red_card", "yellow_card", "yellow_card"]);
  assert.strictEqual(check([KO(1)], CARD("A", "green")), "choose yellow or red");
  assert.strictEqual(check([KO(1)], CARD("A", "red", 0)), "shirt number must be 1 to 999");
  assert.strictEqual(check([], CARD("A", "red")), null, "a card before the kick-off is allowed (it happens)");
  assert.strictEqual(check([KO(1), END(1)], CARD("A", "red")), null, "and at half time");

  // ---- remove a wrong goal / card / penalty ----
  // seq: 1 KO, 2 goal A, 3 goal B, 4 card A, 5 goal A
  const h1 = [KO(1), G("A", 9), G("B", 7), CARD("A", "yellow"), G("A", 11)];
  s = run(h1);
  assert.deepStrictEqual(s.removable, [2, 3, 5, 4], "goals, then penalties, then cards");
  s = run([...h1, RM(3)]);
  assert.deepStrictEqual([score(s), s.goals.map((g) => [g.seq, g.scoreA, g.scoreB]), s.currentB], [[2, 0], [[2, 1, 0], [5, 2, 0]], 0],
    "the goal is gone, the score after later goals is fixed too");
  assert.ok(!s.highlights.some((h) => h.seq === 3), "and its pop-up moment is gone");
  s = run([...h1, RM(4)]);
  assert.deepStrictEqual(s.cards, []);
  assert.strictEqual(check([...h1, RM(3)], RM(3)), "that entry can no longer be removed", "removed twice");
  assert.strictEqual(check(h1, RM(1)), "that entry can no longer be removed", "a kick-off is not a goal");
  assert.strictEqual(check(h1, RM(99)), "that entry can no longer be removed");
  assert.strictEqual(check(h1, { type: "remove", data: {} }), "choose what to remove");
  s = run([...h1, RM(3), undo]);
  assert.deepStrictEqual(score(s), [2, 1], "UNDO of a remove brings the goal back");
  // a goal of half 1, removed at half time or in half 2 (still normal time): the half 1 numbers change
  s = run([...h1, END(1), KO(2), RM(2)]);
  assert.deepStrictEqual([score(s), s.halves], [[1, 1], [[1, 1]]]);
  // a saved penalty can be removed
  s = run([KO(1), PEN("A", "saved"), RM(2)]);
  assert.deepStrictEqual(s.penalties, []);
  // NOT at a level full time (the decision was made on this score) and not in the shootout
  const lv = [KO(1), G("A"), END(1), KO(2), G("B"), CARD("B", "red"), END(2)];   // goals 2 and 5, card 6
  s = run(lv, KNOCK);
  assert.deepStrictEqual(s.removable, [6], "at a level full time only the card can be removed");
  assert.strictEqual(check(lv, RM(2), KNOCK), "that entry can no longer be removed");
  s = run([...lv, ET, G("A")], KNOCK);                                           // ET goal = seq 9
  assert.deepStrictEqual(s.removable, [9, 6], "in extra time only extra-time goals (and cards)");
  s = run([...lv, SO(3, "A")], KNOCK);
  assert.deepStrictEqual(s.removable, [], "nothing in the shootout");
  // a remove stored anyway for a normal-time goal during extra time (broken row) is ignored
  s = run([...lv, ET, RM(2)], KNOCK);
  assert.deepStrictEqual(score(s), [1, 1]);

  // ---- UNDO of each kind ----
  assert.deepStrictEqual(score(run([KO(1), G("A"), undo])), [0, 0]);
  assert.deepStrictEqual(run([KO(1), CARD("A", "red"), undo]).cards, []);
  assert.strictEqual(run([KO(1), undo]).kickedOff, false, "UNDO takes a kick-off back");
  s = run([KO(1), END(1), undo]);
  assert.deepStrictEqual([s.period, s.playing], [1, true], "UNDO of END HALF: the half is on again");
  s = run([...level, ET, undo], KNOCK);
  assert.deepStrictEqual([s.needsDecision, s.isExtraTime], [true, false], "UNDO of EXTRA TIME: choose again");
  s = run([...level, SO(5, "A"), undo], KNOCK);
  assert.deepStrictEqual([s.needsDecision, s.shootout], [true, null]);
  s = run([...level, SO(5, "A"), K("A", "scored"), undo], KNOCK);
  assert.deepStrictEqual([s.shootout.A, s.shootout.next], [[], "A"]);
  assert.ok(canUndo(withSeq([PS("A")])), "a penalty start can be undone (not like a kabaddi raid start)");

  // ---- walkover any time ----
  s = run([KO(1), G("B"), fin("A")]);
  assert.deepStrictEqual([s.winner, s.ended, s.resultText, score(s)], ["A", "walkover", "Team A won (walkover)", [0, 1]]);
  assert.strictEqual(fb.headline(s, { A: "CSE", B: "ECE" }), "CSE won (walkover), 0-1");
  assert.strictEqual(check([], fin("C")), "choose the winner");
  s = run([...level, fin("B")], KNOCK);
  assert.deepStrictEqual([s.winner, s.ended, s.needsDecision], ["B", "walkover", false]);

  // ---- unknown and broken entries never crash compute ----
  assert.strictEqual(check([KO(1)], { type: "point", team: "A", value: 1 }), "unknown action");
  assert.strictEqual(check([KO(1)], { type: "raid", data: {} }), "unknown action");
  const junk = [KO(1), { type: "goal", data: null }, { type: "goal", data: { team: "A", kind: "normal", shirt: "9" } },
    { type: "card", data: { team: "A", color: "red" } }, { type: "penalty", data: { team: "A", outcome: "scored" } },
    { type: "kick", data: { team: "A", outcome: "scored" } }, { type: "shootout_start", data: { kicks: 5, first: "A" } },
    { type: "remove", data: { seq: "2" } }, { type: "end_period", data: { period: 7 } }, { type: "period_start", data: null },
    { type: "raid", data: { team: "A", out: 2 } }, { type: "finish", data: { winner: "draw" } }, { type: "whatever" }];
  s = run(junk, KNOCK);
  assert.deepStrictEqual([score(s), s.goals, s.cards, s.shootout, s.status, s.playing], [[0, 0], [], [], null, "live", true]);
  assert.strictEqual(fb.clean({ type: "extra_time", data: { x: 1 } }), null, "extra time stores no details");
  assert.deepStrictEqual(fb.clean(SO(3, "B")), { kicks: 3, first: "B" });
  assert.deepStrictEqual(fb.clean(K("A", "saved")), { team: "A", outcome: "saved" });
  assert.deepStrictEqual(fb.clean(RM(5)), { seq: 5 });
  assert.deepStrictEqual(fb.clean(END(2)), { period: 2 });
  assert.deepStrictEqual(fb.clean(PEN("A", "missed")), { team: "A", outcome: "missed" });
  assert.deepStrictEqual(fb.clean(PCANCEL), { cancel: true });

  // ---- points table: a football group ----
  // win 2 / draw 1 / loss 0 like every sport (user: decide 3/1/0 later); forA / forB are goals
  const fbDone = (a, c, evs) => ({ stage: "group", competition: "", sport: "football", category: "boys", teamA: a, teamB: c, result: fb.result(run(evs)) });
  const table = buildStandings([
    fbDone("CSE", "ECE", match([G("A"), G("A")], [])),          // CSE 2-0
    fbDone("ECE", "ME", match([G("A")], [G("B")])),              // draw 1-1
    fbDone("ME", "CSE", [KO(1), G("A")]),                        // not finished: ignored
  ]);
  assert.strictEqual(table.length, 1);
  assert.strictEqual(table[0].name, "Football (Boys)");
  const rows = Object.fromEntries(table[0].rows.map((r) => [r.team, r]));
  assert.deepStrictEqual([rows.CSE.points, rows.CSE.won, rows.CSE.diff], [2, 1, 2]);
  assert.deepStrictEqual([rows.ECE.points, rows.ECE.drawn, rows.ECE.lost], [1, 1, 1]);
  assert.deepStrictEqual([rows.ME.points, rows.ME.drawn], [1, 1]);

  // ---- random matches: the score always equals the goals, a knockout always ends with a winner ----
  const rand = rng(20261128);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let shootouts = 0, extraTimes = 0, removes = 0, refused = 0, undos = 0;
  for (let game = 0; game < 400; game++) {
    const config = game % 2 ? KNOCK : GROUP;
    const log = [];
    for (let step = 0; step < 300; step++) {
      const st = fb.compute(effectivePoints(withSeq(log)), { config });
      if (st.status === "finished") break;
      let action;
      const r = rand();
      if (st.shootout) action = K(rand() < 0.1 ? (st.shootout.next === "A" ? "B" : "A") : st.shootout.next, pick(["scored", "scored", "saved", "missed"]));
      else if (st.needsDecision) action = rand() < 0.5 && st.canExtraTime ? ET : SO(pick([3, 5]), pick(["A", "B"]));
      else if (!st.playing) action = rand() < 0.1 ? G("A") : KO(rand() < 0.1 ? st.period + 1 : st.period);
      else if (r < 0.25) action = G(pick(["A", "B"]), 1 + Math.floor(rand() * 99), pick(["normal", "free_kick", "own_goal"]));
      else if (r < 0.32) action = PEN(pick(["A", "B"]), pick(["scored", "saved", "missed"]), 7);
      else if (r < 0.37) action = PS(pick(["A", "B"]));
      else if (r < 0.42) action = CARD(pick(["A", "B"]), pick(["yellow", "red"]));
      else if (r < 0.48 && st.removable.length) action = RM(pick(st.removable));
      else if (r < 0.55 && log.length) action = undo;
      else if (r < 0.75) action = END(rand() < 0.1 ? st.period - 1 : st.period);
      else action = G("B", 9);
      if (action.type === "undo") {
        if (!canUndo(withSeq(log))) continue;
        undos++;
        log.push(action);
        continue;
      }
      const problem = fb.validate(action, st);
      if (problem) { refused++; continue; }
      if (action.type === "shootout_start") shootouts++;
      if (action.type === "extra_time") extraTimes++;
      if (action.type === "remove") removes++;
      log.push({ ...action, data: fb.clean(action) });
      // the state after an allowed action is always sane
      const after = fb.compute(effectivePoints(withSeq(log)), { config });
      const goalsA = after.goals.filter((g) => g.team === "A").length, goalsB = after.goals.filter((g) => g.team === "B").length;
      assert.deepStrictEqual([after.scoreA, after.scoreB], [goalsA, goalsB], "score == goals listed (game " + game + ")");
      const halfSum = after.halves.reduce((t, h) => [t[0] + h[0], t[1] + h[1]], [after.currentA, after.currentB]);
      assert.deepStrictEqual(halfSum, [after.scoreA, after.scoreB], "halves + this half == score (game " + game + ")");
      if (after.shootout) {
        const so = after.shootout;
        assert.ok(Math.abs(so.A.length - so.B.length) <= 1, "kicks in turn");
      }
    }
    const end = fb.compute(effectivePoints(withSeq(log)), { config });
    if (end.status === "finished") {
      if (config.knockout) assert.ok(end.winner === "A" || end.winner === "B", "a knockout match never ends as a draw");
      assert.ok(typeof end.resultText === "string" && end.resultText.length > 0);
    }
  }
  assert.ok(shootouts > 10 && extraTimes > 10 && removes > 100 && refused > 100 && undos > 100,
    "the random test really used every path (" + [shootouts, extraTimes, removes, refused, undos].join(", ") + ")");
};
