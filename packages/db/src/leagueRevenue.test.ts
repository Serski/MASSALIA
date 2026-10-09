import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leagueTax, parseCitiesContent, parsePoliticsConfig } from "@massalia/shared";

// ---------------------------------------------------------------------------
// The League treasury's income (government prompt 1): the opening balance once
// per world, the poleis' tax once a season, the sweep of world_treasury once a
// season and only when the pot holds anything. Integration test against a REAL
// Postgres, guarded to a *_test database (it truncates), as sweeps-world.test.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content = (file: string) => JSON.parse(readFileSync(resolve(root, "content", file), "utf8"));
const cfg = parsePoliticsConfig(content("politics/politics-config.json"));
const cities = parseCitiesContent(content("cities/cities.json"));
const startTax = leagueTax(cities.cities.map((c) => c.start.population), cfg.treasury);
const SEASON = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (season: number) => new Date(T0 + Math.round((season + 0.5) * SEASON));

suite("the League treasury's income (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let worldId: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  const ledger = async (reasonLike: string, world = worldId) =>
    db
      .select({ delta: dbPkg.treasuryLedger.delta, reason: dbPkg.treasuryLedger.reason })
      .from(dbPkg.treasuryLedger)
      .where(and(eq(dbPkg.treasuryLedger.worldId, world), eq(dbPkg.treasuryLedger.owner, "league"), sql`${dbPkg.treasuryLedger.reason} LIKE ${reasonLike}`));
  const balance = (world = worldId) => dbPkg.treasuryBalance(world, "league");
  const pot = async (world = worldId) => (await db.select({ b: dbPkg.worldTreasury.balance }).from(dbPkg.worldTreasury).where(eq(dbPkg.worldTreasury.worldId, world)))[0]?.b ?? 0;
  const setPot = (amount: number) => db.insert(dbPkg.worldTreasury).values({ worldId, balance: amount }).onConflictDoUpdate({ target: dbPkg.worldTreasury.worldId, set: { balance: amount } });

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE treasury_ledger, treasuries, league_cities, world_treasury, worlds CASCADE`);
    worldId = (await db.insert(dbPkg.worlds).values({ name: "Revenue", seed: "rev-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!.id;
  });

  it("a fresh world opens with the config's balance and this season's tax, seeds the poleis, and sweeps no empty pot", async () => {
    expect(cfg.treasury.openingBalance).toBe(60_000);
    expect(startTax).toBe(910);

    const got = await dbPkg.collectLeagueRevenue(cfg, at(0));
    expect(got).toEqual({ opened: 60_000, tax: 910, fees: 0 });

    expect(await ledger("opening")).toEqual([{ delta: 60_000, reason: "opening" }]);
    expect(await ledger("tax:s%")).toEqual([{ delta: 910, reason: "tax:s0" }]);
    expect(await ledger("fees:s%")).toEqual([]);
    expect(await balance()).toBe(60_910);
    const rows = await db.select({ cityId: dbPkg.leagueCities.cityId }).from(dbPkg.leagueCities).where(eq(dbPkg.leagueCities.worldId, worldId));
    expect(rows.map((r) => r.cityId).sort()).toEqual(cities.cities.map((c) => c.id).sort());
  });

  it("a second call in the same season writes nothing", async () => {
    await dbPkg.collectLeagueRevenue(cfg, at(0));
    expect(await dbPkg.collectLeagueRevenue(cfg, at(0))).toEqual({ opened: 0, tax: 0, fees: 0 });
    expect(await balance()).toBe(60_910);
    expect((await ledger("%")).length).toBe(2);
  });

  it("a pot of 37 is swept once a season into the League, and the pot reads 0", async () => {
    await dbPkg.collectLeagueRevenue(cfg, at(0));
    await setPot(37);

    expect(await dbPkg.collectLeagueRevenue(cfg, at(0))).toEqual({ opened: 0, tax: 0, fees: 37 });
    expect(await ledger("fees:s%")).toEqual([{ delta: 37, reason: "fees:s0" }]);
    expect(await pot()).toBe(0);
    expect(await balance()).toBe(60_947);

    // Money that comes in later this season waits for the next season's sweep.
    await setPot(5);
    expect(await dbPkg.collectLeagueRevenue(cfg, at(0))).toEqual({ opened: 0, tax: 0, fees: 0 });
    expect(await pot()).toBe(5);
    expect(await balance()).toBe(60_947);
  });

  it("the next season brings one new tax row and nothing else", async () => {
    await dbPkg.collectLeagueRevenue(cfg, at(0));
    expect(await dbPkg.collectLeagueRevenue(cfg, at(1))).toEqual({ opened: 0, tax: 910, fees: 0 });
    expect((await ledger("tax:s%")).map((r) => r.reason).sort()).toEqual(["tax:s0", "tax:s1"]);
    expect(await ledger("opening")).toHaveLength(1);
    expect(await balance()).toBe(60_000 + 2 * 910);
  });

  it("two calls at once credit the opening and the tax exactly once", async () => {
    const [a, b] = await Promise.all([dbPkg.collectLeagueRevenue(cfg, at(0)), dbPkg.collectLeagueRevenue(cfg, at(0))]);
    expect(a.opened + b.opened).toBe(60_000);
    expect(a.tax + b.tax).toBe(910);
    expect(await ledger("opening")).toHaveLength(1);
    expect(await ledger("tax:s%")).toHaveLength(1);
    expect(await balance()).toBe(60_910);
  });

  it("an ended world beside the active one gets nothing", async () => {
    const ended = (await db.insert(dbPkg.worlds).values({ name: "Old", seed: "rev-old", startedAt: new Date(T0 - 100 * SEASON), endsAt: new Date(T0), status: "ended" }).returning())[0]!.id;
    await dbPkg.collectLeagueRevenue(cfg, at(0));
    expect(await ledger("%", ended)).toEqual([]);
    expect(await balance(ended)).toBe(0);
    expect((await db.select().from(dbPkg.leagueCities).where(eq(dbPkg.leagueCities.worldId, ended))).length).toBe(0);
  });

  it("a second opening row for the same world fails on the index", async () => {
    await dbPkg.collectLeagueRevenue(cfg, at(0));
    // drizzle wraps the Postgres error ("Failed query: …"); the constraint name is on its cause.
    const err = await db.insert(dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: 1, reason: "opening" }).then(() => null, (e: unknown) => e as Error & { cause?: { constraint?: string } });
    expect(err).toBeInstanceOf(Error);
    expect(err!.cause?.constraint).toBe("treasury_ledger_claim_idx");
    expect(await ledger("opening")).toHaveLength(1);
    // The index guards only the claim reasons: a repeating reason still inserts twice.
    await db.insert(dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: 1, reason: "cut:seat_purchase" });
    await db.insert(dbPkg.treasuryLedger).values({ worldId, owner: "league", delta: 1, reason: "cut:seat_purchase" });
    expect(await ledger("cut:seat_purchase")).toHaveLength(2);
  });
});
