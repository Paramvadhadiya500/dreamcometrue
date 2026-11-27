// The admin page (public/admin.html) as it works TODAY. Phase 8 step 1: these tests must stay green when the
// inline script/style move into files (step 2) and the CSP is switched on (step 3) - same behaviour, safer page.
// Every name is unique to this run (RUN), because the test database keeps old matches and users.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, ADMIN, PASSWORD, scorerSocket, sendPoint } = require("./helpers");

const SKEY = "admin-session";                       // the localStorage key admin.html uses
const session = (page) => page.evaluate((k) => localStorage.getItem(k), SKEY);

async function login(page) {
  await page.goto("/admin.html");
  await page.locator("#u").fill(ADMIN);
  await page.locator("#p").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#who")).toHaveText(ADMIN);
}

// Answers the page's confirm()/prompt() boxes. `answers` is a list used in order: true = OK, false = Cancel,
// a string = type it into a prompt and press OK. The texts of the boxes are kept in `seen`.
function answerDialogs(page, answers) {
  const seen = [];
  page.on("dialog", async (d) => {
    seen.push(d.type() + ": " + d.message());
    const a = answers.shift();
    if (a === false || a === undefined) await d.dismiss();
    else await d.accept(typeof a === "string" ? a : undefined);
  });
  return seen;
}

let n = 0;
const tag = () => RUN + "-" + ++n;

// Fills the "New match" form for a simple match and saves it. Returns the new row and the id from the server.
async function createMatch(page, { scorer = false } = {}) {
  const t = tag();
  const m = { teamA: "Ant " + t, teamB: "Bee " + t, name: "E2E Admin (Mix): Ant " + t + " vs Bee " + t };
  await page.getByRole("button", { name: "+ New match" }).click();
  await expect(page.locator("#formTitle")).toHaveText("New match");
  await page.locator("#fSport").selectOption("simple");
  await page.locator("#fCat").selectOption("mix");
  await page.locator("#fComp").fill("E2E Admin");
  await page.locator("#fTeamA").fill(m.teamA);
  await page.locator("#fTeamB").fill(m.teamB);
  await page.locator("#fVenue").fill("Ground " + t);
  if (scorer) await page.locator('#fScorers input[value="' + SCORER + '"]').check();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/admin/matches") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save" }).click();
  m.id = (await (await saved).json()).id;
  await expect(page.locator("#formBox")).toBeHidden();
  m.row = page.locator("#matchList .row", { hasText: m.name });
  await expect(m.row).toBeVisible();
  return m;
}

