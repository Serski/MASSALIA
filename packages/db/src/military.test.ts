import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// World 2 military pools (migration 0049). The content half is pure (runs
// everywhere); the seed half is an integration test against a REAL Postgres,
// guarded to a *_test database like the other db-package suites.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

type Province = { id: string; type: string; towns: string[] };
type World = { provinces: Province[]; towns: { id: string }[] };
type Politics = { polities: Record<string, { name: string }>; owners: Record<string, string> };

const world = read("apps/web/public/map2/world2.json") as World;
const politics = read("apps/web/public/map2/politics2.json") as Politics;
const names = read("apps/web/public/map2/names2.json") as { names: Record<string, string> };
const townFile = read("content/map/town-military.json") as {
  version: number;
  source: string;
  towns: Record<string, { owner: string; garrison: number; pentekonters: number; triremes: number }>;
};
const regionFile = read("content/map/region-military.json") as {
  version: number;
  source: string;
  regions: Record<string, { owner: string; warband: number }>;
};

const namedLand = world.provinces.filter((p) => p.type === "land" && p.id in names.names);
const townless = namedLand.filter((p) => p.towns.length === 0).map((p) => p.id).sort();
const UNCLAIMED_ID = Object.entries(politics.polities).find(([, p]) => p.name === "Unclaimed")![0];
const UNCLAIMED_REGIONS = ["R035", "R043", "R046", "R062", "R078", "R098", "R120", "R121", "R125", "R140"];

const isNonNegInt = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;

describe("military content files", () => {
  it("town-military.json covers exactly the 105 world2 towns", () => {
    const ids = Object.keys(townFile.towns).sort();
    expect(ids).toEqual(world.towns.map((t) => t.id).sort());
    expect(ids).toHaveLength(105);
    expect(townFile.version).toBe(1);
    expect(townFile.source).toMatch(/never copy into apps\/web\/public/);
  });

  it("region-military.json covers exactly the 49 named land regions without towns", () => {
    const ids = Object.keys(regionFile.regions).sort();
    expect(ids).toEqual(townless);
    expect(ids).toHaveLength(49);
    for (const id of ids) expect(namedLand.find((p) => p.id === id)!.towns).toHaveLength(0);
  });

  it("every stat is a non-negative integer", () => {
    for (const t of Object.values(townFile.towns)) {
      expect(isNonNegInt(t.garrison)).toBe(true);
      expect(isNonNegInt(t.pentekonters)).toBe(true);
      expect(isNonNegInt(t.triremes)).toBe(true);
    }
    for (const r of Object.values(regionFile.regions)) expect(isNonNegInt(r.warband)).toBe(true);
  });

  it("town owners are derived from the town's province owner", () => {
    const provinceOf = new Map(world.provinces.flatMap((p) => p.towns.map((t) => [t, p.id] as const)));
    for (const [id, t] of Object.entries(townFile.towns)) {
      expect(t.owner).toBe(politics.owners[provinceOf.get(id)!]);
    }
    for (const [id, r] of Object.entries(regionFile.regions)) expect(r.owner).toBe(politics.owners[id]);
  });

  it("the ten Unclaimed regions carry warband 100 under the Unclaimed polity id", () => {
    expect(UNCLAIMED_ID).toBe("unclaimed");
    for (const id of UNCLAIMED_REGIONS) {
      expect(regionFile.regions[id]).toEqual({ owner: UNCLAIMED_ID, warband: 100 });
    }
    expect(Object.values(regionFile.regions).filter((r) => r.owner === UNCLAIMED_ID)).toHaveLength(10);
  });

  it("spot-checks the canonical numbers", () => {
    expect(townFile.towns.massalia).toMatchObject({ owner: "massalia", garrison: 1000, pentekonters: 10, triremes: 30 });
    expect(townFile.towns.carthage).toMatchObject({ garrison: 25500, pentekonters: 10, triremes: 60 });
    expect(townFile.towns.rome).toMatchObject({ garrison: 30000, pentekonters: 4, triremes: 6 });
    expect(regionFile.regions.R105!.warband).toBe(4000);
    expect(regionFile.regions.R129!.warband).toBe(2500);
  });

  it("after normalization every named land region has an owner in politics2.json", () => {
    const missing = namedLand.filter((p) => !politics.owners[p.id]).map((p) => p.id);
    expect(missing).toEqual([]);
    for (const id of ["R043", "R078", "R121", "R140"]) expect(politics.owners[id]).toBe(UNCLAIMED_ID);
  });
});

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));
const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

suite("military pool seeds (integration)", () => {
  let dbPkg: typeof import("./index.js");
  let db: ReturnType<typeof dbPkg.createDb>;
  let worldId: string;

  beforeAll(async () => {
    dbPkg = await import("./index.js");
    db = dbPkg.createDb();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE town_intel, region_intel, town_military, region_military, worlds CASCADE`);
    const world = (
      await db
        .insert(dbPkg.worlds)
        .values({ name: "W", seed: "s", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" })
        .returning()
    )[0]!;
    worldId = world.id;
  });

  it("ensureTownMilitary and ensureRegionMilitary are idempotent (105 + 49 rows after two runs)", async () => {
    expect(await dbPkg.ensureTownMilitary(db, worldId)).toBe(105);
    expect(await dbPkg.ensureRegionMilitary(db, worldId)).toBe(49);
    await dbPkg.ensureTownMilitary(db, worldId);
    await dbPkg.ensureRegionMilitary(db, worldId);
    const towns = await db.select().from(dbPkg.townMilitary).where(eq(dbPkg.townMilitary.worldId, worldId));
    const regions = await db.select().from(dbPkg.regionMilitary).where(eq(dbPkg.regionMilitary.worldId, worldId));
    expect(towns).toHaveLength(105);
    expect(regions).toHaveLength(49);
    expect(towns.find((t) => t.townId === "massalia")).toMatchObject({ garrison: 1000, pentekonters: 10, triremes: 30 });
    expect(regions.find((r) => r.regionId === "R105")).toMatchObject({ warband: 4000 });
  });

  it("never overwrites an existing pool row", async () => {
    await dbPkg.ensureTownMilitary(db, worldId);
    await db.update(dbPkg.townMilitary).set({ garrison: 7 }).where(eq(dbPkg.townMilitary.townId, "massalia"));
    await dbPkg.ensureTownMilitary(db, worldId);
    const row = (await db.select().from(dbPkg.townMilitary).where(eq(dbPkg.townMilitary.townId, "massalia")))[0]!;
    expect(row.garrison).toBe(7);
  });
});
