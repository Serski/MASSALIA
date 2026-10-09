-- The koinon's army marches (raids prompt 5). A muster no longer fights at
-- its launch: at the launch its army sets out (status 'marching'), its rows on
-- the road to the target and its hulls at sea, and the battle is fought when
-- it arrives (arrives_at), resolved by the first request after that instant,
-- in arrival order with the parties' marches. `march` keeps what the army took
-- on the road: its rows in the order the fight sees them, each member's part
-- and the hulls that sailed. One muster at a time: a koinon has at most one
-- muster open or marching. koinon_muster_parts holds, for every member who
-- took part in a muster that marched, his copy of its report in the Barracks:
-- the instant he first opened it. Idempotent, one transaction.
ALTER TABLE koinon_musters ADD COLUMN IF NOT EXISTS arrives_at timestamptz;
ALTER TABLE koinon_musters ADD COLUMN IF NOT EXISTS march jsonb;
ALTER TABLE koinon_musters DROP CONSTRAINT IF EXISTS koinon_musters_status_check;
ALTER TABLE koinon_musters ADD CONSTRAINT koinon_musters_status_check CHECK (status IN ('open', 'marching', 'resolved', 'stood_down', 'cancelled'));
DROP INDEX IF EXISTS koinon_musters_one_open_idx;
CREATE UNIQUE INDEX IF NOT EXISTS koinon_musters_one_open_idx ON koinon_musters (koinon_id) WHERE status IN ('open', 'marching');
CREATE INDEX IF NOT EXISTS koinon_musters_arrival_idx ON koinon_musters (arrives_at) WHERE status = 'marching';
CREATE TABLE IF NOT EXISTS koinon_muster_parts (
  muster_id uuid NOT NULL REFERENCES koinon_musters(id),
  player_id uuid NOT NULL REFERENCES players(id),
  seen_at timestamptz,
  PRIMARY KEY (muster_id, player_id)
);
CREATE INDEX IF NOT EXISTS koinon_muster_parts_player_idx ON koinon_muster_parts (player_id);
