// Content-Security-Policy of the student pages (Phase 6) and the admin page (Phase 8): only script/style FILES from
// this site run, the pages connect only to this site (API + WebSocket), and normal use causes no blocked item at all.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, ADMIN, PASSWORD, openDb, addMatch, waitUntilOnHome, scorerSocket, sendPoint } = require("./helpers");

// every item the browser blocks because of the CSP is recorded in window.__blocked
async function recordBlocked(page) {
  await page.addInitScript(() => {
    window.__blocked = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__blocked.push(e.violatedDirective + " " + (e.blockedURI || "inline")));
  });
}
const blocked = (page) => page.evaluate(() => window.__blocked);

for (const url of ["/", "/match.html?id=no-such-match", "/admin.html"]) {
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

test("normal use is not blocked: the whole admin flow", async ({ page }) => {
  const cspErrors = [];                              // kept across page loads (window.__blocked starts again on each)
  page.on("console", (msg) => { if (/Content Security Policy/i.test(msg.text())) cspErrors.push(msg.text().slice(0, 120)); });
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "DELETE" : undefined));
  await recordBlocked(page);
  const nothingBlocked = async (where) => expect(await blocked(page), "nothing blocked: " + where).toEqual([]);

  await page.goto("/admin.html");
  await page.locator("#u").fill(ADMIN);
  await page.locator("#p").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#who")).toHaveText(ADMIN);       // the page's script file really ran
  await expect(page.locator("#formBox")).toBeHidden();         // the CSS file really loaded (boxes hidden at start)
  await nothingBlocked("after login");

  // form: every sport, then create a match with the test scorer
  const t = "csp-" + RUN;
  await page.getByRole("button", { name: "+ New match" }).click();
  for (const s of ["table_tennis", "volleyball", "cricket", "simple"]) await page.locator("#fSport").selectOption(s);
  await page.locator("#fCat").selectOption("mix");             // also runs the category/stage listeners (college overs)
  await page.locator("#fStage").selectOption("final");
  await page.locator("#fStage").selectOption("group");
  await page.locator("#fTeamA").fill("Ant " + t);
  await page.locator("#fTeamB").fill("Bee " + t);
  await page.locator('#fScorers input[value="' + SCORER + '"]').check();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/admin/matches") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save" }).click();
  const id = (await (await saved).json()).id;
  const row = page.locator("#matchList .row", { hasText: "Ant " + t });
  await expect(row).toBeVisible();

  // a scored match: reload (new page load), history open / refresh / close, edit + cancel, delete (confirm + prompt)
  const scorer = await scorerSocket(BASE_URL);
  try { await sendPoint(scorer, id, "A"); } finally { scorer.close(); }
  await page.reload();
  await expect(row).toContainText("1 scoring actions");
  await row.getByRole("button", { name: "History" }).click();
  await expect(page.locator("#historyList .hrow")).toHaveCount(1);
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("#lockNote")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await nothingBlocked("matches");

  // scorers tab: create one, log out
  await page.getByRole("button", { name: "Scorers" }).click();
  await page.locator("#newUser").fill("csp_" + RUN);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#secret .good")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.locator("#loginBox")).toBeVisible();
  await nothingBlocked("scorers + log out");
  expect(cspErrors, "no CSP message in the console on any page load").toEqual([]);
});

test("the scorer page is not changed by this (it still uses inline code)", async ({ page }) => {
  const res = await page.goto("/scorer.html");
  expect(res.headers()["content-security-policy"]).toBeUndefined();
});
