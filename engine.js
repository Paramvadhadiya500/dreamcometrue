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
// Entries UNDO never takes back: kabaddi "raid started" (shown only). UNDO takes back the newest OTHER entry,
// so a scorer who tapped "CSE raids" and then presses UNDO still takes back the last scoring entry.
// Other sports have no such entries: for them nothing changes.
const NOT_UNDOABLE = new Set(["raid_start"]);

function effectivePoints(events) {
    const stack = [];
    for (const e of events) {
        if (e.type === "undo") {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (!NOT_UNDOABLE.has(stack[i].type)) { stack.splice(i, 1); break; }
            }
        } else {
            stack.push(e);
        }
    }
    return stack;
}

// true when an UNDO would take something back
function canUndo(events) {
    return effectivePoints(events).some((e) => !NOT_UNDOABLE.has(e.type));
}

module.exports = { computeTableTennis, effectivePoints, canUndo, NOT_UNDOABLE };