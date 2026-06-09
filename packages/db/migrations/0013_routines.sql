-- Daily Routines: the proactive half of the daily loop. One self-directed
-- routine per character per UTC day, separate from the reactive decision cards.
--
-- Four routines feed "ladders" — hidden XP toward the existing upbringing traits.
-- The XP accrues in these columns (mirrors the composure column style); crossing a
-- tier threshold grants the next tier trait (and removes the lower one).
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS rhetoric_xp    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS philosophia_xp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gymnasium_xp   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mysteries_xp   integer NOT NULL DEFAULT 0;

-- One row per character per UTC day → the UNIQUE constraint enforces one pick/day.
CREATE TABLE IF NOT EXISTS daily_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  utc_day text NOT NULL,
  routine_id text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, utc_day)
);
