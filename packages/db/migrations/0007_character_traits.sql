-- Traits held by a character. trait_id references content/traits/traits.json
-- (validated at server boot), not a DB foreign key. Cap/opposite rules live in
-- the service layer.
CREATE TABLE IF NOT EXISTS character_traits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  trait_id text NOT NULL,
  gained_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS character_traits_character_trait_idx
  ON character_traits (character_id, trait_id);
