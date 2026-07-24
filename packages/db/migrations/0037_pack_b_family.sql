-- Family pack B: the lover plot, per-game-year action tracking, and the child
-- rumor flag. Additive only — nothing reads or writes these yet.
--
-- marriages: lover plot state (code-enforced 'none'/'active'/'fallen') + its
-- timestamps, and the yearInGame of the last gift / symposium (once-per-year gates).
ALTER TABLE marriages
  ADD COLUMN IF NOT EXISTS lover_state          text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS lover_started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS lover_fell_at        timestamptz,
  ADD COLUMN IF NOT EXISTS lover_discovered_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_gift_year       integer,
  ADD COLUMN IF NOT EXISTS last_symposium_year  integer;

-- children: rumor of another father (set when born during an active lover plot).
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS rumor boolean NOT NULL DEFAULT false;
