-- The hoplite's home army — RANKS + SALARY (Hoplite Step 1 of 5). Additive only:
-- two new columns on player_characters, no ALTER/DROP of existing columns.
--
-- army_rank      the four-rank promotion ladder (an application, not an election;
--                distinct from the Strategos office). Existing rows default to
--                'none' — every hoplite applies to enlist.
-- last_salary_at lazy salary accrual anchor (rate × in-game days since this
--                instant, computed on read; reset on collect / enlist / promote).
--                Mirrors last_decay_at / last_composure_update.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS army_rank text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS last_salary_at timestamptz;

ALTER TABLE player_characters
  ADD CONSTRAINT player_characters_army_rank_chk
  CHECK (army_rank IN ('none', 'recruit', 'veteran', 'lochagos', 'archilochagos'));
