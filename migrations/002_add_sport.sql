-- Each match now has a sport, which decides which rules engine scores it.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'table_tennis';

-- Points added by one scoring action (used by simple-score sports; NULL means 1).
ALTER TABLE events ADD COLUMN IF NOT EXISTS value INT;

-- Allow a new kind of event: the scorer pressing "Finish match".
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN ('point', 'undo', 'finish'));