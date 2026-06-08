-- Censure window opened when a party member's ideology drifts out of range.
-- Resolved at expires_at (BullMQ worker job + lazy-on-read). One per character.
CREATE TABLE IF NOT EXISTS censures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  party text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS censures_character_idx ON censures (character_id);
