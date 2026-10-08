-- Hulls at sea (raids prompt 3). The ships that carry men leave their owner's
-- stock when they sail and come home at returns_at: with the party, or on their
-- own if nobody survived. One row per sailing per owner: the hulls by ship id
-- (whole counts), what took them out (a scout, raid, attack or move; a koinon
-- muster is a raid with its muster_id) and where. The owner's settle credits
-- them back once returns_at has passed and stamps returned_at, claim first;
-- the row stays as the record. Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS player_voyages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  ships jsonb NOT NULL,
  kind text NOT NULL CHECK (kind IN ('scout', 'raid', 'attack', 'move')),
  region_id text NOT NULL,
  town_id text,
  muster_id uuid REFERENCES koinon_musters(id),
  sailed_at timestamptz NOT NULL,
  returns_at timestamptz NOT NULL,
  returned_at timestamptz
);
CREATE INDEX IF NOT EXISTS player_voyages_away_idx ON player_voyages (owner_player_id, returns_at) WHERE returned_at IS NULL;
