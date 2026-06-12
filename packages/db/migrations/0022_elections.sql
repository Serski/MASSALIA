-- Archon & Ephor elections (Politics Prompt 2). The constitution: 2 Archons + 2
-- Ephors (one Palaioi-side seat + one Dynatoi-side seat each), 2 appointed
-- Strategoi, on the season clock. Every office requires an oligarch seat
-- (Prompt 1). Election ballots are SECRET (totals only); office_history is the
-- public, dynasty-spanning ledger and the term-limit source.

-- Current holders. One row per (world, office, side) for the elected/appointed
-- seats; strategoi use side NULL with a stable seat_slot to keep two rows apart.
CREATE TABLE IF NOT EXISTS offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  office text NOT NULL CHECK (office IN ('archon', 'ephor', 'strategos', 'party_archon', 'party_ephor')),
  side text CHECK (side IN ('palaioi', 'dynatoi')),
  seat_slot integer NOT NULL DEFAULT 0,
  holder_character_id uuid REFERENCES player_characters(id),
  -- True when the current holder took the seat as an independent (party 'none').
  -- Drives the defection-forfeit rule (an independent keeps a seat as 'none').
  independent_holder boolean NOT NULL DEFAULT false,
  term_started_year integer,
  term_ends_year integer,
  acquired_via text CHECK (acquired_via IN ('elected', 'ascended', 'appointed', 'interim')),
  UNIQUE (world_id, office, side, seat_slot)
);

-- Cycle state, advanced through its phases against the season clock by the
-- worker sweep (lazy-on-read net too). One row per (world, office, game_year).
CREATE TABLE IF NOT EXISTS elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  office text NOT NULL CHECK (office IN ('archon', 'ephor')),
  game_year integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('declaration', 'voting', 'resolved')),
  declaration_ends_at timestamptz NOT NULL,
  voting_ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, office, game_year)
);

-- Standing candidates. side is chosen at declaration (independents pick a side).
CREATE TABLE IF NOT EXISTS election_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES elections(id),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  side text NOT NULL CHECK (side IN ('palaioi', 'dynatoi')),
  declared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, character_id)
);

-- The ballot: one vote per voter, changeable until close. SECRET by design —
-- there is NO public per-voter read of this table (unlike chamber_ballots).
CREATE TABLE IF NOT EXISTS election_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES elections(id),
  voter_character_id uuid NOT NULL REFERENCES player_characters(id),
  candidate_character_id uuid NOT NULL REFERENCES player_characters(id),
  cast_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, voter_character_id)
);

-- The public ledger + the term-limit source. Term limits count only rows with
-- acquired_via='elected' (ascended/appointed/interim terms do NOT count).
CREATE TABLE IF NOT EXISTS office_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  character_id uuid NOT NULL REFERENCES player_characters(id),
  office text NOT NULL,
  side text CHECK (side IN ('palaioi', 'dynatoi')),
  started_year integer NOT NULL,
  ended_year integer,
  acquired_via text NOT NULL CHECK (acquired_via IN ('elected', 'ascended', 'appointed', 'interim')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_history_world_idx ON office_history (world_id, office, side);
CREATE INDEX IF NOT EXISTS office_history_character_idx ON office_history (character_id, office);
