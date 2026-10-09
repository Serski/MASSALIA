import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// A pool write never moves its marker backwards (koinon prompt 3, STOP 1
// ruling). A muster's army writes the defender's pool at its arrival instant,
// which may be earlier than the pool's last write. And the marker is the
// regrowth clock (raids prompt 3): a write below the full count leaves it where
// it is, and a full pool's first loss starts it. Integration tests against a
// REAL Postgres, guarded to a *_test database.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const HOUR = 3_600_000;
const T = new Date(Date.UTC(2000, 0, 3));
const earlier = new Date(T.getTime() - HOUR);
const later = new Date(T.getTime() + HOUR);
const evenLater = new Date(T.getTime() + 2 * HOUR);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const mapPools = await import("./mapPools.js");
  return { dbPkg, mapPools };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("A pool write never moves its marker backwards (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let regionId: string;
  let townId: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    regionId = Object.keys((await m.dbPkg.loadRegionMilitaryContent()).regions)[0]!;
    townId = Object.keys((await m.dbPkg.loadTownMilitaryContent()).towns)[0]!;
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE region_military, town_military, worlds CASCADE`);
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Pool Test", seed: "pooltest", startedAt: new Date(Date.UTC(2000, 0, 1)), endsAt: new Date(Date.UTC(2000, 6, 1)), status: "active" }).returning())[0]!.id;
  });

  it("a region's warband written at T, then at T minus an hour, keeps updated_at at T; a later write below the full count leaves it there, and the first loss of a full pool starts it", async () => {
    const { regionMilitary } = m.dbPkg;
    const row = async () => (await db.select().from(regionMilitary).where(and(eq(regionMilitary.worldId, worldId), eq(regionMilitary.regionId, regionId))))[0]!;
    await m.mapPools.writeRegionWarband(db, worldId, regionId, 10, T);
    expect(await row()).toMatchObject({ warband: 10, updatedAt: T });
    await m.mapPools.writeRegionWarband(db, worldId, regionId, 7, earlier);
    expect(await row()).toMatchObject({ warband: 7, updatedAt: T });
    await m.mapPools.writeRegionWarband(db, worldId, regionId, 5, later);
    expect(await row()).toMatchObject({ warband: 5, updatedAt: T });
    // Back to the full count (400 for R001): the clock stays; the first loss after that starts it.
    const base = await m.mapPools.regionBaseWarband(regionId);
    expect(base).toBeGreaterThan(10);
    await m.mapPools.writeRegionWarband(db, worldId, regionId, base, later);
    expect(await row()).toMatchObject({ warband: base, updatedAt: T });
    await m.mapPools.writeRegionWarband(db, worldId, regionId, base - 1, evenLater);
    expect(await row()).toMatchObject({ warband: base - 1, updatedAt: evenLater });
  });

  it("a town's garrison written at T, then at T minus an hour, keeps updated_at at T; a later write below the full count leaves it there, and the first loss of a full pool starts it", async () => {
    const { townMilitary } = m.dbPkg;
    const row = async () => (await db.select().from(townMilitary).where(and(eq(townMilitary.worldId, worldId), eq(townMilitary.townId, townId))))[0]!;
    await m.mapPools.writeTownGarrison(db, worldId, townId, 10, T);
    expect(await row()).toMatchObject({ garrison: 10, updatedAt: T });
    await m.mapPools.writeTownGarrison(db, worldId, townId, 7, earlier);
    expect(await row()).toMatchObject({ garrison: 7, updatedAt: T });
    await m.mapPools.writeTownGarrison(db, worldId, townId, 5, later);
    expect(await row()).toMatchObject({ garrison: 5, updatedAt: T });
    // Back to the full count (100 for abdera): the clock stays; the first loss after that starts it.
    const base = await m.mapPools.townBaseGarrison(townId);
    expect(base).toBeGreaterThan(10);
    await m.mapPools.writeTownGarrison(db, worldId, townId, base, later);
    expect(await row()).toMatchObject({ garrison: base, updatedAt: T });
    await m.mapPools.writeTownGarrison(db, worldId, townId, base - 1, evenLater);
    expect(await row()).toMatchObject({ garrison: base - 1, updatedAt: evenLater });
  });
});
