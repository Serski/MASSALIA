-- The Oligarchy Chamber (Politics Prompt 1). 300 seats per world: NPC blocs
-- (50 Palaioi / 50 Dynatoi / 10 independents) plus player-bought dynastic seats,
-- and the yearly chamber vote with its PUBLIC ballot ledger.

-- One row per seat per world. seat_index is stable (0-299) and drives the
-- hemicycle infographic; purchases always take the lowest-index empty seat.
CREATE TABLE IF NOT EXISTS oligarch_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  seat_index integer NOT NULL CHECK (seat_index >= 0 AND seat_index <= 299),
  holder_type text NOT NULL DEFAULT 'empty' CHECK (holder_type IN ('npc', 'player', 'empty')),
  npc_party text CHECK (npc_party IN ('palaioi', 'dynatoi', 'independent')),
  character_id uuid REFERENCES player_characters(id),
  acquired_at timestamptz,
  UNIQUE (world_id, seat_index)
);
-- One seat per character (the slot row is reused across successions, so the
-- dynastic seat rides the same character_id from holder to heir).
CREATE UNIQUE INDEX IF NOT EXISTS oligarch_seats_character_idx ON oligarch_seats (character_id) WHERE character_id IS NOT NULL;

-- Seed every existing world's chamber: seats 0-49 NPC Palaioi, 50-99 NPC
-- Dynatoi, 100-109 NPC independent, 110-299 empty. (New worlds are seeded by
-- ensureChamberSeats at world creation, from politics-config.json.)
INSERT INTO oligarch_seats (world_id, seat_index, holder_type, npc_party)
SELECT
  w.id,
  gs.seat_index,
  CASE WHEN gs.seat_index < 110 THEN 'npc' ELSE 'empty' END,
  CASE
    WHEN gs.seat_index < 50 THEN 'palaioi'
    WHEN gs.seat_index < 100 THEN 'dynatoi'
    WHEN gs.seat_index < 110 THEN 'independent'
    ELSE NULL
  END
FROM worlds w
CROSS JOIN (SELECT generate_series(0, 299) AS seat_index) gs
ON CONFLICT (world_id, seat_index) DO NOTHING;

-- The yearly chamber vote: one per world per game year, open for one season
-- (auto-closed at the next season boundary by the worker sweep / lazy net).
CREATE TABLE IF NOT EXISTS chamber_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  game_year integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'failed')),
  yes_count integer,
  no_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, game_year)
);

-- The ballots: one per voter per vote, changeable while open. PUBLIC record by
-- design — the API exposes who voted which way (the political ledger).
CREATE TABLE IF NOT EXISTS chamber_ballots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id uuid NOT NULL REFERENCES chamber_votes(id),
  voter_character_id uuid NOT NULL REFERENCES player_characters(id),
  choice text NOT NULL CHECK (choice IN ('yes', 'no')),
  cast_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vote_id, voter_character_id)
);
