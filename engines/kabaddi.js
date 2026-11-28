// Kabaddi rules engine (AKFI rules + the college's choices). Points, players on court, all out; no clock.
// Pure functions: the same events always give the same result. No sockets, no database.
//
// Events this engine understands (undo is handled by the server before events reach here).
// The server keeps "team" only for point events, so for the others the team is inside data.
//   raid        data = { team: raiding team A|B, out: defenders put out 0-7, bonus: true|false, caught: true|false }
//               raider safe:   raiding team + out (+1 bonus); defenders lose "out" players;
//                              the raiding team gets one out player back per defender put out (not for the bonus).
//               raider caught: defenders +1 (+2 = SUPER TACKLE when they had 3 or fewer on court), one defender back;
//                              the players he touched are NOT out (out must be 0); a bonus the referee gave still counts.
//               A team with 0 players left is ALL OUT (lona): the other team gets +2 and the whole team comes back (7).
//               bonus only when the defenders have 6 or more on court (AKFI).
//   point       value +1 = technical point (nobody comes back), -1 = correction (a team total never below 0)
//   court       data = { team, change: +1|-1 }: fix the players on court (cards, injuries, a wrong entry), stays 1-7, no points
//   break       data = { kind: "timeout", team } | { kind: "other", text } | { kind: "over" }: shown only, never scored
//   end_period  data = { period: 1|2 }: the scorer ends half 1 or 2; refused if that half already ended (double press)
//   finish      data = { winner: A|B }: walkover, or the tie-break winner of a level knockout match
//   raid_start  data = { team } | { cancel: true }: "CSE RAIDING NOW" on the match page, never scored, never taken back by
//               UNDO (engine.js effectivePoints); ended by the raid, END HALF, a break or Cancel.
//
// DO-OR-DIE (Pro Kabaddi rule, the user's choice): after 2 EMPTY raids in a row by a team (nobody scored: no out, no bonus,
// raider not caught), its next raid must score. Empty again = the raider is OUT: defenders +1 and one of them back
// (ALL OUT if he was the last), never a super tackle. A touch or a bonus saves it; a tackle is a normal tackle.
// The count is per team and restarts at half time.
//
// After half 2: the higher score wins. Level: a group match is a draw; a knockout match waits for
// the scorer to enter the tie-break winner (the 5 raids + golden raid are played on the mat, not scored here).
// The minutes are only shown on the pages (college rule: Boys 15, Girls 10; final Boys 20, Girls 15).

const PLAYERS = 7;
const HALVES = 2;
const ALL_OUT_POINTS = 2;
const SUPER_TACKLE_MAX = 3;      // defenders on court at most this: a tackle is worth 2
const BONUS_MIN = 6;             // defenders on court at least this: bonus allowed
const SUPER_RAID_MIN = 3;        // raid points at least this: "super raid" (shown only)
const DO_OR_DIE_AFTER = 2;       // empty raids in a row: the next raid is do-or-die
const HIGHLIGHTS = 10;           // how many special moments the state keeps (newest first)
const BREAK_TEXT_MAX = 40;
const DEFAULT_CONFIG = { halfMinutes: 15, knockout: false };
const KNOCKOUT_STAGES = ["quarter_final", "semi_final", "final", "knockout"];

