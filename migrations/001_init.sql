-- First version of the schema (same tables as seed.js). Safe to run on a database that already has them.
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