import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The League's own settle (government prompt 5b): hulls home to its stock,
// arrivals and the merge, a holding kept by its garrison or lost after a day
// without one, tribute to the League treasury once for each whole day with its
// goods sold at what the market pays; never a house's upkeep. And its lock
// order: the League's lock, then the treasury row, as the army's upkeep settle
// takes them. Integration test against a REAL Postgres, guarded to a *_test
// database (it truncates).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (days: number) => new Date(T0 + days * DAY);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const shared = await import("@massalia/shared");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const mapPools = await import("./mapPools.js");
  const holdings = await import("./holdings.js");
  const townStats = await import("./townStats.js");
  const lock = await import("./lock.js");
  const league = await import("./leagueOrders.js");
  return { dbPkg, shared, buildings, barracks, mapGraph, mapPools, holdings, townStats, lock, league };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the League's settle (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let ctx: NonNullable<Awaited<ReturnType<Mods["league"]["leagueContext"]>>>;

  const settle = (when: Date) =>
    db.transaction(async (tx) => {
      await m.league.lockLeagueWrite(tx, ctx);
      return m.league.settleLeague(tx, ctx, when);
    });
  const units = () => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId));
  const rowAt = async (basedAt: string, unitId: string) => (await units()).filter((r) => r.basedAt === basedAt && r.unitId === unitId && r.movingTo === null);
  const insertRow = async (o: { unitId: string; count: number; basedAt: string; movingTo?: string; arrivesAt?: Date; mission?: Record<string, unknown> }) =>
    (
      await db
        .insert(m.dbPkg.playerUnits)
        .values({ worldId, ownerPlayerId: ctx.playerId, source: "trained", unitId: o.unitId, count: o.count, startCount: o.count, recruitedSeason: 0, readyAt: at(0), basedAt: o.basedAt, movingTo: o.movingTo ?? null, arrivesAt: o.arrivesAt ?? null, mission: (o.mission ?? null) as never, createdAt: at(1) })
        .returning()
    )[0]!;
  const fleet = () => m.dbPkg.leagueFleet(db, worldId);
  const balance = () => m.dbPkg.treasuryBalance(worldId, "league");
  const ledger = async () =>
    (await db.select({ reason: m.dbPkg.treasuryLedger.reason, delta: m.dbPkg.treasuryLedger.delta }).from(m.dbPkg.treasuryLedger).where(and(eq(m.dbPkg.treasuryLedger.worldId, worldId), eq(m.dbPkg.treasuryLedger.owner, "league"))).orderBy(m.dbPkg.treasuryLedger.createdAt, m.dbPkg.treasuryLedger.reason)).map((l) => [l.reason, l.delta]);
  const holdingsOf = () => db.select().from(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
  const hold = (regionId: string, townId: string, since: Date, o: { garrisoned?: Date; tribute?: Date } = {}) =>
    db.insert(m.dbPkg.playerHoldings).values({ worldId, regionId, townId, ownerPlayerId: ctx.playerId, kind: "conquest", previousOwner: "saluvii", since, lastGarrisonedAt: o.garrisoned ?? since, lastTributeAt: o.tribute ?? since });

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_orders, player_marches, player_voyages, player_holdings, player_units, town_military, region_military, resources, treasury_ledger, treasuries, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "League Settle", seed: "lsettle", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
    await db.insert(m.dbPkg.treasuries).values({ worldId, owner: "league", balance: 5000 });
    expect(await m.dbPkg.ensureLeagueArmy(worldId, at(0))).toBe(true);
    ctx = (await m.league.leagueContext(db, { id: worldId, startedMs: T0 }))!;
    expect(m.league.isLeague(ctx)).toBe(true);
  });

  it("hulls come home to the League's stock, once", async () => {
    // Three pentekonters sailed and are due back at day 5 plus an hour.
    await db.update(m.dbPkg.resources).set({ amount: "26" }).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, "trade-ship")));
    await db.insert(m.dbPkg.playerVoyages).values({ worldId, ownerPlayerId: ctx.playerId, ships: { "trade-ship": 3 }, kind: "raid", regionId: "R047", townId: "reii", sailedAt: at(5), returnsAt: new Date(at(5).getTime() + HOUR) });
    expect((await settle(at(5))).shipsHome).toBe(0);
    expect(await fleet()).toEqual({ pentekonters: 26, triremes: 40 });
    expect((await settle(new Date(at(5).getTime() + HOUR))).shipsHome).toBe(1);
    expect(await fleet()).toEqual({ pentekonters: 29, triremes: 40 });
    expect((await settle(at(6))).shipsHome).toBe(0);
    expect(await fleet()).toEqual({ pentekonters: 29, triremes: 40 });
  });

  it("a row whose road has ended stands at its destination and folds into the men already there; one still carrying a march is left to its march", async () => {
    const moving = await insertRow({ unitId: "hoplite", count: 40, basedAt: "massalia", movingTo: "nikaia", arrivesAt: at(5), mission: { kind: "move", regionId: "R061", townId: "nikaia", departedAt: at(4).toISOString() } });
    const marching = await insertRow({ unitId: "peltast", count: 30, basedAt: "massalia", movingTo: "reii", arrivesAt: at(5), mission: { kind: "raid", regionId: "R047", townId: "reii", departedAt: at(4).toISOString(), marchId: "00000000-0000-4000-8000-000000000001" } });

    // Before the road ends nothing lands.
    expect(await settle(new Date(at(5).getTime() - HOUR))).toMatchObject({ arrived: 0, merged: 0 });
    const out = await settle(at(5));
    expect(out).toMatchObject({ arrived: 1, merged: 1 });
    const hoplites = await rowAt("nikaia", "hoplite");
    expect(hoplites).toHaveLength(1);
    expect(hoplites[0]).toMatchObject({ count: 76 + 40, startCount: 76 + 40, mission: null, arrivesAt: null });
    expect((await units()).some((r) => r.id === moving.id)).toBe(false); // folded into the row that stood there
    // The party on its way out is its march's to land.
    expect((await units()).find((r) => r.id === marching.id)).toMatchObject({ basedAt: "massalia", movingTo: "reii", count: 30 });
    expect((await units()).reduce((n, r) => n + r.count, 0)).toBe(2050 + 40 + 30);
    // No house's upkeep ran: no marker row, no levy, and the League's men are all there.
    expect(await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, "barracks_upkeep")))).toEqual([]);
    expect(await db.select().from(m.dbPkg.playerLevy).where(eq(m.dbPkg.playerLevy.ownerPlayerId, ctx.playerId))).toEqual([]);
  });

  it("a League holding with men keeps its marker current; with no men for a full day it reverts, and its garrison is the town's again", async () => {
    await hold("R047", "reii", at(3));
    await insertRow({ unitId: "hoplite", count: 20, basedAt: "reii" });
    await settle(at(5));
    expect((await holdingsOf())[0]!.lastGarrisonedAt.getTime()).toBe(at(5).getTime());

    // The men leave. Under a day empty, it holds; a full day on, it is gone.
    await db.delete(m.dbPkg.playerUnits).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId), eq(m.dbPkg.playerUnits.basedAt, "reii")));
    expect((await settle(new Date(at(6).getTime() - HOUR))).holdings.reverted).toEqual([]);
    expect(await holdingsOf()).toHaveLength(1);
    const out = await settle(at(6));
    expect(out.holdings.reverted).toEqual([{ regionId: "R047", townId: "reii", kind: "conquest", previousOwner: "saluvii" }]);
    expect(await holdingsOf()).toEqual([]);
    const town = (await db.select().from(m.dbPkg.townMilitary).where(and(eq(m.dbPkg.townMilitary.worldId, worldId), eq(m.dbPkg.townMilitary.townId, "reii"))))[0]!;
    expect(town.garrison).toBe(await m.mapPools.townBaseGarrison("reii"));
    // The League has no character: the reversion wrote no Chronicle row.
    expect(await db.select().from(m.dbPkg.effectLog)).toEqual([]);
  });

  it("a League town holding pays its tribute to the treasury once for each whole day, and nothing under its minimum garrison", async () => {
    const rate = await m.holdings.tributeRateOf({ regionId: "R047", townId: "reii" });
    expect(rate.drachmae).toBeGreaterThan(0);
    await hold("R047", "reii", at(3));
    await insertRow({ unitId: "hoplite", count: rate.minGarrison, basedAt: "reii" });

    // Two and a half days on: two days are paid, the half carries on the marker.
    const out = await settle(new Date(at(5).getTime() + 12 * HOUR));
    expect(out.tribute).toEqual([{ placeId: "reii", days: 2, amount: 2 * rate.drachmae }]);
    expect(await balance()).toBe(5000 + 2 * rate.drachmae);
    expect(await ledger()).toEqual([[`tribute:reii:d${Math.floor(at(5).getTime() / DAY)}`, 2 * rate.drachmae]]);
    expect((await holdingsOf())[0]!.lastTributeAt.getTime()).toBe(at(5).getTime());
    // The same instant again, and the rest of that day: nothing more.
    expect((await settle(new Date(at(5).getTime() + 12 * HOUR))).tribute).toEqual([]);
    expect((await settle(new Date(at(6).getTime() - HOUR))).tribute).toEqual([]);
    expect(await ledger()).toHaveLength(1);
    // The third day, once.
    expect((await settle(at(6))).tribute).toEqual([{ placeId: "reii", days: 1, amount: rate.drachmae }]);
    expect(await balance()).toBe(5000 + 3 * rate.drachmae);

    // A garrison one man short pays nothing for the day that passed, and the day is gone.
    const row = (await rowAt("reii", "hoplite"))[0]!;
    await db.update(m.dbPkg.playerUnits).set({ count: rate.minGarrison - 1 }).where(eq(m.dbPkg.playerUnits.id, row.id));
    if (rate.minGarrison > 1) {
      expect((await settle(at(7))).tribute).toEqual([]);
      expect((await holdingsOf())[0]!.lastTributeAt.getTime()).toBe(at(7).getTime());
      expect(await balance()).toBe(5000 + 3 * rate.drachmae);
    }
  });

  it("a League land holding's grain and timber are sold at what the market pays that season, in one ledger row", async () => {
    const rate = await m.holdings.tributeRateOf({ regionId: "R046", townId: "" });
    expect(rate).toMatchObject({ drachmae: 0, minGarrison: 1 });
    expect(rate.grain).toBeGreaterThan(0);
    expect(rate.timber).toBeGreaterThan(0);
    await hold("R046", "", at(3));
    await insertRow({ unitId: "peltast", count: 5, basedAt: "R046" });
    const when = at(4); // a Winter day (season 0 of year 1): the market pays its winter price
    const c = m.buildings.getBuildingsContent();
    const pays = (good: string) => m.shared.vendorUnitPrice(c.vendor[good]!, "sell", c.seasonal, m.shared.goodCategoryFor(c.seasonal, good), m.shared.seasonAt(when.getTime(), T0));
    expect(m.league.marketPrice("grain", "sell", when, T0)).toBe(pays("grain"));
    const amount = rate.grain * pays("grain") + rate.timber * pays("timber");
    expect((await settle(when)).tribute).toEqual([{ placeId: "R046", days: 1, amount }]);
    expect(await ledger()).toEqual([[`tribute:R046:d${Math.floor(when.getTime() / DAY)}`, amount]]);
    expect(await balance()).toBe(5000 + amount);
    // The goods were sold, not stocked.
    expect(await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), sql`type IN ('grain', 'timber')`))).toEqual([]);
  });

  it("the settle on a read takes no lock when nothing is due, and settles when something is", async () => {
    expect(await m.league.leagueDue(db, ctx, at(5))).toBe(false);
    // Another transaction holds the League's lock: with nothing due the read's settle answers at once.
    await db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      const answered = await Promise.race([m.league.settleLeagueIfDue(at(5)), new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 1500))]);
      expect(answered).toBe(false);
    });

    // Each kind of thing that can be due: a road ended, a voyage back, and either of a holding's markers.
    const moving = await insertRow({ unitId: "hoplite", count: 10, basedAt: "massalia", movingTo: "nikaia", arrivesAt: at(5), mission: { kind: "move", regionId: "R061", departedAt: at(4).toISOString() } });
    expect(await m.league.leagueDue(db, ctx, new Date(at(5).getTime() - 1))).toBe(false);
    expect(await m.league.leagueDue(db, ctx, at(5))).toBe(true);
    expect(await m.league.settleLeagueIfDue(at(5))).toBe(true);
    expect((await units()).some((r) => r.id === moving.id)).toBe(false);
    expect(await m.league.settleLeagueIfDue(at(5))).toBe(false);

    await db.insert(m.dbPkg.playerVoyages).values({ worldId, ownerPlayerId: ctx.playerId, ships: { galley: 1 }, kind: "move", regionId: "R061", townId: null, sailedAt: at(5), returnsAt: at(6) });
    expect(await m.league.leagueDue(db, ctx, at(6))).toBe(true);
    expect(await m.league.settleLeagueIfDue(at(6))).toBe(true);

    await hold("R046", "", at(6));
    await insertRow({ unitId: "peltast", count: 5, basedAt: "R046" });
    expect(await m.league.leagueDue(db, ctx, new Date(at(7).getTime() - 1))).toBe(false);
    expect(await m.league.leagueDue(db, ctx, at(7))).toBe(true);
    // The tribute marker alone, then the empty-for-a-day marker alone.
    await db.update(m.dbPkg.playerHoldings).set({ lastTributeAt: at(7), lastGarrisonedAt: at(6) }).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
    expect(await m.league.leagueDue(db, ctx, at(7))).toBe(true);
    await db.update(m.dbPkg.playerHoldings).set({ lastTributeAt: at(7), lastGarrisonedAt: at(7) }).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
    expect(await m.league.leagueDue(db, ctx, at(7))).toBe(false);
  });

  it("the League's settle and the army's upkeep settle at once, twenty rounds: both finish and neither deadlocks", async () => {
    // Twenty seasons of upkeep (513 each) must be within the treasury, or the men desert.
    await db.update(m.dbPkg.treasuries).set({ balance: 50_000 }).where(and(eq(m.dbPkg.treasuries.worldId, worldId), eq(m.dbPkg.treasuries.owner, "league")));
    for (let round = 0; round < 20; round++) {
      const when = at(10 + round); // a new season each round: the upkeep is due
      await insertRow({ unitId: "hoplite", count: 1, basedAt: "massalia", movingTo: "nikaia", arrivesAt: when, mission: { kind: "move", regionId: "R061", departedAt: at(9).toISOString() } });
      const [army, settled] = await Promise.all([m.dbPkg.settleLeagueArmy(when), m.league.settleLeagueIfDue(when)]);
      expect(army.charged, `round ${round}`).toBe(true);
      expect(settled, `round ${round}`).toBe(true);
    }
    expect((await ledger()).filter(([reason]) => String(reason).startsWith("army:s"))).toHaveLength(20);
    expect((await rowAt("nikaia", "hoplite"))[0]!.count).toBe(76 + 20);
  });
});
