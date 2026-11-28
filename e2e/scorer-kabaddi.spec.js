// Kabaddi on a 360 px phone, through the REAL server and database:
//  - every button of the raid form shows its whole text and is big enough to tap, even with very long team names;
//  - one raid (who raided, defenders out, bonus) -> SAVE RAID -> score and players on court;
//  - the form closes what is impossible (more defenders out than are on court, bonus with fewer than 6);
//  - END HALF 1 asks first, moves on, and a second END HALF 1 (another scorer) is refused;
//  - a timeout shows on the student match page, with the players on court and the big moments.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, PASSWORD, openDb, scorerSocket } = require("./helpers");

test.use({ viewport: { width: 360, height: 740 } });

const A = "Computer Science Engineering";
const B = "Mechanical Engineering Department";

test("kabaddi scorer on a 360 px phone: raid form, limits, END HALF once, timeout, match page", async ({ page, browser }) => {
  const pool = openDb();
  const id = "e2e-kb-" + RUN;
  try {
    await pool.query(
      `INSERT INTO matches (id, name, sport, config, team_a, team_b, category)
       VALUES ($1, 'E2E kabaddi', 'kabaddi', $2, $3, $4, 'boys')`,
      [id, JSON.stringify({ halfMinutes: 15, knockout: false }), A, B]
    );
    await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [SCORER, id]);

    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto("/scorer.html");
    await page.locator("#u").fill(SCORER);
    await page.locator("#p").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.locator("#match").selectOption(id);
    await expect(page.locator("#kbControls")).toBeVisible();
    await expect(page.locator("#kbRaidA")).toHaveText(A);
    await expect(page.locator("#kbRaidB")).toHaveText(B);
    await expect(page.locator("#kbToB")).toHaveText("Timeout: " + B);
    await expect(page.locator("#kbFinA")).toHaveText("Finish: " + A + " wins");
    await expect(page.locator("#kbHalf")).toHaveText("Half 1 (15 min)");

    // every button of the raid form: whole text visible, tall enough to tap; no sideways scrolling
    const buttons = ["kbRaidA", "kbRaidB", "kbSafe", "kbCaught", "kbOut0", "kbOut1", "kbOut2", "kbOut3", "kbOut4", "kbOut5",
      "kbOut6", "kbOut7", "kbBonusNo", "kbBonusYes", "kbSave", "kbEnd", "kbToA", "kbToB", "kbFinA", "kbFinB"];
    for (const b of buttons) {
      const el = page.locator("#" + b);
      await expect(el).toBeVisible();
      expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight), b + " text is not cut off").toBe(true);
      const box = await el.boundingBox();
      expect(box.height, b + " is tall enough to tap").toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, b + " fits on the screen").toBeLessThanOrEqual(360);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scrolling").toBeLessThanOrEqual(360);

    // a raid: A raids, 2 defenders out + bonus = 3 points
    await expect(page.locator("#kbSave")).toBeDisabled();
    await page.locator("#kbRaidA").click();
    await page.locator("#kbOut2").click();
    await page.locator("#kbBonusYes").click();
    await expect(page.locator("#kbSummary")).toHaveText(A + " +3 (2 out + bonus)");
    await page.locator("#kbSave").click();
    await expect(page.locator("#kbA")).toHaveText("3");
    await expect(page.locator("#kbCourt")).toHaveText("On court: " + A + " 7 · " + B + " 5");
    await expect(page.locator("#kbLast")).toHaveText("Last raid: " + A + " raid: 2 out + bonus");
    await expect(page.locator("#kbSummary")).toHaveText("Tap who raided");

    // B now has 5 on court: A cannot put out 6, and no bonus
    await page.locator("#kbRaidA").click();
    await expect(page.locator("#kbOut5")).toBeEnabled();
    await expect(page.locator("#kbOut6")).toBeDisabled();
    await expect(page.locator("#kbBonusYes")).toBeDisabled();
    // the raider is caught instead: defenders +1, nobody he touched is out
    await page.locator("#kbCaught").click();
    await expect(page.locator("#kbOut1")).toBeDisabled();
    await expect(page.locator("#kbSummary")).toHaveText("Raider OUT: " + B + " +1");
    await page.locator("#kbSave").click();
    await expect(page.locator("#kbB")).toHaveText("1");
    await expect(page.locator("#kbCourt")).toHaveText("On court: " + A + " 6 · " + B + " 6");

    // END HALF 1: asks first, then half 2; HALF TIME is shown
    await page.locator("#kbEnd").click();
    expect(dialogs.at(-1)).toBe("End Half 1? Half time starts. You can still press UNDO afterwards.");
    await expect(page.locator("#kbEnd")).toHaveText("END HALF 2");
    await expect(page.locator("#kbBreakNow")).toHaveText("HALF TIME");

    // a second scorer (or an old phone) tries to end half 1 again: refused, half 2 is not skipped
    const socket = await scorerSocket(BASE_URL);
    try {
      const ack = await socket.timeout(10000).emitWithAck("score:action",
        { id: "e2e-kb-" + RUN + "-late", matchId: id, type: "end_period", data: { period: 1 } });
      expect(ack).toEqual({ ok: false, error: "Half 1 has already ended" });
    } finally {
      socket.close();
    }
    const ends = await pool.query("SELECT data FROM events WHERE match_id = $1 AND type = 'end_period'", [id]);
    expect(ends.rows.map((r) => r.data)).toEqual([{ period: 1 }]);

    // a timeout for B: on the scorer page and on the students' match page
    await page.locator("#kbToB").click();
    await expect(page.locator("#kbBreakNow")).toHaveText("TIMEOUT: " + B);

    const student = await browser.newPage({ viewport: { width: 360, height: 740 } });
    try {
      await student.goto("/match.html?id=" + id);
      await expect(student.locator("#nameA")).toHaveText(A);
      await expect(student.locator("#sA")).toHaveText("3");
      await expect(student.locator("#sB")).toHaveText("1");
      await expect(student.locator("#kabaddi")).toBeVisible();
      await expect(student.locator("#kbBanner")).toHaveText("TIMEOUT: " + B);
      await expect(student.locator("#curLabel")).toHaveText("Half 2 (15 min)");
      await expect(student.locator("#history")).toHaveText("H1 3-1");
      await expect(student.locator("#kbCourtA")).toHaveText("6");
      await expect(student.locator("#kbCourtB")).toHaveText("6");
      await expect(student.locator("#kbMoments li")).toHaveText(["SUPER RAID · " + A + " +3 (2 out + bonus) · H1 · 3-0"]);
      await expect(student.locator("#kbPop"), "no pop-up for a moment that happened before the page opened").toBeHidden();
      await expect(student.locator("#kbDanger p"), "6 on court each: no danger line").toHaveCount(0);
      await expect(student.locator("#kbTable")).toBeVisible();
      await expect(student.locator("#kbTableBody tr")).toHaveText([/^Raids*3s*0$/, /^Tackles*0s*1$/, /^All outs*0s*0$/, /^Technicals*0s*0$/]);
      expect(await student.evaluate(() => document.documentElement.scrollWidth), "match page: no sideways scrolling").toBeLessThanOrEqual(360);

      // Break over on the phone: the banner goes away on the match page (live, no reload)
      await page.locator("#kbOver").click();
      await expect(page.locator("#kbBreakNow")).toBeHidden();
      await expect(student.locator("#kbBanner")).toBeHidden();

      // a technical point while the student watches: the big pop-up comes, live, and the table counts it
      await page.locator("#kbFixBtn").click();
      await page.locator("#kbTechA").click();
      expect(dialogs.at(-1)).toBe("TECHNICAL POINT: +1 for " + A + "? You can still press UNDO afterwards.");
      await expect(student.locator("#kbPop")).toBeVisible();
      await expect(student.locator("#kbPop")).toHaveText("TECHNICAL POINT! " + A + " +1");
      await expect(student.locator("#kbTableBody tr").nth(3)).toHaveText(/^Technicals*1s*0$/);
      await expect(student.locator("#kbMoments li").first()).toHaveText("Technical point · " + A + " +1 · H2 · 4-1");
      expect(await student.evaluate(() => document.documentElement.scrollWidth), "pop-up and table: no sideways scrolling").toBeLessThanOrEqual(360);
      // UNDO on the phone: the moment goes away, and no new pop-up comes for the undo
      await student.locator("#kbPop").evaluate((e) => { e.hidden = true; });
      await page.locator("#undo").click();
      await expect(student.locator("#sA")).toHaveText("3");
      await expect(student.locator("#kbPop")).toBeHidden();
    } finally {
      await student.close();
    }
  } finally {
    await pool.query("DELETE FROM events WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    await pool.end();
  }
});
