-- Barracks timers: training and contracts become DURATIONS from the moment of
-- the action (recruit / hire), stored as timestamps, instead of resolving at
-- season boundaries. One season of duration is one real day.
--   ready_at        trained rows: created_at + trainSeasons days; NULL for bands
--   contract_end_at band rows:    created_at + termSeasons days (advanced on
--                                 renewal); NULL for trained
-- The old ready_at_season / contract_end_season columns stay (migrations are
-- append-only) but are no longer written or read after this migration; the
-- backfill derives each timestamp from the row's own created_at plus the
-- seasons its old column stood ahead of recruited_season.
-- Idempotent: IF NOT EXISTS columns; the backfills only touch NULL timestamps.
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS contract_end_at timestamptz;
UPDATE player_units
   SET ready_at = created_at + (ready_at_season - recruited_season) * interval '1 day'
 WHERE source = 'trained' AND ready_at IS NULL AND ready_at_season IS NOT NULL;
UPDATE player_units
   SET contract_end_at = created_at + (contract_end_season - recruited_season) * interval '1 day'
 WHERE source = 'band' AND contract_end_at IS NULL AND contract_end_season IS NOT NULL;
