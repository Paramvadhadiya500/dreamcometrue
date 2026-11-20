// Wide screens (tablet, laptop): the home page shows the match cards in 2 columns from 640 px on.
// Under 640 px (phones) they stay in 1 column. (Phone width itself: phone-size.spec.js.)
const { test, expect } = require("@playwright/test");
const { BASE_URL, openDb, addMatch, waitUntilOnHome } = require("./helpers");

let pool, last;
test.beforeAll(async () => {
  pool = openDb();
  await addMatch(pool);
  last = await addMatch(pool);                                   // at least 2 cards on the Schedule tab
  await waitUntilOnHome(BASE_URL, last.id);
});
test.afterAll(async () => { await pool.end(); });

// position of the first two cards on the Schedule tab
async function firstTwoCards(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.locator("#list")).toContainText(last.teamA);
  const cards = page.locator("a.card");
  return [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
}

test("640 px and wider: 2 cards side by side", async ({ page }) => {
  for (const width of [640, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const [a, b] = await firstTwoCards(page);
    expect(b.y, width + " px: second card on the same row").toBe(a.y);
    expect(b.x, width + " px: second card to the right").toBeGreaterThan(a.x + a.width);
  }
});

test("639 px: 1 column, the second card under the first", async ({ page }) => {
  await page.setViewportSize({ width: 639, height: 800 });
  const [a, b] = await firstTwoCards(page);
  expect(b.x).toBe(a.x);
  expect(b.y).toBeGreaterThan(a.y + a.height);
});
