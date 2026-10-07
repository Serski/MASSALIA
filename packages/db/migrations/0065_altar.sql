-- The Barracks altar (server-side only; the client reads it through
-- /api/barracks). A bull or a chicken burned there raises the morale of every
-- row the player fields for altar.seasons seasons (battle.json), a DURATION
-- from the act, as training and contracts are since 0054.
--   altar_until the instant the blessing ends: now + seasons × one day
--   altar_good  the good burned, for the view ("bull" / "chicken")
-- Both NULL while the altar is cold. Players are per world, so the blessing
-- is world-scoped by construction.
-- Idempotent: IF NOT EXISTS.
ALTER TABLE players ADD COLUMN IF NOT EXISTS altar_until timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS altar_good text;
