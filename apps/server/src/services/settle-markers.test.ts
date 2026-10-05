import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// A settle never moves a marker backwards (koinon prompt 3, STOP 0 ruling).
// settleAll may be called with a clock earlier than a player's markers: the
// muster's resolve settles each owner at the launch instant, and he may already
// have been settled past it. Integration tests against a REAL Postgres, guarded
// to a *_test database. A settle at T, then one at T minus an hour, must write
// nothing; the next one at T plus an hour must bank exactly one hour.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
// Two days in: the sanctuary (built at T0, an hour to raise) is long active.
const T = new Date(T0 + 2 * DAY);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const holdings = await import("./holdings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  return { dbPkg, buildings, holdings, barracks, mapGraph };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("A settle never moves a marker backwards (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  // A priest with the Sanctuary's staff: the building banks herbal (goods) and
  // offering drachmae (income), so both markers are in play.
  async function priest(name: string) {
    const { users, players, playerCharacters, playerPops, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "priest", drachmae: 1000, startAge: 30, deathAge: 90 });
    const staffing = (m.buildings.getBuildingsContent().classBuildings.priest?.staffing ?? {}) as Record<string, number>;
    for (const [popType, count] of Object.entries(staffing)) if (count > 0) await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType, count });
    for (const type of ["timber", "stone", "iron", "marble", "wool", "leather"]) {
      await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: "500", ratePerSecond: "0", lastUpdatedAt: new Date(T0) });
    }
    const ctx = (await m.buildings.buildingContext(player.id, worldId))!;
    const built = await m.buildings.build("priest", ctx, "sanctuary", new Date(T0));
    if (!built.ok) throw new Error(`build failed: ${built.error}`);
    return { playerId: player.id, ctx };
  }

  // Everything a settle can write for one player, in a stable order.
  async function state(playerId: string) {
    const { resources, playerCharacters, playerBuildings, playerPops } = m.dbPkg;
    return {
      wallet: (await db.select({ drachmae: playerCharacters.drachmae }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)))[0]!.drachmae,
      resources: (await db.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId))).orderBy(asc(resources.type))).map((r) => ({ type: r.type, amount: r.amount, rate: r.ratePerSecond, at: r.lastUpdatedAt.toISOString() })),
      buildings: await db.select().from(playerBuildings).where(eq(playerBuildings.ownerPlayerId, playerId)).orderBy(asc(playerBuildings.id)),
      pops: await db.select().from(playerPops).where(eq(playerPops.ownerPlayerId, playerId)).orderBy(asc(playerPops.popType)),
    };
  }
  const settle = (ctx: Awaited<ReturnType<Mods["buildings"]["buildingContext"]>>, now: Date) => m.buildings.settleAll(db, ctx!, now);
  const marker = (s: Awaited<ReturnType<typeof state>>, type: string) => s.resources.find((r) => r.type === type)!;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE world_treasury, player_holdings, player_units, player_levy, player_buildings, player_pops, resources, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Marker Test", seed: "mktest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  it("a settle at T, then at T minus 1 hour, writes nothing: no marker, wallet or stock changes", async () => {
    const a = await priest("Kallias");
    await settle(a.ctx, T);
    const atT = await state(a.playerId);
    // Both markers stand at T after the first settle, and something was banked.
    expect(marker(atT, "herbal").at).toBe(T.toISOString());
    expect(marker(atT, "building_income").at).toBe(T.toISOString());
    expect(Number(marker(atT, "herbal").amount)).toBeGreaterThan(0);
    expect(atT.wallet).toBeGreaterThan(1000 - 25);

    const earlier = await settle(a.ctx, new Date(T.getTime() - HOUR));
    expect(earlier.banked).toEqual({});
    expect(earlier.wallet).toMatchObject({ income: 0, upkeep: 0, collected: 0 });
    expect(await state(a.playerId)).toEqual(atT);

    // The same again, a whole day earlier and at the very instant: still nothing.
    await settle(a.ctx, new Date(T.getTime() - DAY));
    await settle(a.ctx, T);
    expect(await state(a.playerId)).toEqual(atT);
  });

  it("after a settle at an earlier clock, the next hour banks exactly one hour of goods and income", async () => {
    const a = await priest("Kallias");
    const control = await priest("Deon");
    const later = new Date(T.getTime() + HOUR);

    // The same history for both, but only `a` is settled at an earlier clock in between.
    await settle(a.ctx, T);
    await settle(control.ctx, T);
    await settle(a.ctx, new Date(T.getTime() - HOUR));
    const banked = await settle(a.ctx, later);
    const bankedControl = await settle(control.ctx, later);

    // One hour of herbal and of offering drachmae, and no more: the hour before T
    // is not banked a second time.
    expect(banked.banked.herbal).toBeGreaterThan(0);
    expect(banked.banked).toEqual(bankedControl.banked);
    expect(banked.wallet).toEqual(bankedControl.wallet);
    const [mine, his] = [await state(a.playerId), await state(control.playerId)];
    expect(mine.wallet).toBe(his.wallet);
    expect(mine.resources).toEqual(his.resources);
    expect(marker(mine, "herbal").at).toBe(later.toISOString());
    expect(marker(mine, "building_income").at).toBe(later.toISOString());
  });

  it("a holdings settle at an earlier clock leaves lastGarrisonedAt where it was", async () => {
    const { playerHoldings, playerUnits } = m.dbPkg;
    const a = await priest("Kallias");
    // A held region with men standing in it, last stamped at T.
    const regionId = [...m.mapGraph.getTopology().land.keys()].find((id) => id !== m.mapGraph.getTopology().massaliaRegion)!;
    await db.insert(playerHoldings).values({ worldId, regionId, townId: "", ownerPlayerId: a.playerId, kind: "conquest", since: new Date(T0), lastGarrisonedAt: T, lastTributeAt: T });
    await db.insert(playerUnits).values({ worldId, ownerPlayerId: a.playerId, source: "trained", unitId: "hoplite", count: 10, startCount: 10, recruitedSeason: 0, readyAt: new Date(T0), basedAt: regionId });
    const stamp = async () => (await db.select().from(playerHoldings).where(eq(playerHoldings.ownerPlayerId, a.playerId)))[0]!.lastGarrisonedAt.toISOString();

    expect(await m.holdings.settleHoldings(db, a.ctx!, new Date(T.getTime() - HOUR))).toEqual({ reverted: [] });
    expect(await stamp()).toBe(T.toISOString());
    // Two days earlier is still not a reversion: the holding is not empty, and
    // an earlier clock never counts as a day stood empty.
    expect(await m.holdings.settleHoldings(db, a.ctx!, new Date(T.getTime() - 2 * DAY))).toEqual({ reverted: [] });
    expect(await stamp()).toBe(T.toISOString());
    // A later clock moves it forward as before.
    const later = new Date(T.getTime() + HOUR);
    await m.holdings.settleHoldings(db, a.ctx!, later);
    expect(await stamp()).toBe(later.toISOString());
  });
});
