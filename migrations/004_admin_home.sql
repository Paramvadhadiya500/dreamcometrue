-- Lesson 11: real team names, schedule fields, and grouping for the points table.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_a      TEXT NOT NULL DEFAULT '';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_b      TEXT NOT NULL DEFAULT '';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS competition TEXT NOT NULL DEFAULT '';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stage       TEXT NOT NULL DEFAULT 'group';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS venue       TEXT NOT NULL DEFAULT '';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS start_time  TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_stage_check;
ALTER TABLE matches ADD CONSTRAINT matches_stage_check CHECK (stage IN ('group', 'knockout'));

CREATE INDEX IF NOT EXISTS matches_start_idx ON matches (start_time);
