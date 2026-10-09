-- The League's building projects (government prompt 2a). One row per project
-- the chamber has passed: the polis, the building, what it cost and the cycle
-- that passed it. started_at is the instant the vote closed; completes_at the
-- instant the building stands; completed_at is copied from completes_at by
-- the sweep that first finds it standing, NULL until then. One of each
-- building per polis per world. Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS league_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  city_id text NOT NULL,
  building_id text NOT NULL,
  cost integer NOT NULL CHECK (cost >= 0),
  agenda_cycle_id uuid REFERENCES agenda_cycles(id),
  started_at timestamptz NOT NULL,
  completes_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (world_id, city_id, building_id)
);
CREATE INDEX IF NOT EXISTS league_projects_due_idx ON league_projects (completes_at) WHERE completed_at IS NULL;
