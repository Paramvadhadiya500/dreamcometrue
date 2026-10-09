const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
module.exports = pool;