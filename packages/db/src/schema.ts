import { relations, sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const worlds = pgTable("worlds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  seed: text("seed").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  newsletterOptIn: boolean("newsletter_opt_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const houses = pgTable("houses", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  initial: text("initial").notNull(),
  alignment: text("alignment").notNull(),
  stance: text("stance").notNull(),
  motto: text("motto").notNull(),
  patron: text("patron").notNull(),
  crest: text("crest").notNull(),
  // Starting political ideology a member of this house begins with
  // (-100 Traditionalist .. +100 Reformist). Stat bonus lives in `data.startBonus`.
  startIdeology: integer("start_ideology").notNull().default(0),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
});

export const professions = pgTable("professions", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  initial: text("initial").notNull(),
  rank: text("rank").notNull(),
  income: text("income").notNull(),
  hardMode: boolean("hard_mode").notNull().default(false),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
});

export const professionLadders = pgTable("profession_ladders", {
  id: uuid("id").primaryKey().defaultRandom(),
  professionSlug: text("profession_slug").references(() => professions.slug).notNull(),
  position: integer("position").notNull(),
  building: text("building").notNull(),
  rank: text("rank").notNull(),
  benefit: text("benefit").notNull(),
  upkeep: text("upkeep"),
});

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  professionSlug: text("profession_slug").references(() => professions.slug),
  houseSlug: text("house_slug").references(() => houses.slug),
  faceId: text("face_id"),
  party: text("party").notNull().default("unaligned"),
  // -100..+100 spectrum: negative = Reformist, positive = Conservative, 0 = centre.
  alignment: integer("alignment").notNull().default(0),
  // When set, the player cannot rejoin a party until this time passes.
  partyCooldownUntil: timestamp("party_cooldown_until", { withTimezone: true }),
  origin: text("origin").notNull().default("Massalia"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneActivePlayerPerWorld: uniqueIndex("players_one_active_user_world_idx").on(table.worldId, table.userId),
}));

export const dynasties = pgTable("dynasties", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  name: text("name").notNull(),
  prestige: integer("prestige").notNull().default(0),
  // The dynasty spine (Prompt C): generation increments at each succession.
  houseSlug: text("house_slug"),
  foundingPlayerId: uuid("founding_player_id"),
  generation: integer("generation").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The succession ledger. The slot row is reused for the heir, so from/to ids may
// match; from_name/from_age/to_name snapshot the people for a readable history.
export const successions = pgTable("successions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dynastyId: uuid("dynasty_id").references(() => dynasties.id).notNull(),
  fromCharacterId: uuid("from_character_id"),
  toCharacterId: uuid("to_character_id"),
  kind: text("kind").notNull(),
  fromName: text("from_name"),
  fromAge: integer("from_age"),
  toName: text("to_name"),
  // Free-text chronicle line for the handoff (Hoplite Step 4): a glorious merc
  // death records "<name> fell <setting>, season <n>"; other handoffs leave it null.
  note: text("note"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dynastyIdx: index("successions_dynasty_idx").on(table.dynastyId),
}));

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  dynastyId: uuid("dynasty_id").references(() => dynasties.id).notNull(),
  playerId: uuid("player_id").references(() => players.id),
  name: text("name").notNull(),
  professionSlug: text("profession_slug").references(() => professions.slug),
  houseSlug: text("house_slug").references(() => houses.slug),
  faceId: text("face_id"),
  party: text("party").notNull().default("unaligned"),
  origin: text("origin").notNull().default("Massalia"),
  birthTick: integer("birth_tick").notNull(),
  traits: jsonb("traits").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  relationships: jsonb("relationships").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
});

