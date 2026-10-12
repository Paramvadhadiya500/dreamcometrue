// Cricket rules engine (team-level scoring, limited overs, two innings).
// Pure functions: the same events always give the same result. No sockets, no database.
//
// Events this engine understands (undo is handled by the server before events reach here):
//   ball         data = { runs, extra, wicket }   one delivery (see parseBall below)
//   end_innings  the scorer ends the current innings early
//   finish       the scorer abandons the match (no result)

const KINDS = ["bowled", "caught", "lbw", "stumped", "runout", "hitwicket"];
const EXTRAS = ["wide", "noball", "bye", "legbye"];
const WIDE_KINDS = ["stumped", "runout", "hitwicket"];

const DEFAULT_CONFIG = { overs: 10, players: 11, firstBatting: "A", freeHit: true };

// ---------- match settings ----------
// Returns an error text, or null if the settings are fine. (Used when a match is created.)
function checkConfig(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "settings must be an object";
  if (!Number.isInteger(c.overs) || c.overs < 1 || c.overs > 50) return "overs must be a whole number from 1 to 50";
  if (!Number.isInteger(c.players) || c.players < 2 || c.players > 11) return "players must be a whole number from 2 to 11";
  if (c.firstBatting !== "A" && c.firstBatting !== "B") return "firstBatting must be A or B";
  if (typeof c.freeHit !== "boolean") return "freeHit must be true or false";
  return null;
}

// Fills in defaults for anything missing. Falls back to the defaults if the stored settings are invalid.
function normalizeConfig(raw) {
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const merged = { ...DEFAULT_CONFIG, ...given };
  if (checkConfig(merged)) return { ...DEFAULT_CONFIG };
  return { overs: merged.overs, players: merged.players, firstBatting: merged.firstBatting, freeHit: merged.freeHit };
}

// ---------- one delivery ----------
// data.runs  : 0-6. Meaning depends on the extra:
//                none    -> runs off the bat
//                wide    -> EXTRA runs on top of the 1 penalty run (4 if it reaches the boundary)
//                noball  -> runs off the bat on top of the 1 penalty run
//                bye / legbye -> the runs scored (at least 1)
// data.extra : null | "wide" | "noball" | "bye" | "legbye"
// data.wicket: null | { kind }
function parseBall(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "bad ball" };

  const extra = data.extra === undefined || data.extra === null ? null : data.extra;
  if (extra !== null && !EXTRAS.includes(extra)) return { error: "bad extra" };

  const runs = data.runs;
  if (!Number.isInteger(runs) || runs < 0 || runs > 6) return { error: "bad runs" };
  if ((extra === "bye" || extra === "legbye") && runs < 1) return { error: "bye needs at least 1 run" };

  let wicket = null;
  if (data.wicket !== undefined && data.wicket !== null) {
    const w = data.wicket;
    if (typeof w !== "object" || Array.isArray(w) || !KINDS.includes(w.kind)) return { error: "bad wicket" };
    if (extra === "wide" && !WIDE_KINDS.includes(w.kind)) return { error: "that wicket is not possible on a wide" };
    if ((extra === "noball" || extra === "bye" || extra === "legbye") && w.kind !== "runout") {
      return { error: "only a run out is possible on this ball" };
    }
    if (w.kind !== "runout" && runs !== 0) return { error: "runs do not count with this wicket" };
    wicket = { kind: w.kind };
  }

  return { ball: { runs, extra, wicket } };
}

// ---------- innings bookkeeping ----------
function newInnings(battingTeam) {
  return {
    battingTeam,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    recent: [],            // symbols of the current (or just finished) over, e.g. ["1", "Wd", "4", "W"]
    overComplete: false,
    freeHit: false,
    status: "waiting",     // waiting | live | done
    endReason: null,
  };
}

function applyBall(inn, ball, cfg) {
  if (inn.overComplete) {          // the previous over was finished: start a fresh list
    inn.recent = [];
    inn.overComplete = false;
  }

  let total;
  let legal = true;
  let symbol;
  switch (ball.extra) {
    case "wide":
      total = 1 + ball.runs;
      inn.extras.wides += total;
      legal = false;
      symbol = "Wd" + (ball.runs ? "+" + ball.runs : "");
      break;
    case "noball":
      total = 1 + ball.runs;
      inn.extras.noBalls += 1;
      legal = false;
      symbol = "Nb" + (ball.runs ? "+" + ball.runs : "");
      break;
    case "bye":
      total = ball.runs;
      inn.extras.byes += total;
      symbol = "B" + ball.runs;
      break;
    case "legbye":
      total = ball.runs;
      inn.extras.legByes += total;
      symbol = "Lb" + ball.runs;
      break;
    default:
      total = ball.runs;
      symbol = String(ball.runs);
  }

  inn.runs += total;
  if (legal) inn.legalBalls += 1;

  if (ball.wicket) {
    inn.wickets += 1;
    symbol = symbol === "0" ? "W" : symbol + "+W";
  }

  // free hit: starts after a no-ball, stays through wides and further no-balls, ends after a legal ball
  if (cfg.freeHit) {
    if (ball.extra === "noball") inn.freeHit = true;
    else if (legal) inn.freeHit = false;
  }

  if (legal && inn.legalBalls % 6 === 0) inn.overComplete = true;
  inn.recent.push(symbol);
}

function endReason(inn, cfg, target) {
  if (target !== null && inn.runs >= target) return "target reached";
  if (inn.wickets >= cfg.players - 1) return "all out";
  if (inn.legalBalls >= cfg.overs * 6) return "overs complete";
  return null;
}

