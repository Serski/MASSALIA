ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS houses (
  slug text PRIMARY KEY,
  name text NOT NULL,
  initial text NOT NULL,
  alignment text NOT NULL,
  stance text NOT NULL,
  motto text NOT NULL,
  patron text NOT NULL,
  crest text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS professions (
  slug text PRIMARY KEY,
  name text NOT NULL,
  initial text NOT NULL,
  rank text NOT NULL,
  income text NOT NULL,
  hard_mode boolean NOT NULL DEFAULT false,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS profession_ladders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profession_slug text NOT NULL REFERENCES professions(slug),
  position integer NOT NULL,
  building text NOT NULL,
  rank text NOT NULL,
  benefit text NOT NULL,
  upkeep text
);

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS profession_slug text REFERENCES professions(slug),
  ADD COLUMN IF NOT EXISTS house_slug text REFERENCES houses(slug),
  ADD COLUMN IF NOT EXISTS face_id text,
  ADD COLUMN IF NOT EXISTS party text NOT NULL DEFAULT 'unaligned',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'Massalia',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS players_one_active_user_world_idx
  ON players(world_id, user_id)
  WHERE is_active = true;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES players(id),
  ADD COLUMN IF NOT EXISTS profession_slug text REFERENCES professions(slug),
  ADD COLUMN IF NOT EXISTS house_slug text REFERENCES houses(slug),
  ADD COLUMN IF NOT EXISTS face_id text,
  ADD COLUMN IF NOT EXISTS party text NOT NULL DEFAULT 'unaligned',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'Massalia';
