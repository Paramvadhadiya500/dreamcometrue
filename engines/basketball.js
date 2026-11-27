// Basketball rules engine (FIBA, points only: no clock, no fouls, no timeouts).
// Pure functions: the same events always give the same result. No sockets, no database.
//
// Events this engine understands (undo is handled by the server before events reach here):
//   point       team A or B scores: value 1 (free throw), 2 (basket) or 3 (basket from behind the 3-point line)
//   end_period  the scorer ends the current quarter or overtime (there is no game clock in the app)
//   finish      the scorer ends the match early and picks the winner: data = { winner: "A" | "B" }
//
// A match has 4 quarters. If the score is level after quarter 4, 5-minute overtimes are played
// until one team is ahead at the end of an overtime. There are no draws.
// The minutes are only shown on the pages (college rule: 7 min up to the quarter final, 10 min in the semi final and final).

const QUARTERS = 4;
const DEFAULT_CONFIG = { quarterMinutes: 10, overtimeMinutes: 5 };

const isTeam = (t) => t === "A" || t === "B";
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isMinutes = (m, max) => Number.isInteger(m) && m >= 1 && m <= max;

// College rule: quarter length from the stage. Semi final and final: 10 minutes, everything else: 7.
function collegeQuarterMinutes(stage) {
  return stage === "semi_final" || stage === "final" ? 10 : 7;
}

// ---------- match settings ----------
// Returns an error text, or null if the settings are fine. (Used when a match is created.)
function checkConfig(c) {
  if (!isObject(c)) return "settings must be an object";
  if (!isMinutes(c.quarterMinutes, 20)) return "quarter minutes must be a whole number from 1 to 20";
  if (!isMinutes(c.overtimeMinutes, 10)) return "overtime minutes must be a whole number from 1 to 10";
  return null;
}

// Fills in defaults for anything missing. Falls back to the defaults if the stored settings are invalid.
function normalizeConfig(raw) {
  const merged = { ...DEFAULT_CONFIG, ...(isObject(raw) ? raw : {}) };
  if (checkConfig(merged)) return { ...DEFAULT_CONFIG };
  return { quarterMinutes: merged.quarterMinutes, overtimeMinutes: merged.overtimeMinutes };
}

const periodNameOf = (p) => (p <= QUARTERS ? "Quarter " + p : "Overtime " + (p - QUARTERS));
const shortNameOf = (p) => (p <= QUARTERS ? "Q" + p : "OT" + (p - QUARTERS));

// ---------- the main function ----------
function compute(events, match) {
  const cfg = normalizeConfig(match && match.config);

  let scoreA = 0, scoreB = 0;       // whole match
  let currentA = 0, currentB = 0;   // the period being played now
  const periods = [];               // finished periods: [pointsA, pointsB] scored in that period
  let winner = null;
  let ended = null;

  for (const e of events) {
    if (winner) break;                                        // match is over, ignore extra events
    if (e.type === "point") {
      const v = e.value;
      if (v !== 1 && v !== 2 && v !== 3) continue;            // the server never stores a bad value
      if (e.team === "A") { scoreA += v; currentA += v; }
      else if (e.team === "B") { scoreB += v; currentB += v; }
    } else if (e.type === "end_period") {
      periods.push([currentA, currentB]);
      currentA = 0;
      currentB = 0;
      if (periods.length >= QUARTERS && scoreA !== scoreB) {  // after quarter 4 (or an overtime) and not level
        winner = scoreA > scoreB ? "A" : "B";
        ended = "normal";
      }
    } else if (e.type === "finish") {
      const w = isObject(e.data) ? e.data.winner : null;
      if (isTeam(w)) { winner = w; ended = "walkover"; }
    }
  }

  // when finished, "period" stays on the last one played
  const period = winner && ended === "normal" ? periods.length : periods.length + 1;
  const isOvertime = period > QUARTERS;

  let resultText = null;
  if (winner && ended === "walkover") {
    resultText = "Team " + winner + " won (walkover)";
  } else if (winner) {
    const w = winner === "A" ? scoreA : scoreB;
    const l = winner === "A" ? scoreB : scoreA;
    resultText = "Team " + winner + " won " + w + "-" + l + (periods.length > QUARTERS ? " (after overtime)" : "");
  }

  return {
    quarterMinutes: cfg.quarterMinutes,
    overtimeMinutes: cfg.overtimeMinutes,
    scoreA, scoreB,
    currentA, currentB,
    period,
    isOvertime,
    periodName: periodNameOf(period),
    periodMinutes: isOvertime ? cfg.overtimeMinutes : cfg.quarterMinutes,
    periods,
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

  if (action.type === "point") {
    if (!isTeam(action.team)) return "bad team";
    if (action.value !== 1 && action.value !== 2 && action.value !== 3) return "points must be 1, 2 or 3";
    return null;
  }

  if (action.type === "end_period") return null;              // a quarter may end 0-0

  if (action.type === "finish") {
    if (!isObject(action.data) || !isTeam(action.data.winner)) return "choose the winner";
    return null;
  }

  return "unknown action";
}

// The cleaned copy of the details that is saved in the database (never the raw input).
function clean(action) {
  if (action.type !== "finish") return null;
  if (!isObject(action.data) || !isTeam(action.data.winner)) return null;
  return { winner: action.data.winner };
}

// Facts for the points table: who won, and points scored by each side (for the point difference).
function result(state) {
  return { finished: state.status === "finished", winner: state.winner || null, forA: state.scoreA, forB: state.scoreB };
}

// One line for the match lists. names = { A: "...", B: "..." }
function headline(state, names) {
  const score = state.scoreA + "-" + state.scoreB;
  if (state.status === "finished") {
    if (state.ended === "walkover") return names[state.winner] + " won (walkover), " + score;
    return names.A + " " + score + " " + names.B + (state.periods.length > QUARTERS ? " (OT)" : "");
  }
  return names.A + " " + score + " " + names.B + " (" + shortNameOf(state.period) + ")";
}

module.exports = { compute, validate, clean, checkConfig, normalizeConfig, result, headline, collegeQuarterMinutes, QUARTERS };
