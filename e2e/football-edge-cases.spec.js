// Football: the scorer's test list (the guide given to the user), on 360 px phones, through the REAL server and database.
// A scorer phone and a student phone side by side. Each test makes its own match and deletes it afterwards.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, PASSWORD, openDb, scorerSocket } = require("./helpers");

test.use({ viewport: { width: 360, height: 740 } });

const A = "CSE";
const B = "ECE";
let n = 0;

// a match + a logged-in scorer page + a student page
async function setup(page, browser, { category = "boys", stage = "group", knockout = false } = {}) {
  const pool = openDb();
  const id = "e2e-fbx-" + RUN + "-" + (++n);
  const minutes = category === "girls" ? 7 : 15, players = category === "girls" ? 5 : 6;
  await pool.query(
    `INSERT INTO matches (id, name, sport, config, team_a, team_b, category, stage)
     VALUES ($1, 'Edge football', 'football', $2, $3, $4, $5, $6)`,
    [id, JSON.stringify({ halfMinutes: minutes, players, knockout }), A, B, category, stage]);
  await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [SCORER, id]);
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await page.goto("/scorer.html");
  await page.locator("#u").fill(SCORER);
  await page.locator("#p").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.locator("#match").selectOption(id);
  await expect(page.locator("#fbControls")).toBeVisible();
  const student = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await student.goto("/match.html?id=" + id);
  await expect(student.locator("#football")).toBeVisible();
  const cleanup = async () => {
    await student.close();
    await pool.query("DELETE FROM events WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    await pool.end();
  };
  return { id, pool, student, dialogs, cleanup };
}

// GOAL for a team: kind, shirt, name
async function goal(page, team, shirt, kind = "normal", name = "") {
  await page.locator("#fbGoal" + team).click();
  if (kind !== "normal") await page.locator("#fbKind_" + kind).click();
  await page.locator("#fbShirt").fill(String(shirt));
  if (name) await page.locator("#fbPlayerName").fill(name);
  await page.locator("#fbSave").click();
  await expect(page.locator("#fbForm")).toBeHidden();
}
async function kick(page, outcome) {
  await expect(page.locator("#fbKick_" + outcome)).toBeEnabled();      // the 1.5 s lock after the last kick
  await page.locator("#fbKick_" + outcome).click();
}
const score = async (page, a, b) => {
  await expect(page.locator("#fbA")).toHaveText(String(a));
  await expect(page.locator("#fbB")).toHaveText(String(b));
};
const types = async (pool, id) => (await pool.query("SELECT type FROM events WHERE match_id = $1 ORDER BY seq", [id])).rows.map((r) => r.type);

