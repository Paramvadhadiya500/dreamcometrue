// Scenario 1: the whole path "scorer taps -> student sees it", through the real server, Redis and Postgres.
// The student is a real Chromium page; the scorer is socket.io-client (like the scorer phone).
const { test, expect } = require("@playwright/test");
const { BASE_URL, openDb, addMatch, waitUntilOnHome, scorerSocket, sendPoint } = require("./helpers");

let pool, scorer;
test.beforeAll(async () => { pool = openDb(); scorer = await scorerSocket(BASE_URL); });
test.afterAll(async () => { scorer.close(); await pool.end(); });

test("a point from the scorer reaches the student's match page within 3 s", async ({ page }) => {
  const m = await addMatch(pool);
  await waitUntilOnHome(BASE_URL, m.id);

  // 1-2. home page, Schedule tab (no point yet = "upcoming", so it is not under Live)
  await page.goto("/");
  await page.getByRole("button", { name: "Schedule" }).click();

  // 3. open the card of this match (5 s at most: it must be there on the first load)
  await page.getByRole("link", { name: m.teamA + " vs " + m.teamB }).click({ timeout: 5000 });

  // 4. the match page of THIS match, score 0 : 0
  await expect(page).toHaveURL("/match.html?id=" + m.id);
  await expect(page.locator("#sVs")).toHaveText(m.teamA + " vs " + m.teamB);
  await expect(page.locator("#sA")).toHaveText("0");
  await expect(page.locator("#sB")).toHaveText("0");

  // 5. the scorer adds a point for team A
  await sendPoint(scorer, m.id, "A");

  // 6. the student sees it within 3 s, without a reload; team B unchanged
  await expect(page.locator("#sA")).toHaveText("1", { timeout: 3000 });
  await expect(page.locator("#sB")).toHaveText("0");
});
