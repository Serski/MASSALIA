-- Per-house starting ideology (-100 Traditionalist .. +100 Reformist).
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS start_ideology integer NOT NULL DEFAULT 0;

UPDATE houses SET start_ideology = v.ideology FROM (VALUES
  ('leonidas', -80),
  ('timon', -55),
  ('iason', -35),
  ('herakleides', -25),
  ('aristeides', -5),
  ('xanthippos', 0),
  ('philon', 20),
  ('nicanor', 30),
  ('miltiades', 45),
  ('kleitos', 60)
) AS v(slug, ideology)
WHERE houses.slug = v.slug;

-- One character sheet per player per world.
CREATE TABLE IF NOT EXISTS player_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id),
  world_id uuid NOT NULL REFERENCES worlds(id),
  house_slug text NOT NULL REFERENCES houses(slug),
  class_id text NOT NULL,
  prestige integer NOT NULL DEFAULT 0,
  devotion integer NOT NULL DEFAULT 0,
  militia integer NOT NULL DEFAULT 0,
  intelligence integer NOT NULL DEFAULT 0,
  drachmae integer NOT NULL DEFAULT 100,
  ideology integer NOT NULL DEFAULT 0,
  party text NOT NULL DEFAULT 'none',
  composure integer NOT NULL DEFAULT 70,
  growth_multiplier numeric NOT NULL DEFAULT 1.0,
  actions_spent_today integer NOT NULL DEFAULT 0,
  last_action_reset timestamptz,
  party_cooldown_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_characters_class_chk CHECK (class_id IN
    ('landowner','trader','philosopher','hetaira','hoplite','shipbuilder','priest','slave')),
  CONSTRAINT player_characters_party_chk CHECK (party IN ('none','palaioi','dynatoi')),
  CONSTRAINT player_characters_ideology_chk CHECK (ideology BETWEEN -100 AND 100),
  CONSTRAINT player_characters_composure_chk CHECK (composure BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS player_characters_player_world_idx
  ON player_characters (player_id, world_id);
