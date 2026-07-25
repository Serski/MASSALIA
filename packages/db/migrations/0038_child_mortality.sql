-- Family pack C: child mortality. A child dies (pack C tragedies set this) when
-- died_at is non-null. Additive only; nothing writes died_at yet. Every
-- live-state read of children filters on `died_at IS NULL`; history keeps its dead.
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS died_at timestamptz;
