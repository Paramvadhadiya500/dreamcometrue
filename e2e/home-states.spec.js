// Home page states (Phase 4): skeleton cards while loading, "Updated ... ago", and the connection-problem bar.
// /api/home is answered by the test (page.route); the page's clock is fake where time matters (page.clock).
const { test, expect } = require("@playwright/test");

const DATA = { matches: [{ id: "st-1", name: "St", sport: "simple", competition: "Football", stage: "group", venue: "",
  startTime: null, hasTeams: true, teamA: "Red st", teamB: "Blue st", status: "upcoming", headline: "", resultText: "" }],
  competitions: ["Football"] };

test("first load: grey skeleton cards (hidden from screen readers, which hear 'Loading...'), then the real cards", async ({ page }) => {
  let release;
  const answered = new Promise((r) => (release = r));
  await page.route("**/api/home", async (route) => {
    await answered;                                  // hold the answer until the test lets it go
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DATA) });
  });
  await page.goto("/");
  const skeletons = page.locator("#list .skeleton");
  await expect(skeletons).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(skeletons.nth(i)).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#list")).toContainText("Loading...");

  release();
  await expect(page.locator("a.card", { hasText: "Red st" })).toBeVisible();
  await expect(skeletons).toHaveCount(0);
});

test("'Updated ... ago' counts up while the server cannot be reached; the problem bar is announced, then goes away", async ({ page }) => {
  let failing = false;
  await page.route("**/api/home", (route) => (failing
    ? route.fulfill({ status: 500, body: "error" })
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DATA) })));
  await page.clock.install();
  await page.goto("/");
  const updated = page.locator("#updated");
  const note = page.getByRole("status");
  await expect(updated).toHaveText("Updated just now");
  await expect(note).toHaveText("");
  expect((await note.boundingBox()).height, "no problem: the bar takes no space").toBe(0);

  failing = true;
  await page.clock.runFor(35000);
  await expect(updated).toHaveText("Updated 30 s ago");
  await page.clock.runFor(100000);                  // the page retries (and fails) in between
  await expect(note).toHaveText("Connection problem. Showing the last scores.");
  await expect(updated).toHaveText("Updated 2 min ago");
  expect((await note.boundingBox()).height).toBeGreaterThan(20);

  failing = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(note).toHaveText("");
  await expect(updated).toHaveText("Updated just now");
});
