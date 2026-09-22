import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The chronicle fetch layer's effect_log read (market prompt 1). Integration test
// against a REAL Postgres, guarded to a *_test database (mirrors pops.test.ts).
// Proves market_sale, market_purchase and story_line rows reach the chronicle
// through their nested detail.chronicle block, and that a row without the block
// is skipped.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

suite("chronicle effect_log kinds (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let chronicle: Awaited<ReturnType<typeof load>>["chronicle"];
  let characterId: string;

  async function load() {
    const dbPkg = await import("./index.js");
    const chronicle = await import("./chronicle.js");
    return { dbPkg, chronicle, db: dbPkg.createDb() };
  }

  beforeAll(async () => {
    ({ db, dbPkg, chronicle } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db
      .insert(dbPkg.houses)
      .values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    const world = (await db.insert(dbPkg.worlds).values({ name: "Chronicle Test", seed: "ctest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    const user = (await db.insert(dbPkg.users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(dbPkg.players).values({ worldId: world.id, userId: user.id, name: "Kallias", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (await db.insert(dbPkg.playerCharacters).values({ playerId: player.id, worldId: world.id, houseSlug: "test-house", classId: "landowner" }).returning())[0]!;
    characterId = character.id;
  });

  it("reads market_sale and market_purchase through detail.chronicle and skips a row without it", async () => {
    const payload = {
      listingId: "00000000-0000-0000-0000-000000000001",
      good: "wine",
      goodLabel: "Wine",
      qty: 5,
      price: 9,
      total: 45,
      tax: 4,
      net: 41,
      sellerName: "Kallias",
      sellerHouseName: "House Test",
      buyerName: "Deon",
      buyerHouseName: "House Test",
      source: "market",
    };
    const at = new Date(T0 + 3 * DAY);
    await db.insert(dbPkg.effectLog).values([
      { characterId, kind: "market_sale", detail: { ...payload, chronicle: payload }, createdAt: at },
      { characterId, kind: "market_purchase", detail: { ...payload, chronicle: payload }, createdAt: at },
      { characterId, kind: "market_sale", detail: { ...payload }, createdAt: at }, // no chronicle block
    ]);

    const entries = await chronicle.gatherChronicleForCharacter(characterId);
    expect(entries.map((e) => e.type)).toEqual(["market_sale", "market_purchase"]);
    expect(entries[0]!.payload).toEqual(payload);
    expect(entries[1]!.payload).toEqual(payload);
  });

  it("reads a story_line through detail.chronicle and skips one without it", async () => {
    const payload = { storyId: "house-of-roses", line: "The steward of House Timon is buying poison." };
    const at = new Date(T0 + 3 * DAY);
    await db.insert(dbPkg.effectLog).values([
      { characterId, kind: "story_line", detail: { chronicle: payload }, createdAt: at },
      { characterId, kind: "story_line", detail: { storyId: payload.storyId }, createdAt: at }, // no chronicle block
    ]);

    const entries = await chronicle.gatherChronicleForCharacter(characterId);
    expect(entries.map((e) => e.type)).toEqual(["story_line"]);
    expect(entries[0]!.payload).toEqual(payload);
  });
});
