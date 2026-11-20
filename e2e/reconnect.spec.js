// Scenario 2: the server goes down while a student watches a match -> the red "Reconnecting..." bar.
// Then the server comes back -> the bar goes away and new points arrive again (the page re-joins its match).
// This test starts its OWN server.js on a free port, so stopping it does not break the other tests.
const { test, expect } = require("@playwright/test");
const { openDb, addMatch, freePort, startServer, scorerSocket, sendPoint } = require("./helpers");

let pool, server;
test.beforeAll(() => { pool = openDb(); });
test.afterAll(async () => {
  if (server) await server.stop();
  await pool.end();
});

test("server stops -> reconnecting bar; server back -> bar gone and new points arrive", async ({ page }) => {
  const port = await freePort();
  server = await startServer(port);
  const m = await addMatch(pool);
  const bar = page.locator("#conn");

  await page.goto(server.url + "/match.html?id=" + m.id);
  await expect(page.locator("#sA")).toHaveText("0");
  await expect(bar).toBeHidden();

  // the server process ends: the browser's connection breaks
  await server.stop();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText("Reconnecting... the score below may be out of date");
  await expect(page.locator("#sA")).toHaveText("0");          // the old score stays on screen

  // the server starts again on the SAME port; Socket.IO retries by itself (about 1-5 s between tries)
  server = await startServer(port);
  await expect(bar).toBeHidden({ timeout: 15000 });

  // the page joined its match again: a new point reaches it
  const scorer = await scorerSocket(server.url);
  try {
    await sendPoint(scorer, m.id, "A");
    await expect(page.locator("#sA")).toHaveText("1", { timeout: 3000 });
  } finally {
    scorer.close();
  }
});