test("1-8: group match: kick-off first, goal, own goal, penalty saved, red card, remove, double END, draw", async ({ page, browser }) => {
  const m = await setup(page, browser);
  const st = m.student;
  try {
    // 1. before KICK-OFF: no GOAL / PENALTY buttons, only CARD
    await expect(page.locator("#fbGoalA")).toBeHidden();
    await expect(page.locator("#fbPenB")).toBeHidden();
    await expect(page.locator("#fbCardA")).toBeVisible();
    await expect(st.locator("#fbBanner")).toHaveText("Kick-off soon");
    await page.locator("#fbKickoff").click();
    await expect(st.locator("#fbBanner")).toBeHidden();
    await expect(st.locator("#fbPeriod")).toHaveText("1st half (6-a-side, 2 x 15 min)");

    // 2. goal CSE #9 Rahul
    await goal(page, "A", 9, "normal", "Rahul");
    await score(page, 1, 0);
    await expect(st.locator("#kbPop")).toHaveText("GOAL! CSE #9 Rahul · 1-0");
    await expect(st.locator("#fbGoalsA li")).toHaveText(["#9 Rahul"]);

    // 3. own goal: GOAL under ECE (they GET it), shirt of the CSE player
    await page.locator("#fbGoalB").click();
    await page.locator("#fbKind_own_goal").click();
    await expect(page.locator("#fbShirtQ")).toHaveText("Shirt number of the CSE player who put it in");
    await page.locator("#fbShirt").fill("4");
    await page.locator("#fbSave").click();
    await score(page, 1, 1);
    await expect(st.locator("#kbPop")).toHaveText("OWN GOAL! ECE #4 · 1-1");
    await expect(st.locator("#fbGoalsB li")).toHaveText(["#4 (og)"]);

    // 4. penalty for ECE: the box at once, then SAVED: no goal
    await page.locator("#fbPenB").click();
    await expect(st.locator("#fbPenaltyTitle")).toHaveText("PENALTY TO ECE!");
    await page.locator("#fbOut_saved").click();
    await page.locator("#fbSave").click();
    await expect(st.locator("#fbPenalty")).toBeHidden();
    await expect(st.locator("#kbPop")).toHaveText("PENALTY SAVED! ECE did not score");
    await score(page, 1, 1);

    // 5. red card ECE #5
    await page.locator("#fbCardB").click();
    await page.locator("#fbColor_red").click();
    await page.locator("#fbShirt").fill("5");
    await page.locator("#fbSave").click();
    await expect(st.locator("#kbPop")).toHaveText("RED CARD! ECE #5");
    await expect(st.locator("#fbEvents li .fb-card.red")).toHaveCount(1);

    // 6. Fix a mistake: remove CSE's goal -> 0-1 on both phones
    await page.locator("#fbFixBtn").click();
    await page.locator("#fbFixList button", { hasText: "GOAL CSE #9 Rahul" }).click();
    await score(page, 0, 1);
    await expect(st.locator("#sA")).toHaveText("0");
    await expect(st.locator("#fbGoalsA li")).toHaveCount(0);

    // 7. END 1ST HALF twice quickly: only one is stored
    await page.locator("#fbEnd").click();
    await page.locator("#fbEnd").click({ force: true, timeout: 1000 }).catch(() => {});   // the button is already gone
    await expect(st.locator("#fbBanner")).toHaveText("HALF TIME");
    await expect(page.locator("#fbKickoff")).toHaveText("KICK-OFF 2nd half");
    // a card at half time is allowed (it happens)
    await page.locator("#fbCardA").click();
    await page.locator("#fbColor_yellow").click();
    await page.locator("#fbShirt").fill("3");
    await page.locator("#fbSave").click();
    await expect(st.locator("#kbPop")).toHaveText("Yellow card: CSE #3");

    // 8. 2nd half: CSE scores, END 2ND HALF -> draw 1-1
    await page.locator("#fbKickoff").click();
    await goal(page, "A", 10);
    await page.locator("#fbEnd").click();
    expect(m.dialogs.at(-1)).toContain("The score is level: the match ends as a DRAW.");
    await expect(page.locator("#status")).toHaveText("FINISHED. Draw 1-1");
    await expect(st.locator("#result")).toHaveText("Draw 1-1");
    await expect(st.locator("#history")).toHaveText("HT 0-1 · FT 1-1");
    expect((await types(m.pool, m.id)).filter((t) => t === "end_period")).toHaveLength(2);
  } finally { await m.cleanup(); }
});

