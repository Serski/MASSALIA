-- The hoplite's mercenary contracts — STATE + go/return lifecycle (Step 2 of 5).
-- Additive only: three new columns on player_characters, no ALTER/DROP of existing
-- columns. Existing rows are all NULL (home — no contract).
--
-- A contract pauses home rank salary and pays FOREIGN income instead while the
-- hoplite is sworn abroad. contract_started_at is the immutable lifecycle anchor
-- (seasons-elapsed → completion); the existing last_salary_at doubles as the
-- foreign-income collection anchor while abroad (home XOR foreign income — they
-- are mutually exclusive, so the one anchor serves whichever is active).
--
-- SAFE lifecycle only: contracts always complete successfully. The death/injury
-- roll is Step 4 (a TODO marks its insertion point in the completion routine).
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS contract_id text,
  ADD COLUMN IF NOT EXISTS contract_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_seasons_total integer;
