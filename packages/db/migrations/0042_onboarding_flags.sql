-- Onboarding seen-flags: first-seen timestamps for the welcome intro overlay and
-- the character-sheet portrait pulse. Set once (immutable first-seen); NULL means
-- the player has not yet dismissed that step. Idempotent (mirrors 0041); no backfill
-- — existing rows stay NULL, so returning players see the onboarding once.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS intro_seen_at timestamptz;
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS sheet_seen_at timestamptz;
