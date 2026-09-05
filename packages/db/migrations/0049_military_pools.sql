-- World 2 military pools (server-side only — never shipped under apps/web/public).
-- town_military: per-world garrison + fleet for every town (105 rows per world);
-- region_military: per-world warband for every townless region (49 rows).
-- town_intel / region_intel: per-dynasty SNAPSHOTS of those numbers as scouted,
-- with the game date of the scouting — frozen values, never live pointers.
-- Seeded per world by packages/db/src/military.ts (ON CONFLICT DO NOTHING).
-- Idempotent: every statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS town_military (
  world_id uuid NOT NULL REFERENCES worlds(id),
  town_id text NOT NULL,
  garrison integer NOT NULL,
  pentekonters integer NOT NULL,
  triremes integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, town_id)
);

CREATE TABLE IF NOT EXISTS region_military (
  world_id uuid NOT NULL REFERENCES worlds(id),
  region_id text NOT NULL,
  warband integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, region_id)
);

CREATE TABLE IF NOT EXISTS town_intel (
  world_id uuid NOT NULL REFERENCES worlds(id),
  dynasty_id uuid NOT NULL REFERENCES dynasties(id),
  town_id text NOT NULL,
  garrison integer NOT NULL,
  pentekonters integer NOT NULL,
  triremes integer NOT NULL,
  scouted_at timestamptz NOT NULL DEFAULT now(),
  scouted_game_date text NOT NULL,
  PRIMARY KEY (world_id, dynasty_id, town_id)
);

CREATE TABLE IF NOT EXISTS region_intel (
  world_id uuid NOT NULL REFERENCES worlds(id),
  dynasty_id uuid NOT NULL REFERENCES dynasties(id),
  region_id text NOT NULL,
  warband integer NOT NULL,
  scouted_at timestamptz NOT NULL DEFAULT now(),
  scouted_game_date text NOT NULL,
  PRIMARY KEY (world_id, dynasty_id, region_id)
);
