// Match page (Phase 5): a hidden live region tells screen readers the new score, at most one sentence per 8 s.
// The page's clock is fake (page.clock), so the 8 s pass in milliseconds.
const { test, expect } = require("@playwright/test");
const { stateFor, point, showState, openFixturePage } = require("./match-states");

const simple = (a, b) => stateFor("simple", [point("A", a), point("B", b)], { id: "fx-say" });

// record every text the live region gets
async function listen(page) {
  await page.evaluate(() => {
    window.__said = [];
    new MutationObserver(() => window.__said.push(document.getElementById("announcer").textContent))
      .observe(document.getElementById("announcer"), { childList: true, characterData: true, subtree: true });
  });
}
const said = (page) => page.evaluate(() => window.__said);

test("the announcer exists from the start: empty, polite, off screen", async ({ page }) => {
  await openFixturePage(page, "fx-say");
  const a = page.locator("#announcer");
  await expect(a).toHaveAttribute("aria-live", "polite");
  await expect(a).toHaveText("");
  const box = await a.boundingBox();
  expect(box.width <= 1 && box.height <= 1, "screen readers only").toBe(true);
});

test("first score: silent; a change: one sentence; a burst within 8 s: only the newest, after the gap", async ({ page }) => {
  await page.clock.install();
  await openFixturePage(page, "fx-say");
  await listen(page);
  await showState(page, simple(1, 0));
  expect(await said(page), "nothing for the first score").toEqual([]);

  await showState(page, simple(2, 0));
  expect(await said(page)).toEqual(["CSE 2, ECE 0."]);

  await showState(page, simple(3, 0));
  await showState(page, simple(3, 1));
  await showState(page, simple(4, 1));
  expect(await said(page), "3 more changes within 8 s: still waiting").toEqual(["CSE 2, ECE 0."]);
  await page.clock.runFor(8000);
  expect(await said(page), "then only the newest").toEqual(["CSE 2, ECE 0.", "CSE 4, ECE 1."]);
});

test("the same score again (e.g. resent after a reconnect) is not announced", async ({ page }) => {
  await openFixturePage(page, "fx-say");
  await listen(page);
  await showState(page, simple(1, 0));
  await showState(page, simple(1, 0));                       // newer version, same score
  await showState(page, simple(1, 0));
  expect(await said(page)).toEqual([]);
});