// One character sheet per player per world. The canonical home for stats,
// ideology, party, and currency. The daily action budget is the daily decision
// set (see daily_decisions), not a per-day action counter.
export const playerCharacters = pgTable("player_characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").references(() => players.id).notNull(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  houseSlug: text("house_slug").references(() => houses.slug).notNull(),
  classId: text("class_id").notNull(),
  prestige: integer("prestige").notNull().default(0),
  devotion: integer("devotion").notNull().default(0),
  militia: integer("militia").notNull().default(0),
  intelligence: integer("intelligence").notNull().default(0),
  drachmae: integer("drachmae").notNull().default(100),
  // -100 Traditionalist .. +100 Reformist.
  ideology: integer("ideology").notNull().default(0),
  party: text("party").notNull().default("none"),
  composure: integer("composure").notNull().default(70),
  // Set by the (future) council election system; gates 'councilor' events now.
  isCouncilor: boolean("is_councilor").notNull().default(false),
  // Lazy composure recovery bookkeeping + break (withdrawn) state.
  lastComposureUpdate: timestamp("last_composure_update", { withTimezone: true }),
  breakUntil: timestamp("break_until", { withTimezone: true }),
  breaksCount: integer("breaks_count").notNull().default(0),
  growthMultiplier: numeric("growth_multiplier").notNull().default("1.0"),
  // Life-arc: starting age (20/30), chosen avatar, rolled death age, and the
  // lazy-decay bookkeeping anchor (like last_composure_update). Stats are hard-
  // capped 0..100 by CHECK constraints (see migration 0014).
  startAge: integer("start_age").notNull().default(30),
  avatarId: text("avatar_id"),
  deathAge: integer("death_age"),
  lastDecayAt: timestamp("last_decay_at", { withTimezone: true }),
  // Family pack: sex (hetaira -> female) and the chosen spouse candidate (when married).
  sex: text("sex").notNull().default("male"),
  spouseCandidateId: uuid("spouse_candidate_id"),
  // Anchor for the yearly child roll (set at marriage; advanced one game year per roll).
  lastChildRollAt: timestamp("last_child_roll_at", { withTimezone: true }),
  // Death, succession & regency (Prompt C). status flips to 'deceased' when
  // death_age is reached, opening succession; the heir reuses this slot.
  status: text("status").notNull().default("alive"),
  dynastyId: uuid("dynasty_id"),
  isRegent: boolean("is_regent").notNull().default(false),
  regentForChildId: uuid("regent_for_child_id"),
  adoptedCandidateId: uuid("adopted_candidate_id"),
  // Hidden XP toward the four upbringing-trait ladders (fed by daily routines).
  rhetoricXp: integer("rhetoric_xp").notNull().default(0),
  philosophiaXp: integer("philosophia_xp").notNull().default(0),
  gymnasiumXp: integer("gymnasium_xp").notNull().default(0),
  mysteriesXp: integer("mysteries_xp").notNull().default(0),
  partyCooldownUntil: timestamp("party_cooldown_until", { withTimezone: true }),
  // The hoplite's home army (Hoplite Step 1): the four-rank promotion ladder and
  // the lazy salary-accrual anchor (reset on collect / enlist / promote). While on
  // a mercenary contract (Step 2) the same anchor serves the foreign-income accrual
  // — home and foreign income are mutually exclusive.
  armyRank: text("army_rank").notNull().default("none"),
  lastSalaryAt: timestamp("last_salary_at", { withTimezone: true }),
  // Mercenary contract (Hoplite Step 2): the content key of the active contract
  // (NULL = home), the immutable lifecycle anchor (seasons-elapsed → completion),
  // and the term length in seasons.
  contractId: text("contract_id"),
  contractStartedAt: timestamp("contract_started_at", { withTimezone: true }),
  contractSeasonsTotal: integer("contract_seasons_total"),
  // Hoplite Step 4: the composed chronicle line for a glorious merc death, carried
  // from the death instant to heir resolution (becomeHeir → successions.note).
  pendingDeathNote: text("pending_death_note"),
  // Hoplite Step 5: true if the character is, or ever was, a hoplite. Set at
  // creation-as-hoplite and PRESERVED through re-class — the veteran Strategos signal.
  wasHoplite: boolean("was_hoplite").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneCharacterPerPlayerWorld: uniqueIndex("player_characters_player_world_idx").on(table.playerId, table.worldId),
}));

// Traits held by a character. traitId references content/traits/traits.json
// (not a DB FK). Rules (cap, opposites) are enforced in the service layer.
export const characterTraits = pgTable("character_traits", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  traitId: text("trait_id").notNull(),
  gainedAt: timestamp("gained_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneTraitPerCharacter: uniqueIndex("character_traits_character_trait_idx").on(table.characterId, table.traitId),
}));

