// Playwright settings for the end-to-end tests in e2e/ (dev only; not in the Docker image).
// Laptop (PowerShell, in the project folder):
//   docker compose -f docker-compose.test.yml up -d --wait
//   npm run test:e2e
//   docker compose -f docker-compose.test.yml down
const { defineConfig, devices } = require("@playwright/test");
const { BASE_URL } = require("./e2e/helpers");

module.exports = defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.js",
  workers: 1,                    // one shared server and database: run the tests one after another
  fullyParallel: false,
  forbidOnly: !!process.env.CI,  // a forgotten test.only must not hide the other tests on GitHub
  retries: 0,                    // a flaky test should be fixed, not hidden by a retry
  timeout: 30000,                // one test may take at most 30 s
  expect: { timeout: 5000 },     // expect(...) keeps checking for up to 5 s
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",  // a failed test keeps a recording: npx playwright show-trace <file>
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
