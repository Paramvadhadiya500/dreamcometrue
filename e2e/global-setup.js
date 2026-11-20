// Runs ONCE before all E2E tests (see playwright.config.js):
// 1. checks the database is a test database, 2. runs the migrations, 3. adds the test scorer,
// 4. starts the shared server.js on port 3100 (E2E_PORT).
// The function it returns runs ONCE after all tests: it stops that server.
const { PORT, checkTestDb, migrate, startServer, openDb, addScorer } = require("./helpers");

module.exports = async function globalSetup() {
  checkTestDb();
  await migrate();
  const pool = openDb();
  try { await addScorer(pool); } finally { await pool.end(); }

  const server = await startServer(PORT);
  return async function globalTeardown() {
    await server.stop();
  };
};
