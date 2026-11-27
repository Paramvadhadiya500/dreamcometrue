-- Basketball: the scorer ends a quarter or an overtime (event type 'end_period', no data).
-- Same list as 006_toss.sql plus 'end_period'. Safe to run twice.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('point', 'undo', 'finish', 'ball', 'end_innings', 'toss', 'end_period'));
