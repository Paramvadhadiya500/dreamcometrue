// "Simple score" mode: works for any sport where a scorer just adds points to a team.

function compute(events) {
    let scoreA = 0, scoreB = 0, finished = false;
    for (const e of events) {
        if (e.type === "point") {
            const v = Number.isInteger(e.value) ? e.value : 1;
            if (e.team === "A") scoreA += v;
            else if (e.team === "B") scoreB += v;
        } else if (e.type === "finish") {
            finished = true;
        }
    }
    const winner = finished ? (scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw") : null;
    return { scoreA, scoreB, winner, status: finished ? "finished" : "live" };
}

function validate(action, state) {
    if (action.type === "point") {
        if (action.team !== "A" && action.team !== "B") return "bad team";
        if (!Number.isInteger(action.value) || action.value < 1 || action.value > 10) return "bad value";
        if (state.status === "finished") return "match already finished";
        return null;
    }
    if (action.type === "finish") {
        if (state.status === "finished") return "match already finished";
        return null;
    }
    return "unknown action";
}

module.exports = { compute, validate };