test("9-12, 17: knockout: extra time, remove only extra-time goals, still level -> shootout only, 3 kicks early end, double tap", async ({ page, browser }) => {
  const m = await setup(page, browser, { category: "girls", stage: "semi_final", knockout: true });
  const st = m.student;
  try {
    await page.locator("#fbKickoff").click();
    await goal(page, "A", 9);
    await page.locator("#fbEnd").click();
    await page.locator("#fbKickoff").click();
    await goal(page, "B", 7);
    await page.locator("#fbEnd").click();
    expect(m.dialogs.at(-1)).toContain("next you choose EXTRA TIME or the PENALTY SHOOTOUT");
    // 9. the choice screen; EXTRA TIME kicks off at once
    await expect(page.locator("#fbDecide")).toBeVisible();
    await expect(st.locator("#fbBanner")).toHaveText("FULL TIME · level: extra time or penalties next");
    await page.locator("#fbEtBtn").click();
    await expect(page.locator("#fbEnd")).toHaveText("END EXTRA TIME 1ST HALF");
    await expect(st.locator("#fbPeriod")).toHaveText("Extra time 1st half");

    // 17. in extra time: the normal-time goals cannot be removed, an extra-time goal can
    await goal(page, "A", 11);
    await score(page, 2, 1);
    await page.locator("#fbFixBtn").click();
    await expect(page.locator("#fbFixList button")).toHaveText(["Remove: GOAL CSE #11 (Extra time 1st half, 2-1)"]);
    await page.locator("#fbFixList button").click();
    await score(page, 1, 1);

    // 10. extra time still level -> only the shootout (no 2nd extra time)
    await page.locator("#fbEnd").click();
    await expect(st.locator("#fbBanner")).toHaveText("EXTRA TIME · HALF TIME");
    await page.locator("#fbKickoff").click();
    await page.locator("#fbEnd").click();
    expect(m.dialogs.at(-1)).toContain("next comes the PENALTY SHOOTOUT");
    await expect(page.locator("#fbDecide")).toBeVisible();
    await expect(page.locator("#fbEtBtn")).toBeHidden();
    await expect(st.locator("#fbBanner")).toHaveText("Level after extra time: penalty shootout next");

    // 11. 3 kicks, ECE first: ECE scores, CSE misses, ECE scores, CSE misses -> over (CSE cannot catch up)
    await expect(page.locator("#fbShootBtn")).toBeDisabled();
    await page.locator("#fbKicks3").click();
    await page.locator("#fbFirstB").click();
    await page.locator("#fbShootBtn").click();
    // 18. no "Fix a mistake" in the shootout
    await expect(page.locator("#fbFixBtn")).toBeHidden();
    await expect(page.locator("#fbNext")).toHaveText("Next kick: ECE (kick 1)");
    // 12. a very fast double tap counts once
    await page.locator("#fbKick_scored").click();
    await page.locator("#fbKick_scored").click({ force: true });
    await expect(page.locator("#fbNext")).toHaveText("Next kick: CSE (kick 1)");
    await kick(page, "missed");
    await kick(page, "scored");
    await kick(page, "saved");
    await expect(page.locator("#status")).toHaveText("FINISHED. ECE won 2-0 on penalties (1-1)");
    await expect(st.locator("#kbPop")).toHaveText("SAVED! CSE (penalty 2) · ECE WIN ON PENALTIES!");
    const kicks = (await m.pool.query("SELECT data FROM events WHERE match_id = $1 AND type = 'kick' ORDER BY seq", [m.id])).rows.map((r) => r.data);
    expect(kicks).toEqual([{ team: "B", outcome: "scored" }, { team: "A", outcome: "missed" }, { team: "B", outcome: "scored" }, { team: "A", outcome: "saved" }]);
  } finally { await m.cleanup(); }
});

test("13: shootout level after 3 each -> SUDDEN DEATH until one side leads", async ({ page, browser }) => {
  test.setTimeout(60000);                // 10 kicks, each waits for the 1.5 s double-tap lock
  const m = await setup(page, browser, { stage: "final", knockout: true });
  const st = m.student;
  try {
    await page.locator("#fbKickoff").click();
    await page.locator("#fbEnd").click();
    await page.locator("#fbKickoff").click();
    await page.locator("#fbEnd").click();                                  // 0-0 final
    await page.locator("#fbKicks3").click();
    await page.locator("#fbFirstA").click();
    await page.locator("#fbShootBtn").click();
    for (let i = 0; i < 3; i++) { await kick(page, "scored"); await kick(page, "scored"); }   // 3-3
    await expect(page.locator("#fbShootLine")).toContainText("SUDDEN DEATH");
    await expect(st.locator("#fbShootNote")).toHaveText("SUDDEN DEATH · Next: CSE");
    await kick(page, "missed");                                            // CSE misses: ECE can win now
    await expect(page.locator("#status")).toHaveText("LIVE");
    await kick(page, "missed");                                            // ECE misses too: go on
    await kick(page, "scored");
    await kick(page, "saved");                                             // CSE 4 - 3 ECE from 5 each
    await expect(page.locator("#status")).toHaveText("FINISHED. CSE won 4-3 on penalties (0-0)");
    await expect(st.locator("#fbShootNote")).toHaveText("Decided in sudden death");
  } finally { await m.cleanup(); }
});