// Party favor accrued via events (per character per party).
export const partyFavor = pgTable("party_favor", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  party: text("party").notNull(),
  favor: integer("favor").notNull().default(0),
}, (table) => ({
  oneFavorPerCharacterParty: uniqueIndex("party_favor_character_party_idx").on(table.characterId, table.party),
}));

// The curated daily decision set: one card per arena per character per UTC day.
export const dailyDecisions = pgTable("daily_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  utcDay: date("utc_day").notNull(),
  arena: text("arena").notNull(),
  eventId: text("event_id").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedChoiceId: text("resolved_choice_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneCardPerArenaPerDay: uniqueIndex("daily_decisions_char_day_arena_idx").on(table.characterId, table.utcDay, table.arena),
}));

// One self-directed routine per character per UTC day. The UNIQUE
// (character_id, utc_day) constraint enforces the one-pick-per-day rule.
export const dailyRoutines = pgTable("daily_routines", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  utcDay: text("utc_day").notNull(),
  routineId: text("routine_id").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  onePickPerDay: uniqueIndex("daily_routines_char_day_idx").on(table.characterId, table.utcDay),
}));

// Generated people for marriage AND adoption. PER PLAYER (for_character_id) so
// the offer never runs dry. consumed_at set when chosen (kept for history).
export const familyCandidates = pgTable("family_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  forCharacterId: uuid("for_character_id").references(() => playerCharacters.id).notNull(),
  purpose: text("purpose").notNull(),
  name: text("name").notNull(),
  sex: text("sex").notNull(),
  houseSlug: text("house_slug").notNull(),
  age: integer("age").notNull(),
  prestige: integer("prestige").notNull().default(0),
  devotion: integer("devotion").notNull().default(0),
  militia: integer("militia").notNull().default(0),
  intelligence: integer("intelligence").notNull().default(0),
  traitId: text("trait_id"),
  avatarId: text("avatar_id"),
  ideology: integer("ideology").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => ({
  forCharacterIdx: index("family_candidates_for_char_idx").on(table.forCharacterId, table.purpose, table.consumedAt),
}));

// The marriages ledger. ended_at/end_reason fill when a marriage ends (e.g.
// death in childbirth).
export const marriages = pgTable("marriages", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  candidateId: uuid("candidate_id").references(() => familyCandidates.id).notNull(),
  marriedAt: timestamp("married_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endReason: text("end_reason"),
  // The wife's rolled lifespan (uniform in spouse.deathAge); the marriage ends
  // with 'spouse_died' once her lazily-aged current age reaches it.
  spouseDeathAge: integer("spouse_death_age"),
});

// Children of a played character. Age derives lazily from born_at (1 game year /
// 4 real days). came_of_age_at flips them to heir-eligible at 15; stats are NOT
// rolled until succession (Prompt C).
export const children = pgTable("children", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentCharacterId: uuid("parent_character_id").references(() => playerCharacters.id).notNull(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  name: text("name").notNull(),
  sex: text("sex").notNull(),
  bornAt: timestamp("born_at", { withTimezone: true }).notNull().defaultNow(),
  named: boolean("named").notNull().default(false),
  comeOfAgeAt: timestamp("came_of_age_at", { withTimezone: true }),
  heirCharacterId: uuid("heir_character_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  parentIdx: index("children_parent_idx").on(table.parentCharacterId),
}));

// Per-character delivery of a festival event (one per character per festival per
// game year). Auto-resolves to the free "attend" choice at close.
export const festivalEvents = pgTable("festival_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  festivalId: text("festival_id").notNull(),
  eventId: text("event_id").notNull(),
  gameYear: integer("game_year").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedChoiceId: text("resolved_choice_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneInstancePerCharacter: uniqueIndex("festival_events_char_idx").on(table.characterId, table.festivalId, table.gameYear),
}));

// Donations toward a festival instance — the sum decides the choregos.
export const festivalDonations = pgTable("festival_donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  festivalId: text("festival_id").notNull(),
  gameYear: integer("game_year").notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  instanceIdx: index("festival_donations_instance_idx").on(table.festivalId, table.gameYear),
}));

// Closed festival instances + the crowned patron (each instance awards once).
export const festivalChoregos = pgTable("festival_choregos", {
  id: uuid("id").primaryKey().defaultRandom(),
  festivalId: text("festival_id").notNull(),
  gameYear: integer("game_year").notNull(),
  winnerCharacterId: uuid("winner_character_id").references(() => playerCharacters.id),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneClosePerInstance: uniqueIndex("festival_choregos_instance_idx").on(table.festivalId, table.gameYear),
}));

