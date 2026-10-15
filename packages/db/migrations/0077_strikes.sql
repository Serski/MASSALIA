-- The strikes (strikes prompt 1). A nation marches on a Massalian place: in a
-- war, once a season; and a tribe whose town or land was raided more than 10
-- times in a game year raids back once. One row per march: who marches (the
-- Diplomacy faction, or the owner polity of a tribe with none), why (war or
-- raids), how (a raid or an attack), the place raided an 11th time and that
-- fight's instant (raids; the place's count restarts after it), the target and
-- its holder at the call, the men who march and the number shown ("about", to
-- the nearest 10), where they were drawn from, when it was called and when it
-- strikes, and how it ended. strike_parts holds every owner whose men fought
-- and the target's holder: his men, his dead, what he paid, and when he first
-- opened the report.
--
-- worlds.strikes_from: raids and seasons count from it (call 14 at STOP 0).
-- The worlds that exist when this runs count from now; a world created later
-- has none and counts from its start.
--
-- Keys: one march on the road per nation (call 13), one war march per nation
-- per season, one raids march per count. Idempotent, one transaction.
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS strikes_from timestamptz;
UPDATE worlds SET strikes_from = now() WHERE strikes_from IS NULL;

CREATE TABLE IF NOT EXISTS strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  nation_id text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('war', 'raids')),
  mode text NOT NULL CHECK (mode IN ('raid', 'attack')),
  season_index integer NOT NULL,
  trigger_place_id text,
  trigger_at timestamptz,
  region_id text NOT NULL,
  town_id text,
  target_kind text NOT NULL CHECK (target_kind IN ('home', 'holding')),
  holder_player_id uuid REFERENCES players(id),
  taken_from boolean NOT NULL DEFAULT false,
  force integer NOT NULL CHECK (force > 0),
  about integer NOT NULL CHECK (about >= 0),
  draws jsonb NOT NULL DEFAULT '[]'::jsonb,
  called_at timestamptz NOT NULL,
  strikes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'marching' CHECK (status IN ('marching', 'struck', 'called_off')),
  resolved_at timestamptz,
  report jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS strikes_one_on_the_road ON strikes (world_id, nation_id) WHERE status = 'marching';
CREATE UNIQUE INDEX IF NOT EXISTS strikes_one_war_march_a_season ON strikes (world_id, nation_id, season_index) WHERE trigger = 'war';
CREATE UNIQUE INDEX IF NOT EXISTS strikes_one_per_count ON strikes (world_id, trigger_place_id, trigger_at) WHERE trigger = 'raids';
CREATE INDEX IF NOT EXISTS strikes_due ON strikes (strikes_at) WHERE status = 'marching';
CREATE INDEX IF NOT EXISTS strikes_by_place ON strikes (world_id, (coalesce(town_id, region_id)), called_at DESC);

CREATE TABLE IF NOT EXISTS strike_parts (
  strike_id uuid NOT NULL REFERENCES strikes(id),
  player_id uuid NOT NULL REFERENCES players(id),
  men integer NOT NULL CHECK (men >= 0),
  lost integer NOT NULL CHECK (lost >= 0),
  paid integer NOT NULL DEFAULT 0 CHECK (paid >= 0),
  holder boolean NOT NULL DEFAULT false,
  seen_at timestamptz,
  PRIMARY KEY (strike_id, player_id)
);
CREATE INDEX IF NOT EXISTS strike_parts_player_idx ON strike_parts (player_id);
