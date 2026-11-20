// Content-Security-Policy of the student pages (Phase 6): only script/style FILES from this site run, the pages
// connect only to this site (API + WebSocket), and normal use causes no blocked item at all.
const { test, expect } = require("@playwright/test");
const { BASE_URL, openDb, addMatch, waitUntilOnHome, scorerSocket, sendPoint } = require("./helpers");

// every item the browser blocks because of the CSP is recorded in window.__blocked
async function recordBlocked(page) {
  await page.addInitScript(() => {
    window.__blocked = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__blocked.push(e.violatedDirective + " " + (e.blockedURI || "inline")));
  });
}
const blocked = (page) => page.evaluate(() => window.__blocked);

for (const url of ["/", "/match.html?id=no-such-match"]) {
  test("CSP header on " + url + ": files from this site only, no inline code", async ({ page }) => {
    const res = await page.goto(url);
    const csp = res.headers()["content-security-policy"] || "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers()["permissions-policy"]).toContain("camera=()");
  });

  test("an injected inline script does NOT run on " + url, async ({ page }) => {
    await recordBlocked(page);
    await page.goto(url);
    const ran = await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__injected = true";            // what an attacker's <script> would do
      document.body.append(s);
      return window.__injected === true;
    });
    expect(ran, "the injected script must be blocked").toBe(false);
    expect(await blocked(page)).toContain("script-src-elem inline");
  });
}

test("normal use is not blocked: home (all tabs) and a live match page with its WebSocket", async ({ page }) => {
  const pool = openDb();
  const scorer = await scorerSocket(BASE_URL);
  // the browser console keeps every CSP message across page loads (window.__blocked starts again on each page)
  const cspErrors = [];
  page.on("console", (msg) => { if (/Content Security Policy/i.test(msg.text())) cspErrors.push(msg.text().slice(0, 120)); });
  try {
    const m = await addMatch(pool);
    await sendPoint(scorer, m.id, "A");
    await waitUntilOnHome(BASE_URL, m.id);            // /api/home is cached for 3 s (see helpers.js)
    await recordBlocked(page);

    await page.goto("/");
    await expect(page.locator("a.card", { hasText: m.teamA })).toBeVisible();   // the page's script really ran
    expect(await blocked(page), "nothing blocked on the home page").toEqual([]);
    for (const tab of ["Live", "Schedule", "Results", "Points"]) {
      await page.getByRole("link", { exact: true, name: tab }).click();
      await expect(page.locator("#list")).not.toContainText("Loading");
    }
    await page.getByRole("combobox", { name: "Sport" }).selectOption({ index: 0 });

    await page.goto("/match.html?id=" + m.id);
    await expect(page.locator("#sA")).toHaveText("1");
    await sendPoint(scorer, m.id, "A");
    await expect(page.locator("#sA")).toHaveText("2", { timeout: 3000 });
    // the live connection really upgraded to a WebSocket (allowed by connect-src 'self')
    await expect.poll(() => page.evaluate(() => socket.io.engine.transport.name)).toBe("websocket");

    expect(await blocked(page), "nothing blocked on the match page").toEqual([]);
    expect(cspErrors, "no CSP message in the console on any page").toEqual([]);
  } finally {
    scorer.close();
    await pool.end();
  }
});

test("scorer and admin pages are not changed by this (they still use inline code)", async ({ page }) => {
  for (const url of ["/scorer.html", "/admin.html"]) {
    const res = await page.goto(url);
    expect(res.headers()["content-security-policy"], url).toBeUndefined();
  }
});
