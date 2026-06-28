-- Atlas Phase 2b-i — once-per-game-year city drift guard.
-- Adds the per-(world,city) marker the drift sweep stamps after growing a city,
-- so the hourly tick stays idempotent (grow once per game year) and can catch up
-- if the worker was down across a year boundary. NULL means "never grown" (rows
-- seeded by 0030 / the ensure-on-read path predate this column). Additive and
-- idempotent: safe to re-run.
ALTER TABLE league_cities ADD COLUMN IF NOT EXISTS last_growth_year integer;
