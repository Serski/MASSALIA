import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The strikes table (migration 0077, strikes prompt 1): its keys hold one march
// on the road per nation, one war march per nation per season and one raids
// march per count; a world created after the migration has no strikes_from
// (it counts from its start). Integration test against a REAL Postgres, guarded
// to a *_test database (it truncates).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const SEASON = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (season: number) => new Date(T0 + season * SEASON);

suite("the strikes table (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let worldId: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE strike_parts, strikes, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    worldId = (await db.insert(dbPkg.worlds).values({ name: "Strikes", seed: "strikes", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!.id;
  });

  const march = (over: Partial<typeof dbPkg.strikes.$inferInsert> = {}) =>
    db.insert(dbPkg.strikes).values({ worldId, nationId: "volcae", trigger: "war", mode: "raid", seasonIndex: 9, regionId: "R050", townId: "agathe", targetKind: "home", force: 473, about: 470, draws: [{ placeId: "tolosa", kind: "town", men: 460 }, { placeId: "nemausus", kind: "town", men: 13 }], calledAt: at(9), strikesAt: new Date(at(9).getTime() + SEASON / 2), ...over }).returning();

  it("a world created after the migration counts from its start: no strikes_from", async () => {
    const world = (await db.select().from(dbPkg.worlds).where(eq(dbPkg.worlds.id, worldId)))[0]!;
    expect(world.strikesFrom).toBeNull();
  });

  it("one march on the road per nation; another may be called once it has struck", async () => {
    const first = (await march())[0]!;
    expect(first).toMatchObject({ status: "marching", resolvedAt: null, report: null, takenFrom: false });
    await expect(march({ trigger: "raids", seasonIndex: 9, triggerPlaceId: "nemausus", triggerAt: at(9) })).rejects.toThrow();
    // Another nation marches alongside.
    expect(await march({ nationId: "saluvii", trigger: "raids", triggerPlaceId: "reii", triggerAt: at(9) })).toHaveLength(1);
    await db.update(dbPkg.strikes).set({ status: "struck", resolvedAt: at(9.5) }).where(eq(dbPkg.strikes.id, first.id));
    expect(await march({ trigger: "raids", seasonIndex: 9, triggerPlaceId: "nemausus", triggerAt: at(9) })).toHaveLength(1);
  });

  it("one war march per nation per season, called off or not; one raids march per count", async () => {
    const first = (await march())[0]!;
    await db.update(dbPkg.strikes).set({ status: "called_off", resolvedAt: at(9.2) }).where(eq(dbPkg.strikes.id, first.id));
    await expect(march()).rejects.toThrow();
    expect(await march({ seasonIndex: 10, calledAt: at(10), strikesAt: at(10.5) })).toHaveLength(1);
    await db.update(dbPkg.strikes).set({ status: "struck" }).where(and(eq(dbPkg.strikes.worldId, worldId), eq(dbPkg.strikes.seasonIndex, 10)));

    const raids = { trigger: "raids" as const, triggerPlaceId: "nemausus", triggerAt: at(10.25), seasonIndex: 10 };
    const called = (await march(raids))[0]!;
    await db.update(dbPkg.strikes).set({ status: "struck" }).where(eq(dbPkg.strikes.id, called.id));
    await expect(march(raids)).rejects.toThrow();
    expect(await march({ ...raids, triggerAt: at(11) })).toHaveLength(1);
  });

  it("a part per owner and strike", async () => {
    const strike = (await march())[0]!;
    const player = (await db.insert(dbPkg.players).values({ worldId, kind: "league", userId: null, name: "The League", color: "#000000" }).returning())[0]!;
    await db.insert(dbPkg.strikeParts).values({ strikeId: strike.id, playerId: player.id, men: 40, lost: 12 });
    await expect(db.insert(dbPkg.strikeParts).values({ strikeId: strike.id, playerId: player.id, men: 1, lost: 0 })).rejects.toThrow();
    expect(await db.select().from(dbPkg.strikeParts)).toMatchObject([{ men: 40, lost: 12, paid: 0, holder: false, seenAt: null }]);
  });
});
