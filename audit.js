// Score history for the admin page: every scoring action of one match, in plain words, with who did it,
// when the server saved it, whether it was undone, and the score right after it.
// Pure: no database. admin.js reads the rows and calls buildHistory().
const { effectivePoints } = require("./engine");

const KIND_NAMES = { bowled: "Bowled", caught: "Caught", lbw: "LBW", stumped: "Stumped", runout: "Run out", hitwicket: "Hit wicket" };

// same rule as teamNames() in server.js: an empty name shows as "Team A" / "Team B"
function teamNames(match) {
  return { A: (match.team_a || "").trim() || "Team A", B: (match.team_b || "").trim() || "Team B" };
}

// one cricket ball in words (same wording as the scorer page, public/scorer.html describe())
function ballText(data) {
  const runs = Number.isInteger(data.runs) ? data.runs : 0;
  let t;
  if (data.extra === "wide") t = "Wide" + (runs ? " + " + runs : "");
  else if (data.extra === "noball") t = "No ball" + (runs ? " + " + runs + " off the bat" : "");
  else if (data.extra === "bye") t = runs + " bye" + (runs > 1 ? "s" : "");
  else if (data.extra === "legbye") t = runs + " leg bye" + (runs > 1 ? "s" : "");
  else t = runs === 0 ? "Dot ball" : runs + (runs === 1 ? " run" : " runs");
  if (data.wicket) t += " + WICKET (" + (KIND_NAMES[data.wicket.kind] || data.wicket.kind) + ")";
  return t;
}

function actionText(e, names) {
  if (e.type === "point") return "+" + (Number.isInteger(e.value) ? e.value : 1) + " for " + (names[e.team] || e.team);
  if (e.type === "ball" && e.data) return ballText(e.data);
  if (e.type === "finish") return "Finish match" + (e.data && names[e.data.winner] ? " (" + names[e.data.winner] + " wins)" : "");
  if (e.type === "end_innings") return "End innings";
  return String(e.type);
}

// match: the matches row (sport, best_of, config, team_a, team_b); events: rows in seq order
// (seq, type, team, value, data, by_user, created_at); engine: getEngine(match.sport)
function buildHistory(match, events, engine) {
  const names = teamNames(match);
  const rows = [];
  const counted = [];               // rows still counted, newest last (the same stack as effectivePoints)
  const prefix = [];

  for (const e of events) {
    const row = {
      seq: Number(e.seq),
      at: new Date(e.created_at).toISOString(),
      by: e.by_user,
      type: e.type,
      text: "",
      undone: false,
      undoneBySeq: null,
      undoesSeq: null,
      after: null,
    };
    if (e.type === "undo") {
      const target = counted.pop();
      if (target) {
        target.undone = true;
        target.undoneBySeq = row.seq;
        row.undoesSeq = target.seq;
        row.text = "UNDO (cancels: " + target.text + ")";
      } else {
        row.text = "UNDO (nothing to cancel)";
      }
    } else {
      row.text = actionText(e, names);
      counted.push(row);
    }

    prefix.push(e);
    try {
      row.after = engine.headline(engine.compute(effectivePoints(prefix), match), names);
    } catch (err) {
      row.after = null;             // a broken old row must not break the whole page
    }
    rows.push(row);
  }

  return { total: events.length, rows: rows.reverse() };
}

module.exports = { buildHistory };
