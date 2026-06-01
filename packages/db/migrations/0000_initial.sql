CREATE TABLE IF NOT EXISTS worlds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  seed text NOT NULL,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  color text NOT NULL
);

CREATE TABLE IF NOT EXISTS dynasties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  prestige integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dynasty_id uuid NOT NULL REFERENCES dynasties(id),
  name text NOT NULL,
  birth_tick integer NOT NULL,
  traits jsonb NOT NULL DEFAULT '[]'::jsonb,
  relationships jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS regions (
  id text PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS realms (
  id text PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  color text NOT NULL
);

CREATE TABLE IF NOT EXISTS factions (
  id text PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  color text NOT NULL
);

CREATE TABLE IF NOT EXISTS provinces (
  id text PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  region_id text NOT NULL REFERENCES regions(id),
  realm_id text NOT NULL REFERENCES realms(id),
  terrain text NOT NULL,
  owner_player_id uuid REFERENCES players(id),
  faction_id text REFERENCES factions(id),
  control_status text NOT NULL DEFAULT 'controlled',
  is_city boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province_id text NOT NULL REFERENCES provinces(id),
  type text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  queued_completion_at timestamptz
);

CREATE TABLE IF NOT EXISTS resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  scope_id text NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  rate_per_second numeric NOT NULL DEFAULT 0,
  last_updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS armies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  location_province_id text NOT NULL REFERENCES provinces(id),
  units jsonb NOT NULL,
  moving_to text REFERENCES provinces(id),
  arrival_at timestamptz
);

CREATE TABLE IF NOT EXISTS events_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  event_id text NOT NULL,
  choice_id text NOT NULL,
  result_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
