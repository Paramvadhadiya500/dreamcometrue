// Football on a 360 px phone, through the REAL server and database:
//  - every button shows its whole text and is big enough to tap, even with very long team names;
//  - KICK-OFF -> GOAL form (shirt number + name) -> score; PENALTY shows at once, then saved; a red card;
//  - "Fix a mistake" removes a wrong goal; END 1st HALF asks first, and a second END (another scorer) is refused;
//  - a level semi final: PENALTY SHOOTOUT (3 kicks), kick by kick, a double tap does not become the other team's kick,
//    the shootout ends by itself with the winner.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, PASSWORD, openDb, scorerSocket } = require("./helpers");

test.use({ viewport: { width: 360, height: 740 } });

const A = "Computer Science Engineering";
const B = "Mechanical Engineering Department";

test("football scorer on a 360 px phone: kick-off, goal, penalty, card, remove, END HALF once, shootout", async ({ page }) => {
  const pool = openDb();
  const id = "e2e-fb-" + RUN;
  try {
    await pool.query(
      `INSERT INTO matches (id, name, sport, config, team_a, team_b, category, stage)
       VALUES ($1, 'E2E football', 'football', $2, $3, $4, 'girls', 'semi_final')`,
      [id, JSON.stringify({ halfMinutes: 7, players: 5, knockout: true }), A, B]
    );
    await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [SCORER, id]);

    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto("/scorer.html");
    await page.locator("#u").fill(SCORER);
    await page.locator("#p").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.locator("#match").selectOption(id);
    await expect(page.locator("#fbControls")).toBeVisible();
    await expect(page.locator("#fbNameA")).toHaveText(A);
    await expect(page.locator("#fbNameB")).toHaveText(B);
    await expect(page.locator("#fbPeriod")).toHaveText("1st half (5-a-side, 2 x 7 min): not kicked off yet");
    await expect(page.locator("#fbGoalA")).toBeHidden();

    const fits = async (ids) => {
      for (const b of ids) {
        const el = page.locator("#" + b);
        await expect(el, b).toBeVisible();
        expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight), b + " text is not cut off").toBe(true);
        const box = await el.boundingBox();
        expect(box.height, b + " is tall enough to tap").toBeGreaterThanOrEqual(44);
        expect(box.x + box.width, b + " fits on the screen").toBeLessThanOrEqual(360);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scrolling").toBeLessThanOrEqual(360);
    };

    // KICK-OFF: then GOAL / PENALTY / CARD for both teams and END 1st HALF
    await fits(["fbKickoff", "fbCardA", "fbCardB", "fbFinA", "fbFinB"]);
    await page.locator("#fbKickoff").click();
    await expect(page.locator("#fbEnd")).toHaveText("END 1ST HALF");
    await fits(["fbGoalA", "fbPenA", "fbCardA", "fbGoalB", "fbPenB", "fbCardB", "fbEnd", "fbFixBtn"]);

    // a goal: GOAL under B, free kick, shirt 7 + name
    await page.locator("#fbGoalB").click();
    await expect(page.locator("#fbFormTitle")).toHaveText("GOAL for " + B);
    await fits(["fbKind_normal", "fbKind_free_kick", "fbKind_own_goal", "fbShirt", "fbPlayerName", "fbSave", "fbFormCancel"]);
    await expect(page.locator("#fbSave")).toBeDisabled();
    await page.locator("#fbKind_free_kick").click();
    await page.locator("#fbShirt").fill("7");
    await page.locator("#fbPlayerName").fill("Ravi");
    await expect(page.locator("#fbSummary")).toHaveText("Will send: GOAL " + B + " #7 Ravi (free kick)");
    await page.locator("#fbSave").click();
    await expect(page.locator("#fbB")).toHaveText("1");
    await expect(page.locator("#fbGoals")).toHaveText("Last goals: " + B + " #7 Ravi (free kick)");
    await expect(page.locator("#fbForm")).toBeHidden();

    // a second goal for A (shirt 9), to remove later
    await page.locator("#fbGoalA").click();
    await page.locator("#fbShirt").fill("9");
    await page.locator("#fbSave").click();
    await expect(page.locator("#fbA")).toHaveText("1");

    // PENALTY to A: stored at once (students see it), then SAVED
    await page.locator("#fbPenA").click();
    await expect(page.locator("#fbPenNow")).toHaveText("PENALTY TO " + A.toUpperCase() + " (students see it)");
    await fits(["fbOut_scored", "fbOut_saved", "fbOut_missed", "fbSave", "fbFormCancel"]);
    await page.locator("#fbOut_saved").click();
    await page.locator("#fbSave").click();
    await expect(page.locator("#fbPenNow")).toBeHidden();
    await expect(page.locator("#fbA")).toHaveText("1");

    // a red card for B #4
    await page.locator("#fbCardB").click();
    await fits(["fbColor_yellow", "fbColor_red"]);
    await page.locator("#fbColor_red").click();
    await page.locator("#fbShirt").fill("4");
    await expect(page.locator("#fbSummary")).toHaveText("Will send: Red card " + B + " #4");
    await page.locator("#fbSave").click();
    await expect(page.locator("#fbForm")).toBeHidden();

    // Fix a mistake: remove A's goal (the list comes from the server)
    await page.locator("#fbFixBtn").click();
    const removeGoal = page.locator("#fbFixList button", { hasText: "GOAL " + A + " #9" });
    await expect(removeGoal).toBeVisible();
    await removeGoal.click();
    expect(dialogs.at(-1)).toBe("REMOVE: GOAL " + A + " #9 (1st half, 1-1)? Use this only for a wrong entry. You can still press UNDO afterwards.");
    await expect(page.locator("#fbA")).toHaveText("0");

    const stored = await pool.query("SELECT type, data FROM events WHERE match_id = $1 ORDER BY seq", [id]);
    expect(stored.rows.map((r) => r.type)).toEqual(["period_start", "goal", "goal", "penalty_start", "penalty", "card", "remove"]);
    expect(stored.rows[1].data).toEqual({ team: "B", kind: "free_kick", shirt: 7, name: "Ravi" });

    // END 1st HALF: asks first; a second END 1st half (another scorer) is refused
    await page.locator("#fbEnd").click();
    expect(dialogs.at(-1)).toBe("End the 1st half? Half time starts. You can still press UNDO afterwards.");
    await expect(page.locator("#fbBreakNow")).toHaveText("HALF TIME");
    await expect(page.locator("#fbKickoff")).toHaveText("KICK-OFF 2nd half");
    const socket = await scorerSocket(BASE_URL);
    try {
      const ack = await socket.timeout(10000).emitWithAck("score:action",
        { id: "e2e-fb-" + RUN + "-late", matchId: id, type: "end_period", data: { period: 1 } });
      expect(ack).toEqual({ ok: false, error: "1st half has already ended" });
    } finally {
      socket.close();
    }

    // 2nd half: A equalises (0-1 -> 1-1), full time level in a semi final
    await page.locator("#fbKickoff").click();
    await page.locator("#fbGoalA").click();
    await page.locator("#fbShirt").fill("10");
    await page.locator("#fbSave").click();
    await expect(page.locator("#fbA")).toHaveText("1");
    await page.locator("#fbEnd").click();
    expect(dialogs.at(-1)).toBe("End the 2nd half? The score is level: next you choose EXTRA TIME or the PENALTY SHOOTOUT. You can still press UNDO afterwards.");
    await expect(page.locator("#fbDecide")).toBeVisible();
    await expect(page.locator("#fbBreakNow")).toHaveText("FULL TIME: LEVEL");
    await expect(page.locator("#fbFirstA")).toHaveText(A);
    await fits(["fbEtBtn", "fbKicks3", "fbKicks5", "fbFirstA", "fbFirstB", "fbShootBtn"]);

    // PENALTY SHOOTOUT: 3 kicks, B first
    await page.locator("#fbKicks3").click();
    await page.locator("#fbFirstB").click();
    await page.locator("#fbShootBtn").click();
    expect(dialogs.at(-1)).toBe("Start the PENALTY SHOOTOUT: 3 kicks each, " + B + " kicks first? You can still press UNDO afterwards.");
    await expect(page.locator("#fbShoot")).toBeVisible();
    await expect(page.locator("#fbNext")).toHaveText("Next kick: " + B + " (kick 1)");
    await expect(page.locator("#fbKick_scored")).toHaveText("SCORED");
    await fits(["fbNext"]);
    await fits(["fbKick_scored", "fbKick_saved", "fbKick_missed"]);

    // B scores; a quick second tap is ignored (it would have been A's kick)
    await page.locator("#fbKick_scored").click();
    await page.locator("#fbKick_scored").click({ force: true });
    await expect(page.locator("#fbNext")).toHaveText("Next kick: " + A + " (kick 1)");
    await expect(page.locator("#fbKick_saved")).toBeEnabled();
    let kicks = await pool.query("SELECT data FROM events WHERE match_id = $1 AND type = 'kick' ORDER BY seq", [id]);
    expect(kicks.rows.map((r) => r.data)).toEqual([{ team: "B", outcome: "scored" }]);

    // A saved, B scored, A missed: A 0/2 with 1 left cannot reach 2 -> B wins
    for (const outcome of ["saved", "scored", "missed"]) {
      await expect(page.locator("#fbKick_" + outcome)).toBeEnabled();
      await page.locator("#fbKick_" + outcome).click();
    }
    await expect(page.locator("#status")).toHaveText("FINISHED. " + B + " won 2-0 on penalties (1-1)");
    await expect(page.locator("#fbControls")).toBeHidden();
    kicks = await pool.query("SELECT data FROM events WHERE match_id = $1 AND type = 'kick' ORDER BY seq", [id]);
    expect(kicks.rows.length).toBe(4);
  } finally {
    await pool.query("DELETE FROM events WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    await pool.end();
  }
});