// The Olympiad (Prompt 8): cycle state, advanced through its phases by the
// worker sweep (lazy-on-read net). One row per Olympiad (world + game year).
export const olympiads = pgTable("olympiads", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  gameYear: integer("game_year").notNull(),
  phase: text("phase").notNull(), // 'nomination' | 'voting' | 'resolved' | 'completed'
  nominationEndsAt: timestamp("nomination_ends_at", { withTimezone: true }),
  votingEndsAt: timestamp("voting_ends_at", { withTimezone: true }),
  payoffAt: timestamp("payoff_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneePerYear: uniqueIndex("olympiads_world_year_idx").on(table.worldId, table.gameYear),
}));

// Standing candidates — the nominate event registers the actor here.
export const olympicCandidates = pgTable("olympic_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  olympiadGameYear: integer("olympiad_game_year").notNull(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  nominatedAt: timestamp("nominated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneNominationPerCharacter: uniqueIndex("olympic_candidates_idx").on(table.olympiadGameYear, table.characterId),
}));

// The ballot: one vote per voter, replaceable until close (upsert on re-vote).
export const olympicVotes = pgTable("olympic_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  olympiadGameYear: integer("olympiad_game_year").notNull(),
  voterCharacterId: uuid("voter_character_id").references(() => playerCharacters.id).notNull(),
  candidateCharacterId: uuid("candidate_character_id").references(() => playerCharacters.id).notNull(),
  castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneVotePerVoter: uniqueIndex("olympic_votes_voter_idx").on(table.olympiadGameYear, table.voterCharacterId),
  tallyIdx: index("olympic_votes_tally_idx").on(table.olympiadGameYear, table.candidateCharacterId),
}));

// The Oligarchy Chamber (Politics Prompt 1): one row per seat per world.
// seat_index is stable (0-299) and drives the hemicycle infographic; purchases
// take the lowest-index empty seat. The slot row (player_characters) is reused
// across successions, so a dynastic seat rides its character_id to the heir.
export const oligarchSeats = pgTable("oligarch_seats", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  seatIndex: integer("seat_index").notNull(),
  holderType: text("holder_type").notNull().default("empty"), // 'npc' | 'player' | 'empty'
  npcParty: text("npc_party"), // 'palaioi' | 'dynatoi' | 'independent'
  characterId: uuid("character_id").references(() => playerCharacters.id),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
}, (table) => ({
  oneSeatPerIndex: uniqueIndex("oligarch_seats_world_seat_idx").on(table.worldId, table.seatIndex),
  // One seat per character — a unique partial index (WHERE character_id IS NOT
  // NULL) in the migration; mirrored here for reference.
  oneSeatPerCharacter: uniqueIndex("oligarch_seats_character_idx").on(table.characterId).where(sql`character_id IS NOT NULL`),
}));

// The yearly chamber vote: one per world per game year, open for one season.
export const chamberVotes = pgTable("chamber_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  gameYear: integer("game_year").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"), // 'open' | 'passed' | 'failed'
  yesCount: integer("yes_count"),
  noCount: integer("no_count"),
  // Politics Prompt 3: the agenda routes votes by scope; party scope restricts the
  // tally electorate. agenda_card_id ties a passed vote to its effect + treasury spend.
  scope: text("scope").notNull().default("league"), // 'league' | 'palaioi' | 'dynatoi'
  agendaCardId: text("agenda_card_id"),
  // yes/no leans per NPC party for the tally; NULL → flavor question fallback.
  leans: jsonb("leans").$type<{ palaioi: "yes" | "no"; dynatoi: "yes" | "no"; independent: "yes" | "no" }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneVotePerScopeYear: uniqueIndex("chamber_votes_world_scope_year_idx").on(table.worldId, table.scope, table.gameYear),
}));

