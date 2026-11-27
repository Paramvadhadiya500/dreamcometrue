// Basketball scorer page on a 360 px phone, through the REAL server and database:
//  - the +1 / +2 / +3 buttons can always be read, even with very long team names (the old buttons were
//    "Computer Scie... +3" and the number was cut off);
//  - END QUARTER moves the button on and sends its quarter number; a second press for the same quarter
//    (another scorer, or an old phone) is refused by the server, so no quarter is skipped;
//  - "Fix a mistake" takes points away.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, PASSWORD, openDb, scorerSocket } = require("./helpers");

test.use({ viewport: { width: 360, height: 740 } });

test("basketball scorer on a 360 px phone: numbers readable with long names, END QUARTER once per quarter, correction", async ({ page }) => {
  const pool = openDb();
  const id = "e2e-bb-" + RUN;
  try {
    await pool.query(
      `INSERT INTO matches (id, name, sport, config, team_a, team_b, category)
       VALUES ($1, 'E2E basketball', 'basketball', $2, 'Computer Science Engineering', 'Mechanical Engineering Department', 'boys')`,
      [id, JSON.stringify({ quarterMinutes: 7, overtimeMinutes: 5 })]
    );
    await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [SCORER, id]);

    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto("/scorer.html");
    await page.locator("#u").fill(SCORER);
    await page.locator("#p").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.locator("#match").selectOption(id);
    await expect(page.locator("#bbControls")).toBeVisible();
    await expect(page.locator("#bbNameA")).toHaveText("Computer Science Engineering");
    await expect(page.locator("#bbNameB")).toHaveText("Mechanical Engineering Department");

    // every number button shows its WHOLE text and is big enough to tap
    for (const b of ["bbA1", "bbA2", "bbA3", "bbB1", "bbB2", "bbB3"]) {
      const el = page.locator("#" + b);
      await expect(el).toBeVisible();
      await expect(el).toHaveText(/^\+[123]$/);
      expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth), b + " text is not cut off").toBe(true);
      const box = await el.boundingBox();
      expect(box.height, b + " is tall enough to tap").toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scrolling").toBeLessThanOrEqual(360);

    // a 3-pointer
    await page.locator("#bbA3").click();
    await expect(page.locator("#bbA")).toHaveText("3");

    // END QUARTER: asks first, then the button moves on
    await page.locator("#bbEnd").click();
    expect(dialogs.at(-1)).toContain("End Quarter 1?");
    await expect(page.locator("#bbEnd")).toHaveText("END QUARTER 2");
    await expect(page.locator("#bbPeriod")).toHaveText("Quarter 2 (7 min)");

    // a second scorer (or an old phone) tries to end quarter 1 again: refused, nothing skipped
    const socket = await scorerSocket(BASE_URL);
    try {
      const ack = await socket.timeout(10000).emitWithAck("score:action",
        { id: "e2e-bb-" + RUN + "-late", matchId: id, type: "end_period", data: { period: 1 } });
      expect(ack).toEqual({ ok: false, error: "Quarter 1 has already ended" });
    } finally {
      socket.close();
    }
    const ends = await pool.query("SELECT data FROM events WHERE match_id = $1 AND type = 'end_period'", [id]);
    expect(ends.rows.map((r) => r.data)).toEqual([{ period: 1 }]);

    // correction: the 3 should have been a 2
    await expect(page.locator("#bbFix")).toBeHidden();
    await page.locator("#bbFixBtn").click();
    await page.locator("#bbFixA1").click();
    expect(dialogs.at(-1)).toContain("CORRECTION: take 1 point away from Computer Science Engineering?");
    await expect(page.locator("#bbA")).toHaveText("2");
    await expect(page.locator("#bbFix")).toBeHidden();
  } finally {
    await pool.query("DELETE FROM events WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    await pool.end();
  }
});
