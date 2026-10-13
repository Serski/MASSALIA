-- The record of the League's orders (government prompt 5b). One row per order a
-- sitting Archon or Strategos gives the League's army: who gave it and from
-- which seat, what (a move, a scout, a raid or an attack), from which of the
-- League's places and to where, the men sent by type, the hulls that sailed,
-- the naval supplies bought and what they cost the treasury, when it was given
-- and when it arrives. A scout, raid or attack carries its march's id (its
-- report is the march's own); a move has no march and keeps its report here.
-- The official's name is kept as it was when he gave the order: the players row
-- is reused by his heirs, and an old order must not take the heir's name. Read
-- by the Government tab. Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS league_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  ordered_by_character_id uuid NOT NULL REFERENCES player_characters(id),
  ordered_by_name text NOT NULL,
  office text NOT NULL CHECK (office IN ('archon', 'strategos')),
  side text,
  kind text NOT NULL CHECK (kind IN ('move', 'scout', 'raid', 'attack')),
  base_id text NOT NULL,
  region_id text NOT NULL,
  town_id text,
  men integer NOT NULL CHECK (men >= 0),
  force jsonb NOT NULL DEFAULT '[]'::jsonb,
  ships jsonb NOT NULL DEFAULT '{}'::jsonb,
  supplies integer NOT NULL DEFAULT 0 CHECK (supplies >= 0),
  supplies_cost integer NOT NULL DEFAULT 0 CHECK (supplies_cost >= 0),
  march_id uuid REFERENCES player_marches(id),
  report jsonb,
  ordered_at timestamptz NOT NULL,
  arrives_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS league_orders_world_idx ON league_orders (world_id, ordered_at);
CREATE UNIQUE INDEX IF NOT EXISTS league_orders_march_idx ON league_orders (march_id) WHERE march_id IS NOT NULL;