// Chamber ballots: one per voter per vote, changeable while open. PUBLIC record
// by design — the API exposes who voted which way (the political ledger).
export const chamberBallots = pgTable("chamber_ballots", {
  id: uuid("id").primaryKey().defaultRandom(),
  voteId: uuid("vote_id").references(() => chamberVotes.id).notNull(),
  voterCharacterId: uuid("voter_character_id").references(() => playerCharacters.id).notNull(),
  choice: text("choice").notNull(), // 'yes' | 'no'
  castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneBallotPerVoter: uniqueIndex("chamber_ballots_voter_idx").on(table.voteId, table.voterCharacterId),
}));

// Archon & Ephor elections (Politics Prompt 2). Current office-holders: one row
// per (world, office, side, seat_slot). Strategoi use side NULL + seat_slot 0/1.
export const offices = pgTable("offices", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  office: text("office").notNull(), // 'archon' | 'ephor' | 'strategos' | 'party_archon' | 'party_ephor'
  side: text("side"), // 'palaioi' | 'dynatoi' | null (strategoi)
  seatSlot: integer("seat_slot").notNull().default(0),
  holderCharacterId: uuid("holder_character_id").references(() => playerCharacters.id),
  // True when the holder took the seat as an independent (drives defection forfeit).
  independentHolder: boolean("independent_holder").notNull().default(false),
  termStartedYear: integer("term_started_year"),
  termEndsYear: integer("term_ends_year"),
  acquiredVia: text("acquired_via"), // 'elected' | 'ascended' | 'appointed' | 'interim'
}, (table) => ({
  oneSeatPerSlot: uniqueIndex("offices_world_office_side_slot_idx").on(table.worldId, table.office, table.side, table.seatSlot),
}));

// Election cycle state: one per (world, office, game_year), advanced through
// declaration → voting → resolved against the season clock.
export const elections = pgTable("elections", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  office: text("office").notNull(), // 'archon' | 'ephor'
  gameYear: integer("game_year").notNull(),
  phase: text("phase").notNull(), // 'declaration' | 'voting' | 'resolved'
  declarationEndsAt: timestamp("declaration_ends_at", { withTimezone: true }).notNull(),
  votingEndsAt: timestamp("voting_ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  onePerOfficeYear: uniqueIndex("elections_world_office_year_idx").on(table.worldId, table.office, table.gameYear),
}));

// Standing candidates. side is chosen at declaration (independents pick a side).
export const electionCandidates = pgTable("election_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").references(() => elections.id).notNull(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  side: text("side").notNull(), // 'palaioi' | 'dynatoi'
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneCandidacyPerCharacter: uniqueIndex("election_candidates_idx").on(table.electionId, table.characterId),
}));

// The ballot: one vote per voter, changeable until close. SECRET — no public
// per-voter read (unlike chamber_ballots).
export const electionVotes = pgTable("election_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").references(() => elections.id).notNull(),
  voterCharacterId: uuid("voter_character_id").references(() => playerCharacters.id).notNull(),
  candidateCharacterId: uuid("candidate_character_id").references(() => playerCharacters.id).notNull(),
  castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneVotePerVoter: uniqueIndex("election_votes_voter_idx").on(table.electionId, table.voterCharacterId),
}));

// The public ledger + the term-limit source (count only acquired_via='elected').
export const officeHistory = pgTable("office_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  office: text("office").notNull(),
  side: text("side"),
  startedYear: integer("started_year").notNull(),
  endedYear: integer("ended_year"),
  acquiredVia: text("acquired_via").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  worldIdx: index("office_history_world_idx").on(table.worldId, table.office, table.side),
  characterIdx: index("office_history_character_idx").on(table.characterId, table.office),
}));

// --- The Agenda & the Three Governments (Politics Prompt 3) ------------------

// One treasury per owner per world. Spent only via passed agenda items.
export const treasuries = pgTable("treasuries", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  owner: text("owner").notNull(), // 'league' | 'palaioi' | 'dynatoi'
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneTreasuryPerOwner: uniqueIndex("treasuries_world_owner_idx").on(table.worldId, table.owner),
}));

// The audit trail the Ephors read: every treasury movement with a reason.
export const treasuryLedger = pgTable("treasury_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  owner: text("owner").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index("treasury_ledger_owner_idx").on(table.worldId, table.owner, table.createdAt),
}));

