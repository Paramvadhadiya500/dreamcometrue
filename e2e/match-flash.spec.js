// Match page (Phase 5): only a number that really changed flashes (class "bump"); nothing flashes on the first
// score or when the same score arrives again; "reduce motion" ends the flash at once.
const { test, expect } = require("@playwright/test");
const { stateFor, point, ball, showState, openFixturePage } = require("./match-states");

const flashing = (page) => page.evaluate(() => [...document.querySelectorAll(".bump")].map((e) => e.id));
const simple = (list) => stateFor("simple", list, { id: "fx-flash" });

test("simple sport: only the score that changed flashes", async ({ page }) => {
  await openFixturePage(page, "fx-flash");
  await showState(page, simple([point("A", 2), point("B", 1)]));
  expect(await flashing(page), "first score: no flash").toEqual([]);

  await showState(page, simple([point("A", 2), point("B", 1), point("A", 1)]));   // CSE scores
  await expect(page.locator("#sA")).toHaveText("3");
  expect(await flashing(page)).toEqual(["sA"]);

  await page.waitForTimeout(1700);                                               // the flash is over
  expect(await flashing(page)).toEqual([]);
  await showState(page, simple([point("A", 2), point("B", 1), point("A", 1)]));   // same score again (newer version)
  expect(await flashing(page), "same score: no flash").toEqual([]);

  await showState(page, simple([point("A", 2), point("B", 1), point("A", 1), point("B", 3)]));
  expect(await flashing(page)).toEqual(["sB"]);
});

test("a number that changes twice quickly flashes again from the start", async ({ page }) => {
  await openFixturePage(page, "fx-flash");
  await showState(page, simple([point("A")]));
  await showState(page, simple([point("A"), point("A")]));
  await page.waitForTimeout(800);                                                // first flash half done
  await showState(page, simple([point("A"), point("A"), point("A")]));
  await page.waitForTimeout(100);                                                // the old flash's "cancel" event arrives now
  const t = await page.evaluate(() => document.getElementById("sA").getAnimations().map((a) => a.currentTime));
  expect(t.length, "a flash is running").toBe(1);
  expect(t[0], "and it started again").toBeLessThan(500);
});

test("table tennis: a point flashes the game score; winning the game flashes the games too", async ({ page }) => {
  const rallyTo = (a, b) => [...Array(b)].flatMap(() => [point("A"), point("B")]).concat([...Array(a - b)].map(() => point("A")));
  const tt = (list) => stateFor("table_tennis", list, { id: "fx-flash" });
  await openFixturePage(page, "fx-flash");
  await showState(page, tt(rallyTo(10, 5)));                                    // 10-5 in game 1
  await showState(page, tt([...rallyTo(10, 5), point("B")]));                   // 10-6
  expect(await flashing(page)).toEqual(["pB"]);
  await page.waitForTimeout(1700);
  await showState(page, tt([...rallyTo(10, 5), point("B"), point("A")]));       // A wins the game: games 1-0, points 0-0
  expect((await flashing(page)).sort()).toEqual(["pA", "pB", "sA"]);
});

test("cricket: a ball that changes the score flashes it", async ({ page }) => {
  const cfg = { config: { overs: 2, players: 4, firstBatting: "A", freeHit: true }, id: "fx-flash" };
  await openFixturePage(page, "fx-flash");
  await showState(page, stateFor("cricket", [ball(1)], cfg));
  await showState(page, stateFor("cricket", [ball(1), ball(4)], cfg));
  expect(await flashing(page)).toContain("crBig");
});

test("reduce motion: the flash ends at once (the new number is still shown)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFixturePage(page, "fx-flash");
  await showState(page, simple([point("A", 1)]));
  await showState(page, simple([point("A", 1), point("A", 1)]));
  await expect(page.locator("#sA")).toHaveText("2");
  await page.waitForTimeout(150);
  expect(await flashing(page)).toEqual([]);
});
