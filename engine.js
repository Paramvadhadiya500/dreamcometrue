
function computeTableTennis(events, bestOf = 3) {
    const gamesToWin = Math.ceil(bestOf / 2);
    let pointsA = 0, pointsB = 0;
    let gamesA = 0, gamesB = 0;
    const finishedGames = [];
    let winner = null;

    for (const e of events) {
        if (winner) break;
        if (e.type !== "point") continue;

        if (e.team === "A") pointsA++;
        else if (e.team === "B") pointsB++;
        else continue;

        const top = Math.max(pointsA, pointsB);
        const lead = Math.abs(pointsA - pointsB);

        if (top >= 11 && lead >= 2) {
            if (pointsA > pointsB) gamesA++;
            else gamesB++;

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

// Replays the log: each undo cancels the most recent point still counted.
function effectivePoints(events) {
    const stack = [];

    for (const e of events) {
        if (e.type === "point") {
            stack.push(e);
        } else if (e.type === "undo") {
            stack.pop();
        }
    }

    return stack;
}

module.exports = { computeTableTennis, effectivePoints };
