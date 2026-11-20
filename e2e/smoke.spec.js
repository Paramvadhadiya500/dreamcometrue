// Smoke test: the home page opens and gets its data from the real server (database + Redis work).
const { test, expect } = require("@playwright/test");

test("home page opens and loads the match list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sports Live" })).toBeVisible();
  // "Loading..." is replaced once /api/home has answered
  await expect(page.locator("#list")).not.toHaveText("Loading...");
  await expect(page.locator("#list")).not.toContainText("Cannot load");
});
