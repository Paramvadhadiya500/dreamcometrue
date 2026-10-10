// Usage: node loadtest.js <viewers> <url[,url2,...]> [rounds]
// Scorer login: set SCORER_USER and SCORER_PASS (defaults are the Lesson 6 demo account).
const { io } = require("socket.io-client");
const { performance } = require("perf_hooks");

const VIEWERS = Number(process.argv[2] || 500);
const URLS = (process.argv[3] || "http://localhost:3000").split(",");
const ROUNDS = Number(process.argv[4] || 10);
const MATCH = "tt-1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

async function main() {
    // ---- 1. connect the viewers (students) in small batches ----
    const arrivals = new Map();      // version -> list of arrival times
    const firstState = [];           // time each viewer needed for its first score
    const viewers = [];
    let failed = 0;

    console.log(`Connecting ${VIEWERS} viewers to ${URLS.join(", ")} ...`);
    for (let i = 0; i < VIEWERS; i += 100) {
        const batch = [];
        for (let j = i; j < Math.min(i + 100, VIEWERS); j++) {
            batch.push(new Promise((resolve) => {
                const s = io(URLS[j % URLS.length], { transports: ["websocket"], reconnection: false });
                let t0 = 0, gotFirst = false;
                const giveUp = setTimeout(() => { failed++; resolve(); }, 15000);
                s.on("connect", () => { t0 = performance.now(); s.emit("join-match", MATCH); });
                s.on("connect_error", () => { clearTimeout(giveUp); failed++; resolve(); });
                s.on("score:update", (st) => {
                    const now = performance.now();
                    if (!gotFirst) {
                        gotFirst = true;
                        firstState.push(now - t0);
                        clearTimeout(giveUp);
                        resolve();
                        return;
                    }
                    if (!arrivals.has(st.version)) arrivals.set(st.version, []);
                    arrivals.get(st.version).push(now);
                });
                viewers.push(s);
            }));
        }
        await Promise.all(batch);
    }
    firstState.sort((a, b) => a - b);
    console.log(`Ready: ${firstState.length}/${VIEWERS} viewers (failed: ${failed})`);
    if (firstState.length === 0) process.exit(1);
    console.log(`First score after joining: median ${pct(firstState, 50).toFixed(0)} ms, ` +
        `95th percentile ${pct(firstState, 95).toFixed(0)} ms, worst ${firstState[firstState.length - 1].toFixed(0)} ms`);

    // ---- 2. log in as the scorer ----
    const r = await fetch(URLS[0] + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: process.env.SCORER_USER || "rahul", password: process.env.SCORER_PASS || "rahul123" }),
    });
    if (!r.ok) { console.log("Scorer login failed"); process.exit(1); }
    const { token } = await r.json();
    const scorer = io(URLS[0], { transports: ["websocket"], auth: { token }, reconnection: false });
    await new Promise((res) => scorer.on("connect", res));

    // ---- 3. alternate point / undo, so the match never finishes ----
    const worst = [];
    for (let round = 1; round <= ROUNDS; round++) {
        const type = round % 2 === 1 ? "point" : "undo";
        const action = { id: "lt-" + Date.now() + "-" + round, matchId: MATCH, type, team: type === "point" ? "A" : undefined };

        const t0 = performance.now();
        const res = await new Promise((resolve) => {
            scorer.timeout(10000).emit("score:action", action, (err, ack) => resolve(err ? { ok: false, error: "no answer" } : ack));
        });
        if (!res.ok) {
            console.log(`Round ${round}: rejected (${res.error}). If the match is finished, reset it first (see lesson).`);
            break;
        }
        const ackMs = performance.now() - t0;
        const v = res.state.version;

        // wait until every viewer has this version (max 10 s)
        const deadline = performance.now() + 10000;
        while ((arrivals.get(v) || []).length < firstState.length && performance.now() < deadline) await sleep(5);

        const list = (arrivals.get(v) || []).map((t) => t - t0).sort((a, b) => a - b);
        const missing = firstState.length - list.length;
        worst.push(list.length ? list[list.length - 1] : Infinity);
        console.log(
            `Round ${String(round).padStart(2)} ${type.padEnd(5)}: scorer ack ${ackMs.toFixed(0)} ms | ` +
            `viewers ${list.length}/${firstState.length} | median ${list.length ? pct(list, 50).toFixed(0) : "-"} ms | ` +
            `95th ${list.length ? pct(list, 95).toFixed(0) : "-"} ms | worst ${list.length ? list[list.length - 1].toFixed(0) : "-"} ms` +
            (missing ? `  <-- ${missing} MISSED` : "")
        );
        await sleep(300);
    }

    const w = worst.filter(Number.isFinite);
    if (w.length) console.log(`\nWorst delay in any round: ${Math.max(...w).toFixed(0)} ms (goal: under 5000 ms)`);
    viewers.forEach((s) => s.disconnect());
    scorer.disconnect();
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });