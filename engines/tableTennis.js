const { computeTableTennis } = require("../engine");

function compute(events, match) {
  return computeTableTennis(events, match.best_of);
}

// Returns an error text, or null if the action is allowed. (Undo is handled by the server.)
function validate(action, state) {
  if (action.type !== "point") return "unknown action";
  if (action.team !== "A" && action.team !== "B") return "bad team";
  if (state.winner) return "match already finished";
  return null;
}

// Short facts used by the points table: who won, and games won by each side.
function result(state) {
  return { finished: state.status === "finished", winner: state.winner || null, forA: state.gamesA, forB: state.gamesB };
}

// One line for the match lists. names = { A: "...", B: "..." }
function headline(state, names) {
  const games = names.A + " " + state.gamesA + "-" + state.gamesB + " " + names.B;
  return state.status === "finished" ? games : games + " (" + state.pointsA + "-" + state.pointsB + " in this game)";
}

module.exports = { compute, validate, result, headline };
