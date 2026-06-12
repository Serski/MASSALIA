-- The Agenda & the Three Governments (Politics Prompt 3) — the capstone.
-- The League agenda + treasury, and the two Party machines (each a mini-league
-- with its own treasury, agenda, and for-life leaders), all on one engine.

-- Treasuries: one per owner per world. Real money now — spent only via passed
-- agenda items, funded by levy + dues + cuts of seat purchases & festival donations.
CREATE TABLE IF NOT EXISTS treasuries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner text NOT NULL CHECK (owner IN ('league', 'palaioi', 'dynatoi')),
  balance integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, owner)
);

-- The audit trail the Ephors read: every treasury movement, with a reason.
CREATE TABLE IF NOT EXISTS treasury_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  owner text NOT NULL CHECK (owner IN ('league', 'palaioi', 'dynatoi')),
  delta integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treasury_ledger_owner_idx ON treasury_ledger (world_id, owner, created_at);

-- Seed one treasury per owner for every active world (idempotent).
INSERT INTO treasuries (world_id, owner)
SELECT w.id, o.owner
FROM worlds w
CROSS JOIN (VALUES ('league'), ('palaioi'), ('dynatoi')) AS o(owner)
ON CONFLICT (world_id, owner) DO NOTHING;

-- Agenda cycle state: one per (world, scope, game_year), advanced drafting →
-- voting → resolved against the season clock. drafting is where officials choose
-- (draft/veto); voting reuses the chamber vote.
CREATE TABLE IF NOT EXISTS agenda_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  scope text NOT NULL CHECK (scope IN ('league', 'palaioi', 'dynatoi')),
  game_year integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('drafting', 'voting', 'resolved')),
  card_ids jsonb NOT NULL DEFAULT '[]',
  drafted_card_id text,
  vetoed_card_id text,
  vetoed_by_character_id uuid REFERENCES player_characters(id),
  opens_at timestamptz NOT NULL,
  voting_ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, scope, game_year)
);

-- One veto per Ephor per term (the office_term_started_year scopes it).
CREATE TABLE IF NOT EXISTS ephor_vetoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  ephor_character_id uuid NOT NULL REFERENCES player_characters(id),
  scope text NOT NULL CHECK (scope IN ('league', 'palaioi', 'dynatoi')),
  office_term_started_year integer NOT NULL,
  agenda_cycle_id uuid REFERENCES agenda_cycles(id),
  used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ephor_character_id, scope, office_term_started_year)
);

-- Agenda votes reuse the chamber vote machinery: scope routes the tally electorate
-- (league = all; party = that party's members + that party's NPC bloc), and
-- agenda_card_id ties a passed vote to its effect + treasury spend.
ALTER TABLE chamber_votes
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'league',
  ADD COLUMN IF NOT EXISTS agenda_card_id text,
  -- The {palaioi,dynatoi,independent} yes/no leans for the tally. NULL → the close
  -- falls back to the flavor question's leans (Prompt 1). Set for agenda votes.
  ADD COLUMN IF NOT EXISTS leans jsonb;
ALTER TABLE chamber_votes
  ADD CONSTRAINT chamber_votes_scope_chk CHECK (scope IN ('league', 'palaioi', 'dynatoi'));
-- One vote per (world, scope, game_year): league + each party may each sit once a
-- year. Drop the old (world_id, game_year) uniqueness (a table constraint named
-- *_key by Postgres) so a league + party vote can share a game year.
ALTER TABLE chamber_votes DROP CONSTRAINT IF EXISTS chamber_votes_world_id_game_year_key;
DROP INDEX IF EXISTS chamber_votes_world_year_idx;
CREATE UNIQUE INDEX IF NOT EXISTS chamber_votes_world_scope_year_idx ON chamber_votes (world_id, scope, game_year);

-- Party-leader endorsements during a league election: the leader transfers swing
-- weight to an endorsee. One endorsement per leader per election.
CREATE TABLE IF NOT EXISTS party_endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  election_id uuid NOT NULL REFERENCES elections(id),
  endorser_character_id uuid NOT NULL REFERENCES player_characters(id),
  party text NOT NULL CHECK (party IN ('palaioi', 'dynatoi')),
  endorsee_character_id uuid NOT NULL REFERENCES player_characters(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, endorser_character_id)
);
