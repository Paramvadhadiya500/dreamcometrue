// Match page connection states (Phase 5): the bar is announced (role="status"), says at once when the phone
// goes offline (with the time of the last score), and the page reconnects at once when it can.
const { test, expect } = require("@playwright/test");
const { stateFor, point, showState, openFixturePage } = require("./match-states");

const bar = (page) => page.locator("#conn");

test("phone goes offline: the bar says so at once, with the time of the last score; back online: it goes away", async ({ page, context }) => {
  await openFixturePage(page, "fx-conn");
  await showState(page, stateFor("simple", [point("A", 2)], { id: "fx-conn" }));
  await expect(bar(page)).toBeHidden();
  await expect(bar(page)).toHaveAttribute("role", "status");

  await context.setOffline(true);                     // the browser fires "offline" (the socket may not know yet)
  await expect(bar(page)).toBeVisible({ timeout: 2000 });
  await expect(bar(page)).toHaveText(/^No internet connection\. The score below is from .*\d\d.*\.$/);

  await context.setOffline(false);
  await expect(bar(page)).toBeHidden({ timeout: 15000 });
  expect(await page.evaluate(() => socket.connected)).toBe(true);
});

test("coming back to the tab with a dead connection reconnects at once", async ({ page }) => {
  await openFixturePage(page, "fx-conn");
  await showState(page, stateFor("simple", [point("A", 2)], { id: "fx-conn" }));
  // a connection closed while the phone slept: Socket.IO would NOT reconnect this one by itself
  await page.evaluate(() => socket.disconnect());
  await expect(bar(page)).toHaveText(/^Reconnecting\.\.\. The score below is from /);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // the tab is visible again
  await expect(bar(page)).toBeHidden({ timeout: 5000 });
  expect(await page.evaluate(() => socket.connected)).toBe(true);
});
