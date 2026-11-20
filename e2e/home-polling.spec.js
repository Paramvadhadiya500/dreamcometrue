// How often the home page asks the server for /api/home (Phase 4).
// /api/home is answered by the test itself (page.route), so the database does not matter, and the page's
// clock is fake (page.clock), so minutes pass in milliseconds. Every wait has +-20 % random spread (jitter),
// so the checks use ranges.
const { test, expect } = require("@playwright/test");

const QUIET = { matches: [], competitions: [] };
const LIVE = {
  matches: [{ id: "poll-1", name: "Poll", sport: "simple", competition: "Poll", stage: "group", venue: "", startTime: null,
    hasTeams: true, teamA: "A", teamB: "B", status: "live", headline: "A 1 - 0 B", resultText: "" }],
  competitions: ["Poll"],
};

// Answer /api/home with reply() (an object = 200 JSON, a number = that error status).
// The page counts its own /api/home requests at the moment it sends them (window.__homeCalls).
async function open(page, reply) {
  await page.route("**/api/home", async (route) => {
    const r = reply();
    if (typeof r === "number") await route.fulfill({ status: r, body: "error" });
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(r) });
  });
  await page.addInitScript(() => {
    window.__homeCalls = 0;
    const realFetch = window.fetch;
    window.fetch = (url, opts) => { if (String(url).includes("/api/home")) window.__homeCalls++; return realFetch(url, opts); };
  });
  await page.clock.install();
  await page.goto("/");
  await page.waitForTimeout(300);                  // first answer read, next request planned
}
const calls = (page) => page.evaluate(() => window.__homeCalls);

// Move fake time on in 1 s steps until the page sends its next request. Returns the wait in ms (+-1 s).
async function nextWait(page, limit = 90000) {
  const before = await calls(page);
  for (let t = 1000; t <= limit; t += 1000) {
    await page.clock.runFor(1000);
    if ((await calls(page)) > before) {
      await page.waitForTimeout(200);              // REAL time for the page to read the answer and plan the next one
      return t;
    }
  }
  throw new Error("no request within " + limit + " ms");
}

// the wait must be base +-20 % (plus 1 s for the step size)
async function expectWait(page, base) {
  const w = await nextWait(page);
  expect(w, "wait " + w + " ms, expected about " + base).toBeGreaterThanOrEqual(base * 0.8 - 1000);
  expect(w, "wait " + w + " ms, expected about " + base).toBeLessThanOrEqual(base * 1.2 + 1000);
}

test("nothing live: asks again after about 60 s, not every 10 s", async ({ page }) => {
  await open(page, () => QUIET);
  expect(await calls(page)).toBe(1);
  await expectWait(page, 60000);
  await expectWait(page, 60000);
});

test("a match is live: asks again after about 10 s", async ({ page }) => {
  await open(page, () => LIVE);
  await expectWait(page, 10000);
  await expectWait(page, 10000);
  await expectWait(page, 10000);
});

test("errors: waits 10, 20, 40, 60, 60 s; after one success back to normal", async ({ page }) => {
  let failing = true;
  await open(page, () => (failing ? 500 : LIVE));  // request 1 fails
  for (const base of [10000, 20000, 40000, 60000, 60000]) await expectWait(page, base);
  failing = false;
  await expectWait(page, 60000);                   // this one works...
  await expectWait(page, 10000);                   // ...so the next wait is the normal 10 s (a match is live)
});

test("hidden tab: no requests; visible again: asks at once and keeps going even without the event", async ({ page }) => {
  await open(page, () => LIVE);
  // pretend the tab is hidden (the student switched apps)
  await page.evaluate(() => {
    window.__hidden = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__hidden ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await calls(page);
  await page.clock.runFor(120000);
  await page.waitForTimeout(200);
  expect(await calls(page), "no requests while hidden").toBe(before);

  // visible again, the normal way: the event refreshes at once
  await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(300);
  expect(await calls(page)).toBe(before + 1);

  // hidden again, then visible WITHOUT the event (some phones): polling must still come back by itself
  await page.evaluate(() => { window.__hidden = true; });
  await page.clock.runFor(30000);
  await page.evaluate(() => { window.__hidden = false; });
  await nextWait(page, 13000);                     // throws if no request comes within one live wait (max 12 s)
});

test("network comes back (online event): asks at once", async ({ page }) => {
  await open(page, () => QUIET);
  expect(await calls(page)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(300);
  expect(await calls(page)).toBe(2);
});
