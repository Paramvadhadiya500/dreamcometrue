const bcrypt = require("bcryptjs");
const pool = require("./db");

const schema = `
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'scorer')),
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS matches (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  best_of INT  NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS match_scorers (
  username TEXT NOT NULL REFERENCES users(username),
  match_id TEXT NOT NULL REFERENCES matches(id),
  PRIMARY KEY (username, match_id)
);

CREATE TABLE IF NOT EXISTS events (
  seq        BIGSERIAL PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  match_id   TEXT NOT NULL REFERENCES matches(id),
  type       TEXT NOT NULL CHECK (type IN ('point', 'undo')),
  team       TEXT CHECK (team IN ('A', 'B')),
  by_user    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_match_idx ON events (match_id, seq);
`;

async function main() {
  await pool.query(schema);

  const users = [
    ["admin", "admin123", "admin"],
    ["rahul", "rahul123", "scorer"],
    ["neha", "neha123", "scorer"],
  ];
  for (const [u, p, r] of users) {
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING",
      [u, bcrypt.hashSync(p, 10), r]
    );
  }

  const matches = [
    ["tt-1", "Table Tennis: A vs B"],
    ["tt-2", "Table Tennis: C vs D"],
  ];
  for (const [id, name] of matches) {
    await pool.query("INSERT INTO matches (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [id, name]);
  }

  await pool.query("INSERT INTO match_scorers VALUES ('rahul', 'tt-1') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO match_scorers VALUES ('neha', 'tt-2') ON CONFLICT DO NOTHING");

  console.log("Seed done");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });