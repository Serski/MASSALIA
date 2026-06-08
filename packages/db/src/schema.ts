import { relations, sql } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
});

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
// ideology, party, currency, and the daily action economy.
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
  growthMultiplier: numeric("growth_multiplier").notNull().default("1.0"),
  actionsSpentToday: integer("actions_spent_today").notNull().default(0),
  lastActionReset: timestamp("last_action_reset", { withTimezone: true }),
  partyCooldownUntil: timestamp("party_cooldown_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneCharacterPerPlayerWorld: uniqueIndex("player_characters_player_world_idx").on(table.playerId, table.worldId),
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
