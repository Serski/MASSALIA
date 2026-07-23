-- Family pack, wife personality: give marriage candidates a personality trait
-- (a player trait id from content/traits/traits.json) so the wife reacts to the
-- player's daily choices through the composure system instead of being a dead
-- stat block. Additive only.
--
-- Nullable, no backfill: existing rows and non-marriage (adoption/regency)
-- candidates keep NULL and are treated as "no personality" everywhere downstream.
-- Her statMod is never applied to the player — only her opposes/embraces tags,
-- consumed by composure.
ALTER TABLE family_candidates
  ADD COLUMN IF NOT EXISTS personality_trait_id text;
