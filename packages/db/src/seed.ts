import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { HOUSE_START, nobleHouses, parsePoliticsConfig, professions as sharedProfessions, SERVER_DURATION_DAYS } from "@massalia/shared";
import { ensureChamberSeats } from "./chamber.js";
import { createDb } from "./client.js";
import {
  buildings,
  factions,
  houses,
  players,
  professionLadders,
  professions,
  provinces,
  realms,
  regions,
  resources,
  users,
  worlds,
} from "./schema.js";

const db = createDb();
const now = new Date();
const seasonEnd = new Date(now.getTime() + SERVER_DURATION_DAYS * 24 * 60 * 60 * 1000);

const provinceRows = [
  ["massalia-harbor", "Massalia Harbor", "coast", "realm-massalia", "plains", true],
  ["old-port", "Old Port", "coast", "realm-massalia", "coast", true],
  ["la-ciotat", "La Ciotat", "coast", "realm-massalia", "coast", false],
  ["aix", "Aix", "hinterland", "realm-massalia", "farmland", true],
  ["arles", "Arles", "hinterland", "realm-rhone", "marsh", true],
  ["rhone-mouth", "Rhone Mouth", "hinterland", "realm-rhone", "marsh", false],
  ["cassis", "Cassis", "coast", "realm-massalia", "hills", false],
  ["sainte-baume", "Sainte-Baume", "uplands", "realm-aurelian", "mountain", false],
  ["brignoles", "Brignoles", "uplands", "realm-aurelian", "forest", true],
  ["toulon", "Toulon", "coast", "realm-aurelian", "coast", true],
  ["durance", "Durance Ford", "hinterland", "realm-rhone", "farmland", false],
  ["luberon", "Luberon", "uplands", "realm-rhone", "hills", false],
] as const;

function expectOne<T>(rows: T[], label: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Seed failed to create ${label}`);
  return row;
}

async function getOrCreateWorld() {
  const existing = await db.select().from(worlds).where(eq(worlds.seed, "massalia-alpha")).limit(1);
  if (existing[0]) return existing[0];
  return expectOne(
    await db
      .insert(worlds)
      .values({ name: "Massalia Season One", seed: "massalia-alpha", startedAt: now, endsAt: seasonEnd, status: "active" })
      .returning(),
    "world",
  );
}

async function getOrCreateUser(email: string) {
  await db
    .insert(users)
    .values({ email, passwordHash: "seed-user-disabled" })
    .onConflictDoNothing();
  return expectOne(await db.select().from(users).where(eq(users.email, email)).limit(1), `${email} user`);
}

async function getOrCreatePlayer(input: typeof players.$inferInsert) {
  const existing = await db
    .select()
    .from(players)
    .where(eq(players.userId, input.userId))
    .limit(1);
  if (existing[0]) return existing[0];
  return expectOne(await db.insert(players).values(input).returning(), `${input.name} player`);
}

async function seedCatalog() {
  await db
    .insert(houses)
    .values(nobleHouses.map((house) => ({
      slug: house.slug,
      name: house.name,
      initial: house.initial,
      alignment: house.alignment,
      stance: house.stance,
      motto: house.motto,
      patron: house.patron,
      crest: house.crest,
      startIdeology: HOUSE_START[house.slug]?.ideology ?? 0,
      data: { ...house, startBonus: HOUSE_START[house.slug]?.bonus ?? {} },
    })))
    .onConflictDoNothing();

  await db
    .insert(professions)
    .values(sharedProfessions.map((profession) => ({
      slug: profession.slug,
      name: profession.name,
      initial: profession.initial,
      rank: profession.rank,
      income: profession.income,
      hardMode: Boolean(profession.hardMode),
      data: profession,
    })))
    .onConflictDoNothing();

  await db.delete(professionLadders);
  for (const profession of sharedProfessions) {
    if (!profession.tiers.length) continue;
    await db.insert(professionLadders).values(
      profession.tiers.map((tier, index) => ({
        professionSlug: profession.slug,
        position: index + 1,
        building: tier.building,
        rank: tier.rank,
        benefit: tier.benefit,
        upkeep: tier.upkeep,
      })),
    );
  }
}

async function seedWorldState() {
  const world = await getOrCreateWorld();
  const userA = await getOrCreateUser("archon@example.com");
  const userB = await getOrCreateUser("legatus@example.com");

  const archon = await getOrCreatePlayer({ worldId: world.id, userId: userA.id, name: "House Phocaean", color: "#2f80ed" });
  const legatus = await getOrCreatePlayer({ worldId: world.id, userId: userB.id, name: "Aurelian League", color: "#c44d58" });

  await db
    .insert(regions)
    .values([
      { id: "coast", worldId: world.id, name: "Ligurian Coast" },
      { id: "hinterland", worldId: world.id, name: "Rhone Hinterland" },
      { id: "uplands", worldId: world.id, name: "Aurelian Uplands" },
    ])
    .onConflictDoNothing();

  await db
    .insert(realms)
    .values([
      { id: "realm-massalia", worldId: world.id, name: "Massalia", color: "#315c9c" },
      { id: "realm-rhone", worldId: world.id, name: "Rhone March", color: "#588157" },
      { id: "realm-aurelian", worldId: world.id, name: "Aurelian League", color: "#9a3412" },
    ])
    .onConflictDoNothing();

  await db
    .insert(factions)
    .values([
      { id: "faction-blue", worldId: world.id, name: "Harbor Compact", color: "#3a86ff" },
      { id: "faction-red", worldId: world.id, name: "Aurelian League", color: "#d1495b" },
    ])
    .onConflictDoNothing();

  await db
    .insert(provinces)
    .values(
      provinceRows.map(([id, name, regionId, realmId, terrain, isCity], index) => ({
        id,
        worldId: world.id,
        name,
        regionId,
        realmId,
        terrain,
        ownerPlayerId: index < 7 ? archon.id : legatus.id,
        factionId: index < 7 ? "faction-blue" : "faction-red",
        controlStatus: index === 8 ? "contested" : "controlled",
        isCity,
      })),
    )
    .onConflictDoNothing();

  const existingBuildings = await db.select().from(buildings).limit(1);
  if (!existingBuildings.length) {
    await db.insert(buildings).values([
      { provinceId: "massalia-harbor", type: "harbor", level: 2 },
      { provinceId: "aix", type: "market", level: 1 },
      { provinceId: "brignoles", type: "watchtower", level: 1, queuedCompletionAt: new Date(now.getTime() + 60_000) },
    ]);
  }

  const existingResources = await db.select().from(resources).limit(1);
  if (!existingResources.length) {
    await db.insert(resources).values([
      { scope: "province", scopeId: "massalia-harbor", type: "grain", amount: "240", ratePerSecond: "0.05", lastUpdatedAt: now },
      { scope: "province", scopeId: "aix", type: "silver", amount: "80", ratePerSecond: "0.01", lastUpdatedAt: now },
      { scope: "province", scopeId: "brignoles", type: "timber", amount: "130", ratePerSecond: "0.03", lastUpdatedAt: now },
    ]);
  }

  return world;
}

// The Oligarchy Chamber: seed this world's 300 seats from politics-config.json
// (idempotent — existing worlds were seeded by migration 0021).
async function seedChamber(worldId: string) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const politics = parsePoliticsConfig(JSON.parse(await readFile(path.join(repoRoot, "content/politics/politics-config.json"), "utf8")));
  await ensureChamberSeats(worldId, politics.chamber);
}

const world = await seedWorldState();
await seedCatalog();
await seedChamber(world.id);
console.log(`Seeded ${world.name} with ${nobleHouses.length} houses and ${sharedProfessions.length} professions`);
