-- Annual festivals (Prompt 7). Free civic events that fire on the season clock,
-- separate from the daily decisions. The register_choregos effect records a
-- patron's donation to a festival instance; at close the top donor is crowned
-- Megas Choregos.

-- Per-character delivery of a festival event (one instance per character per
-- festival per game year). Auto-resolves to the free "attend" choice at close.
CREATE TABLE IF NOT EXISTS festival_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  festival_id text NOT NULL,
  event_id text NOT NULL,
  game_year integer NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_choice_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, festival_id, game_year)
);

-- Donations toward a festival instance (sum decides the choregos).
CREATE TABLE IF NOT EXISTS festival_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  festival_id text NOT NULL,
  game_year integer NOT NULL,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS festival_donations_instance_idx
  ON festival_donations (festival_id, game_year);

-- Closed festival instances + the crowned patron (so an instance awards once).
CREATE TABLE IF NOT EXISTS festival_choregos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id text NOT NULL,
  game_year integer NOT NULL,
  winner_character_id uuid REFERENCES player_characters(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (festival_id, game_year)
);