// Agenda cycle state: drafting → voting → resolved on the season clock.
export const agendaCycles = pgTable("agenda_cycles", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  scope: text("scope").notNull(), // 'league' | 'palaioi' | 'dynatoi'
  gameYear: integer("game_year").notNull(),
  phase: text("phase").notNull(), // 'drafting' | 'voting' | 'resolved'
  cardIds: jsonb("card_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  draftedCardId: text("drafted_card_id"),
  vetoedCardId: text("vetoed_card_id"),
  vetoedByCharacterId: uuid("vetoed_by_character_id").references(() => playerCharacters.id),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  votingEndsAt: timestamp("voting_ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  onePerScopeYear: uniqueIndex("agenda_cycles_world_scope_year_idx").on(table.worldId, table.scope, table.gameYear),
}));

// One veto per Ephor per term (scoped by the office term-started year).
export const ephorVetoes = pgTable("ephor_vetoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  ephorCharacterId: uuid("ephor_character_id").references(() => playerCharacters.id).notNull(),
  scope: text("scope").notNull(),
  officeTermStartedYear: integer("office_term_started_year").notNull(),
  agendaCycleId: uuid("agenda_cycle_id").references(() => agendaCycles.id),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneVetoPerTerm: uniqueIndex("ephor_vetoes_term_idx").on(table.ephorCharacterId, table.scope, table.officeTermStartedYear),
}));

// Party-leader endorsements during a league election (one per leader per election).
export const partyEndorsements = pgTable("party_endorsements", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  electionId: uuid("election_id").references(() => elections.id).notNull(),
  endorserCharacterId: uuid("endorser_character_id").references(() => playerCharacters.id).notNull(),
  party: text("party").notNull(),
  endorseeCharacterId: uuid("endorsee_character_id").references(() => playerCharacters.id).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneEndorsementPerLeader: uniqueIndex("party_endorsements_election_endorser_idx").on(table.electionId, table.endorserCharacterId),
}));

// Events drawn for a character (for the "exclude last 5 draws" rule).
export const eventHistory = pgTable("event_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  eventId: text("event_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Generic audit log of every applied effect.
export const effectLog = pgTable("effect_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  kind: text("kind").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Audit log of every composure change (action delta, break, etc.).
export const composureLog = pgTable("composure_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A censure window opened when a member's ideology drifts out of their party's
// range. Resolved at expiresAt (worker job + lazy-on-read). One per character.
export const censures = pgTable("censures", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => playerCharacters.id).notNull(),
  party: text("party").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  oneCensurePerCharacter: uniqueIndex("censures_character_idx").on(table.characterId),
}));

