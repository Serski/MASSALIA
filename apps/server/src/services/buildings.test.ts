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

  async function freshPlayer(drachmae = 100, classId = "landowner") {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "P", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, drachmae, startAge: 30, deathAge: 90 });
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
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE world_treasury, player_buildings, resources, effect_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
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
    expect(collected.banked.grain).toBeCloseTo(6, 1);
    expect(await goodBalance("grain")).toBeCloseTo(6, 1);
    // T1 upkeep is 0 → wallet untouched, never negative.
    expect(await wallet()).toBe(0);
  });

  it("vendor band trades are atomic (sell grain for floor, buy chicken at ceiling)", async () => {
    const c = await ctx();
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    const t = new Date(T0 + 2 * DAY);
    await m.buildings.collect(c, t); // bank ~6 grain

    const sell = await m.buildings.vendorTrade(c, "sell", "grain", 5, t);
    expect(sell.ok).toBe(true);
    if (sell.ok) {
      expect(sell.total).toBe(sell.unitPrice * 5);
      expect(await wallet()).toBe(sell.total);
      expect(await goodBalance("grain")).toBeCloseTo(1, 1);
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

    // First collect creates the wallet marker (upkeep 0). Drain the purse so the
    // next collect's upkeep would go negative, and confirm it clamps at 0.
    await m.buildings.collect(c, new Date(T0 + 8 * DAY)); // T2 active (completes T0+7d)
    await setWallet(0);
    const collected = await m.buildings.collect(c, new Date(T0 + 28 * DAY));
    expect(collected.upkeep).toBeGreaterThan(0); // ~20 days × 1dr/day
    expect(collected.owed).toBeGreaterThan(0); // shortfall forgiven, not carried as debt
    expect(await wallet()).toBe(0); // never negative
  });

  it("routine consumption: missing good rejects; fee credits the world treasury; waiver zeroes the cost", async () => {
    const c = await ctx();
    // No chicken on hand → an offering (1 chicken) is rejected.
    const missing = await m.buildings.consumeRoutineRequirement(playerId, worldId, { good: { type: "chicken", qty: 1 }, fee: undefined }, new Date(T0));
    expect(missing.ok).toBe(false);

    // Buy a chicken, then the offering succeeds and debits it.
    await m.buildings.build("landowner", c, "estate", new Date(T0));
    await m.buildings.collect(c, new Date(T0 + 2 * DAY));
    await m.buildings.vendorTrade(c, "sell", "grain", 5, new Date(T0 + 2 * DAY));
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
    // Offering income banks into the integer wallet (income 6/day, T1 upkeep 0 → never negative).
    expect(collected.collected).toBeGreaterThanOrEqual(5);
    expect(collected.collected).toBeLessThanOrEqual(7);
    expect(await wallet()).toBe(collected.collected);
    // Herbal banks into resources like grain.
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
});
