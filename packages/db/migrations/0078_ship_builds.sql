-- The shipyard's slips. One row per hull a Shipbuilder lays down: whose yard,
-- which ship (a content.craft good), when the keel was laid and when the hull is
-- ready. The recipe is paid when the keel is laid; the hull joins the player's
-- stores at the first settle at or after ready_at, which claims the row
-- (delivered_at set, only while it is still null) in the same transaction as the
-- credit. A row still open (delivered_at null) takes a slip; the yard's slips by
-- tier are content (craftSlots in buildings.json). Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS ship_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  player_id uuid NOT NULL REFERENCES players(id),
  good text NOT NULL,
  started_at timestamptz NOT NULL,
  ready_at timestamptz NOT NULL CHECK (ready_at > started_at),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS ship_builds_open ON ship_builds (player_id, ready_at) WHERE delivered_at IS NULL;
