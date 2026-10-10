const assert = require("assert");
const { computeTableTennis, effectivePoints } = require("./engine");
const { getEngine } = require("./engines");

// helper: build a list of points, A first then B
const pts = (a, b) => [
    ...Array(a).fill({ type: "point", team: "A" }),
    ...Array(b).fill({ type: "point", team: "B" }),
];

// ---------- table tennis (Lessons 3 and 6) ----------
let s = computeTableTennis(pts(11, 0));
assert.strictEqual(s.gamesA, 1);
assert.strictEqual(s.pointsA, 0);

s = computeTableTennis([...pts(10, 10), { type: "point", team: "A" }]);
assert.strictEqual(s.gamesA, 0);
assert.strictEqual(s.pointsA, 11);

s = computeTableTennis([...pts(10, 10), { type: "point", team: "A" }, { type: "point", team: "A" }]);
assert.strictEqual(s.gamesA, 1);

s = computeTableTennis([...pts(11, 0), ...pts(11, 0)]);
assert.strictEqual(s.winner, "A");
assert.strictEqual(s.status, "finished");

s = computeTableTennis(pts(15, 13));                      // 15-13 finishes a game
assert.strictEqual(s.gamesA, 1);

const log = [
    { type: "point", team: "A" },
    { type: "point", team: "B" },
    { type: "undo" },
    { type: "point", team: "A" },
];
s = computeTableTennis(effectivePoints(log));
assert.strictEqual(s.pointsA, 2);
assert.strictEqual(s.pointsB, 0);
assert.strictEqual(effectivePoints([{ type: "undo" }]).length, 0);

// ---------- simple score mode (Lesson 9) ----------
const simple = getEngine("simple");
const sp = (team, value) => ({ type: "point", team, value });

let st = simple.compute([sp("A", 2), sp("B", 3), sp("A", 1)]);
assert.strictEqual(st.scoreA, 3);
assert.strictEqual(st.scoreB, 3);
assert.strictEqual(st.status, "live");
assert.strictEqual(st.winner, null);

// finish decides the winner
st = simple.compute([sp("A", 2), sp("B", 3), { type: "finish" }]);
assert.strictEqual(st.status, "finished");
assert.strictEqual(st.winner, "B");

// equal score at the end is a draw
st = simple.compute([sp("A", 2), sp("B", 2), { type: "finish" }]);
assert.strictEqual(st.winner, "draw");

// undo cancels the last action, even a "finish"
st = simple.compute(effectivePoints([sp("A", 2), { type: "finish" }, { type: "undo" }]));
assert.strictEqual(st.status, "live");
st = simple.compute(effectivePoints([sp("A", 2), sp("B", 3), { type: "undo" }]));
assert.strictEqual(st.scoreB, 0);

// validation
const live = { status: "live" };
assert.strictEqual(simple.validate(sp("A", 2), live), null);
assert.strictEqual(simple.validate(sp("C", 2), live), "bad team");
assert.strictEqual(simple.validate(sp("A", 0), live), "bad value");
assert.strictEqual(simple.validate(sp("A", 11), live), "bad value");
assert.strictEqual(simple.validate(sp("A", 1.5), live), "bad value");
assert.strictEqual(simple.validate(sp("A", 2), { status: "finished" }), "match already finished");
assert.strictEqual(simple.validate({ type: "finish" }, live), null);
assert.strictEqual(simple.validate({ type: "finish" }, { status: "finished" }), "match already finished");
assert.strictEqual(simple.validate({ type: "dance" }, live), "unknown action");

// table tennis refuses "finish", registry refuses unknown sports
const tt = getEngine("table_tennis");
assert.strictEqual(tt.validate({ type: "finish" }, { winner: null }), "unknown action");
assert.strictEqual(getEngine("quidditch"), null);
assert.strictEqual(getEngine("constructor"), null);

console.log("All tests passed");