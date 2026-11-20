// Home page tabs are links (#live, #schedule, #results, #points) (Phase 4): the Back button goes to the
// previous tab, a shared link opens the right tab, and screen readers hear which tab is chosen (aria-current).
const { test, expect } = require("@playwright/test");

const tab = (page, name) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name });

async function expectChosen(page, name, hash) {
  await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.tabs [aria-current="page"]'), "exactly one chosen tab").toHaveCount(1);
  expect(new URL(page.url()).hash).toBe(hash);
}

test("clicking tabs changes the address; Back and Forward go through the tabs", async ({ page }) => {
  await page.goto("/");
  await expect(tab(page, "Live")).toHaveAttribute("aria-current", "page");
  await tab(page, "Schedule").click();
  await expectChosen(page, "Schedule", "#schedule");
  await tab(page, "Results").click();
  await expectChosen(page, "Results", "#results");
  await page.goBack();
  await expectChosen(page, "Schedule", "#schedule");
  await page.goForward();
  await expectChosen(page, "Results", "#results");
});

test("a shared link opens its tab: /#points shows the points table tab", async ({ page }) => {
  await page.goto("/#points");
  await expectChosen(page, "Points", "#points");
  await expect(page.locator("#list")).not.toContainText("Loading");
  await expect(page.locator("#list")).not.toContainText("Cannot load");
});

test("an unknown address part falls back to Live", async ({ page }) => {
  await page.goto("/#nonsense");
  await expect(tab(page, "Live")).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.tabs [aria-current="page"]')).toHaveCount(1);
});

test("keyboard: Tab to a tab, Enter opens it", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(tab(page, "Schedule")).toBeFocused();
  await page.keyboard.press("Enter");
  await expectChosen(page, "Schedule", "#schedule");
});
