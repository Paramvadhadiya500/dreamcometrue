// Match page scoreboard (Phase 5): one h1 (the match name), a LIVE / FINISHED pill, team names beside the big
// numbers, every sport readable on a 360 px phone. States come from the real engines (e2e/match-states.js).
const { test, expect } = require("@playwright/test");
const { states, stateFor, point, showState, openFixturePage } = require("./match-states");

async function show(page, state) {
  await openFixturePage(page, state.matchId);
  await showState(page, state);
}
const visibleHeadings = (page) => page.evaluate(() =>
  [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => h.checkVisibility()).map((h) => h.tagName + ": " + h.textContent.trim()));

test("every sport: exactly one heading, the match name (scores are not headings)", async ({ page }) => {
  for (const [name, make] of Object.entries(states)) {
    await show(page, make());
    expect(await visibleHeadings(page), name).toEqual(["H1: Final"]);
  }
});

test("simple sport: names beside the score, LIVE pill; finished: FINISHED pill and the result", async ({ page }) => {
  await show(page, states.simpleLive());
  await expect(page.locator("#nameA")).toHaveText("CSE");
  await expect(page.locator("#sA")).toHaveText("3");
  await expect(page.locator("#sB")).toHaveText("1");
  await expect(page.locator("#nameB")).toHaveText("ECE");
  await expect(page.locator("#status")).toHaveText("LIVE");
  await expect(page.locator("#result")).toBeHidden();

  await show(page, states.simpleFinished());
  await expect(page.locator("#status")).toHaveText("FINISHED");
  await expect(page.locator("#result")).toHaveText("CSE won");
});

test("table tennis and volleyball: games / sets big, the running game / set below, finished ones listed", async ({ page }) => {
  await show(page, states.tableTennis());
  await expect(page.locator("#sA")).toHaveText("1");
  await expect(page.locator("#sB")).toHaveText("0");
  await expect(page.locator("#unit")).toHaveText("games");
  await expect(page.locator("#current")).toContainText("Current game");
  await expect(page.locator("#current")).toContainText("5 - 3");
  await expect(page.locator("#history")).toHaveText("Games: 11-7");

  await show(page, states.volleyball());
  await expect(page.locator("#unit")).toHaveText("sets");
  await expect(page.locator("#current")).toContainText("Set 2, to 25");
  await expect(page.locator("#current")).toContainText("12 - 10");
  await expect(page.locator("#history")).toHaveText("Sets: 25-20");
});

test("basketball: total score big, the quarter now below, finished quarters listed; overtime result", async ({ page }) => {
  await show(page, states.basketball());
  await expect(page.locator("#sA")).toHaveText("5");
  await expect(page.locator("#sB")).toHaveText("3");
  await expect(page.locator("#unit")).toHaveText("");
  await expect(page.locator("#current")).toContainText("Quarter 2 (7 min)");
  await expect(page.locator("#current")).toContainText("2 - 1");
  await expect(page.locator("#history")).toHaveText("Q1 3-2");
  await expect(page.locator("#status")).toHaveText("LIVE");

  await show(page, states.basketballFinished());
  await expect(page.locator("#status")).toHaveText("FINISHED");
  await expect(page.locator("#current")).toBeHidden();
  await expect(page.locator("#history")).toHaveText("Q1 2-2, Q2 0-0, Q3 0-0, Q4 0-0, OT1 0-3");
  await expect(page.locator("#result")).toHaveText("Team B won 5-2 (after overtime)");
});

test("cricket: batting score big, overs, chase, free hit; no names-beside-score row", async ({ page }) => {
  await show(page, states.cricketChase());
  await expect(page.locator("#crBig")).toHaveText("ECE 3/1");
  await expect(page.locator("#crChase")).toContainText("Need 20 from 10 balls");
  await expect(page.locator("#crFree")).toBeVisible();
  await expect(page.locator("#duel")).toBeHidden();
});

test("cricket toss: 'Waiting for the toss' first, then who won it; the right team bats", async ({ page }) => {
  await show(page, states.cricketBeforeToss());
  await expect(page.locator("#crToss")).toHaveText("Waiting for the toss");
  await expect(page.locator("#crBig")).toHaveText("CSE vs ECE");
  await expect(page.locator("#crOvers")).toHaveText("12 overs per innings");
  await show(page, states.cricketAfterToss());
  await expect(page.locator("#crToss")).toHaveText("ECE won the toss and chose to bowl");
  await expect(page.locator("#crBig")).toHaveText("CSE 4/0");
  await expect(page.locator("#crOvers")).toContainText("0.1 / 12 overs");
});

test("360 px phone: long team names and big scores never scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const long = stateFor("simple", [point("A", 10), point("B", 10), point("B", 2)],
    { teamA: "Computer Science and Engineering", teamB: "Electronics and Communication" });
  for (const s of [long, ...Object.values(states).map((f) => f())]) {
    await show(page, s);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, s.sport + ": sideways scroll").toBe(0);
  }
});
