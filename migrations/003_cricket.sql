-- Cricket needs two things:
--   events.data    the details of one delivery (runs, extra, wicket)
--   matches.config the settings of one match (overs, players, who bats first, free hit)
ALTER TABLE events ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Allow the new kinds of event: a ball, and "end innings".
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('point', 'undo', 'finish', 'ball', 'end_innings'));
