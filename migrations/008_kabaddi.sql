-- Kabaddi: a raid (event type 'raid'), a fix of the players on court ('court'),
-- and a break shown on the pages ('break': timeout, other text, break over).
-- Same list as 007_basketball.sql plus these three. Safe to run twice.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('point', 'undo', 'finish', 'ball', 'end_innings', 'toss', 'end_period', 'raid', 'court', 'break'));
