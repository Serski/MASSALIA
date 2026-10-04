-- The koinon (koinon prompt 1): a player-made company of citizens. `koina` is
-- the company (a dissolved one keeps its row; the partial unique index frees its
-- name), `koinon_members` holds one row per player per world (the primary key is
-- what keeps a player in one koinon at a time), `koinon_invites` the standing
-- invitations (one per koinon and player), `koinon_posts` the board. Leaving or
-- expulsion stamps players.koinon_cooldown_until.
-- Idempotent, one transaction.
CREATE TABLE IF NOT EXISTS koina (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  leader_player_id uuid REFERENCES players(id),
  vice_player_id uuid REFERENCES players(id),
  leader_since timestamptz NOT NULL DEFAULT now(),
  founded_at timestamptz NOT NULL DEFAULT now(),
  dissolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS koina_live_name_idx ON koina (world_id, lower(name)) WHERE dissolved_at IS NULL;

CREATE TABLE IF NOT EXISTS koinon_members (
  world_id uuid NOT NULL REFERENCES worlds(id),
  player_id uuid NOT NULL REFERENCES players(id),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, player_id)
);
CREATE INDEX IF NOT EXISTS koinon_members_koinon_idx ON koinon_members (koinon_id);

CREATE TABLE IF NOT EXISTS koinon_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  player_id uuid NOT NULL REFERENCES players(id),
  inviter_player_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (koinon_id, player_id)
);
CREATE INDEX IF NOT EXISTS koinon_invites_player_idx ON koinon_invites (player_id);

CREATE TABLE IF NOT EXISTS koinon_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  author_player_id uuid NOT NULL REFERENCES players(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS koinon_posts_koinon_idx ON koinon_posts (koinon_id, created_at DESC);

ALTER TABLE players ADD COLUMN IF NOT EXISTS koinon_cooldown_until timestamptz;
