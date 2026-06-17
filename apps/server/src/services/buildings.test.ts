import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";

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

  // Phase 2: buildings now need staff (pops) to produce. By default seed a generous
  // shared pool so existing production scenarios stay staffed; pass `pops` to control
  // staffing precisely (e.g. {} to force under-staffing).
  async function freshPlayer(drachmae = 100, classId = "landowner", pops: Record<string, number> = { slave: 10, freeman: 10, citizen: 10 }) {
    const { users, players, playerCharacters, playerPops } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "P", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, drachmae, startAge: 30, deathAge: 90 });
    for (const [popType, count] of Object.entries(pops)) {
      if (count > 0) await db.insert(playerPops).values({ worldId, ownerPlayerId: player.id, popType, count });
    }
    return player.id;
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

  it("(a) staff wages + food are a real cost: the shipbuilder's cash income alone can't cover its crew → owed > 0", async () => {
    // The slipway needs 2 freemen (4 dr/day wages) and feeds them (2 food/day, bought
    // from the NPC since it grows no grain). That daily cost exceeds its 8.4 dr/day
    // cash income — the shipbuilder must SELL its naval-supplies to come out ahead.
    playerId = await freshPlayer(100, "shipbuilder"); // plenty of freemen to staff it
    const c = await ctx();
    await m.buildings.build("shipbuilder", c, "slipway", new Date(T0));
    expect(await wallet()).toBe(0);

    // Collect a long window with an empty purse: income is banked, then staff wages +
    // food eat all of it and more — the shortfall is forgiven as `owed`.
    const collected = await m.buildings.collect(c, new Date(T0 + 12 * DAY));
    expect(collected.staffUpkeep).toBeGreaterThan(0); // crew wages charged
    expect(collected.income).toBeGreaterThan(0); // gross cash income is positive…
    // …yet staffing (wages + food) exceeds it, so net wallet is 0 and a shortfall is owed.
    expect(collected.staffUpkeep + collected.foodCost).toBeGreaterThan(collected.income);
    expect(collected.owed).toBeGreaterThan(0);
    expect(await wallet()).toBe(0); // never negative
    expect(collected.banked["naval-supplies"]).toBeGreaterThan(0); // it still produced goods to sell
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
    // A landowner with NO pops can't staff the estate. Take it to T2 (upkeep 1 dr/day),
    // then it idles: zero grain, zero income, but the flat building upkeep still bites.
    playerId = await freshPlayer(400, "landowner", {}); // no pops at all
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    const up = await m.buildings.upgrade(c, "estate", new Date(T0 + 5 * DAY)); // → T2, completes T0+7
    expect(up.ok).toBe(true);

    // The Ledger shows it idled: produces nothing, but its building upkeep is unchanged.
    const view = await m.buildings.mine("landowner", c, new Date(T0 + 10 * DAY));
    const estate = view.buildings.find((b) => b.id === "estate")!;
    expect(estate.idle).toBe(true);
    expect(estate.yields).toEqual([]);
    expect(estate.income).toBe(0);
    expect(estate.upkeepPerDay).toBe(1); // T2 building upkeep — still owed

    // Collecting confirms it: no goods, no income, no staff cost (it idled), yet
    // building upkeep was charged.
    const collected = await m.buildings.collect(c, new Date(T0 + 10 * DAY));
    expect(Object.keys(collected.banked)).toHaveLength(0); // produced nothing
    expect(collected.income).toBe(0);
    expect(collected.staffUpkeep).toBe(0); // idled → no crew to pay
    expect(collected.upkeep).toBeGreaterThan(0); // building upkeep still owed
    expect(collected.idled).toContain("estate");
  });
});
