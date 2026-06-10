-- Age, stat cap & old-age decay. The 100 hard cap is the ceiling of human
-- excellence; age decay is the arc of a life. Constants live in
-- content/age/age-config.json — this migration only adds the storage + the cap.

-- 1. Hard cap on every stat. Clamp existing data into [0,100] FIRST so the
--    CHECK constraints can be added without violating any current row.
UPDATE player_characters SET
  prestige     = LEAST(GREATEST(prestige, 0), 100),
  devotion     = LEAST(GREATEST(devotion, 0), 100),
  militia      = LEAST(GREATEST(militia, 0), 100),
  intelligence = LEAST(GREATEST(intelligence, 0), 100);

ALTER TABLE player_characters
  ADD CONSTRAINT player_characters_prestige_range     CHECK (prestige     BETWEEN 0 AND 100),
  ADD CONSTRAINT player_characters_devotion_range     CHECK (devotion     BETWEEN 0 AND 100),
  ADD CONSTRAINT player_characters_militia_range      CHECK (militia      BETWEEN 0 AND 100),
  ADD CONSTRAINT player_characters_intelligence_range CHECK (intelligence BETWEEN 0 AND 100);

-- 2. Age columns. start_age defaults to 30 (so existing rows are filled). The
--    nullable columns are backfilled for legacy rows below.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS start_age     integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS avatar_id     text,
  ADD COLUMN IF NOT EXISTS death_age     integer,
  ADD COLUMN IF NOT EXISTS last_decay_at timestamptz;

-- Backfill legacy rows: avatar 'avatar-30-1', a death age rolled in [55,68],
-- and a fresh decay anchor. (No marital column — unmarried is implicit until the
-- marriage pack.)
UPDATE player_characters SET
  avatar_id     = COALESCE(avatar_id, 'avatar-30-1'),
  death_age     = COALESCE(death_age, 55 + floor(random() * (68 - 55 + 1))::int),
  last_decay_at = COALESCE(last_decay_at, now());