const round2 = (x) => Math.round(x * 100) / 100;
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

function publicInnings(inn) {
  const e = inn.extras;
  return {
    battingTeam: inn.battingTeam,
    runs: inn.runs,
    wickets: inn.wickets,
    legalBalls: inn.legalBalls,
    overs: Math.floor(inn.legalBalls / 6) + "." + (inn.legalBalls % 6),
    runRate: inn.legalBalls ? round2((inn.runs * 6) / inn.legalBalls) : 0,
    extras: { wides: e.wides, noBalls: e.noBalls, byes: e.byes, legByes: e.legByes, total: e.wides + e.noBalls + e.byes + e.legByes },
    recent: inn.recent.slice(),
    status: inn.status,
    endReason: inn.endReason,
  };
}

// ---------- the main function ----------
function compute(events, match) {
  const cfg = normalizeConfig(match && match.config);
  const first = cfg.firstBatting;
  const second = first === "A" ? "B" : "A";
  const maxWickets = cfg.players - 1;

  const innings = [newInnings(first), newInnings(second)];
  innings[0].status = "live";
  let cur = 0;
  let target = null;
  let over = false;
  let abandoned = false;

  function closeInnings(reason) {
    innings[cur].status = "done";
    innings[cur].endReason = reason;
    if (cur === 0) {
      cur = 1;
      target = innings[0].runs + 1;
      innings[1].status = "live";
    } else {
      over = true;
    }
  }

  for (const e of events) {
    if (over) break;
    if (e.type === "ball") {
      const parsed = parseBall(e.data);
      if (parsed.error) continue;                       // the server never stores these
      applyBall(innings[cur], parsed.ball, cfg);
      const reason = endReason(innings[cur], cfg, cur === 1 ? target : null);
      if (reason) closeInnings(reason);
    } else if (e.type === "end_innings") {
      closeInnings("ended by scorer");
    } else if (e.type === "finish") {
      abandoned = true;
      over = true;
    }
  }

  // result
  let winner = null;
  let resultText = null;
  if (over && abandoned) {
    resultText = "Match abandoned (no result)";
  } else if (over) {
    const r1 = innings[0].runs;
    const r2 = innings[1].runs;
    if (r2 >= target) {
      winner = second;
      resultText = "Team " + second + " won by " + plural(maxWickets - innings[1].wickets, "wicket");
    } else if (r2 < r1) {
      winner = first;
      resultText = "Team " + first + " won by " + plural(r1 - r2, "run");
    } else {
      winner = "tie";
      resultText = "Match tied";
    }
  }

  // chase information
  let need = null;
  let ballsLeft = null;
  let requiredRate = null;
  if (cur === 1 && !over) {
    need = target - innings[1].runs;
    ballsLeft = cfg.overs * 6 - innings[1].legalBalls;
    requiredRate = ballsLeft > 0 ? round2((need * 6) / ballsLeft) : null;
  }

  return {
    maxOvers: cfg.overs,
    maxWickets,
    inning: cur + 1,
    innings: [publicInnings(innings[0]), publicInnings(innings[1])],
    target,
    need,
    ballsLeft,
    requiredRate,
    freeHit: !over && innings[cur].freeHit,
    status: over ? "finished" : "live",
    winner,
    resultText,
  };
}

// ---------- rules check before an action is stored ----------
// Returns an error text, or null if the action is allowed. (Undo is handled by the server.)
function validate(action, state) {
  if (state.status === "finished") return "match already finished";

  if (action.type === "ball") {
    const p = parseBall(action.data);
    if (p.error) return p.error;
    if (state.freeHit && p.ball.wicket && p.ball.wicket.kind !== "runout") {
      return "free hit: only a run out is possible";
    }
    return null;
  }

  if (action.type === "end_innings") {
    const inn = state.innings[state.inning - 1];
    if (inn.legalBalls === 0 && inn.runs === 0) return "no balls bowled in this innings yet";
    return null;
  }

  if (action.type === "finish") return null;
  return "unknown action";
}

// The cleaned copy of the ball details that is saved in the database (never the raw input).
function clean(action) {
  if (action.type !== "ball") return null;
  const p = parseBall(action.data);
  return p.error ? null : p.ball;
}

// Facts for the points table. Runs and balls are per TEAM (A or B), not per innings.
// A team that was all out counts as having faced its full quota of overs (net run rate rule).
function result(state) {
  const finished = state.status === "finished";
  const byTeam = {};
  for (const inn of state.innings) byTeam[inn.battingTeam] = inn;
  const full = state.maxOvers * 6;
  const balls = (inn) => (inn.endReason === "all out" ? full : inn.legalBalls);
  return {
    finished,
    winner: state.winner === "tie" ? "draw" : state.winner,
    noResult: finished && state.winner === null,
    forA: byTeam.A.runs,
    forB: byTeam.B.runs,
    ballsA: balls(byTeam.A),
    ballsB: balls(byTeam.B),
  };
}

// One line for the match lists. names = { A: "...", B: "..." }
function headline(state, names) {
  const cur = state.innings[state.inning - 1];
  const part = (inn) => names[inn.battingTeam] + " " + inn.runs + "/" + inn.wickets;
  if (state.inning === 1) return part(cur) + " (" + cur.overs + " ov)";
  let text = part(state.innings[0]) + ", " + part(cur) + " (" + cur.overs + " ov)";
  if (state.status !== "finished" && state.need !== null) text += ", need " + state.need + " from " + state.ballsLeft + " balls";
  return text;
}

module.exports = { compute, validate, clean, checkConfig, normalizeConfig, parseBall, result, headline };
