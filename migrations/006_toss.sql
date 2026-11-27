-- Cricket: the scorer records the toss before the first ball (event type 'toss', data = { winner, choice }).
-- Same list as 003_cricket.sql plus 'toss'. Safe to run twice.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('point', 'undo', 'finish', 'ball', 'end_innings', 'toss'));
