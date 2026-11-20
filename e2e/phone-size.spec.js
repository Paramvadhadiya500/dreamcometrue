// Scenario 3: on a small phone (360 x 740) the student pages never scroll sideways.
// isMobile: Chrome behaves like a phone browser. Without <meta name="viewport"> a phone lays the page out
// 980 px wide and shrinks it (tiny text, but NO sideways scroll), so we also check the layout width is 360.
const { test, expect } = require("@playwright/test");
const { BASE_URL, openDb, addMatch, waitUntilOnHome, scorerSocket, sendPoint } = require("./helpers");

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

let pool, scorer, m;
test.beforeAll(async () => {
  pool = openDb();
  scorer = await scorerSocket(BASE_URL);
  m = await addMatch(pool);
  await sendPoint(scorer, m.id, "A");                          // a live match: the Live tab has a card
  await waitUntilOnHome(BASE_URL, m.id);
});
test.afterAll(async () => { scorer.close(); await pool.end(); });

// how many pixels the page is wider than the screen (0 = no sideways scroll)
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// the width the page is laid out for (360 = made for the phone; 980 = desktop page shrunk)
const layoutWidth = (page) => page.evaluate(() => document.documentElement.clientWidth);

test("home page fits a 360 px phone on every tab", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#list")).toContainText(m.teamA);   // real content, not "Loading..."
  expect(await layoutWidth(page), "home page laid out for a 360 px phone").toBe(360);
  for (const tab of ["Live", "Schedule", "Results", "Points"]) {
    await page.getByRole("button", { name: tab }).click();
    await expect(page.locator("#list")).not.toContainText("Loading");
    expect(await overflow(page), "sideways scroll on the " + tab + " tab").toBe(0);
  }
});

test("match page fits a 360 px phone", async ({ page }) => {
  await page.goto("/match.html?id=" + m.id);
  await expect(page.locator("#sA")).toHaveText("1");
  expect(await layoutWidth(page), "match page laid out for a 360 px phone").toBe(360);
  expect(await overflow(page), "sideways scroll on the match page").toBe(0);
});
