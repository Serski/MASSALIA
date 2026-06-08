-- The curated daily decision set: one card per arena (class/general/council/party)
-- per character per UTC day. Stable for the day; each card resolvable once.
CREATE TABLE IF NOT EXISTS daily_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  utc_day date NOT NULL,
  arena text NOT NULL,
  event_id text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_choice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_decisions_char_day_arena_idx
  ON daily_decisions (character_id, utc_day, arena);
