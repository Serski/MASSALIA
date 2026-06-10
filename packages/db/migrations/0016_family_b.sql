-- Family pack, Prompt B: children & growing up. The yearly child roll, birth
-- (with risk), naming, and aging to coming-of-age. Death enforcement and the
-- succession ladder are Prompt C — NOT here.

CREATE TABLE IF NOT EXISTS children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_character_id uuid NOT NULL REFERENCES player_characters(id),
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  -- Real timestamp; age derives lazily from the season clock (1 game year / 4 real days).
  born_at timestamptz NOT NULL DEFAULT now(),
  -- false until the player names (or the naming window passes and the default sticks).
  named boolean NOT NULL DEFAULT false,
  came_of_age_at timestamptz,
  -- Set later if this child becomes a played character at succession (Prompt C).
  heir_character_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS children_parent_idx ON children (parent_character_id);

-- Anchor for the yearly child roll (mirrors last_decay_at / the candidate cadence):
-- set at marriage; the lazy-on-read + BullMQ roll advances it one game year at a time.
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS last_child_roll_at timestamptz;
