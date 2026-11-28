-- Kabaddi: "raid started" (event type 'raid_start', data = { team } or { cancel: true }): shown live on the
-- match page, never scored, never taken back by UNDO. Same list as 008_kabaddi.sql plus 'raid_start'. Safe to run twice.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('point', 'undo', 'finish', 'ball', 'end_innings', 'toss', 'end_period', 'raid', 'court', 'break', 'raid_start'));
