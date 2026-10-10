// ---- Table tennis rules (unchanged from Lesson 3) ----
function computeTableTennis(events, bestOf = 3) {
    const gamesToWin = Math.ceil(bestOf / 2);
    let pointsA = 0, pointsB = 0;
    let gamesA = 0, gamesB = 0;
    const finishedGames = [];
    let winner = null;

    for (const e of events) {
        if (winner) break;                       // match is over, ignore extra events
        if (e.type !== "point") continue;

        if (e.team === "A") pointsA++;
        else if (e.team === "B") pointsB++;
        else continue;

        const top = Math.max(pointsA, pointsB);
        const lead = Math.abs(pointsA - pointsB);

        if (top >= 11 && lead >= 2) {            // game finished
            if (pointsA > pointsB) gamesA++; else gamesB++;
            finishedGames.push([pointsA, pointsB]);
            pointsA = 0;
            pointsB = 0;
            if (gamesA === gamesToWin) winner = "A";
            if (gamesB === gamesToWin) winner = "B";
        }
    }

    return {
        pointsA, pointsB, gamesA, gamesB,
        finishedGames, winner,
        status: winner ? "finished" : "live",
    };
}

// ---- Undo handling (now works for ANY kind of event) ----
// Replays the log: every undo cancels the most recent event still counted.
function effectivePoints(events) {
    const stack = [];
    for (const e of events) {
        if (e.type === "undo") stack.pop();
        else stack.push(e);
    }
    return stack;
}

module.exports = { computeTableTennis, effectivePoints };