const isTeam = (t) => t === "A" || t === "B";
const other = (t) => (t === "A" ? "B" : "A");
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isBool = (x) => x === true || x === false;
const isOut = (n) => Number.isInteger(n) && n >= 0 && n <= PLAYERS;
const BREAK_TEXT_OK = /^[\p{L}\p{M}\p{N} .,'!?:()\/-]+$/u;
const BREAK_TEXT_ERROR = "break text: 1 to " + BREAK_TEXT_MAX + " letters, numbers, spaces and . , ' ! ? : ( ) / -";

// College rule: half length from the category and the stage. Only the final is longer.
function collegeHalfMinutes(category, stage) {
  const girls = category === "girls";
  if (stage === "final") return girls ? 15 : 20;
  return girls ? 10 : 15;
}

// quarter final, semi final, final (and old "knockout" matches): a level score needs a tie-break
function isKnockoutStage(stage) {
  return KNOCKOUT_STAGES.includes(stage);
}

// ---------- match settings ----------
function checkConfig(c) {
  if (!isObject(c)) return "settings must be an object";
  if (!Number.isInteger(c.halfMinutes) || c.halfMinutes < 1 || c.halfMinutes > 30) return "half minutes must be a whole number from 1 to 30";
  if (!isBool(c.knockout)) return "knockout must be true or false";
  return null;
}

function normalizeConfig(raw) {
  const merged = { ...DEFAULT_CONFIG, ...(isObject(raw) ? raw : {}) };
  if (checkConfig(merged)) return { ...DEFAULT_CONFIG };
  return { halfMinutes: merged.halfMinutes, knockout: merged.knockout };
}

// ---------- reading one event safely (compute must never crash on a broken stored row) ----------
function raidOf(data) {
  if (!isObject(data) || !isTeam(data.team) || !isOut(data.out) || !isBool(data.bonus) || !isBool(data.caught)) return null;
  return { team: data.team, out: data.out, bonus: data.bonus, caught: data.caught };
}

// text with runs of spaces made into one, or null if it is not allowed
function breakText(t) {
  if (typeof t !== "string" || /[\u0000-\u001f\u007f]/.test(t)) return null;
  const s = t.replace(/ +/g, " ").trim();
  if (!s || s.length > BREAK_TEXT_MAX || !BREAK_TEXT_OK.test(s)) return null;
  return s;
}

function breakOf(data) {
  if (!isObject(data)) return null;
  if (data.kind === "timeout") return isTeam(data.team) ? { kind: "timeout", team: data.team } : null;
  if (data.kind === "other") { const text = breakText(data.text); return text ? { kind: "other", text } : null; }
  if (data.kind === "over") return { kind: "over" };
  return null;
}

function raidStartOf(data) {
  if (!isObject(data)) return null;
  if (data.cancel === true) return { cancel: true };
  return isTeam(data.team) ? { team: data.team } : null;
}

function courtOf(data) {
  if (!isObject(data) || !isTeam(data.team) || (data.change !== 1 && data.change !== -1)) return null;
  return { team: data.team, change: data.change };
}

// ---------- the main function ----------
function compute(events, match) {
  const cfg = normalizeConfig(match && match.config);

  const score = { A: 0, B: 0 };          // whole match
  const current = { A: 0, B: 0 };        // the half being played now
  const onCourt = { A: PLAYERS, B: PLAYERS };
  const timeouts = { A: 0, B: 0 };       // this half
  const halves = [];                     // finished halves: [pointsA, pointsB]
  let highlights = [];
  let breakNow = null;
  let lastRaid = null;
  let winner = null;
  let ended = null;
  let needsTiebreak = false;
  const empty = { A: 0, B: 0 };          // empty raids in a row, this half
  let raidingNow = null;                 // team of the raid going on now (RAID STARTED), or null

  // points by type for each team (raid = touch + bonus); they always add up to the score
  const zero = () => ({ raid: 0, tackle: 0, allOut: 0, doOrDie: 0, technical: 0, correction: 0 });
  const by = { A: zero(), B: zero() };
  const add = (t, n, type) => { score[t] += n; current[t] += n; by[t][type] += n; };
  // a special moment, with the points it gave (super raid: also how, out + bonus)
  const mark = (kind, team, points, extra) => {
    highlights.unshift({ kind, team, points, ...extra, half: halves.length + 1, scoreA: score.A, scoreB: score.B });
    if (highlights.length > HIGHLIGHTS) highlights = highlights.slice(0, HIGHLIGHTS);
  };

  for (const e of events) {
    if (winner) break;                                       // match is over, ignore extra events

    if (needsTiebreak) {                                     // only the tie-break winner counts now
      const w = e.type === "finish" && isObject(e.data) ? e.data.winner : null;
      if (isTeam(w)) { winner = w; ended = "tiebreak"; needsTiebreak = false; }
      continue;
    }

    if (e.type === "raid") {
      const r = raidOf(e.data);
      const att = r && r.team;
      const def = att && other(att);
      if (!r || r.out > onCourt[def] || (r.caught && r.out > 0) || (r.bonus && onCourt[def] < BONUS_MIN)) continue;
      const defendersBefore = onCourt[def];
      const doOrDie = empty[att] >= DO_OR_DIE_AFTER;
      const isEmpty = !r.caught && r.out === 0 && !r.bonus;
      const doOrDieOut = doOrDie && isEmpty;                          // the do-or-die raid scored nothing: raider OUT
      const bonus = r.bonus ? 1 : 0;
      let defencePoints = 0, allOut = false, superTackle = false;
      add(att, bonus, "raid");
      if (doOrDieOut) {
        defencePoints = 1;
        add(def, 1, "doOrDie");
        onCourt[def] = Math.min(PLAYERS, onCourt[def] + 1);           // one defender back, as for a tackle
        onCourt[att] -= 1;
        if (onCourt[att] === 0) {                                     // the raider was the last one: ALL OUT
          add(def, ALL_OUT_POINTS, "allOut");
          defencePoints += ALL_OUT_POINTS;
          onCourt[att] = PLAYERS;
          allOut = true;
        }
      } else if (!r.caught) {
        add(att, r.out, "raid");
        onCourt[att] = Math.min(PLAYERS, onCourt[att] + r.out);       // revival: one per defender put out
        onCourt[def] -= r.out;
        if (onCourt[def] === 0) {                                     // ALL OUT
          add(att, ALL_OUT_POINTS, "allOut");
          onCourt[def] = PLAYERS;
          allOut = true;
        }
      } else {
        superTackle = defendersBefore <= SUPER_TACKLE_MAX;
        defencePoints = superTackle ? 2 : 1;
        add(def, defencePoints, "tackle");
        onCourt[def] = Math.min(PLAYERS, onCourt[def] + 1);           // only ONE back, even for a super tackle
        onCourt[att] -= 1;
        if (onCourt[att] === 0) {                                     // the raider was the last one: ALL OUT
          add(def, ALL_OUT_POINTS, "allOut");
          defencePoints += ALL_OUT_POINTS;
          onCourt[att] = PLAYERS;
          allOut = true;
        }
      }
      const lostRaider = r.caught || doOrDieOut;
      const raidPoints = bonus + (lostRaider ? 0 : r.out + (allOut ? ALL_OUT_POINTS : 0));
      const superRaid = !r.caught && bonus + r.out >= SUPER_RAID_MIN;
      if (doOrDie && !r.caught && !isEmpty) mark("do_or_die", att, r.out + bonus);
      if (doOrDieOut) mark("do_or_die_out", def, 1);
      if (superRaid) mark("super_raid", att, r.out + bonus, { out: r.out, bonus: r.bonus });
      if (superTackle) mark("super_tackle", def, 2);
      if (allOut) mark("all_out", lostRaider ? def : att, ALL_OUT_POINTS);
      lastRaid = { team: att, out: r.out, bonus: r.bonus, caught: r.caught, raidPoints, defencePoints, superRaid, superTackle, allOut,
        doOrDie, doOrDieOut };
      empty[att] = isEmpty && !doOrDie ? empty[att] + 1 : 0;          // any point (either side) or a do-or-die raid: start again
      raidingNow = null;
      breakNow = null;                                                // a raid means play is on
    } else if (e.type === "raid_start") {
      const s = raidStartOf(e.data);
      if (!s) continue;
      raidingNow = s.cancel ? null : s.team;
    } else if (e.type === "point") {
      if (!isTeam(e.team)) continue;
      if (e.value === 1) { add(e.team, 1, "technical"); mark("technical", e.team, 1); }
      else if (e.value === -1 && score[e.team] > 0) add(e.team, -1, "correction");
    } else if (e.type === "court") {
      const c = courtOf(e.data);
      if (!c) continue;
      const n = onCourt[c.team] + c.change;
      if (n >= 1 && n <= PLAYERS) onCourt[c.team] = n;
    } else if (e.type === "break") {
      const b = breakOf(e.data);
      if (!b) continue;
      raidingNow = null;                                              // play stopped
      if (b.kind === "over") breakNow = null;
      else {
        breakNow = b;
        if (b.kind === "timeout") timeouts[b.team] += 1;
      }
    } else if (e.type === "end_period") {
      halves.push([current.A, current.B]);
      current.A = 0; current.B = 0;
      timeouts.A = 0; timeouts.B = 0;
      empty.A = 0; empty.B = 0;                                       // the do-or-die count restarts every half
      raidingNow = null;
      breakNow = halves.length < HALVES ? { kind: "half_time" } : null;
      if (halves.length >= HALVES) {
        if (score.A !== score.B) { winner = score.A > score.B ? "A" : "B"; ended = "normal"; }
        else if (cfg.knockout) needsTiebreak = true;
        else { winner = "draw"; ended = "draw"; }
      }
    } else if (e.type === "finish") {
      const w = isObject(e.data) ? e.data.winner : null;
      if (isTeam(w)) { winner = w; ended = "walkover"; }
    }
  }

  const half = Math.min(HALVES, halves.length + 1);

  let resultText = null;
  if (ended === "walkover") resultText = "Team " + winner + " won (walkover)";
  else if (ended === "draw") resultText = "Draw " + score.A + "-" + score.B;
  else if (ended === "tiebreak") resultText = "Team " + winner + " won on tie-break (" + score.A + "-" + score.B + ")";
  else if (ended === "normal") {
    const w = score[winner], l = score[other(winner)];
    resultText = "Team " + winner + " won " + w + "-" + l;
  }

  return {
    halfMinutes: cfg.halfMinutes,
    knockout: cfg.knockout,
    players: PLAYERS,
    scoreA: score.A, scoreB: score.B,
    currentA: current.A, currentB: current.B,
    half,
    halfName: "Half " + half,
    halves,
    onCourtA: onCourt.A, onCourtB: onCourt.B,
    timeoutsA: timeouts.A, timeoutsB: timeouts.B,
    emptyRaidsA: empty.A, emptyRaidsB: empty.B,
    doOrDieA: empty.A >= DO_OR_DIE_AFTER, doOrDieB: empty.B >= DO_OR_DIE_AFTER,
    raidingNow: raidingNow && !winner && !needsTiebreak
      ? { team: raidingNow, doOrDie: empty[raidingNow] >= DO_OR_DIE_AFTER,
          superTackleChance: onCourt[other(raidingNow)] <= SUPER_TACKLE_MAX, defenders: onCourt[other(raidingNow)] }
      : null,
    pointsBy: by,
    breakNow: winner ? null : breakNow,
    lastRaid,
    highlights,
    needsTiebreak,
    status: winner ? "finished" : "live",
    winner,
    ended,
    resultText,
  };
}

// ---------- rules check before an action is stored ----------
// Returns an error text, or null if the action is allowed. (Undo is handled by the server.)
function validate(action, state) {
  if (state.status === "finished") return "match already finished";
  const data = isObject(action.data) ? action.data : null;

  if (state.needsTiebreak) {
    if (action.type !== "finish") return "the match is level: choose the tie-break winner";
    return data && isTeam(data.winner) ? null : "choose the winner";
  }

  if (action.type === "raid_start") {
    if (data && data.cancel === true) return state.raidingNow ? null : "no raid has started";
    if (!data || !isTeam(data.team)) return "bad team";
    return null;
  }

  if (action.type === "raid") {
    if (!data || !isTeam(data.team)) return "bad team";
    if (!isOut(data.out)) return "players out must be a whole number from 0 to 7";
    if (!isBool(data.bonus) || !isBool(data.caught)) return "bad raid";
    const def = other(data.team);
    const defenders = def === "A" ? state.onCourtA : state.onCourtB;
    if (data.caught && data.out > 0) return "raider caught: the players he touched are not out (enter 0 out)";
    if (data.out > defenders) return "Team " + def + " has only " + defenders + " players on court";
    if (data.bonus && defenders < BONUS_MIN) return "no bonus: Team " + def + " has fewer than " + BONUS_MIN + " players on court";
    return null;
  }

  if (action.type === "point") {
    if (!isTeam(action.team)) return "bad team";
    if (action.value !== 1 && action.value !== -1) return "points must be +1 (technical point) or -1 (correction)";
    const has = action.team === "A" ? state.scoreA : state.scoreB;
    if (action.value === -1 && has < 1) return "cannot take away 1 point: Team " + action.team + " has only " + has;
    return null;
  }

  if (action.type === "court") {
    if (!data || !isTeam(data.team)) return "bad team";
    if (data.change !== 1 && data.change !== -1) return "change must be +1 or -1";
    const n = data.team === "A" ? state.onCourtA : state.onCourtB;
    if (data.change === 1 && n >= PLAYERS) return "Team " + data.team + " already has " + PLAYERS + " players on court";
    if (data.change === -1 && n <= 1) return "Team " + data.team + " must keep at least 1 player on court";
    return null;
  }

  if (action.type === "break") {
    if (!data) return "bad break";
    if (data.kind === "timeout") return isTeam(data.team) ? null : "bad team";
    if (data.kind === "other") return breakText(data.text) ? null : BREAK_TEXT_ERROR;
    if (data.kind === "over") return state.breakNow ? null : "no break is on";
    return "bad break";
  }

  if (action.type === "end_period") {
    const p = data ? data.period : undefined;
    if (p !== 1 && p !== 2) return "bad half number";
    if (p < state.half) return "Half " + p + " has already ended";
    if (p > state.half) return "Half " + p + " has not started yet";
    return null;
  }

  if (action.type === "finish") {
    return data && isTeam(data.winner) ? null : "choose the winner";
  }

  return "unknown action";
}

// The cleaned copy of the details that is saved in the database (never the raw input).
function clean(action) {
  const d = action.data;
  if (action.type === "raid") return raidOf(d);
  if (action.type === "raid_start") return raidStartOf(d);
  if (action.type === "court") return courtOf(d);
  if (action.type === "break") return breakOf(d);
  if (action.type === "end_period") return isObject(d) && (d.period === 1 || d.period === 2) ? { period: d.period } : null;
  if (action.type === "finish") return isObject(d) && isTeam(d.winner) ? { winner: d.winner } : null;
  return null;
}

// Facts for the points table: winner A, B or "draw", and points scored by each side.
function result(state) {
  return { finished: state.status === "finished", winner: state.winner || null, forA: state.scoreA, forB: state.scoreB };
}

// One line for the match lists. names = { A: "...", B: "..." }
function headline(state, names) {
  const score = state.scoreA + "-" + state.scoreB;
  const line = names.A + " " + score + " " + names.B;
  if (state.status === "finished") {
    if (state.ended === "walkover") return names[state.winner] + " won (walkover), " + score;
    if (state.ended === "tiebreak") return names[state.winner] + " won on tie-break, " + score;
    if (state.ended === "draw") return line + " (draw)";
    return line;
  }
  if (state.needsTiebreak) return line + " (tie-break)";
  if (state.breakNow && state.breakNow.kind === "half_time") return line + " (half time)";
  return line + " (H" + state.half + ")";
}

module.exports = {
  compute, validate, clean, checkConfig, normalizeConfig, result, headline,
  collegeHalfMinutes, isKnockoutStage, PLAYERS, HALVES,
};
