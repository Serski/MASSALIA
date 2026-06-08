-- Composure: lazy recovery bookkeeping + break (withdrawn) state on the sheet,
-- plus an audit log of every change.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS last_composure_update timestamptz,
  ADD COLUMN IF NOT EXISTS break_until timestamptz,
  ADD COLUMN IF NOT EXISTS breaks_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS composure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  delta integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
