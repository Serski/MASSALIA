-- Family arena pack: philia, the 0–100 bond with the spouse, on the marriage row.
-- Default 50 — existing marriages inherit it via the default, no backfill. Moved
-- later by family-event change_philia effects + a daily spouse-reaction coupling;
-- gates fertility and exposes band modifiers at its extremes. Additive only.
ALTER TABLE marriages
  ADD COLUMN IF NOT EXISTS philia integer NOT NULL DEFAULT 50;
