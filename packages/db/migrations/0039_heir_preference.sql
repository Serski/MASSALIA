-- Heir preference: when a character has BOTH an of-age son and an adopted heir,
-- this standing choice decides who inherits. Default 'blood' preserves the current
-- behavior (the of-age son wins) for every existing row — no backfill needed. The
-- succession plan consults it only when both paths exist; otherwise it is inert.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS heir_preference text NOT NULL DEFAULT 'blood';

ALTER TABLE player_characters
  ADD CONSTRAINT player_characters_heir_pref_chk CHECK (heir_preference IN ('blood', 'adopted'));
