-- Rejoin cooldown for political parties: when a player leaves a party they may
-- not rejoin until this timestamp passes. NULL = no active cooldown. Additive.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS party_cooldown_until timestamptz;