test("14-16: wrong shirt numbers and names are refused; a scored penalty needs the shirt; UNDO takes a goal back with no pop-up", async ({ page, browser }) => {
  const m = await setup(page, browser);
  const st = m.student;
  try {
    await page.locator("#fbKickoff").click();
    // 14. shirt 0, 000, abc, -5, 9.5, empty
    await page.locator("#fbGoalA").click();
    for (const bad of ["0", "000", "abc", "-5", "9.5"]) {
      await page.locator("#fbShirt").fill(bad);
      await expect(page.locator("#fbSummary"), bad).toHaveText("Shirt number: 1 to 999");
      await expect(page.locator("#fbSave")).toBeDisabled();
    }
    // 3 digits are fine (up to 999)
    await page.locator("#fbShirt").fill("999");
    await expect(page.locator("#fbSummary")).toHaveText("Will send: GOAL CSE #999");
    await expect(page.locator("#fbSave")).toBeEnabled();
    // the box takes only 3 characters: "1000" becomes "100" and the line shows it BEFORE SAVE
    await page.locator("#fbShirt").fill("1000");
    await expect(page.locator("#fbShirt")).toHaveValue("100");
    await expect(page.locator("#fbSummary")).toHaveText("Will send: GOAL CSE #100");
    await page.locator("#fbShirt").fill("");
    await expect(page.locator("#fbSummary")).toHaveText("Type the shirt number of the scorer");
    await expect(page.locator("#fbSave")).toBeDisabled();
    // 15. names: HTML, too long (typed past the box limit), only a name without shirt
    await page.locator("#fbShirt").fill("9");
    await page.locator("#fbPlayerName").fill("<b>Ravi</b>");
    await expect(page.locator("#fbSummary")).toHaveText("Name: up to 20 letters, numbers, spaces and . ' -");
    await page.locator("#fbPlayerName").evaluate((e) => { e.value = "x".repeat(21); e.dispatchEvent(new Event("input")); });
    await expect(page.locator("#fbSummary")).toHaveText("Name: up to 20 letters, numbers, spaces and . ' -");
    await page.locator("#fbPlayerName").fill("D'Souza Jr. Ravi-K");
    await expect(page.locator("#fbSummary")).toHaveText("Will send: GOAL CSE #9 D'Souza Jr. Ravi-K");
    await page.locator("#fbFormCancel").click();
    expect(await types(m.pool, m.id)).toEqual(["period_start"]);           // nothing was stored
    // the server refuses a bad shirt or name too (an old or changed page)
    const sock = await scorerSocket(BASE_URL);
    try {
      const send = (data, k) => sock.timeout(10000).emitWithAck("score:action", { id: "e2e-fbx-" + RUN + "-bad" + k, matchId: m.id, type: "goal", data });
      expect(await send({ team: "A", kind: "normal", shirt: 1000 }, 1)).toEqual({ ok: false, error: "shirt number must be 1 to 999" });
      expect(await send({ team: "A", kind: "normal", shirt: 9, name: "<script>" }, 2)).toEqual({ ok: false, error: "name: up to 20 letters, numbers, spaces and . ' -" });
      expect(await send({ team: "A", kind: "header", shirt: 9 }, 3)).toEqual({ ok: false, error: "choose the kind of goal" });
      expect(await send({ team: "C", kind: "normal", shirt: 9 }, 4)).toEqual({ ok: false, error: "bad team" });
    } finally { sock.close(); }
    expect(await types(m.pool, m.id)).toEqual(["period_start"]);
    // a scored penalty needs the shirt, a missed one does not
    await page.locator("#fbPenA").click();
    await page.locator("#fbOut_scored").click();
    await expect(page.locator("#fbSummary")).toHaveText("Type the shirt number of the scorer");
    await expect(page.locator("#fbSave")).toBeDisabled();
    await page.locator("#fbOut_missed").click();
    await expect(page.locator("#fbSave")).toBeEnabled();
    await page.locator("#fbSave").click();
    await expect(st.locator("#kbPop")).toHaveText("PENALTY MISSED! CSE");
    // a card needs a colour
    await page.locator("#fbCardB").click();
    await page.locator("#fbShirt").fill("2");
    await expect(page.locator("#fbSummary")).toHaveText("Tap YELLOW or RED");
    await page.locator("#fbFormCancel").click();

    // 16. UNDO right after a goal: gone on both phones, no new pop-up
    await goal(page, "B", 8);
    await expect(st.locator("#kbPop")).toHaveText("GOAL! ECE #8 · 0-1");
    await st.locator("#kbPop").evaluate((e) => { e.hidden = true; });
    await page.locator("#undo").click();
    await score(page, 0, 0);
    await expect(st.locator("#sB")).toHaveText("0");
    await expect(st.locator("#fbGoalsB li")).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(st.locator("#kbPop")).toBeHidden();
  } finally { await m.cleanup(); }
});

