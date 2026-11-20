// Home page refresh: only what changed is touched (Phase 4). /api/home is answered by the test (page.route)
// with data the test changes; the "online" event makes the page refresh at once (no waiting 10 s).
// A JavaScript mark (__mark) on an element shows whether the page kept THAT element or built a new one.
const { test, expect } = require("@playwright/test");

const match = (id, status, headline, extra = {}) => ({ id, name: "Match " + id, sport: "simple", competition: "Football",
  stage: "group", venue: "", startTime: null, hasTeams: true, teamA: "Red " + id, teamB: "Blue " + id, status, headline,
  resultText: "", ...extra });

async function open(page, data) {
  await page.route("**/api/home", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data.home) }));
  await page.goto("/");
  await expect(page.locator("a.card")).not.toHaveCount(0);
}
const refreshNow = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const card = (page, id) => page.locator("a.card", { hasText: "Red " + id + " vs" });
const mark = (page, id) => card(page, id).evaluate((el) => { el.__mark = true; });
const marked = (page, id) => card(page, id).evaluate((el) => el.__mark === true);

test("a refresh keeps unchanged cards, updates a changed card in place, and only that one flashes", async ({ page }) => {
  const data = { home: { matches: [match("m1", "live", "Red m1 1 - 0 Blue m1"), match("m2", "live", "Red m2 0 - 0 Blue m2")], competitions: ["Football"] } };
  await open(page, data);
  await expect(page.locator("a.card.changed"), "nothing flashes on the first load").toHaveCount(0);
  await mark(page, "m1");
  await mark(page, "m2");

  data.home.matches[1] = match("m2", "live", "Red m2 1 - 0 Blue m2");          // a goal in m2 only
  await refreshNow(page);
  await expect(card(page, "m2")).toContainText("Red m2 1 - 0 Blue m2");

  expect(await marked(page, "m1"), "unchanged card m1: same element").toBe(true);
  expect(await marked(page, "m2"), "changed card m2: still the same element, new text").toBe(true);
  await expect(card(page, "m2")).toHaveClass(/changed/);
  await expect(card(page, "m1")).not.toHaveClass(/changed/);
});

test("keyboard focus stays on a card through refreshes, also when that card's score changes", async ({ page }) => {
  const data = { home: { matches: [match("m1", "live", "Red m1 0 - 0 Blue m1"), match("m2", "live", "Red m2 0 - 0 Blue m2")], competitions: ["Football"] } };
  await open(page, data);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");                // 4 tabs, dropdown, first card
  await expect(card(page, "m1")).toBeFocused();

  data.home.matches[1] = match("m2", "live", "Red m2 1 - 0 Blue m2");          // another card changes
  await refreshNow(page);
  await expect(card(page, "m2")).toContainText("1 - 0");
  await expect(card(page, "m1")).toBeFocused();

  data.home.matches[0] = match("m1", "live", "Red m1 2 - 0 Blue m1");          // the focused card itself changes
  await refreshNow(page);
  await expect(card(page, "m1")).toContainText("2 - 0");
  await expect(card(page, "m1")).toBeFocused();
  await page.keyboard.press("Tab");                                            // and Tab goes on from there
  await expect(card(page, "m2")).toBeFocused();
});

test("a new match gets a card without flashing; a removed match loses its card", async ({ page }) => {
  const data = { home: { matches: [match("m1", "live", "Red m1 0 - 0 Blue m1")], competitions: ["Football"] } };
  await open(page, data);
  data.home.matches = [match("m2", "live", "Red m2 0 - 0 Blue m2")];
  await refreshNow(page);
  await expect(card(page, "m2")).toBeVisible();
  await expect(card(page, "m1")).toHaveCount(0);
  await expect(card(page, "m2")).not.toHaveClass(/changed/);
});

test("switching tabs or sport reuses cards and does not flash", async ({ page }) => {
  const data = { home: { matches: [match("m1", "live", "Red m1 0 - 0 Blue m1"),
    match("m3", "finished", "Red m3 2 - 1 Blue m3", { competition: "Kabaddi", resultText: "Red m3 won" })], competitions: ["Football", "Kabaddi"] } };
  await open(page, data);
  await mark(page, "m1");
  await page.getByRole("button", { name: "Schedule" }).click();
  await page.getByRole("button", { name: "Live" }).click();
  expect(await marked(page, "m1"), "back on Live: the same element").toBe(true);
  await page.getByRole("combobox", { name: "Sport" }).selectOption("Kabaddi");
  await page.getByRole("button", { name: "Results" }).click();
  await expect(card(page, "m3")).toBeVisible();
  await expect(page.locator("a.card.changed")).toHaveCount(0);
});