test.describe("admin page (today's behaviour)", () => {
  test("only the login box shows at start; a wrong password shows an error", async ({ page }) => {
    await page.goto("/admin.html");
    await expect(page.locator("#loginBox")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    await page.locator("#u").fill(ADMIN);
    await page.locator("#p").fill("wrong-password-e2e");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#loginErr")).toHaveText("wrong username or password");
    await expect(page.locator("#app")).toBeHidden();
    expect(await session(page)).toBeNull();
  });

  test("a scorer cannot use the admin page", async ({ page }) => {
    await page.goto("/admin.html");
    await page.locator("#u").fill(SCORER);
    await page.locator("#p").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#loginErr")).toHaveText("This page is for admins only.");
    await expect(page.locator("#app")).toBeHidden();
    expect(await session(page)).toBeNull();
  });

  test("log in, stay logged in after reload, switch tabs, log out", async ({ page }) => {
    await login(page);
    await expect(page.locator("#loginBox")).toBeHidden();
    expect(JSON.parse(await session(page)).username).toBe(ADMIN);
    await expect(page.locator("#tabMatches")).toHaveClass("on");
    await expect(page.locator("#matchesTab")).toBeVisible();
    await expect(page.locator("#scorersTab")).toBeHidden();
    await expect(page.locator("#formBox")).toBeHidden();
    await expect(page.locator("#historyBox")).toBeHidden();

    await page.reload();                                   // the token in localStorage logs in again
    await expect(page.locator("#who")).toHaveText(ADMIN);
    await expect(page.locator("#loginBox")).toBeHidden();

    await page.getByRole("button", { name: "Scorers" }).click();
    await expect(page.locator("#scorersTab")).toBeVisible();
    await expect(page.locator("#matchesTab")).toBeHidden();
    await expect(page.locator("#tabScorers")).toHaveClass("on");
    await expect(page.locator("#scorerList .row", { hasText: SCORER }).first()).toBeVisible();
    await page.getByRole("button", { name: "Matches" }).click();
    await expect(page.locator("#matchesTab")).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.locator("#loginBox")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    expect(await session(page), "the token is removed").toBeNull();
  });

  test("a bad saved token sends you back to the login box", async ({ page }) => {
    await page.addInitScript((k) => {
      if (!sessionStorage.getItem("seeded")) {           // only on the first load
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(k, JSON.stringify({ token: "not-a-real-token", username: "ghost" }));
      }
    }, SKEY);
    await page.goto("/admin.html");
    await expect(page.locator("#loginErr")).toHaveText("Session expired. Please log in again.");
    await expect(page.locator("#loginBox")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    expect(await session(page)).toBeNull();
  });

  test("the form shows the settings of the chosen sport; an empty form shows an error", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "+ New match" }).click();
    await expect(page.locator("#formBox")).toBeVisible();
    await expect(page.locator("#lockNote")).toBeHidden();
    const groups = { cricket: "#crGroup", table_tennis: "#ttGroup", volleyball: "#vbGroup", basketball: "#bbGroup", simple: null };
    for (const [sport, shown] of Object.entries(groups)) {
      await page.locator("#fSport").selectOption(sport);
      for (const g of Object.values(groups).filter(Boolean)) {
        if (g === shown) await expect(page.locator(g), sport + " shows " + g).toBeVisible();
        else await expect(page.locator(g), sport + " hides " + g).toBeHidden();
      }
    }
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#fErr")).toHaveText("Choose a category");
    await page.locator("#fCat").selectOption("boys");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#fErr")).toHaveText("give a match name, or both team names");
    await expect(page.locator("#formBox")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#formBox")).toBeHidden();
  });

  test("college rules: cricket overs come from the category and stage; Mix cricket is refused", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "+ New match" }).click();
    await page.locator("#fSport").selectOption("cricket");
    const overs = page.locator("#fOvers");
    const pick = async (category, stage) => {
      await page.locator("#fCat").selectOption(category);
      await page.locator("#fStage").selectOption(stage);
    };
    await pick("boys", "group");             await expect(overs).toHaveValue("12");
    await pick("boys", "quarter_final");     await expect(overs).toHaveValue("12");
    await pick("boys", "semi_final");        await expect(overs).toHaveValue("14");
    await pick("boys", "final");             await expect(overs).toHaveValue("14");
    await pick("girls", "group");            await expect(overs).toHaveValue("10");
    await pick("girls", "final");            await expect(overs).toHaveValue("12");
    await pick("male_faculty", "semi_final"); await expect(overs).toHaveValue("14");
    await expect(page.locator("#oversHint")).toHaveText("College rule: 14 overs");
    await overs.fill("9");                   // the admin can still change it (rain)
    await expect(overs).toHaveValue("9");

    await pick("mix", "group");
    await expect(page.locator("#oversHint")).toHaveText("Cricket is only for Student Boys, Student Girls and Male Faculty");
    await page.locator("#fTeamA").fill("Ant " + tag());
    await page.locator("#fTeamB").fill("Bee " + tag());
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#fErr")).toHaveText("cricket is only for Boys, Girls and Male Faculty");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("college rules: basketball quarters are 7 or 10 minutes from the stage; only Boys and Girls", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "+ New match" }).click();
    await page.locator("#fSport").selectOption("basketball");
    const hint = page.locator("#bbHint");
    const pick = async (category, stage) => {
      await page.locator("#fCat").selectOption(category);
      await page.locator("#fStage").selectOption(stage);
    };
    await pick("boys", "group");          await expect(hint).toHaveText("College rule: 4 quarters of 7 minutes (set from the stage)");
    await pick("girls", "quarter_final"); await expect(hint).toHaveText("College rule: 4 quarters of 7 minutes (set from the stage)");
    await pick("girls", "semi_final");    await expect(hint).toHaveText("College rule: 4 quarters of 10 minutes (set from the stage)");
    await pick("boys", "final");          await expect(hint).toHaveText("College rule: 4 quarters of 10 minutes (set from the stage)");

    await pick("mix", "group");
    await expect(hint).toHaveText("Basketball is only for Student Boys and Student Girls");
    await page.locator("#fTeamA").fill("Ant " + tag());
    await page.locator("#fTeamB").fill("Bee " + tag());
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#fErr")).toHaveText("basketball is only for Boys and Girls");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("create a match with a scorer, edit it, delete it (Cancel keeps it)", async ({ page }) => {
    const seen = answerDialogs(page, [false, true]);
    await login(page);
    const m = await createMatch(page, { scorer: true });
    await expect(m.row).toContainText("Other sport · Mix · E2E Admin · " + m.teamA + " vs " + m.teamB);
    await expect(m.row).toContainText("Scorers: " + SCORER);
    await expect(m.row).toContainText("Not started");
    await expect(m.row.getByRole("button", { name: "History" })).toHaveCount(0);

    // the scorer really got the match
    const res = await fetch(BASE_URL + "/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: SCORER, password: PASSWORD }),
    });
    expect((await res.json()).matches.map((x) => x.id)).toContain(m.id);

    // edit: the form is filled with the match, a change is saved
    await m.row.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("#formTitle")).toHaveText("Edit match");
    await expect(page.locator("#fTeamA")).toHaveValue(m.teamA);
    await expect(page.locator("#fSport")).toBeEnabled();
    await page.locator("#fVenue").fill("Hall " + RUN);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#formBox")).toBeHidden();
    await expect(m.row).toContainText("Hall " + RUN);

    // delete: Cancel keeps the match, OK deletes it
    await m.row.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => seen.length).toBe(1);
    await expect(m.row).toBeVisible();
    await m.row.getByRole("button", { name: "Delete" }).click();
    await expect(m.row).toHaveCount(0);
    expect(seen).toEqual(['confirm: Delete "' + m.name + '"?', 'confirm: Delete "' + m.name + '"?']);
  });

  test("a scored match: settings locked, history opens/refreshes/closes, delete needs DELETE", async ({ page }) => {
    const seen = answerDialogs(page, [true, "delete", true, "DELETE"]);
    await login(page);
    const m = await createMatch(page, { scorer: true });
    const scorer = await scorerSocket(BASE_URL);
    try {
      await sendPoint(scorer, m.id, "A");
      await page.reload();
      await expect(m.row).toContainText("1 scoring actions");

      await m.row.getByRole("button", { name: "Edit" }).click();
      await expect(page.locator("#lockNote")).toBeVisible();
      await expect(page.locator("#fSport")).toBeDisabled();
      await page.getByRole("button", { name: "Cancel" }).click();

      await m.row.getByRole("button", { name: "History" }).click();
      await expect(page.locator("#historyBox")).toBeVisible();
      await expect(page.locator("#historyTitle")).toHaveText("History: " + m.name);
      await expect(page.locator("#historySummary")).toHaveText("1 action · " + SCORER + " 1 · 0 undone");
      await expect(page.locator("#historyList .hrow")).toHaveCount(1);

      await sendPoint(scorer, m.id, "B");
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.locator("#historySummary")).toHaveText("2 actions · " + SCORER + " 2 · 0 undone");
      await expect(page.locator("#historyList .hrow")).toHaveCount(2);
      await expect(m.row).toContainText("2 scoring actions");      // Refresh also reloads the cards
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.locator("#historyBox")).toBeHidden();
    } finally {
      scorer.close();
    }

    // a wrong word in the prompt keeps the match; "DELETE" deletes it with its scores
    await m.row.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => seen.length).toBe(2);
    await expect(m.row).toBeVisible();
    await m.row.getByRole("button", { name: "Delete" }).click();
    await expect(m.row).toHaveCount(0);
    expect(seen[1]).toContain("prompt: This match has 2 scoring actions");
  });

  test("scorers: create (password shown once), new password, disable, enable", async ({ page }) => {
    const seen = answerDialogs(page, [true]);
    const name = "e2e_" + RUN;                          // a-z, 0-9, _ ; at most 20 characters
    const tryLogin = async (password) => (await fetch(BASE_URL + "/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name, password }),
    })).status;

    await login(page);
    await page.getByRole("button", { name: "Scorers" }).click();
    await page.locator("#newUser").fill("Bad Name!");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("#newErr")).toContainText("username: 3 to 20 characters");

    await page.locator("#newUser").fill(name);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("#secret .good")).toContainText("Password for " + name + ":");
    const first = await page.locator("#secret .good b").textContent();
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    await expect(page.locator("#newUser")).toHaveValue("");
    const row = page.locator("#scorerList .row", { has: page.locator(".title", { hasText: new RegExp("^" + name + "$") }) });
    await expect(row).toContainText("Active · 0 matches");
    expect(await tryLogin(first)).toBe(200);

    await page.locator("#newUser").fill(name);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("#newErr")).toHaveText("that username already exists");

    await row.getByRole("button", { name: "New password" }).click();
    await expect(page.locator("#secret .good b")).not.toHaveText(first);
    const second = await page.locator("#secret .good b").textContent();
    expect(seen[0]).toContain("confirm: Make a new password for " + name);
    expect(await tryLogin(second)).toBe(200);

    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row).toContainText("Disabled · 0 matches");
    expect(await tryLogin(second), "a disabled scorer cannot log in").toBe(401);
    await row.getByRole("button", { name: "Enable" }).click();
    await expect(row).toContainText("Active · 0 matches");
    expect(await tryLogin(second)).toBe(200);
  });

  test("scorers: Delete asks first (Cancel keeps), then removes the scorer", async ({ page }) => {
    const seen = answerDialogs(page, [false, true]);
    const name = ("e2d_" + RUN).slice(0, 20);
    await login(page);
    await page.getByRole("button", { name: "Scorers" }).click();
    await page.locator("#newUser").fill(name);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("#secret .good")).toContainText("Password for " + name + ":");
    const row = page.locator("#scorerList .row", { has: page.locator(".title", { hasText: new RegExp("^" + name + "$") }) });

    await row.getByRole("button", { name: "Delete" }).click();         // Cancel
    await expect.poll(() => seen.length).toBe(1);
    await expect(row).toBeVisible();
    expect(seen[0]).toBe("confirm: Delete scorer " + name + "?\nScores they entered stay in the history. This cannot be undone.");

    await row.getByRole("button", { name: "Delete" }).click();         // OK
    await expect(row).toHaveCount(0);
    await expect(page.locator("#secret .good")).toHaveCount(0, { timeout: 1000 });   // its password box is cleared
    await expect(page.locator("#newErr")).toHaveText("");
  });
});
