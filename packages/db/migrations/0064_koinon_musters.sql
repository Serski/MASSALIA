-- The koinon's Raid muster (koinon prompt 3). A muster is one raid a koinon
-- marches on together: its target, its gathering place on Massalia's own ground
-- and its launch instant. One open muster per koinon (the partial unique
-- index). Pledged men have no table: they are the player_units rows whose
-- mission is { kind: 'muster', musterId, … }. Pledged hulls are counts here;
-- ships are never moved or debited. `report` holds the outcome once resolved.
-- Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS koinon_musters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  opener_player_id uuid NOT NULL REFERENCES players(id),
  kind text NOT NULL DEFAULT 'raid' CHECK (kind IN ('raid')),
  region_id text NOT NULL,
  town_id text,
  gather_id text NOT NULL,
  gather_region_id text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  launch_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'stood_down', 'cancelled')),
  closed_at timestamptz,
  report jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS koinon_musters_one_open_idx ON koinon_musters (koinon_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS koinon_musters_due_idx ON koinon_musters (launch_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS koinon_muster_hulls (
  muster_id uuid NOT NULL REFERENCES koinon_musters(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  ship_id text NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  pledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muster_id, owner_player_id, ship_id)
);
