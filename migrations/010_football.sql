-- Football: goals, cards, penalties (live "PENALTY!" banner), kick-off, extra time, penalty shootout kick by kick,
-- and "remove" (take out a wrong goal / card). Same list as 009_raid_start.sql plus the football types. Safe to run twice.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('point', 'undo', 'finish', 'ball', 'end_innings', 'toss', 'end_period', 'raid', 'court', 'break', 'raid_start',
                  'goal', 'card', 'penalty_start', 'penalty', 'period_start', 'extra_time', 'shootout_start', 'kick', 'remove'));
