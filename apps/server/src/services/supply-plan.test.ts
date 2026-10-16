import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The Economy view's supply plan against the charge (economy supply-plan
// prompt 1): a landowner with a harvest, a store, a household, a levy, a band
// and men still in training. The plan is read from mine() at the start of a
// whole day; settleAll then runs across that day, and the stock it drew and
// the drachmae it spent must be the plan's numbers. This is the guard that the
// tab cannot drift from the charge.
//
// Prices move daily (a season is a day) and the plan prices at today's season,
// so the day runs Spring into Summer, where wheat, chicken and herbs cost the
// same, and the store covers the oil and the wine, whose price moves. The
// estate is inside its new-player guard, so its harvest is the same on both
// days. Against a REAL Postgres guarded to a *_test database.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1); // world start, the opening Winter
const at = (seasons: number) => new Date(T0 + seasons * DAY);
const SPRING = 1;
const SUMMER = 2;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const lock = await import("./lock.js");
  return { dbPkg, buildings, barracks, mapGraph, lock };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Supply plan against the settle (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  type Ctx = { playerId: string; worldId: string; worldStartedMs: number };

  const stock = async (ctx: Ctx, type: string) =>
    Number((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, type))))[0]?.amount ?? 0);
  const wallet = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, ctx.playerId)))[0]!.drachmae;

  // A landowner at the start of Spring: an estate finished half a day before
  // (inside the guard), four slaves (two staff it, all four eat), ten ekdromoi
  // standing, a Volcae band, thirty peltasts still in training, and a store of
  // 5 wheat, 15 oil, 6 wine and 1 chicken. Every settle marker sits at Spring's
  // start, so the next settle charges exactly one whole day.
  async function seed(drachmae: number): Promise<Ctx> {
    const { users, players, playerCharacters, playerPops, playerBuildings, playerUnits, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `P-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "landowner", militia: 20, drachmae, startAge: 30, deathAge: 90 });
    await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType: "slave", count: 4, createdAt: at(0) });
    await db.insert(playerBuildings).values({ worldId, ownerPlayerId: player.id, buildingId: "estate", tier: 1, status: "active", completesAt: at(SPRING - 0.5), createdAt: at(0) });
    const unit = { worldId, ownerPlayerId: player.id, createdAt: at(0) };
    await db.insert(playerUnits).values([
      { ...unit, source: "trained", unitId: "ekdromos", count: 10, startCount: 10, recruitedSeason: 0, readyAt: at(0) },
      { ...unit, source: "band", unitId: "volcae-irregulars", count: 40, startCount: 40, recruitedSeason: 0, contractEndAt: at(9) },
      { ...unit, source: "trained", unitId: "peltast", count: 30, startCount: 30, recruitedSeason: 0, readyAt: at(9) },
    ]);
    const row = (type: string, amount: number) => ({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: at(SPRING) });
    await db.insert(resources).values([
      row("grain", 5),
      row("oliveoil", 15),
      row("wine", 6),
      row("chicken", 1),
      row("building_income", 0),
      row("building_staff", 0),
      row("barracks_upkeep", 0),
    ]);
    return { playerId: player.id, worldId, worldStartedMs: T0 };
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_festivals, league_projects, league_cities, world_treasury, player_units, player_holdings, player_levy, band_offers, effect_log, resources, player_buildings, player_pops, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Supply Test", seed: "stest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("one whole day of settleAll draws the stock and spends the drachmae the plan said it would", async () => {
    const ctx = await seed(1000);
    const view = await m.buildings.mine("landowner", ctx, at(SPRING));
    const plan = view.supply;

    // The plan itself: the household's 4 wheat from the estate's 6; the army's
    // 10 wheat from the other 2, the store's 5 and 3 bought; chicken and herbs
    // bought; oil and wine from the store; the band's 40 dr.
    expect(plan.household).toEqual([{ good: "grain", need: 4, fromHarvest: 4, fromStore: 0, bought: 0, price: 3, cost: 0 }]);
    const army = Object.fromEntries(plan.army.map((l) => [l.good, l]));
    expect(army.grain).toMatchObject({ need: 10, fromStore: 5, bought: 3, cost: 9 });
    expect(army.grain!.fromHarvest).toBeCloseTo(2, 9);
    expect(army.oliveoil).toMatchObject({ need: 10, fromHarvest: 0, fromStore: 10, bought: 0 });
    expect(army.wine).toMatchObject({ need: 4, fromStore: 4, bought: 0 });
    expect(army.chicken).toMatchObject({ need: 4, fromStore: 1, bought: 3, price: 3, cost: 9 });
    expect(army.herbal).toMatchObject({ need: 2, fromStore: 0, bought: 2, price: 5, cost: 10 });
    expect(plan.armyPay).toBe(40);
    expect(plan.householdCost).toBe(0);
    expect(plan.armyGoodsCost).toBe(28);
    expect(plan.armyShort).toBeNull();
    // The thirty peltasts take the 5 oil the active rows leave in store and buy
    // the rest at Spring's prices: 30 wheat at 3 and 25 oil at 6, 240 dr a day
    // once they stand.
    expect(plan.training).toEqual({ men: [{ unitId: "peltast", label: "Peltast", plural: "Peltasts", count: 30 }], addsPerDay: 240 });

    const income = view.buildings.reduce((s, b) => s + b.income, 0);
    const upkeep = view.buildings.reduce((s, b) => s + b.upkeepPerDay, 0);
    const harvest = view.buildings.flatMap((b) => b.yields).filter((y) => y.good === "grain").reduce((s, y) => s + y.perDay, 0);
    const before = { purse: await wallet(ctx), grain: await stock(ctx, "grain"), oliveoil: await stock(ctx, "oliveoil"), wine: await stock(ctx, "wine"), chicken: await stock(ctx, "chicken"), herbal: await stock(ctx, "herbal") };

    const settled = await db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.buildings.settleAll(tx, ctx, at(SUMMER));
    });

    // What the settle says it did is the plan, line for line.
    const drawnBy = (lines: typeof plan.army) => Object.fromEntries(lines.filter((l) => l.fromHarvest + l.fromStore > 0).map((l) => [l.good, l.fromHarvest + l.fromStore]));
    const boughtBy = (lines: typeof plan.army) => Object.fromEntries(lines.filter((l) => l.bought > 0).map((l) => [l.good, l.bought]));
    expect(settled.staff.foodDrawn).toBeCloseTo(plan.household[0]!.fromHarvest + plan.household[0]!.fromStore, 9);
    expect(settled.staff.foodBought).toBeCloseTo(plan.household[0]!.bought, 9);
    expect(settled.staff.foodCost).toBe(Math.round(plan.householdCost));
    expect(Object.keys(settled.barracks.drawn).sort()).toEqual(Object.keys(drawnBy(plan.army)).sort());
    for (const [good, q] of Object.entries(drawnBy(plan.army))) expect(settled.barracks.drawn[good]).toBeCloseTo(q, 9);
    expect(Object.keys(settled.barracks.bought).sort()).toEqual(Object.keys(boughtBy(plan.army)).sort());
    for (const [good, q] of Object.entries(boughtBy(plan.army))) expect(settled.barracks.bought[good]).toBeCloseTo(q, 9);
    expect(settled.barracks.cost).toBe(Math.round(plan.armyPay + plan.armyGoodsCost));
    expect(settled.barracks.insolvent).toEqual([]);

    // The stock moved by the day's harvest less what the plan drew.
    const drawn = (good: string) => [...plan.household, ...plan.army].filter((l) => l.good === good).reduce((s, l) => s + l.fromHarvest + l.fromStore, 0);
    expect(await stock(ctx, "grain")).toBeCloseTo(before.grain + harvest - drawn("grain"), 6);
    for (const good of ["oliveoil", "wine", "chicken", "herbal"] as const) expect(await stock(ctx, good)).toBeCloseTo(before[good] - drawn(good), 6);
    expect(await stock(ctx, "oliveoil")).toBe(5);
    expect(await stock(ctx, "wine")).toBe(2);

    // The purse moved by the day's income less building upkeep, the household's
    // bought food and the army's day: nothing else was charged.
    expect((await wallet(ctx)) - before.purse).toBe(Math.round(income - upkeep) - Math.round(plan.householdCost) - Math.round(plan.armyPay + plan.armyGoodsCost));
  });

  it("calls the army's day short when tomorrow's purse, in the settle's order, cannot pay it", async () => {
    const ctx = await seed(0);
    const plan = (await m.buildings.mine("landowner", ctx, at(SPRING))).supply;
    expect(plan.armyShort).toEqual({ cost: 68 });
    await db.update(m.dbPkg.playerCharacters).set({ drachmae: 1000 }).where(eq(m.dbPkg.playerCharacters.playerId, ctx.playerId));
    expect((await m.buildings.mine("landowner", ctx, at(SPRING))).supply.armyShort).toBeNull();
  });
});
