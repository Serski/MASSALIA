-- Wife Lifespan & Fertility pass: wives now age, die of old age, and bear
-- children only within a fertility window. Each marriage rolls the wife's
-- death age at marriage time, uniformly in the configured band.

-- The wife's rolled lifespan. Compared against her lazily-aged current age; when
-- reached, the marriage ends with end_reason 'spouse_died'.
ALTER TABLE marriages
  ADD COLUMN IF NOT EXISTS spouse_death_age integer;

-- Backfill existing active marriages with a roll now, uniform in [60, 70]
-- (content/family/family-config.json spouse.deathAge at the time of this pass).
UPDATE marriages
  SET spouse_death_age = 60 + floor(random() * (70 - 60 + 1))::int
  WHERE ended_at IS NULL AND spouse_death_age IS NULL;
