// Smoke test: the home page opens and gets its data from the real server (database + Redis work).
const { test, expect } = require("@playwright/test");

test("home page opens and loads the match list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sports Live" })).toBeVisible();
  // "Loading..." is replaced once /api/home has answered, by real content: cards or a message
  // (an EMPTY list must fail too: that is what a page whose script did not run looks like)
  await expect(page.locator("#list")).not.toContainText("Loading");
  await expect(page.locator("#list")).not.toContainText("Cannot load");
  await expect(page.locator("#list a.card, #list p.empty").first()).toBeVisible();
});

// Both student pages take their colors from /css/base.css. If that file does not load (wrong path, typo),
// the page still works but loses its colors (the red "Reconnecting" bar has no red), and no other test sees it.
for (const url of ["/", "/match.html?id=no-such-match"]) {
  test("shared stylesheet base.css is loaded on " + url, async ({ page }) => {
    await page.goto(url);
    const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand"));
    expect(brand.trim(), "the --brand token from base.css").not.toBe("");
  });

  // without an icon in the page, browsers ask for /favicon.ico on every visit and get 404
  test("tab icon and browser-bar color are set on " + url, async ({ page }) => {
    await page.goto(url);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^data:image\/svg\+xml,/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);   // light and dark
  });
}
