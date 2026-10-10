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

module.exports = { compute, validate };