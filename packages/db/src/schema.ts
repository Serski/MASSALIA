import { relations, sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const provinceRelations = relations(provinces, ({ one, many }) => ({
  owner: one(players, { fields: [provinces.ownerPlayerId], references: [players.id] }),
  faction: one(factions, { fields: [provinces.factionId], references: [factions.id] }),
  buildings: many(buildings),
}));
