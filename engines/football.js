// Football rules engine (IFAB Laws of the Game + the college's choices). Goals, penalties, cards, shootout; no clock.
// Pure functions: the same events always give the same result. No sockets, no database.
//
// College format (user, 2026-11-28): Boys 6-a-side, 2 x 15 min; Girls 5-a-side, 2 x 7 min; every stage the same.
// The minutes and players are only SHOWN (no clock, no match minute, no player count).
//
// Events this engine understands (undo is handled by the server before events reach here).
// The server keeps "team" only for point events, so the team is inside data. Every event has its seq.
//   period_start  data = { period: 1..4 }: KICK-OFF of half 1, 2 (and extra time half 2 = period 4).
//                 Goals, penalties and END HALF need a half that has kicked off.
//   goal          data = { team (gets the goal), kind: normal|free_kick|own_goal, shirt: 1-999, name? }
//                 own goal: shirt/name of the player who put it in (from the OTHER team).
//   penalty_start data = { team } | { cancel: true }: "PENALTY TO CSE!" on the match page until the penalty is entered.
//   penalty       data = { team (took it), outcome: scored|saved|missed, shirt?, name? } (shirt needed when scored)
//                 scored = a goal of kind "penalty".
//   card          data = { team, color: yellow|red, shirt, name? }: shown only (nothing automatic).
//   end_period    data = { period: 1..4 }: the scorer ends that half; refused if it already ended (double press).
//   extra_time    (no data): level knockout at full time, the scorer chooses extra time; it kicks off at once (period 3).
//   shootout_start data = { kicks: 3|5, first: A|B }: level knockout (full time or after extra time) -> penalty shootout.
//   kick          data = { team, outcome: scored|saved|missed }: one shootout kick; the team must be the one whose turn it is.
//                 The shootout ends by itself: early when one team cannot catch up, after "kicks" each if different,
//                 then sudden death (one kick each until one scores more from the same number of kicks).
//   remove        data = { seq }: take out an earlier goal / penalty / card (a mistake). A goal or penalty of the
//                 normal time can be removed only during normal time, one of extra time only during extra time,
//                 never at a level full time or in the shootout (that decision was made on that score). Cards always.
//   finish        data = { winner: A|B }: walkover (the score stays).
//
// After half 2: the higher score wins. Level: a group match is a draw; a knockout match waits for the scorer to choose
// EXTRA TIME or the SHOOTOUT. After extra time: the higher score wins, level = shootout only.

const HALVES = 2;                     // normal time
const ET_HALVES = 2;                  // extra time
const HIGHLIGHTS = 10;
const NAME_MAX = 20;
const SHIRT_MAX = 999;                 // shirt numbers 1-999 (user, 2026-11-28)
const DEFAULT_CONFIG = { halfMinutes: 15, players: 6, knockout: false };
const KNOCKOUT_STAGES = ["quarter_final", "semi_final", "final", "knockout"];
const GOAL_KINDS = ["normal", "free_kick", "own_goal"];
const OUTCOMES = ["scored", "saved", "missed"];
const COLORS = ["yellow", "red"];
const PERIOD_NAMES = ["1st half", "2nd half", "Extra time 1st half", "Extra time 2nd half"];

