-- The League's festivals (government prompt 3). One row per festival the
-- chamber has passed: the festival, the game year it is held in, what it cost
-- and the cycle that passed it. starts_at is the first instant of that year,
-- ends_at the first instant of the next. One festival per world per year.
-- The festival motion runs as the agenda scope 'festival', so the three
-- scope checks of 0023 widen to admit it; the treasury owners stay as they
-- are, the motion spends from the League's. Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS league_festivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  festival_id text NOT NULL,
  game_year integer NOT NULL,
  cost integer NOT NULL CHECK (cost >= 0),
  agenda_cycle_id uuid REFERENCES agenda_cycles(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  UNIQUE (world_id, game_year)
);
ALTER TABLE agenda_cycles DROP CONSTRAINT IF EXISTS agenda_cycles_scope_check;
ALTER TABLE agenda_cycles ADD CONSTRAINT agenda_cycles_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival'));
ALTER TABLE ephor_vetoes DROP CONSTRAINT IF EXISTS ephor_vetoes_scope_check;
ALTER TABLE ephor_vetoes ADD CONSTRAINT ephor_vetoes_scope_check CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival'));
ALTER TABLE chamber_votes DROP CONSTRAINT IF EXISTS chamber_votes_scope_chk;
ALTER TABLE chamber_votes ADD CONSTRAINT chamber_votes_scope_chk CHECK (scope IN ('league', 'palaioi', 'dynatoi', 'festival'));
