-- College rules: every match has a category, and knockout matches have a round.
--   category  '' (not set, old matches) | boys | girls | male_faculty | female_faculty | mix
--   stage     group | quarter_final | semi_final | final | knockout (old matches)
-- Safe to run twice.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_category_check;
ALTER TABLE matches ADD CONSTRAINT matches_category_check
  CHECK (category IN ('', 'boys', 'girls', 'male_faculty', 'female_faculty', 'mix'));

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_stage_check;
ALTER TABLE matches ADD CONSTRAINT matches_stage_check
  CHECK (stage IN ('group', 'knockout', 'quarter_final', 'semi_final', 'final'));
