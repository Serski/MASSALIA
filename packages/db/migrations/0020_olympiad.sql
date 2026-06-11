-- The Olympiad (Prompt 8): the second half of the festival pack. Every 8 game
-- years Massalia elects two delegates to compete at Olympia. Three tables hold
-- the cycle state and the (reusable) ballot.

-- The cycle: one row per Olympiad, advanced through its phases against real
-- timestamps by the worker sweep (with a lazy-on-read safety net).
CREATE TABLE IF NOT EXISTS olympiads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  game_year integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('nomination', 'voting', 'resolved', 'completed')),
  nomination_ends_at timestamptz,
  voting_ends_at timestamptz,
  payoff_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, game_year)
);

-- Standing candidates (the nominate event registers the actor here).
CREATE TABLE IF NOT EXISTS olympic_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  olympiad_game_year integer NOT NULL,
  character_id uuid NOT NULL REFERENCES player_characters(id),
  nominated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (olympiad_game_year, character_id)
);

-- The ballot: one vote per voter, replaceable until close (upsert on re-vote).
CREATE TABLE IF NOT EXISTS olympic_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  olympiad_game_year integer NOT NULL,
  voter_character_id uuid NOT NULL REFERENCES player_characters(id),
  candidate_character_id uuid NOT NULL REFERENCES player_characters(id),
  cast_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (olympiad_game_year, voter_character_id)
);
CREATE INDEX IF NOT EXISTS olympic_votes_tally_idx ON olympic_votes (olympiad_game_year, candidate_character_id);