test("19: offline: entries wait in order; after END 2nd half the buttons wait for the server; back online all is sent", async ({ page, browser }) => {
  const m = await setup(page, browser, { category: "girls", stage: "quarter_final", knockout: true });
  try {
    await page.evaluate(() => socket.disconnect());                    // the network is gone (the phone keeps the entries)
    await expect(page.locator("#conn")).toHaveText("OFFLINE - entries are saved on this phone");
    await page.locator("#fbKickoff").click();
    await goal(page, "A", 9);
    await page.locator("#fbEnd").click();
    await expect(page.locator("#fbKickoff")).toHaveText("KICK-OFF 2nd half");  // the phone follows its own entries
    await page.locator("#fbKickoff").click();
    await page.locator("#fbEnd").click();
    expect(m.dialogs.at(-1)).toContain("entries are still waiting to be sent");
    await expect(page.locator("#fbWait")).toBeVisible();                // only the server knows: win, draw or a decision
    await expect(page.locator("#fbPlay")).toBeHidden();
    await expect(page.locator("#pending")).toHaveText("5 entries waiting to be sent");
    expect(await types(m.pool, m.id)).toEqual([]);                      // nothing reached the server
    await page.evaluate(() => socket.connect());
    await expect(page.locator("#pending")).toHaveText("All entries sent");
    await expect(page.locator("#status")).toHaveText("FINISHED. CSE won 1-0");
    expect(await types(m.pool, m.id)).toEqual(["period_start", "goal", "end_period", "period_start", "end_period"]);
    await expect(m.student.locator("#result")).toHaveText("CSE won 1-0");
  } finally { await m.cleanup(); }
});

test("20: reload while a penalty waits: its form opens again; a walkover ends the match", async ({ page, browser }) => {
  const m = await setup(page, browser);
  try {
    await page.locator("#fbKickoff").click();
    await page.locator("#fbPenB").click();
    await expect(m.student.locator("#fbPenaltyTitle")).toHaveText("PENALTY TO ECE!");
    await page.reload();
    await page.locator("#match").selectOption(m.id);
    await expect(page.locator("#fbForm")).toBeVisible();
    await expect(page.locator("#fbFormTitle")).toHaveText("PENALTY to ECE (students see it now). What happened?");
    await page.locator("#fbOut_scored").click();
    await page.locator("#fbShirt").fill("10");
    await page.locator("#fbSave").click();
    await score(page, 0, 1);
    await expect(m.student.locator("#kbPop")).toHaveText("PENALTY GOAL! ECE #10 · 0-1");
    await expect(m.student.locator("#fbGoalsB li")).toHaveText(["#10 (pen)"]);
    await expect(page.locator("#fbForm"), "the saved penalty does not open again").toBeHidden();
    // walkover
    await page.locator("#fbFinA").click();
    await expect(page.locator("#status")).toHaveText("FINISHED. CSE won (walkover)");
  } finally { await m.cleanup(); }
});