const isTeam = (t) => t === "A" || t === "B";
const other = (t) => (t === "A" ? "B" : "A");
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isBool = (x) => x === true || x === false;
const isShirt = (n) => Number.isInteger(n) && n >= 1 && n <= SHIRT_MAX;
const NAME_OK = /^[\p{L}\p{M}\p{N} .'-]+$/u;
const NAME_ERROR = "name: up to " + NAME_MAX + " letters, numbers, spaces and . ' -";

// College rule (user): Boys 6-a-side 2 x 15 min, Girls 5-a-side 2 x 7 min, every stage the same.
function collegeHalfMinutes(category) {
  return category === "girls" ? 7 : 15;
}
function collegePlayers(category) {
  return category === "girls" ? 5 : 6;
}
function isKnockoutStage(stage) {
  return KNOCKOUT_STAGES.includes(stage);
}

// ---------- match settings ----------
function checkConfig(c) {
  if (!isObject(c)) return "settings must be an object";
  if (!Number.isInteger(c.halfMinutes) || c.halfMinutes < 1 || c.halfMinutes > 45) return "half minutes must be a whole number from 1 to 45";
  if (!Number.isInteger(c.players) || c.players < 3 || c.players > 11) return "players must be a whole number from 3 to 11";
  if (!isBool(c.knockout)) return "knockout must be true or false";
  return null;
}

function normalizeConfig(raw) {
  const merged = { ...DEFAULT_CONFIG, ...(isObject(raw) ? raw : {}) };
  if (checkConfig(merged)) return { ...DEFAULT_CONFIG };
  return { halfMinutes: merged.halfMinutes, players: merged.players, knockout: merged.knockout };
}

// ---------- reading one event safely (compute must never crash on a broken stored row) ----------
// optional player name: undefined / "" -> "" (no name); otherwise cleaned text, or null if not allowed
function nameText(t) {
  if (t === undefined || t === null) return "";
  if (typeof t !== "string" || /[\u0000-\u001f\u007f]/.test(t)) return null;
  const s = t.replace(/ +/g, " ").trim();
  if (!s) return "";
  if (s.length > NAME_MAX || !NAME_OK.test(s)) return null;
  return s;
}

// { shirt, name } of a player, or null
function playerOf(d) {
  if (!isShirt(d.shirt)) return null;
  const name = nameText(d.name);
  if (name === null) return null;
  return name ? { shirt: d.shirt, name } : { shirt: d.shirt };
}

function goalOf(d) {
  if (!isObject(d) || !isTeam(d.team) || !GOAL_KINDS.includes(d.kind)) return null;
  const p = playerOf(d);
  return p ? { team: d.team, kind: d.kind, ...p } : null;
}

function cardOf(d) {
  if (!isObject(d) || !isTeam(d.team) || !COLORS.includes(d.color)) return null;
  const p = playerOf(d);
  return p ? { team: d.team, color: d.color, ...p } : null;
}

function penaltyOf(d) {
  if (!isObject(d) || !isTeam(d.team) || !OUTCOMES.includes(d.outcome)) return null;
  if (d.outcome === "scored") {
    const p = playerOf(d);
    return p ? { team: d.team, outcome: "scored", ...p } : null;
  }
  // saved / missed: the player is optional
  if (d.shirt === undefined || d.shirt === null) return { team: d.team, outcome: d.outcome };
  const p = playerOf(d);
  return p ? { team: d.team, outcome: d.outcome, ...p } : null;
}

function penaltyStartOf(d) {
  if (!isObject(d)) return null;
  if (d.cancel === true) return { cancel: true };
  return isTeam(d.team) ? { team: d.team } : null;
}

function kickOf(d) {
  if (!isObject(d) || !isTeam(d.team) || !OUTCOMES.includes(d.outcome)) return null;
  return { team: d.team, outcome: d.outcome };
}

function shootoutStartOf(d) {
  if (!isObject(d) || (d.kicks !== 3 && d.kicks !== 5) || !isTeam(d.first)) return null;
  return { kicks: d.kicks, first: d.first };
}

const periodOf = (d) => (isObject(d) && Number.isInteger(d.period) && d.period >= 1 && d.period <= HALVES + ET_HALVES ? d.period : null);
const removeOf = (d) => (isObject(d) && Number.isInteger(d.seq) && d.seq >= 1 ? { seq: d.seq } : null);

// ---------- the shootout ----------
const goalsIn = (list) => list.filter((o) => o === "scored").length;

// whose turn it is (they kick in turn, the "first" team first in every round)
function nextKicker(so) {
  return (so.A.length + so.B.length) % 2 === 0 ? so.first : other(so.first);
}

// "A" | "B" when the shootout is decided, else null
function shootoutWinner(so) {
  const gA = goalsIn(so.A), gB = goalsIn(so.B);
  const n = so.kicks;
  if (so.A.length <= n && so.B.length <= n) {
    const leftA = n - so.A.length, leftB = n - so.B.length;
    if (gA > gB + leftB) return "A";              // B cannot catch up even if it scores all its kicks
    if (gB > gA + leftA) return "B";
    if (leftA > 0 || leftB > 0) return null;
  }
  // after "kicks" each, and in sudden death: decided only when both have taken the same number of kicks
  if (so.A.length === so.B.length && gA !== gB) return gA > gB ? "A" : "B";
  return null;
}

// ---------- the main function ----------
function compute(events, match) {
  const cfg = normalizeConfig(match && match.config);

  const score = { A: 0, B: 0 };
  const current = { A: 0, B: 0 };        // the half being played now
  const halves = [];                     // finished halves: [goalsA, goalsB] (extra time halves too)
  let started = 0;                       // the last period that kicked off (0 = not yet)
  let extraTime = false;                 // the scorer chose extra time
  let goals = [];                        // oldest first
  let cards = [];
  let penalties = [];                    // in-match penalties saved / missed (scored ones are in goals)
  let highlights = [];
  let penaltyNow = null;
  let needsDecision = false;
  let shootout = null;                   // { kicks, first, A: [outcome], B: [outcome] }
  let winner = null;
  let ended = null;

  const period = () => halves.length + 1;          // the half being played or waiting to kick off
  // the half to SHOW: after full time (no extra time chosen) it stays "2nd half", after extra time "Extra time 2nd half"
  const shownPeriod = () => Math.max(1, Math.min(period(), extraTime ? HALVES + ET_HALVES : HALVES));
  const mark = (kind, team, seq, extra) => {
    highlights.unshift({ kind, team, seq, ...extra, period: shownPeriod(), scoreA: score.A, scoreB: score.B });
    if (highlights.length > HIGHLIGHTS) highlights = highlights.slice(0, HIGHLIGHTS);
  };
  const playing = () => started === period() && !needsDecision && !shootout;
  // a goal or penalty can be taken out only in its own phase (normal time / extra time, half time included),
  // never at a level full time or in the shootout: that decision was made on this score
  const goalRemovable = (p) => !needsDecision && !shootout && (p <= HALVES) === (period() <= HALVES);

  const addGoal = (team, kind, player, seq) => {
    score[team] += 1; current[team] += 1;
    const g = { seq, team, kind, ...player, period: period(), scoreA: score.A, scoreB: score.B };
    goals.push(g);
    mark("goal", team, seq, { goalKind: kind, ...player });
  };

  // after the last half of normal time or of extra time
  const fullTime = () => {
    if (score.A !== score.B) { winner = score.A > score.B ? "A" : "B"; ended = extraTime ? "extra_time" : "normal"; }
    else if (cfg.knockout) needsDecision = true;
    else { winner = "draw"; ended = "draw"; }
  };

  for (const e of events) {
    if (winner) break;                                       // match is over, ignore extra events
    const d = e.data;
    const seq = Number(e.seq) || 0;

    if (shootout) {                                          // only kicks (and a walkover) count now
      if (e.type === "kick") {
        const k = kickOf(d);
        if (!k || k.team !== nextKicker(shootout)) continue;
        shootout[k.team].push(k.outcome);
        mark("kick", k.team, seq, { outcome: k.outcome, kickNo: shootout[k.team].length });
        const w = shootoutWinner(shootout);
        if (w) { winner = w; ended = "shootout"; }
      } else if (e.type === "finish" && isObject(d) && isTeam(d.winner)) {
        winner = d.winner; ended = "walkover";
      }
      continue;
    }

    if (needsDecision) {
      if (e.type === "extra_time" && !extraTime) {
        extraTime = true; needsDecision = false; started = period();     // extra time kicks off at once
      } else if (e.type === "shootout_start") {
        const s = shootoutStartOf(d);
        if (s) { shootout = { ...s, A: [], B: [] }; needsDecision = false; }
      } else if (e.type === "card") {
        const c = cardOf(d);
        if (c) {
          const player = c.name ? { shirt: c.shirt, name: c.name } : { shirt: c.shirt };
          cards.push({ seq, team: c.team, color: c.color, ...player, period: shownPeriod() });
          mark(c.color + "_card", c.team, seq, player);
        }
      } else if (e.type === "finish" && isObject(d) && isTeam(d.winner)) {
        winner = d.winner; ended = "walkover";
      }
      continue;
    }

    if (e.type === "period_start") {
      const p = periodOf(d);
      const last = extraTime ? HALVES + ET_HALVES : HALVES;
      if (p === period() && started < p && p <= last) started = p;
    } else if (e.type === "goal") {
      const g = goalOf(d);
      if (g && playing()) addGoal(g.team, g.kind, g.name ? { shirt: g.shirt, name: g.name } : { shirt: g.shirt }, seq);
    } else if (e.type === "penalty_start") {
      const s = penaltyStartOf(d);
      if (s && playing()) penaltyNow = s.cancel ? null : { team: s.team };
    } else if (e.type === "penalty") {
      const p = penaltyOf(d);
      if (!p || !playing()) continue;
      penaltyNow = null;
      const player = p.shirt ? (p.name ? { shirt: p.shirt, name: p.name } : { shirt: p.shirt }) : {};
      if (p.outcome === "scored") addGoal(p.team, "penalty", player, seq);
      else {
        penalties.push({ seq, team: p.team, outcome: p.outcome, ...player, period: period() });
        mark("penalty_" + p.outcome, p.team, seq, player);
      }
    } else if (e.type === "card") {
      const c = cardOf(d);
      if (!c) continue;
      const player = c.name ? { shirt: c.shirt, name: c.name } : { shirt: c.shirt };
      cards.push({ seq, team: c.team, color: c.color, ...player, period: shownPeriod() });
      mark(c.color + "_card", c.team, seq, player);
    } else if (e.type === "remove") {
      const r = removeOf(d);
      if (!r) continue;
      const g = goals.find((x) => x.seq === r.seq);
      if (g) {
        if (!goalRemovable(g.period)) continue;
        goals = goals.filter((x) => x !== g);
        score[g.team] -= 1;
        if (g.period === period()) current[g.team] -= 1;
        else halves[g.period - 1][g.team === "A" ? 0 : 1] -= 1;
        // the score after each later goal changes too
        for (const x of goals) if (x.seq > g.seq) { if (g.team === "A") x.scoreA -= 1; else x.scoreB -= 1; }
      } else if (penalties.some((x) => x.seq === r.seq)) {
        const p = penalties.find((x) => x.seq === r.seq);
        if (!goalRemovable(p.period)) continue;
        penalties = penalties.filter((x) => x !== p);
      } else if (cards.some((x) => x.seq === r.seq)) {
        cards = cards.filter((x) => x.seq !== r.seq);
      } else continue;
      highlights = highlights.filter((h) => h.seq !== r.seq);
    } else if (e.type === "end_period") {
      const p = periodOf(d);
      if (p !== period() || started !== p) continue;
      halves.push([current.A, current.B]);
      current.A = 0; current.B = 0;
      penaltyNow = null;
      if (halves.length === HALVES || halves.length === HALVES + ET_HALVES) fullTime();
    } else if (e.type === "finish") {
      if (isObject(d) && isTeam(d.winner)) { winner = d.winner; ended = "walkover"; }
    }
  }

  const p = shownPeriod();
  const isPlaying = !winner && playing();
  let breakNow = null;
  if (!winner && !shootout) {
    if (needsDecision) breakNow = { kind: "full_time" };
    else if (started < p && p === 2) breakNow = { kind: "half_time" };
    else if (started < p && p === 4) breakNow = { kind: "extra_time_half_time" };
  }

  let so = null;
  if (shootout) {
    const done = !!winner && ended === "shootout";
    so = {
      kicks: shootout.kicks, first: shootout.first, A: shootout.A, B: shootout.B,
      scoreA: goalsIn(shootout.A), scoreB: goalsIn(shootout.B),
      next: winner ? null : nextKicker(shootout),
      // not finished: the next kick is sudden death; finished: it was decided in sudden death
      suddenDeath: done ? Math.max(shootout.A.length, shootout.B.length) > shootout.kicks
        : Math.min(shootout.A.length, shootout.B.length) >= shootout.kicks,
    };
  }

  // what the scorer may still take out (newest first on the page)
  const removable = [];
  if (!winner) {
    for (const g of goals) if (goalRemovable(g.period)) removable.push(g.seq);
    for (const x of penalties) if (goalRemovable(x.period)) removable.push(x.seq);
    if (!shootout) for (const c of cards) removable.push(c.seq);
  }

  let resultText = null;
  const line = (w) => score[w] + "-" + score[other(w)];
  if (ended === "walkover") resultText = "Team " + winner + " won (walkover)";
  else if (ended === "draw") resultText = "Draw " + score.A + "-" + score.B;
  else if (ended === "normal") resultText = "Team " + winner + " won " + line(winner);
  else if (ended === "extra_time") resultText = "Team " + winner + " won " + line(winner) + " after extra time";
  else if (ended === "shootout") {
    const w = winner === "A" ? so.scoreA + "-" + so.scoreB : so.scoreB + "-" + so.scoreA;
    resultText = "Team " + winner + " won " + w + " on penalties (" + score.A + "-" + score.B + ")";
  }

  return {
    halfMinutes: cfg.halfMinutes,
    players: cfg.players,
    knockout: cfg.knockout,
    scoreA: score.A, scoreB: score.B,
    currentA: current.A, currentB: current.B,
    period: p,
    periodName: PERIOD_NAMES[p - 1],
    isExtraTime: extraTime,
    kickedOff: started >= 1,
    playing: isPlaying,
    halves,
    goals,
    cards,
    penalties,
    highlights,
    penaltyNow: isPlaying ? penaltyNow : null,
    breakNow,
    needsDecision: !winner && needsDecision,
    canExtraTime: !winner && needsDecision && !extraTime,
    shootout: so,
    removable,
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
  const d = isObject(action.data) ? action.data : null;
  const t = action.type;

  if (t === "finish") return d && isTeam(d.winner) ? null : "choose the winner";

  if (state.shootout) {
    if (t !== "kick") return "the penalty shootout is on: enter the kicks";
    if (!d || !isTeam(d.team)) return "bad team";
    if (!OUTCOMES.includes(d.outcome)) return "choose scored, saved or missed";
    if (d.team !== state.shootout.next) return "it is Team " + state.shootout.next + "'s kick";
    return null;
  }

  if (t === "card") {
    if (!d || !isTeam(d.team)) return "bad team";
    if (!COLORS.includes(d.color)) return "choose yellow or red";
    if (!isShirt(d.shirt)) return "shirt number must be 1 to " + SHIRT_MAX;
    if (nameText(d.name) === null) return NAME_ERROR;
    return null;
  }

  if (t === "remove") {
    if (!d || !Number.isInteger(d.seq)) return "choose what to remove";
    return state.removable.includes(d.seq) ? null : "that entry can no longer be removed";
  }

  if (state.needsDecision) {
    if (t === "extra_time") return state.canExtraTime ? null : "extra time was already played: start the penalty shootout";
    if (t === "shootout_start") {
      if (!d || (d.kicks !== 3 && d.kicks !== 5)) return "choose 3 or 5 kicks";
      if (!isTeam(d.first)) return "choose who kicks first";
      return null;
    }
    return "the match is level: choose extra time or the penalty shootout";
  }
  if (t === "extra_time" || t === "shootout_start") return "only when a knockout match is level at full time";
  if (t === "kick") return "no penalty shootout is on";

  if (t === "period_start") {
    const p = d ? d.period : undefined;
    if (!Number.isInteger(p) || p < 1 || p > HALVES + ET_HALVES) return "bad half number";
    if (state.playing || p < state.period) return PERIOD_NAMES[p - 1] + " has already kicked off";
    if (p > state.period) return PERIOD_NAMES[p - 1] + " cannot start yet";
    return null;
  }

  if (t === "end_period") {
    const p = d ? d.period : undefined;
    if (!Number.isInteger(p) || p < 1 || p > HALVES + ET_HALVES) return "bad half number";
    if (p < state.period) return PERIOD_NAMES[p - 1] + " has already ended";
    if (p > state.period) return PERIOD_NAMES[p - 1] + " has not started yet";
    if (!state.playing) return PERIOD_NAMES[p - 1] + " has not kicked off yet";
    return null;
  }

  if (t === "goal" || t === "penalty" || t === "penalty_start") {
    if (!state.playing) return state.kickedOff ? "the half has not kicked off: tap KICK-OFF first" : "tap KICK-OFF first";
    if (!d) return "bad entry";
    if (t === "penalty_start") {
      if (d.cancel === true) return state.penaltyNow ? null : "no penalty is waiting";
      return isTeam(d.team) ? null : "bad team";
    }
    if (!isTeam(d.team)) return "bad team";
    if (t === "goal" && !GOAL_KINDS.includes(d.kind)) return "choose the kind of goal";
    if (t === "penalty" && !OUTCOMES.includes(d.outcome)) return "choose scored, saved or missed";
    const needShirt = t === "goal" || d.outcome === "scored";
    if (needShirt && !isShirt(d.shirt)) return "shirt number must be 1 to " + SHIRT_MAX;
    if (!needShirt && d.shirt !== undefined && d.shirt !== null && !isShirt(d.shirt)) return "shirt number must be 1 to " + SHIRT_MAX;
    if (nameText(d.name) === null) return NAME_ERROR;
    return null;
  }

  return "unknown action";
}

// The cleaned copy of the details that is saved in the database (never the raw input).
function clean(action) {
  const d = action.data;
  const t = action.type;
  if (t === "goal") return goalOf(d);
  if (t === "card") return cardOf(d);
  if (t === "penalty") return penaltyOf(d);
  if (t === "penalty_start") return penaltyStartOf(d);
  if (t === "kick") return kickOf(d);
  if (t === "shootout_start") return shootoutStartOf(d);
  if (t === "remove") return removeOf(d);
  if (t === "period_start" || t === "end_period") { const p = periodOf(d); return p ? { period: p } : null; }
  if (t === "finish") return isObject(d) && isTeam(d.winner) ? { winner: d.winner } : null;
  return null;                                      // extra_time: no details
}

// Facts for the points table: winner A, B or "draw", and goals of each side (shootout goals NOT counted).
function result(state) {
  return { finished: state.status === "finished", winner: state.winner || null, forA: state.scoreA, forB: state.scoreB };
}

// One line for the match lists. names = { A: "...", B: "..." }
function headline(state, names) {
  const score = state.scoreA + "-" + state.scoreB;
  const line = names.A + " " + score + " " + names.B;
  const so = state.shootout;
  if (state.status === "finished") {
    if (state.ended === "walkover") return names[state.winner] + " won (walkover), " + score;
    if (state.ended === "shootout") return names[state.winner] + " won on penalties " + Math.max(so.scoreA, so.scoreB) + "-" +
      Math.min(so.scoreA, so.scoreB) + ", " + score;
    if (state.ended === "extra_time") return line + " (after extra time)";
    if (state.ended === "draw") return line + " (draw)";
    return line;
  }
  if (so) return line + " (penalties " + so.scoreA + "-" + so.scoreB + ")";
  if (state.needsDecision) return line + " (full time)";
  if (!state.kickedOff) return line;
  if (state.breakNow && state.breakNow.kind === "half_time") return line + " (half time)";
  if (state.isExtraTime) return line + " (extra time)";
  return line + " (H" + state.period + ")";
}

module.exports = {
  compute, validate, clean, checkConfig, normalizeConfig, result, headline,
  collegeHalfMinutes, collegePlayers, isKnockoutStage, nextKicker, shootoutWinner, HALVES, PERIOD_NAMES,
};
