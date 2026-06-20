import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { buildingYield, coeffFor, craftRawCost, goodCategoryFor, seasonAt, vendorUnitPrice } from "@massalia/shared";

// ---------------------------------------------------------------------------
// The Ledger / player economy (Economy Build 1) — integration tests against a
// REAL Postgres, guarded to a *_test database (mirrors agenda.test.ts). Exercises
// the DB-level behaviors the pure engine tests can't: lazy activation, OFFLINE
// closed-form accrual, collect netting upkeep (wallet never negative), atomic
// vendor band trades, and the routine consumption hook (good/fee/waiver +
// world-treasury credit).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1); // world start = opening Winter

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  return { dbPkg, buildings };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Ledger / building engine (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let playerId: string;

  // Phase 2: buildings need staff (pops) to produce. Phase 3: build/upgrade also
  // spends materials + requires owning the staff. By default seed a generous pop
  // pool AND a material stock so existing build/produce scenarios pass; pass `pops`
  // / `materials` to control them (e.g. {} to force a shortfall).
  async function freshPlayer(
    drachmae = 100,
    classId = "landowner",
    // Default: own exactly the class building's T1 staffing requirement, so OWNED == required.
    // (Wages/food are now charged on every owned pop, so seeding more than required would
    // distort the per-day arithmetic these tests assert. Tests that need a surplus or a
    // higher-tier prereq pass an explicit pops map.)
    pops: Record<string, number> = (m.buildings.getBuildingsContent().classBuildings[classId]?.staffing ?? {}) as Record<string, number>,
    materials: Record<string, number> = { timber: 500, stone: 500, iron: 500, marble: 500, wool: 500, leather: 500 },
  ) {
    const { users, players, playerCharacters, playerPops, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "P", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, drachmae, startAge: 30, deathAge: 90 });
    for (const [popType, count] of Object.entries(pops)) {
      if (count > 0) await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType, count });
    }
    for (const [type, amount] of Object.entries(materials)) {
      if (amount > 0) await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: new Date(T0) });
    }
    return player.id;
  }

  async function popBalance(type: string) {
    const rows = await db.select().from(m.dbPkg.playerPops).where(and(eq(m.dbPkg.playerPops.ownerPlayerId, playerId), eq(m.dbPkg.playerPops.popType, type))).limit(1);
    return rows[0]?.count ?? 0;
  }

  async function ctx() {
    return (await m.buildings.buildingContext(playerId, worldId))!;
  }
  async function wallet() {
    const rows = await db.select({ drachmae: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)).limit(1);
    return rows[0]!.drachmae;
  }
  async function setWallet(amount: number) {
    await db.update(m.dbPkg.playerCharacters).set({ drachmae: amount }).where(eq(m.dbPkg.playerCharacters.playerId, playerId));
  }
  async function goodBalance(type: string) {
    const rows = await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, type))).limit(1);
    return Number(rows[0]?.amount ?? 0);
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE world_treasury, player_buildings, player_pops, resources, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Ledger Test", seed: "ltest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
    playerId = await freshPlayer();
  });

  it("day-1 path: 100dr → build Estate T1 (100) → wallet 0 → constructs in 1 day → first collect yields grain", async () => {
    const c = await ctx();
    const built = await m.buildings.build("landowner", c, "estate", new Date(T0));
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.cost).toBe(100);
    expect(await wallet()).toBe(0);

    // Still constructing before completesAt.
    const midBuild = await m.buildings.mine("landowner", c, new Date(T0 + DAY / 2));
    expect(midBuild.buildings[0]!.status).toBe("constructing");

    // OFFLINE: jump two days forward with no intervening tick. Lazy activation
    // flips it active and ~one day of grain has accrued (guarded → full output).
    const collectAt = new Date(T0 + 2 * DAY);
    const view = await m.buildings.mine("landowner", c, collectAt);
    expect(view.buildings[0]!.status).toBe("active");
    expect(view.pendingGoods.grain).toBeGreaterThan(5.5);
    expect(view.pendingGoods.grain).toBeLessThan(6.5);

    const collected = await m.buildings.collect(c, collectAt);
    expect(collected.banked.grain).toBeCloseTo(6, 1); // production (banked before food is drawn)
    // Phase 2: the estate's 2 slaves now cost wages and eat. Food is drawn from the
    // freshly-banked grain first, so stock left = produced − food drawn; the wallet =
    // income (6) − staff wages (drawn food was free, no NPC buy needed).
    expect(collected.staffUpkeep).toBeGreaterThan(0);
    expect(collected.foodDrawn).toBeGreaterThan(0);
    expect(await goodBalance("grain")).toBeCloseTo(6 - collected.foodDrawn, 1);
    expect(await wallet()).toBe(collected.collected - collected.staffUpkeep - collected.foodCost);
  });

  it("vendor band trades are atomic (sell grain for floor, buy chicken at ceiling)", async () => {
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    const t = new Date(T0 + 2 * DAY);
    await m.buildings.collect(c, t); // banks grain (minus the day's food) + income (minus staff wages)

    const grainHeld = await goodBalance("grain"); // produced minus food drawn for the staff
    const before = await wallet();
    const sell = await m.buildings.vendorTrade(c, "sell", "grain", 3, t); // sell ≤ held
    expect(sell.ok).toBe(true);
    if (sell.ok) {
      expect(sell.total).toBe(sell.unitPrice * 3);
      expect(await wallet()).toBe(before + sell.total);
      expect(await goodBalance("grain")).toBeCloseTo(grainHeld - 3, 1);
    }

    // Now affords a chicken from the vendor (day-2 guardrail).
    const buy = await m.buildings.vendorTrade(c, "buy", "chicken", 1, t);
    expect(buy.ok).toBe(true);
    if (buy.ok) expect(await goodBalance("chicken")).toBe(1);

    // Selling more than held is rejected (atomic — no partial trade).
    const bad = await m.buildings.vendorTrade(c, "sell", "grain", 999, t);
    expect(bad.ok).toBe(false);
  });

  it("upgrade raises the tier; collect nets upkeep and never pushes the wallet negative", async () => {
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    // Fund the upgrade directly (the grind is covered elsewhere), then upgrade to T2.
    const t1 = new Date(T0 + 5 * DAY); // estate active
    await setWallet(300);
    const up = await m.buildings.upgrade(c, "estate", t1);
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.tier).toBe(2);
    expect(await wallet()).toBe(50); // 300 − 250

    // First collect creates the wallet marker. Drain the purse, then collect after a
    // long window. Under economy v2.1 the landowner's T2 income (10.8 dr/day) far
    // exceeds the gentle 1 dr/day upkeep, so the net is positive: upkeep is still
    // deducted, `owed` stays 0 (nothing forgiven), and the wallet never goes negative.
    // (A non-zero `owed` is unreachable via any class building now — every line earns
    // income above its upkeep at every tier — so the clamp stays a defensive guard.)
    await m.buildings.collect(c, new Date(T0 + 8 * DAY)); // T2 active (completes T0+7d)
    await setWallet(0);
    const collected = await m.buildings.collect(c, new Date(T0 + 28 * DAY));
    expect(collected.upkeep).toBeGreaterThan(0); // gentle tax still computed (~20 days × 1dr/day)
    expect(collected.owed).toBe(0); // income covers upkeep → nothing forgiven
    expect(await wallet()).toBeGreaterThan(0); // net income (after upkeep) banked; never negative
  });

  it("routine consumption: missing good rejects; fee credits the world treasury; waiver zeroes the cost", async () => {
    const c = await ctx();
    // No chicken on hand → an offering (1 chicken) is rejected.
    const missing = await m.buildings.consumeRoutineRequirement(playerId, worldId, { good: { type: "chicken", qty: 1 }, fee: undefined }, new Date(T0));
    expect(missing.ok).toBe(false);

    // Buy a chicken, then the offering succeeds and debits it.
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    await m.buildings.collect(c, new Date(T0 + 2 * DAY));
    await m.buildings.vendorTrade(c, "sell", "grain", 3, new Date(T0 + 2 * DAY)); // ≤ grain left after food
    await m.buildings.vendorTrade(c, "buy", "chicken", 1, new Date(T0 + 2 * DAY));
    const offering = await m.buildings.consumeRoutineRequirement(playerId, worldId, { good: { type: "chicken", qty: 1 } }, new Date(T0 + 2 * DAY));
    expect(offering.ok).toBe(true);
    expect(await goodBalance("chicken")).toBe(0);

    // A fee debits the wallet and lands in the world-treasury stub.
    const walletBefore = await wallet();
    const fee = await m.buildings.consumeRoutineRequirement(playerId, worldId, { fee: 2 }, new Date(T0 + 2 * DAY));
    expect(fee.ok).toBe(true);
    expect(await wallet()).toBe(walletBefore - 2);
    const treasury = await db.select().from(m.dbPkg.worldTreasury).where(eq(m.dbPkg.worldTreasury.worldId, worldId)).limit(1);
    expect(treasury[0]!.balance).toBe(2);

    // Owning the waivedBy building zeroes a cost (no horse needed, none debited).
    await setWallet(300);
    await m.buildings.build("landowner", c, "horse-farm", new Date(T0 + 2 * DAY));
    const ride = await m.buildings.consumeRoutineRequirement(playerId, worldId, { good: { type: "horse", qty: 1 }, waivedBy: "horse-farm" }, new Date(T0 + 2 * DAY));
    expect(ride.ok).toBe(true);
    if (ride.ok) expect(ride.waived).toBe(true);
    expect(await goodBalance("horse")).toBe(0); // waived → nothing consumed
  });

  it("a PRIEST builds the Sanctuary; collect banks BOTH offering drachmae (wallet) and herbal (resources); upgrade raises both", async () => {
    // The priest path rides the exact same generic engine as the landowner.
    playerId = await freshPlayer(100, "priest");
    const c = await ctx();

    const built = await m.buildings.build("priest", c, "sanctuary", new Date(T0));
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.cost).toBe(100);
    expect(await wallet()).toBe(0);

    // OFFLINE jump: constructs in 1 day, then ~1 day active (guarded → full output).
    const collectAt = new Date(T0 + 2 * DAY);
    const view = await m.buildings.mine("priest", c, collectAt);
    expect(view.buildings[0]!.status).toBe("active");
    expect(view.pendingGoods.herbal).toBeGreaterThan(3.5);
    expect(view.pendingIncomeTotal).toBeGreaterThan(5.5); // offering drachmae pending

    const collected = await m.buildings.collect(c, collectAt);
    // Offering income banks into the integer wallet (income 7.2/day, T1 upkeep 0).
    expect(collected.collected).toBeGreaterThanOrEqual(5);
    expect(collected.collected).toBeLessThanOrEqual(8);
    // Phase 2: the sanctuary's citizen costs wages and eats. The priest grows no
    // grain, so the day's food is AUTO-BOUGHT from the NPC and the wallet debited.
    expect(collected.staffUpkeep).toBeGreaterThan(0);
    expect(collected.foodBought).toBeGreaterThan(0); // no wheat stock → bought
    expect(await wallet()).toBe(collected.collected - collected.staffUpkeep - collected.foodCost);
    // Herbal banks into resources (food draws grain, not herbal, so it's untouched).
    expect(collected.banked.herbal).toBeCloseTo(4, 0);
    expect(await goodBalance("herbal")).toBeCloseTo(4, 0);

    // Herbal sells on the vendor band (exists + trades, no deadlock).
    const sell = await m.buildings.vendorTrade(c, "sell", "herbal", 4, collectAt);
    expect(sell.ok).toBe(true);

    // Upgrade to Temple Precinct (T2) lifts both yields on the curve.
    await setWallet(300);
    const up = await m.buildings.upgrade(c, "sanctuary", new Date(T0 + 5 * DAY));
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.tier).toBe(2);
    expect(await wallet()).toBe(50); // 300 − 250
  });

  it("the class gate is generic: a non-priest cannot build the Sanctuary, and a priest cannot build the Estate", async () => {
    // Landowner barred from the priest's line.
    const landCtx = await ctx();
    const landTriesSanctuary = await m.buildings.build("landowner", landCtx, "sanctuary", new Date(T0));
    expect(landTriesSanctuary.ok).toBe(false);
    if (!landTriesSanctuary.ok) expect(landTriesSanctuary.code).toBe(403);

    // Priest barred from the landowner's line.
    playerId = await freshPlayer(100, "priest");
    const priestCtx = await ctx();
    const priestTriesEstate = await m.buildings.build("priest", priestCtx, "estate", new Date(T0));
    expect(priestTriesEstate.ok).toBe(false);
    if (!priestTriesEstate.ok) expect(priestTriesEstate.code).toBe(403);

    // The priest's own class-section slot is the labelled "Rites" placeholder (Step 2 pilgrimages).
    const priestMine = await m.buildings.mine("priest", priestCtx, new Date(T0));
    expect(priestMine.classSection.label).toBe("Rites");
    expect(priestMine.classSection.entries).toEqual([]);
    expect(priestMine.classSection.comingSoon).toBe(true);
  });

  it("trader/philosopher/hetaira are income-only lines: collect banks offering drachmae to the wallet, upgrade raises it", async () => {
    for (const [classId, buildingId, label] of [
      ["trader", "emporion", "Ventures"],
      ["philosopher", "school", "Pupils"],
      ["hetaira", "salon", "Clientele"],
    ] as const) {
      playerId = await freshPlayer(100, classId);
      const c = await ctx();

      const built = await m.buildings.build(classId, c, buildingId, new Date(T0));
      expect(built.ok).toBe(true);
      if (built.ok) expect(built.cost).toBe(100);
      expect(await wallet()).toBe(0);

      // ~1 day active → income accrues to the wallet (no goods at T1 for these lines).
      const collectAt = new Date(T0 + 2 * DAY);
      const view = await m.buildings.mine(classId, c, collectAt);
      expect(view.buildings[0]!.status).toBe("active");
      expect(view.pendingIncomeTotal).toBeGreaterThan(5.5); // income 6–7/day pending
      expect(Object.keys(view.pendingGoods)).toHaveLength(0); // no tradeable good

      const collected = await m.buildings.collect(c, collectAt);
      expect(collected.collected).toBeGreaterThanOrEqual(5); // income banked (income − building upkeep)
      // Phase 2: staff wages + auto-bought food (these lines grow no grain) net out
      // of the wallet alongside the income.
      expect(collected.staffUpkeep).toBeGreaterThan(0);
      expect(await wallet()).toBe(collected.collected - collected.staffUpkeep - collected.foodCost);
      expect(collected.banked).toEqual({}); // nothing into resources

      // Upgrade to tier 2 works on the curve; the section slot stays the labelled stub.
      await setWallet(300);
      const up = await m.buildings.upgrade(c, buildingId, new Date(T0 + 5 * DAY));
      expect(up.ok).toBe(true);
      if (up.ok) expect(up.tier).toBe(2);
      const mineV = await m.buildings.mine(classId, c, new Date(T0 + 5 * DAY));
      expect(mineV.classSection.label).toBe(label);
      expect(mineV.classSection.comingSoon).toBe(true);
    }
  });

  it("a SHIPBUILDER earns passive income AND produces 'naval-supplies' goods into resources; they trade on the vendor band", async () => {
    playerId = await freshPlayer(100, "shipbuilder");
    const c = await ctx();

    const built = await m.buildings.build("shipbuilder", c, "slipway", new Date(T0));
    expect(built.ok).toBe(true);
    expect(await wallet()).toBe(0);

    const collectAt = new Date(T0 + 2 * DAY);
    const view = await m.buildings.mine("shipbuilder", c, collectAt);
    expect(view.buildings[0]!.status).toBe("active");
    expect(view.pendingGoods["naval-supplies"]).toBeGreaterThan(0.8); // ~1/day, guarded full output
    expect(view.pendingIncomeTotal).toBeGreaterThan(8); // income 8.4/day → ~8.4 after one guarded day

    const collected = await m.buildings.collect(c, collectAt);
    expect(collected.collected).toBe(8); // round(8.4 income − 0 upkeep)
    expect(collected.banked["naval-supplies"]).toBeCloseTo(1, 0);
    expect(await goodBalance("naval-supplies")).toBeCloseTo(1, 0);

    // Naval supplies sell to the vendor at the seasonal floor (exists + trades, no deadlock).
    const sell = await m.buildings.vendorTrade(c, "sell", "naval-supplies", 1, collectAt);
    expect(sell.ok).toBe(true);
    if (sell.ok) expect(sell.total).toBeGreaterThan(0);
  });

  it("the class gate stays generic for all four: no cross-class building", async () => {
    // A landowner cannot raise any of the four new lines.
    const landCtx = await ctx();
    for (const buildingId of ["emporion", "school", "salon", "slipway"]) {
      const denied = await m.buildings.build("landowner", landCtx, buildingId, new Date(T0));
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.code).toBe(403);
    }
    // And a trader cannot raise another class's line (e.g. the shipbuilder's slipway).
    playerId = await freshPlayer(100, "trader");
    const traderCtx = await ctx();
    const crossed = await m.buildings.build("trader", traderCtx, "slipway", new Date(T0));
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.code).toBe(403);
  });

  it("slaves cannot build; the class-section slot is labelled+empty for non-landowners, null for the landowner", async () => {
    const c = await ctx();
    // Landowner: no class section (the land is the business).
    const landMine = await m.buildings.mine("landowner", c, new Date(T0));
    expect(landMine.classSection.label).toBeNull();

    // A hoplite (no class building wired) gets a labelled "Service" slot (the
    // home army rank ladder lives in this section; buildings leave entries empty).
    playerId = await freshPlayer(100, "hoplite");
    const hopliteCtx = await ctx();
    const hopMine = await m.buildings.mine("hoplite", hopliteCtx, new Date(T0));
    expect(hopMine.classSection.label).toBe("Service");
    expect(hopMine.classSection.entries).toEqual([]);
    expect(hopMine.classSection.comingSoon).toBe(true);

    // A slave is barred from building.
    playerId = await freshPlayer(100, "slave");
    const slaveCtx = await ctx();
    const denied = await m.buildings.build("slave", slaveCtx, "poultry-yard", new Date(T0));
    expect(denied.ok).toBe(false);
  });

  // --- Phase 2: staffing as the counterweight ------------------------------

  it("(a) the rebalanced slipway (1 freeman) covers its own keep on cash income alone — staff + food < income", async () => {
    // Phase 4 balance fix: the slipway now needs 1 freeman (2 dr/day wages + 1 food/day),
    // so its 8.4 dr/day cash income covers its keep — naval-supplies are a bonus on top,
    // matching every other class (was a 2-freeman cash deficit before).
    playerId = await freshPlayer(100, "shipbuilder");
    const c = await ctx();
    await m.buildings.build("shipbuilder", c, "slipway", new Date(T0));
    expect(await wallet()).toBe(0);

    const collected = await m.buildings.collect(c, new Date(T0 + 12 * DAY));
    expect(collected.staffUpkeep).toBeGreaterThan(0); // crew wages still charged
    expect(collected.income).toBeGreaterThan(0);
    // …and the cash income now EXCEEDS wages + food (the keep is self-covering).
    expect(collected.staffUpkeep + collected.foodCost).toBeLessThan(collected.income);
    expect(collected.owed).toBe(0); // no shortfall
    expect(await wallet()).toBeGreaterThan(0); // income net of keep is banked
    expect(collected.banked["naval-supplies"]).toBeGreaterThan(0); // goods are a bonus on top
  });

  it("(a2) the deficit still bites a building that runs SHORT: an under-staffed estate with an empty purse owes building upkeep it can't pay (owed > 0)", async () => {
    // Own the 2 slaves to build + upgrade the estate to T2 (1 dr/day upkeep), then lose
    // one. Now under-staffed, it idles (no income/yield) — yet the flat building upkeep
    // keeps accruing, and with an empty purse it can't be paid → forgiven as `owed`.
    playerId = await freshPlayer(500, "landowner", { slave: 2 });
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    await m.buildings.upgrade(c, "estate", new Date(T0 + 5 * DAY)); // → T2, completes T0+7
    await db.update(m.dbPkg.playerPops).set({ count: 1 }).where(and(eq(m.dbPkg.playerPops.ownerPlayerId, playerId), eq(m.dbPkg.playerPops.popType, "slave")));
    await setWallet(0);

    const collected = await m.buildings.collect(c, new Date(T0 + 27 * DAY)); // long window
    expect(collected.idled).toContain("estate"); // under-staffed → idled
    expect(collected.income).toBe(0); // no income
    expect(collected.staffUpkeep).toBeGreaterThan(0); // the 1 owned slave is still fed + paid, building idle or not
    expect(collected.upkeep).toBeGreaterThan(0); // building upkeep still accrues
    expect(collected.owed).toBeGreaterThan(0); // empty purse can't cover wages + upkeep → forgiven shortfall
    expect(await wallet()).toBe(0); // never negative
  });

  it("(b) food draws from wheat stock first, then auto-buys the shortfall from the NPC (wallet debited)", async () => {
    // A priest grows no grain. Seed exactly 1 wheat; over a 2-day window the sanctuary's
    // citizen needs 2 food → 1 drawn from stock, 1 auto-bought at the wheat ceiling.
    playerId = await freshPlayer(100, "priest");
    const c = await ctx();
    await m.buildings.build("priest", c, "sanctuary", new Date(T0));
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: playerId, type: "grain", amount: "1", ratePerSecond: "0", lastUpdatedAt: new Date(T0) });
    const before = await wallet();

    const collected = await m.buildings.collect(c, new Date(T0 + 3 * DAY)); // sanctuary active T0+1 → 2 whole days
    expect(collected.foodDrawn).toBe(1); // the seeded wheat, drawn first
    expect(collected.foodBought).toBe(1); // the remaining day bought from the NPC
    expect(collected.foodCost).toBeGreaterThan(0); // wallet paid for it
    expect(await goodBalance("grain")).toBe(0); // the 1 wheat was consumed
    // Wallet = income − staff wages − bought-food cost (income covers it here).
    expect(await wallet()).toBe(before + collected.collected - collected.staffUpkeep - collected.foodCost);
  });

  it("(c) an under-staffed building idles — no income/yield — but still owes building upkeep", async () => {
    // Build + upgrade the estate to T2 (upkeep 1 dr/day) while owning the 2 slaves it
    // needs. Then a slave is lost (freed/dead — simulated here by dropping the pool to
    // 1). Now under-staffed, the estate idles: zero grain, zero income, but the flat
    // building upkeep still bites.
    playerId = await freshPlayer(500, "landowner", { slave: 2 });
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    const up = await m.buildings.upgrade(c, "estate", new Date(T0 + 5 * DAY)); // → T2, completes T0+7
    expect(up.ok).toBe(true);
    // Lose a slave: the pool (1) now falls short of the estate's T2 need (2).
    await db.update(m.dbPkg.playerPops).set({ count: 1 }).where(and(eq(m.dbPkg.playerPops.ownerPlayerId, playerId), eq(m.dbPkg.playerPops.popType, "slave")));

    // The Ledger shows it idled: produces nothing, but its building upkeep is unchanged.
    const view = await m.buildings.mine("landowner", c, new Date(T0 + 10 * DAY));
    const estate = view.buildings.find((b) => b.id === "estate")!;
    expect(estate.idle).toBe(true);
    expect(estate.yields).toEqual([]);
    expect(estate.income).toBe(0);
    expect(estate.upkeepPerDay).toBe(1); // T2 building upkeep — still owed

    // Collecting confirms it: no goods, no income — yet the owned slave's wages AND the
    // flat building upkeep are both charged (wages are owned-based, not staffing-based).
    const collected = await m.buildings.collect(c, new Date(T0 + 10 * DAY));
    expect(Object.keys(collected.banked)).toHaveLength(0); // produced nothing
    expect(collected.income).toBe(0);
    expect(collected.staffUpkeep).toBeGreaterThan(0); // the owned slave is still paid even though the estate idles
    expect(collected.upkeep).toBeGreaterThan(0); // building upkeep still owed
    expect(collected.idled).toContain("estate");
  });

  it("(d) wages + food are charged on ALL owned pops, not just the staffing requirement", async () => {
    // Own 5 slaves but build an estate that only requires 2. Hiring is the commitment:
    // every owned slave draws wages + food, working a building or not. So the bill is
    // 5 slaves' worth (25 dr over 5 days), NOT the 2 the estate staffs (which would be 10).
    playerId = await freshPlayer(500, "landowner", { slave: 5 });
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0)); // T1 active T0+1, staffs 2

    const collected = await m.buildings.collect(c, new Date(T0 + 6 * DAY)); // 5 whole staffed days
    expect(collected.idled).toEqual([]); // 5 owned ≥ 2 required → fully staffed, not idled
    expect(collected.staffUpkeep).toBe(25); // 5 owned × 1 dr/day × 5 days (required-only would be 10)
    expect(collected.foodDrawn + collected.foodBought).toBe(25); // all 5 are fed each day
    expect(collected.owed).toBe(0); // the estate's income + grain cover the bill
  });

  it("(e) owning pops with NO staffed building still runs the wages + food clock from when they were hired", async () => {
    // The edge case: hire pops, build nothing. Wages + food are charged anyway — hiring
    // means paying and feeding them, idle or not. With no building completion to anchor
    // the first settle, it falls back to the pops' createdAt (set to T0 so the simulated
    // clock applies).
    playerId = await freshPlayer(500, "landowner", {}); // empty purse-staffing: no pops, no building
    await db.insert(m.dbPkg.playerPops).values({ worldId, ownerPlayerId: playerId, popType: "slave", count: 3, createdAt: new Date(T0) });
    const c = await ctx();

    const view = await m.buildings.mine("landowner", c, new Date(T0 + 5 * DAY));
    expect(view.buildings).toHaveLength(0); // owns no buildings at all

    const collected = await m.buildings.collect(c, new Date(T0 + 5 * DAY));
    expect(collected.income).toBe(0); // earns nothing
    expect(collected.collected).toBe(0); // no income, no building upkeep
    expect(collected.staffUpkeep).toBe(15); // 3 slaves × 1 dr/day × 5 days, anchored at hire time (T0)
    expect(collected.foodBought).toBe(15); // grows no grain → all 15 food auto-bought
    expect(collected.foodCost).toBeGreaterThan(0); // wallet paid for the food
    expect(collected.owed).toBe(0); // 500 dr covers wages + food
    expect(await wallet()).toBe(500 - collected.staffUpkeep - collected.foodCost); // debited, never negative
  });

  // --- Upgrade-in-progress earns the PRIOR tier (Option A) -------------------

  it("(U1) an upgrade-in-progress keeps earning its PRIOR tier's income during construction (not 0)", async () => {
    playerId = await freshPlayer(5000, "trader"); // default pops cover the emporion's staffing
    const c = await ctx();
    await m.buildings.build("trader", c, "emporion", new Date(T0)); // Market Stall T1, completes T0+1
    await m.buildings.collect(c, new Date(T0 + 2 * DAY)); // T1 active; income marker → T0+2
    await m.buildings.upgrade(c, "emporion", new Date(T0 + 2 * DAY)); // → T2 (Counting House), completes T0+4

    // Mid-construction read at T0+3: the prior tier (T1) is still operating.
    const at = new Date(T0 + 3 * DAY);
    const view = await m.buildings.mine("trader", c, at);
    const emp = view.buildings.find((b) => b.id === "emporion")!;
    expect(emp.status).toBe("constructing");
    expect(emp.income).toBeGreaterThan(0); // the fix: prior-tier income, not 0

    // Exactly T1 rate × 1 day × the season's yearround coefficient (prior tier, no guard).
    const content = m.buildings.getBuildingsContent();
    const t1 = buildingYield(content.classBuildings.trader!.income!, 1);
    const coeff = coeffFor(content.seasonal, "yearround", seasonAt(T0 + 3 * DAY, T0)).production;
    const expected = t1 * 1 * coeff;
    expect(emp.income).toBeCloseTo(expected, 2); // mine() display rate
    const collected = await m.buildings.collect(c, at);
    expect(collected.income).toBeCloseTo(expected, 2); // collect applies the SAME amount (projection == actual)
  });

  it("(U2) a window straddling completesAt splits: PRIOR rate before, NEW rate after, each with its own season", async () => {
    playerId = await freshPlayer(5000, "trader");
    const c = await ctx();
    await m.buildings.build("trader", c, "emporion", new Date(T0)); // T1 completes T0+1
    await m.buildings.collect(c, new Date(T0 + 6 * DAY)); // income marker → T0+6
    await m.buildings.upgrade(c, "emporion", new Date(T0 + 6 * DAY)); // → T2, completes T0+8 (buildMs(2)=2d)

    // Collect at T0+14: window [T0+6, T0+14] straddles completion (T0+8) AND a season
    // boundary. Prior segment [T0+6,T0+8] = 2d; new segment [T0+8,T0+14] = 6d (past the
    // 3-day guard → seasonal). The two segments fall in DIFFERENT seasons.
    const at = new Date(T0 + 14 * DAY);
    const content = m.buildings.getBuildingsContent();
    const priorRate = buildingYield(content.classBuildings.trader!.income!, 1);
    const newRate = buildingYield(content.classBuildings.trader!.income!, 2);
    const priorCoeff = coeffFor(content.seasonal, "yearround", seasonAt(T0 + 8 * DAY, T0)).production; // Winter
    const newCoeff = coeffFor(content.seasonal, "yearround", seasonAt(T0 + 14 * DAY, T0)).production; // Summer
    expect(priorCoeff).not.toBe(newCoeff); // the test is only meaningful if the seasons differ
    const expectedSplit = priorRate * 2 * priorCoeff + newRate * 6 * newCoeff;
    const expectedSingleSeason = (priorRate * 2 + newRate * 6) * newCoeff; // the WRONG one-rate-for-the-window answer

    const projected = (await m.buildings.mine("trader", c, at)).pendingIncomeTotal; // mine() projection
    const collected = await m.buildings.collect(c, at);
    expect(collected.income).toBeCloseTo(expectedSplit, 1); // split with the right coeff per segment
    expect(collected.income).not.toBeCloseTo(expectedSingleSeason, 1); // NOT one season for the whole window
    expect(projected).toBeCloseTo(collected.income, 4); // mine() projection == what collect applied
  });

  it("(U3) a fresh tier-1 build still earns 0 while constructing (no prior tier)", async () => {
    playerId = await freshPlayer(5000, "trader");
    const c = await ctx();
    await m.buildings.build("trader", c, "emporion", new Date(T0)); // T1, completes T0+1
    const at = new Date(T0 + DAY / 2); // before completion
    const view = await m.buildings.mine("trader", c, at);
    const emp = view.buildings.find((b) => b.id === "emporion")!;
    expect(emp.status).toBe("constructing");
    expect(emp.income).toBe(0); // no prior tier → nothing yet
    const collected = await m.buildings.collect(c, at);
    expect(collected.income).toBe(0);
  });

  it("(U4) prior-tier GOODS also accrue during an upgrade (estate grain keeps flowing)", async () => {
    playerId = await freshPlayer(5000, "landowner"); // estate yields grain at T1
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0)); // T1 completes T0+1
    await m.buildings.collect(c, new Date(T0 + 2 * DAY)); // bank T1 grain; markers → T0+2
    await m.buildings.upgrade(c, "estate", new Date(T0 + 2 * DAY)); // → T2, completes T0+4
    const grainBefore = await goodBalance("grain");
    // Mid-construction collect: the prior tier (T1) keeps producing grain.
    const collected = await m.buildings.collect(c, new Date(T0 + 3 * DAY));
    expect(collected.banked.grain ?? 0).toBeGreaterThan(0); // prior-tier goods flow during the upgrade
    expect(await goodBalance("grain")).toBeGreaterThan(grainBefore);
  });

  // --- Phase 3: construction spend (materials + drachmae) + hiring -----------

  it("(P3a) build is rejected — and nothing mutated — when drachmae, materials, OR pops are short", async () => {
    const noBuilding = async () => (await db.select().from(m.dbPkg.playerBuildings).where(eq(m.dbPkg.playerBuildings.ownerPlayerId, playerId))).length === 0;

    // (i) Insufficient drachmae: estate T1 costs 100; give 50. Materials + slaves are present.
    playerId = await freshPlayer(50, "landowner");
    let c = await ctx();
    const poorWallet = await m.buildings.build("landowner", c, "estate", new Date(T0));
    expect(poorWallet.ok).toBe(false);
    if (!poorWallet.ok) expect(poorWallet.code).toBe(402);
    expect(await wallet()).toBe(50); // not debited
    expect(await goodBalance("timber")).toBe(500); // materials untouched
    expect(await noBuilding()).toBe(true); // no row created (rolled back)

    // (ii) Insufficient materials: plenty of drachmae + slaves, but no timber/stone.
    playerId = await freshPlayer(1000, "landowner", { slave: 10, freeman: 10, citizen: 10 }, {});
    c = await ctx();
    const noMats = await m.buildings.build("landowner", c, "estate", new Date(T0));
    expect(noMats.ok).toBe(false);
    if (!noMats.ok) expect(noMats.code).toBe(402);
    expect(await wallet()).toBe(1000); // drachmae NOT debited despite being sufficient
    expect(await noBuilding()).toBe(true);

    // (iii) Insufficient pops: plenty of drachmae + materials, but no slaves.
    playerId = await freshPlayer(1000, "landowner", {});
    c = await ctx();
    const noPops = await m.buildings.build("landowner", c, "estate", new Date(T0));
    expect(noPops.ok).toBe(false);
    if (!noPops.ok) expect(noPops.code).toBe(409); // own-staff prerequisite
    expect(await wallet()).toBe(1000); // nothing debited
    expect(await goodBalance("timber")).toBe(500);
    expect(await noBuilding()).toBe(true);
  });

  it("(P3b) happy build debits drachmae + exactly the right materials, creates the building, consumes NO pops", async () => {
    playerId = await freshPlayer(100, "landowner"); // estate T1: 100dr, {timber:8, stone:6}, needs 2 slaves owned
    const c = await ctx();
    const slavesBefore = await popBalance("slave"); // 2 (default = estate T1 staffing)

    const built = await m.buildings.build("landowner", c, "estate", new Date(T0));
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.cost).toBe(100);
      expect(built.materials).toEqual({ timber: 8, stone: 6 }); // T1 material bill (content-driven)
    }
    expect(await wallet()).toBe(0); // 100 − 100
    expect(await goodBalance("timber")).toBe(492); // 500 − 8
    expect(await goodBalance("stone")).toBe(494); // 500 − 6
    expect(await popBalance("slave")).toBe(slavesBefore); // pops are a prerequisite, NOT consumed
    const rows = await db.select().from(m.dbPkg.playerBuildings).where(eq(m.dbPkg.playerBuildings.ownerPlayerId, playerId));
    expect(rows).toHaveLength(1);
  });

  it("(P3c) upgrade debits the SCALED material cost and enforces the higher staff requirement", async () => {
    // Estate T1→T2 scales materials by 1.8×: timber 8→14, stone 6→11 (rounded). T2
    // still needs 2 slaves. Build with 2 slaves, then check the upgrade prereq bites
    // when short, and the scaled spend when met.
    playerId = await freshPlayer(1000, "landowner", { slave: 2 });
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0)); // T1: 100dr, 8 timber, 6 stone
    const timberAfterBuild = await goodBalance("timber"); // 492
    const stoneAfterBuild = await goodBalance("stone"); // 494
    const walletAfterBuild = await wallet(); // 900

    const up = await m.buildings.upgrade(c, "estate", new Date(T0 + 2 * DAY));
    expect(up.ok).toBe(true);
    if (up.ok) {
      expect(up.tier).toBe(2);
      expect(up.cost).toBe(250); // buildingCost(2)
      expect(up.materials).toEqual({ timber: 14, stone: 11 }); // 8×1.8=14.4→14, 6×1.8=10.8→11
    }
    expect(await wallet()).toBe(walletAfterBuild - 250);
    expect(await goodBalance("timber")).toBe(timberAfterBuild - 14);
    expect(await goodBalance("stone")).toBe(stoneAfterBuild - 11);

    // Now a tier whose staff need exceeds the pool: lose a slave, the T2→T3 upgrade
    // (needs 3 slaves) is rejected on the staffing prerequisite — nothing mutated.
    await db.update(m.dbPkg.playerPops).set({ count: 2 }).where(and(eq(m.dbPkg.playerPops.ownerPlayerId, playerId), eq(m.dbPkg.playerPops.popType, "slave")));
    const walletBefore = await wallet();
    const timberBefore = await goodBalance("timber");
    const blocked = await m.buildings.upgrade(c, "estate", new Date(T0 + 10 * DAY)); // T2 active (completes T0+4)
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe(409); // T3 needs 3 slaves, own 2
    expect(await wallet()).toBe(walletBefore); // not debited
    expect(await goodBalance("timber")).toBe(timberBefore); // materials untouched
    const row = (await db.select().from(m.dbPkg.playerBuildings).where(eq(m.dbPkg.playerBuildings.ownerPlayerId, playerId)).limit(1))[0]!;
    expect(row.tier).toBe(2); // still T2 — upgrade rolled back
  });

  it("(P3d) hire debits hireCost × N and increments the pop count; rejected when the wallet is short", async () => {
    // slave hireCost is 49 (content). Hire 2 → 98 dr, +2 slaves.
    playerId = await freshPlayer(100, "landowner", {}); // start with no slaves
    const c = await ctx();
    expect(await popBalance("slave")).toBe(0);

    const hired = await m.buildings.hirePops(c, "slave", 2, new Date(T0));
    expect(hired.ok).toBe(true);
    if (hired.ok) {
      expect(hired.unitCost).toBe(49); // from pops.json
      expect(hired.total).toBe(98);
      expect(hired.owned).toBe(2);
    }
    expect(await wallet()).toBe(2); // 100 − 98
    expect(await popBalance("slave")).toBe(2);

    // Hiring again increments the existing row (not a duplicate); rejected when short.
    const broke = await m.buildings.hirePops(c, "slave", 1, new Date(T0)); // needs 49, have 2
    expect(broke.ok).toBe(false);
    if (!broke.ok) expect(broke.code).toBe(402);
    expect(await wallet()).toBe(2); // unchanged
    expect(await popBalance("slave")).toBe(2); // unchanged

    const rows = await db.select().from(m.dbPkg.playerPops).where(and(eq(m.dbPkg.playerPops.ownerPlayerId, playerId), eq(m.dbPkg.playerPops.popType, "slave")));
    expect(rows).toHaveLength(1); // single row, count incremented in place
  });

  it("(P3e) dismiss decrements the owned count (no refund) and the upkeep drops on the NEXT settle", async () => {
    // Own 3 slaves but build an estate that staffs 2. The first collect charges all 3
    // (owned-based wages). Dismiss 2 — no refund, the wallet is untouched by the act —
    // and the next collect charges only the 1 that remains.
    playerId = await freshPlayer(500, "landowner", { slave: 3 });
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0)); // T1 active T0+1, staffs 2

    const first = await m.buildings.collect(c, new Date(T0 + 6 * DAY)); // 5 whole days × 3 slaves
    expect(first.staffUpkeep).toBe(15); // 3 owned × 1 dr/day × 5 days

    // Dismiss 2 slaves: count floors toward 0, no drachmae refunded.
    const walletBefore = await wallet();
    const res = await m.buildings.dismissPops(c, "slave", 2, new Date(T0 + 6 * DAY));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.dismissed).toBe(2);
      expect(res.owned).toBe(1); // 3 − 2
    }
    expect(await popBalance("slave")).toBe(1); // decremented in place
    expect(await wallet()).toBe(walletBefore); // NO refund — dismissing is a sunk cost

    // Next settle charges only the 1 remaining slave (upkeep dropped from 15 → 5).
    const second = await m.buildings.collect(c, new Date(T0 + 11 * DAY)); // another 5 whole days
    expect(second.staffUpkeep).toBe(5); // 1 owned × 1 dr/day × 5 days
    expect(second.staffUpkeep).toBeLessThan(first.staffUpkeep);
  });

  it("(P3f) dismissing MORE than you own is rejected — nothing mutated", async () => {
    playerId = await freshPlayer(500, "landowner", { slave: 2 }); // own 2
    const c = await ctx();
    const tooMany = await m.buildings.dismissPops(c, "slave", 5, new Date(T0));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.code).toBe(409);
    expect(await popBalance("slave")).toBe(2); // unchanged

    // Dismissing a type you own none of is likewise rejected.
    const none = await m.buildings.dismissPops(c, "citizen", 1, new Date(T0));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.code).toBe(409);
  });

  // --- Phase 4: NPC market (all goods) + People surface + craft --------------

  it("(P4-A) the NPC market trades EVERY vendor good generically — iron + naval-supplies, at vendorUnitPrice (ceiling buy / floor sell)", async () => {
    const content = m.buildings.getBuildingsContent();
    const season = seasonAt(T0, T0); // world started at T0 → opening Winter
    playerId = await freshPlayer(500, "landowner"); // materials seeded (iron 500)
    const c = await ctx();

    // SELL iron at the seasonal FLOOR (the price comes straight from vendorUnitPrice).
    const ironFloor = vendorUnitPrice(content.vendor.iron!, "sell", content.seasonal, goodCategoryFor(content.seasonal, "iron"), season);
    const sell = await m.buildings.vendorTrade(c, "sell", "iron", 10, new Date(T0));
    expect(sell.ok).toBe(true);
    if (sell.ok) {
      expect(sell.unitPrice).toBe(ironFloor);
      expect(sell.total).toBe(ironFloor * 10);
    }
    expect(await goodBalance("iron")).toBe(490);

    // BUY naval-supplies at the seasonal CEILING (a Phase-2 craft input good, fully tradeable).
    const navalCeiling = vendorUnitPrice(content.vendor["naval-supplies"]!, "buy", content.seasonal, goodCategoryFor(content.seasonal, "naval-supplies"), season);
    const buy = await m.buildings.vendorTrade(c, "buy", "naval-supplies", 2, new Date(T0));
    expect(buy.ok).toBe(true);
    if (buy.ok) {
      expect(buy.unitPrice).toBe(navalCeiling);
      expect(buy.unitPrice).toBeGreaterThan(ironFloor); // ceiling > floor, generically
    }
    expect(await goodBalance("naval-supplies")).toBe(2);
  });

  it("(P4-B) the People market lists all three pop types with the content numbers", () => {
    const view = m.buildings.listPops();
    expect(view.foodGood).toBe("grain");
    expect(view.pops.map((p) => p.type).sort()).toEqual(["citizen", "freeman", "slave"]);
    const slave = view.pops.find((p) => p.type === "slave")!;
    expect(slave).toMatchObject({ label: "Slave", dismissLabel: "Free / Sell", hireCost: 49, upkeepPerDay: 1, foodPerDay: 1, civic: false });
    const citizen = view.pops.find((p) => p.type === "citizen")!;
    expect(citizen).toMatchObject({ label: "Citizen", dismissLabel: "Release", hireCost: 84, upkeepPerDay: 3, foodPerDay: 1, civic: true });
  });

  it("(P4-C0) every craft recipe is cheaper to make than to buy: craftRawCost < the good's vendor sell", () => {
    const content = m.buildings.getBuildingsContent();
    for (const [good, recipe] of Object.entries(content.craft ?? {})) {
      expect(craftRawCost(recipe.recipe, content.vendor)).toBeLessThan(content.vendor[good]!.sell);
    }
  });

  it("(P4-C) craft is gated by building+tier, consumes the recipe atomically, credits the good; rolls back on a shortfall", async () => {
    // A non-shipbuilder owns no slipway → 403.
    playerId = await freshPlayer(100, "landowner");
    let c = await ctx();
    const noYard = await m.buildings.craft(c, "trade-ship", new Date(T0));
    expect(noYard.ok).toBe(false);
    if (!noYard.ok) expect(noYard.code).toBe(403);

    // A shipbuilder with only a tier-1 slipway is under tier (trade-ship needs T3) → 409,
    // and nothing is consumed. Seed 2 freemen — the slipway's T3 staffing prerequisite.
    playerId = await freshPlayer(2000, "shipbuilder", { freeman: 2 });
    c = await ctx();
    await m.buildings.build("shipbuilder", c, "slipway", new Date(T0));
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: playerId, type: "naval-supplies", amount: "10", ratePerSecond: "0", lastUpdatedAt: new Date(T0) });
    const navalBefore = await goodBalance("naval-supplies");
    const underTier = await m.buildings.craft(c, "trade-ship", new Date(T0 + DAY));
    expect(underTier.ok).toBe(false);
    if (!underTier.ok) expect(underTier.code).toBe(409);
    expect(await goodBalance("naval-supplies")).toBe(navalBefore); // nothing consumed

    // Take the slipway to T3, then craft a trade-ship: consumes EXACTLY the recipe
    // {naval-supplies:2, timber:5, leather:1} and credits one trade-ship.
    await m.buildings.upgrade(c, "slipway", new Date(T0 + 2 * DAY)); // → T2 (completes T0+4)
    await m.buildings.upgrade(c, "slipway", new Date(T0 + 6 * DAY)); // → T3 (completes T0+10)
    const timberBefore = await goodBalance("timber");
    const leatherBefore = await goodBalance("leather");
    const crafted = await m.buildings.craft(c, "trade-ship", new Date(T0 + 20 * DAY));
    expect(crafted.ok).toBe(true);
    if (crafted.ok) {
      expect(crafted.consumed).toEqual({ "naval-supplies": 2, timber: 5, leather: 1 });
      expect(crafted.balance).toBe(1);
    }
    expect(await goodBalance("trade-ship")).toBe(1);
    expect(await goodBalance("naval-supplies")).toBe(navalBefore - 2);
    expect(await goodBalance("timber")).toBe(timberBefore - 5);
    expect(await goodBalance("leather")).toBe(leatherBefore - 1);

    // Rollback proof: drain naval-supplies, craft again → 402 and NOTHING consumed
    // (validate-before-write — timber is untouched even though it was sufficient).
    await db.update(m.dbPkg.resources).set({ amount: "0" }).where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, "naval-supplies")));
    const timberNow = await goodBalance("timber");
    const short = await m.buildings.craft(c, "trade-ship", new Date(T0 + 21 * DAY));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.code).toBe(402);
    expect(await goodBalance("timber")).toBe(timberNow); // not consumed on the failed craft
    expect(await goodBalance("trade-ship")).toBe(1); // still just the one
  });

  it("(P5) catalog + mine expose the additive Phase 5 fields from content + player_pops", async () => {
    const c = await ctx(); // default landowner, owns its estate T1 staffing (slave: 2)
    const cat = m.buildings.catalog("landowner", c, new Date(T0));

    // goodLabels straight from content (IDs stay stable; names come from goodLabels).
    expect(cat.goodLabels.grain).toBe("Wheat");
    expect(cat.goodLabels.timber).toBe("Wood");

    // Per-tier material bill + staffing on the class line, scaled by the shared helpers.
    const t1 = cat.classBuilding!.tiers.find((t) => t.tier === 1)!;
    const t2 = cat.classBuilding!.tiers.find((t) => t.tier === 2)!;
    expect(t1.materials).toEqual({ timber: 8, stone: 6 }); // T1 base bill
    expect(t1.staffing).toEqual({ slave: 2 });
    expect(t2.materials).toEqual({ timber: 14, stone: 11 }); // 8×1.8→14, 6×1.8→11

    // Craft recipes from content.craft.
    expect(cat.craft["trade-ship"]).toEqual({ building: "slipway", tier: 3, recipe: { "naval-supplies": 2, timber: 5, leather: 1 } });

    // Owned pop counts on mine, from player_pops (the default seeds the estate's T1 staffing).
    const mineV = await m.buildings.mine("landowner", c, new Date(T0));
    expect(mineV.pops).toMatchObject({ slave: 2 });
  });
});
