// Volleyball rules engine (rally scoring, best of 3 or 5 sets).
// Pure functions: the same events always give the same result. No sockets, no database.
//
// Events this engine understands (undo is handled by the server before events reach here):
//   point   team A or B wins one rally (value is ignored, it always counts 1)
//   finish  the scorer ends the match early and picks the winner: data = { winner: "A" | "B" }
//
// A set is won by the first team to reach the target with a lead of at least winBy points.
// The deciding set (both teams one set away from winning) uses decidingPoints as its target.

const DEFAULT_CONFIG = { bestOf: 3, setPoints: 25, decidingPoints: 15, winBy: 2 };

const isTeam = (t) => t === "A" || t === "B";
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// ---------- match settings ----------
// Returns an error text, or null if the settings are fine. (Used when a match is created.)
function checkConfig(c) {
  if (!isObject(c)) return "settings must be an object";
  if (c.bestOf !== 3 && c.bestOf !== 5) return "best of must be 3 or 5";
  if (!Number.isInteger(c.setPoints) || c.setPoints < 5 || c.setPoints > 50) return "points per set must be a whole number from 5 to 50";
  if (!Number.isInteger(c.decidingPoints) || c.decidingPoints < 5 || c.decidingPoints > 50) return "points in the deciding set must be a whole number from 5 to 50";
  if (c.decidingPoints > c.setPoints) return "the deciding set cannot be longer than a normal set";
  if (c.winBy !== 1 && c.winBy !== 2) return "win by must be 1 or 2";
  return null;
}

// Fills in defaults for anything missing. Falls back to the defaults if the stored settings are invalid.
function normalizeConfig(raw) {
  const given = isObject(raw) ? raw : {};
  const merged = { ...DEFAULT_CONFIG, ...given };
  if (checkConfig(merged)) return { ...DEFAULT_CONFIG };
  return { bestOf: merged.bestOf, setPoints: merged.setPoints, decidingPoints: merged.decidingPoints, winBy: merged.winBy };
}

// ---------- the main function ----------
function compute(events, match) {
  const cfg = normalizeConfig(match && match.config);
  const setsToWin = (cfg.bestOf + 1) / 2;

  let pointsA = 0, pointsB = 0;
  let setsA = 0, setsB = 0;
  const finishedSets = [];
  let winner = null;
  let ended = null;

  const isDeciding = () => setsA === setsToWin - 1 && setsB === setsToWin - 1;
  const targetNow = () => (isDeciding() ? cfg.decidingPoints : cfg.setPoints);

  for (const e of events) {
    if (winner) break;                                        // match is over, ignore extra events
    if (e.type === "point") {
      if (e.team === "A") pointsA++;
      else if (e.team === "B") pointsB++;
      else continue;

      const top = Math.max(pointsA, pointsB);
      const lead = Math.abs(pointsA - pointsB);
      if (top >= targetNow() && lead >= cfg.winBy) {          // set finished
        if (pointsA > pointsB) setsA++; else setsB++;
        finishedSets.push([pointsA, pointsB]);
        pointsA = 0;
        pointsB = 0;
        if (setsA === setsToWin) { winner = "A"; ended = "normal"; }
        else if (setsB === setsToWin) { winner = "B"; ended = "normal"; }
      }
    } else if (e.type === "finish") {
      const w = isObject(e.data) ? e.data.winner : null;
      if (isTeam(w)) { winner = w; ended = "walkover"; }      // the server never stores a bad winner
    }
  }

  let resultText = null;
  if (winner && ended === "walkover") {
    resultText = "Team " + winner + " won (walkover)";
  } else if (winner) {
    const w = winner === "A" ? setsA : setsB;
    const l = winner === "A" ? setsB : setsA;
    resultText = "Team " + winner + " won " + w + "-" + l;
  }

  return {
    bestOf: cfg.bestOf,
    setsToWin,
    winBy: cfg.winBy,
    setsA, setsB,
    pointsA, pointsB,
    currentSet: setsA + setsB + 1,
    isDeciding: isDeciding(),
    target: targetNow(),
    finishedSets,
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
    if (action.value !== undefined && action.value !== null && action.value !== 1) return "bad value";
    return null;
  }

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

// Facts for the points table: who won, and sets won by each side.
function result(state) {
  return { finished: state.status === "finished", winner: state.winner || null, forA: state.setsA, forB: state.setsB };
}

// One line for the match lists. names = { A: "...", B: "..." }
function headline(state, names) {
  const sets = state.setsA + "-" + state.setsB;
  if (state.status === "finished") {
    if (state.ended === "walkover") return names[state.winner] + " won (walkover), sets " + sets;
    return names.A + " " + sets + " " + names.B;
  }
  const label = state.isDeciding ? "deciding set" : "set " + state.currentSet;
  return names.A + " " + sets + " " + names.B + " (" + label + ": " + state.pointsA + "-" + state.pointsB + ")";
}

module.exports = { compute, validate, clean, checkConfig, normalizeConfig, result, headline };
