
const assert = require("assert");
const { computeTableTennis, effectivePoints } = require("./engine");

// helper: build a list of points, A first then B
const pts = (a, b) => [
    ...Array(a).fill({ type: "point", team: "A" }),
    ...Array(b).fill({ type: "point", team: "B" }),
];

// 11-0 wins a game, and the score resets
let s = computeTableTennis(pts(11, 0));
assert.strictEqual(s.gamesA, 1);
assert.strictEqual(s.pointsA, 0);

// 11-10 is NOT a win (deuce rule)
s = computeTableTennis([...pts(10, 10), { type: "point", team: "A" }]);
assert.strictEqual(s.gamesA, 0);
assert.strictEqual(s.pointsA, 11);

// 12-10 IS a win
s = computeTableTennis([
    ...pts(10, 10),
    { type: "point", team: "A" },
    { type: "point", team: "A" }
]);
assert.strictEqual(s.gamesA, 1);

// Undo = drop the last event
const events = pts(5, 3);
s = computeTableTennis(events.slice(0, -1));
assert.strictEqual(s.pointsB, 2);

// Winning two games in a best-of-3 ends the match
s = computeTableTennis([...pts(11, 0), ...pts(11, 0)]);
assert.strictEqual(s.winner, "A");
assert.strictEqual(s.status, "finished");

// An undo cancels the latest point still counted
// The original log remains unchanged
const log = [
    { type: "point", team: "A" },
    { type: "point", team: "B" },
    { type: "undo" },
    { type: "point", team: "A" },
];

s = computeTableTennis(effectivePoints(log));
assert.strictEqual(s.pointsA, 2);
assert.strictEqual(s.pointsB, 0);

// Undo with nothing to undo does nothing
assert.strictEqual(effectivePoints([{ type: "undo" }]).length, 0);

console.log("All tests passed");
