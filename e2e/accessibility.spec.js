// Basic accessibility of the student pages (Phase 3, step 3): they must survive the coming redesign.
const { test, expect } = require("@playwright/test");

test("keyboard focus shows a clear ring; a mouse click shows none", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");                                   // first stop: the Live tab
  const live = page.getByRole("link", { exact: true, name: "Live" });
  await expect(live).toBeFocused();
  await expect(live).toHaveCSS("outline-style", "solid");
  await expect(live).toHaveCSS("outline-width", "3px");

  const schedule = page.getByRole("link", { exact: true, name: "Schedule" });
  await schedule.click();                                             // mouse: :focus-visible is false
  await expect(schedule).toBeFocused();
  await expect(schedule).toHaveCSS("outline-style", "none");
});

test("the sports dropdown has a name for screen readers", async ({ page }) => {
  await page.goto("/");
  // the label is .sr-only: not on screen, but it gives the dropdown its name
  await expect(page.getByRole("combobox", { name: "Sport" })).toBeVisible();
});

test("phone set to reduce motion: animations end at once", async ({ page }) => {
  // no animation exists yet, so the test adds one (2 s) and reads how long it really lasts
  const animationSeconds = () => page.evaluate(() => {
    const el = document.createElement("div");
    el.style.animation = "anything 2s";
    document.body.append(el);
    return parseFloat(getComputedStyle(el).animationDuration);
  });
  await page.goto("/");
  expect(await animationSeconds()).toBe(2);                           // normal setting: 2 s
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationSeconds()).toBeLessThan(0.001);               // reduce motion: almost 0
});
