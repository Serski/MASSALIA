-- Council office flag (gates 'councilor' events; election system fills it later).
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS is_councilor boolean NOT NULL DEFAULT false;

-- Party favor accrued via events (per character per party).
CREATE TABLE IF NOT EXISTS party_favor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  party text NOT NULL,
  favor integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS party_favor_character_party_idx ON party_favor (character_id, party);

-- Drawn-event history (for the "exclude last 5 draws" rule).
CREATE TABLE IF NOT EXISTS event_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_history_character_idx ON event_history (character_id, created_at DESC);

-- Generic audit log of every applied effect.
CREATE TABLE IF NOT EXISTS effect_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
