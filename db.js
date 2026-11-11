const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,   // a hung database fails after 5 s (the scorer's phone then retries) instead of waiting forever
});

// When Postgres restarts, its idle connections in the pool break. Without this listener Node treats that
// as an unhandled error and the WHOLE app crashes. With it we only log; the pool opens new connections by itself.
pool.on("error", (e) => console.error("db pool error (an idle connection was lost):", e.message));

module.exports = pool;
