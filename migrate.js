// Usage: node migrate.js
// Applies every .sql file in ./migrations (in name order) that has not been applied yet.
const fs = require("fs");
const path = require("path");
const pool = require("./db");
async function main() {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

    const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));

    const dir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const f of files) {
        if (done.has(f)) continue;
        const sql = fs.readFileSync(path.join(dir, f), "utf8");
        const client = await pool.connect();
        let ok = true;
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
            await client.query("COMMIT");
            console.log("applied", f);
        } catch (e) {
            await client.query("ROLLBACK");
            console.error("FAILED", f, "-", e.message);
            ok = false;
        } finally {
            client.release();
        }
        if (!ok) { process.exitCode = 1; break; }
    }

    if (!process.exitCode) console.log("Database is up to date");
    await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });