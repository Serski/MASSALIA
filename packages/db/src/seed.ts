import { createDb } from "./client.js";
import { buildings, factions, players, provinces, realms, regions, resources, users, worlds } from "./schema.js";

const db = createDb();
const now = new Date();
const seasonEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

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

function expectAt<T>(rows: T[], index: number, label: string): T {
  const row = rows[index];
  if (!row) throw new Error(`Seed failed to create ${label}`);
  return row;
}

async function seed() {
  const world = expectOne(
    await db
      .insert(worlds)
      .values({ name: "Massalia Season One", seed: "massalia-alpha", startedAt: now, endsAt: seasonEnd, status: "active" })
      .returning(),
    "world",
  );

  const createdUsers = await db
    .insert(users)
    .values([
      { email: "archon@example.com", passwordHash: "stub-password-hash" },
      { email: "legatus@example.com", passwordHash: "stub-password-hash" },
    ])
    .returning();
  const userA = expectAt(createdUsers, 0, "archon user");
  const userB = expectAt(createdUsers, 1, "legatus user");

  const createdPlayers = await db
    .insert(players)
    .values([
      { worldId: world.id, userId: userA.id, name: "House Phocaean", color: "#2f80ed" },
      { worldId: world.id, userId: userB.id, name: "Aurelian League", color: "#c44d58" },
    ])
    .returning();
  const archon = expectAt(createdPlayers, 0, "archon player");
  const legatus = expectAt(createdPlayers, 1, "legatus player");

  await db.insert(regions).values([
    { id: "coast", worldId: world.id, name: "Ligurian Coast" },
    { id: "hinterland", worldId: world.id, name: "Rhone Hinterland" },
    { id: "uplands", worldId: world.id, name: "Aurelian Uplands" },
  ]);

  await db.insert(realms).values([
    { id: "realm-massalia", worldId: world.id, name: "Massalia", color: "#315c9c" },
    { id: "realm-rhone", worldId: world.id, name: "Rhone March", color: "#588157" },
    { id: "realm-aurelian", worldId: world.id, name: "Aurelian League", color: "#9a3412" },
  ]);

  await db.insert(factions).values([
    { id: "faction-blue", worldId: world.id, name: "Harbor Compact", color: "#3a86ff" },
    { id: "faction-red", worldId: world.id, name: "Aurelian League", color: "#d1495b" },
  ]);

  await db.insert(provinces).values(
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
  );

  await db.insert(buildings).values([
    { provinceId: "massalia-harbor", type: "harbor", level: 2 },
    { provinceId: "aix", type: "market", level: 1 },
    { provinceId: "brignoles", type: "watchtower", level: 1, queuedCompletionAt: new Date(now.getTime() + 60_000) },
  ]);

  await db.insert(resources).values([
    { scope: "province", scopeId: "massalia-harbor", type: "grain", amount: "240", ratePerSecond: "0.05", lastUpdatedAt: now },
    { scope: "province", scopeId: "aix", type: "silver", amount: "80", ratePerSecond: "0.01", lastUpdatedAt: now },
    { scope: "province", scopeId: "brignoles", type: "timber", amount: "130", ratePerSecond: "0.03", lastUpdatedAt: now },
  ]);

  console.log(`Seeded ${world.name}`);
}

await seed();
