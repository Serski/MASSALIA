-- The hoplite capstone (Step 5): one-way re-class + veteran Strategos eligibility.
-- Additive only.
--
-- was_hoplite: the persistent signal that a character is, or ever was, a hoplite —
-- preserved through re-class so a former-hoplite-now-landowner stays Strategos-
-- eligible. Set true at creation-as-hoplite; backfilled for existing hoplites.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS was_hoplite boolean NOT NULL DEFAULT false;

UPDATE player_characters SET was_hoplite = true WHERE class_id = 'hoplite';