export const regions = pgTable("regions", {
  id: text("id").primaryKey(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  name: text("name").notNull(),
});

export const realms = pgTable("realms", {
  id: text("id").primaryKey(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const factions = pgTable("factions", {
  id: text("id").primaryKey(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const provinces = pgTable("provinces", {
  id: text("id").primaryKey(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  name: text("name").notNull(),
  regionId: text("region_id").references(() => regions.id).notNull(),
  realmId: text("realm_id").references(() => realms.id).notNull(),
  terrain: text("terrain").notNull(),
  ownerPlayerId: uuid("owner_player_id").references(() => players.id),
  factionId: text("faction_id").references(() => factions.id),
  controlStatus: text("control_status").notNull().default("controlled"),
  isCity: boolean("is_city").notNull().default(false),
});

export const buildings = pgTable("buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  provinceId: text("province_id").references(() => provinces.id).notNull(),
  type: text("type").notNull(),
  level: integer("level").notNull().default(1),
  queuedCompletionAt: timestamp("queued_completion_at", { withTimezone: true }),
});

// The Ledger / player economy (Economy Build 1). A player-scoped buildings table,
// distinct from the province-scoped `buildings` table (map/atlas system). Tier
// upgrades happen in place; one row per (world, owner, buildingId).
export const playerBuildings = pgTable("player_buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  ownerPlayerId: uuid("owner_player_id").references(() => players.id).notNull(),
  buildingId: text("building_id").notNull(),
  tier: integer("tier").notNull().default(1),
  status: text("status").notNull().default("constructing"), // 'constructing' | 'active'
  completesAt: timestamp("completes_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneBuildingPerOwner: uniqueIndex("player_buildings_owner_building_idx").on(table.worldId, table.ownerPlayerId, table.buildingId),
  ownerIdx: index("player_buildings_owner_idx").on(table.worldId, table.ownerPlayerId),
}));

// Pops a player owns (Phase 1 economy rebalance — STORAGE ONLY). One row per
// (world, owner, pop type); `count` is adjusted in place, so the UNIQUE key forbids
// duplicates. `pop_type` is free-form text (content-driven: slave / freeman /
// citizen come from content/people/pops.json via @massalia/shared parsePopsContent),
// mirroring the string-keyed `resources.type`. Pop economics (hireCost / upkeep /
// food) live in content, NOT here. No upkeep/food/hiring/staffing logic yet.
export const playerPops = pgTable("player_pops", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  ownerPlayerId: uuid("owner_player_id").references(() => players.id).notNull(),
  popType: text("pop_type").notNull(),
  count: integer("count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  onePerOwnerType: uniqueIndex("player_pops_owner_type_idx").on(table.worldId, table.ownerPlayerId, table.popType),
  ownerIdx: index("player_pops_owner_idx").on(table.worldId, table.ownerPlayerId),
}));

// Stub treasury sink: routine fees accrue here (one row per world). NO spending
// in this build — a counter the future treasury system will read.
export const worldTreasury = pgTable("world_treasury", {
  worldId: uuid("world_id").primaryKey().references(() => worlds.id),
  balance: integer("balance").notNull().default(0),
});

export const resources = pgTable("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  scopeId: text("scope_id").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount").notNull().default("0"),
  ratePerSecond: numeric("rate_per_second").notNull().default("0"),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull(),
});

export const armies = pgTable("armies", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerPlayerId: uuid("owner_player_id").references(() => players.id).notNull(),
  locationProvinceId: text("location_province_id").references(() => provinces.id).notNull(),
  units: jsonb("units").$type<Record<string, number>>().notNull(),
  movingTo: text("moving_to").references(() => provinces.id),
  arrivalAt: timestamp("arrival_at", { withTimezone: true }),
});

export const eventsLog = pgTable("events_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  eventId: text("event_id").notNull(),
  choiceId: text("choice_id").notNull(),
  resultText: text("result_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- League world-state (Atlas Phase 2a/2b-i) -------------------------------
// These two tables are created by the hand-written SQL migration 0030 (and 0031
// adds league_cities.last_growth_year). The defs below describe the LIVE tables
// AS-IS for typed access (the city-drift sweep + future reads). They are NOT
// drizzle-kit managed — the SQL migrations remain the source of truth; the
// constraint names mirror what Postgres generated so the description matches.
export const leagueCities = pgTable("league_cities", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  cityId: text("city_id").notNull(),
  population: integer("population").notNull(),
  // tax is an independent stat (NOT derived from population — content ratios vary
  // 3.3%–12%); it does not drift this phase.
  tax: integer("tax").notNull(),
  stability: integer("stability").notNull(),
  // 1..5 fortification level — Archon-upgraded in a later phase; never auto-grows.
  fortifications: integer("fortifications").notNull(),
  garrison: integer("garrison").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Once-per-game-year drift guard (migration 0031): the yearInGame this city last
  // grew. NULL = never grown (legacy/freshly-seeded). Nullable + additive.
  lastGrowthYear: integer("last_growth_year"),
}, (table) => ({
  oneCityPerWorld: unique("league_cities_world_id_city_id_key").on(table.worldId, table.cityId),
  worldIdx: index("league_cities_world_idx").on(table.worldId),
}));

export const factionRelations = pgTable("faction_relations", {
  id: uuid("id").primaryKey().defaultRandom(),
  worldId: uuid("world_id").references(() => worlds.id).notNull(),
  factionId: text("faction_id").notNull(),
  // The diplomatic stance, stored as the scale string id (war .. allied); the
  // numeric ordering lives in @massalia/shared. Static this phase (no drift).
  stance: text("stance").notNull(),
  vassal: boolean("vassal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneFactionPerWorld: unique("faction_relations_world_id_faction_id_key").on(table.worldId, table.factionId),
  worldIdx: index("faction_relations_world_idx").on(table.worldId),
}));

export const provinceRelations = relations(provinces, ({ one, many }) => ({
  owner: one(players, { fields: [provinces.ownerPlayerId], references: [players.id] }),
  faction: one(factions, { fields: [provinces.factionId], references: [factions.id] }),
  buildings: many(buildings),
}));
