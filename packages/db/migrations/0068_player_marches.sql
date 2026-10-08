-- Parties on the march (raids prompt 4). A raid, an attack or a scout no longer
-- fights inside the request that sends it: the party sets out, and the battle
-- is fought when it arrives (arrives_at), resolved by the first request after
-- that instant, in arrival order with the koinon's musters. One row per party:
-- the target, the base it set out from and comes home to, the route and its
-- minutes each way, its rows in the order they set out (`party`, the order the
-- fight sees), the hulls it took (`ships`, as the report names them) and every
-- hull that sailed (`sailing`, the escort included, whose naval power meets a
-- town's fleet), and once it has arrived its report and the instant its owner
-- first opened it. The party's rows carry the march's id on their mission until
-- it arrives. Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS player_marches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  kind text NOT NULL CHECK (kind IN ('scout', 'raid', 'attack')),
  region_id text NOT NULL,
  town_id text,
  base_id text NOT NULL,
  route text NOT NULL CHECK (route IN ('land', 'sea')),
  steps integer NOT NULL,
  minutes integer NOT NULL,
  party jsonb NOT NULL DEFAULT '[]'::jsonb,
  ships jsonb NOT NULL DEFAULT '{}'::jsonb,
  sailing jsonb NOT NULL DEFAULT '{}'::jsonb,
  departed_at timestamptz NOT NULL,
  arrives_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'marching' CHECK (status IN ('marching', 'resolved')),
  resolved_at timestamptz,
  report jsonb,
  seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS player_marches_due_idx ON player_marches (arrives_at) WHERE status = 'marching';
CREATE INDEX IF NOT EXISTS player_marches_owner_idx ON player_marches (owner_player_id, arrives_at);
