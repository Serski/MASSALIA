-- The League's wars (government prompt 4). One row per war the chamber has
-- passed: the nation, the game year of the motion, what it cost and the
-- cycle that passed it. starts_at is the instant the vote closed, ends_at
-- the instant peace comes, ended_at stamped once when it does. One war
-- declared per world per year, and one open war per nation. The war motion
-- runs as the agenda scope 'war', so the three scope checks widen to admit
-- it; the motion spends from the League's treasury. Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS league_wars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  faction_id text NOT NULL,
  game_year integer NOT NULL,
  cost integer NOT NULL CHECK (cost >= 0),
  agenda_cycle_id uuid REFERENCES agenda_cycles(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  UNIQUE (world_id, game_year)
);
CREATE UNIQUE INDEX IF NOT EXISTS league_wars_one_open_per_faction ON league_wars (world_id, faction_id) WHERE ended_at IS NULL;
ALTER TABLE agenda_cycles DROP CONSTRAINT IF EXISTS agenda_cycles_scope_check;
ALTER TABLE agenda_cycles ADD CONSTRAINT agenda_cycles_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival', 'war'));
ALTER TABLE ephor_vetoes DROP CONSTRAINT IF EXISTS ephor_vetoes_scope_check;
ALTER TABLE ephor_vetoes ADD CONSTRAINT ephor_vetoes_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival', 'war'));
ALTER TABLE chamber_votes DROP CONSTRAINT IF EXISTS chamber_votes_scope_chk;
ALTER TABLE chamber_votes ADD CONSTRAINT chamber_votes_scope_chk CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival', 'war'));
