-- Unit mission (server-side only — never shipped under apps/web/public; the
-- client reads it through /api/barracks).
-- player_units.mission: what a row on the march is doing, set by the map action
--   that sent it ({ kind: scout | raid | attack | move, regionId, departedAt })
--   and cleared by the barracks settle when the row arrives. NULL for a row at
--   home; rows already moving when this lands have no mission and read as a
--   plain return.
-- Idempotent: IF NOT EXISTS.
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS mission jsonb;
