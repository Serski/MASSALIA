import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The player market (market prompt 1) — integration tests against a REAL
// Postgres, guarded to a *_test database (mirrors buildings.test.ts). Three
// players: a Landowner seller (taxed), a Trader seller (exempt) and a buyer.
// Exercises escrow, the stall cap, settlement with the agora tax, every refusal,
// partial and full buys, cancel, and two buyers racing for the last unit.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const NOW = new Date(T0 + DAY);
const RACE_RUNS = 10;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const market = await import("./market.js");
  const age = await import("./age.js");
  return { dbPkg, buildings, market, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Player market (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let landowner: string;
  let trader: string;
  let buyer: string;

  async function freshPlayer(name: string, classId: string, drachmae: number, goods: Record<string, number> = {}) {
    const { users, players, playerCharacters, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, drachmae, startAge: 30, deathAge: 90, avatarId: "avatar-30-1" });
    for (const [type, amount] of Object.entries(goods)) {
      await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: new Date(T0) });
    }
    return player.id;
  }

  const ctx = async (playerId: string) => (await m.buildings.buildingContext(playerId, worldId))!;
  async function wallet(playerId: string) {
    const rows = await db.select({ drachmae: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)).limit(1);
    return rows[0]!.drachmae;
  }
  async function stock(playerId: string, type: string) {
    const { resources } = m.dbPkg;
    const rows = await db.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId), eq(resources.type, type))).limit(1);
    return Number(rows[0]?.amount ?? 0);
  }
  async function treasury() {
    const rows = await db.select().from(m.dbPkg.worldTreasury).where(eq(m.dbPkg.worldTreasury.worldId, worldId)).limit(1);
    return rows[0]?.balance ?? 0;
  }
  async function listing(id: string) {
    return (await db.select().from(m.dbPkg.marketListings).where(eq(m.dbPkg.marketListings.id, id)).limit(1))[0]!;
  }
  async function listingCount() {
    return (await db.select().from(m.dbPkg.marketListings)).length;
  }
  async function effectRows() {
    return db.select().from(m.dbPkg.effectLog);
  }
  async function houseName() {
    return (await db.select({ name: m.dbPkg.houses.name }).from(m.dbPkg.houses).where(eq(m.dbPkg.houses.slug, "test-house")).limit(1))[0]!.name;
  }
  async function list(playerId: string, good: string, qty: number, price: number) {
    const res = await m.market.listGood(await ctx(playerId), good, qty, price, NOW);
    if (!res.ok) throw new Error(`list failed: ${res.error}`);
    return res.listing.id;
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.age.loadAgeConfig();
    await (await import("./barracks.js")).loadBarracksContent(); // collect settles the barracks too
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE market_listings, world_treasury, player_buildings, player_pops, resources, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Market Test", seed: "mtest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
    landowner = await freshPlayer("Kallias", "landowner", 0, { wine: 50 });
    trader = await freshPlayer("Deon", "trader", 0, { wine: 50 });
    buyer = await freshPlayer("Nikias", "hoplite", 1000);
  });

  // --- list -------------------------------------------------------------------

  it("list escrows the stock at once, and a later settle does not restore it", async () => {
    const res = await m.market.listGood(await ctx(landowner), "wine", 20, 9, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.balance).toBe(30);
    expect(await stock(landowner, "wine")).toBe(30);
    const row = await listing(res.listing.id);
    expect(row).toMatchObject({ worldId, sellerPlayerId: landowner, good: "wine", remaining: 20, price: 9, closedAt: null });

    await m.buildings.collect(await ctx(landowner), new Date(NOW.getTime() + DAY));
    expect(await stock(landowner, "wine")).toBe(30);
  });

  it("list refuses an over-stock quantity (409, nothing written), an unknown good and a pop type (404)", async () => {
    const short = await m.market.listGood(await ctx(landowner), "wine", 51, 9, NOW);
    expect(short).toEqual({ ok: false, code: 409, error: "You hold only 50 wine." });
    expect(await stock(landowner, "wine")).toBe(50);
    expect(await listingCount()).toBe(0);

    expect(await m.market.listGood(await ctx(landowner), "ambrosia", 1, 9, NOW)).toMatchObject({ ok: false, code: 404 });
    expect(await m.market.listGood(await ctx(landowner), "slave", 1, 9, NOW)).toMatchObject({ ok: false, code: 404 });
    expect(await listingCount()).toBe(0);
  });

  it("list rejects out-of-bounds or fractional quantities and prices (400)", async () => {
    const c = await ctx(landowner);
    for (const [qty, price] of [[0, 9], [1001, 9], [1.5, 9], [1, 0], [1, 10_001], [1, 2.5]] as const) {
      expect(await m.market.listGood(c, "wine", qty, price, NOW)).toMatchObject({ ok: false, code: 400 });
    }
    expect(await listingCount()).toBe(0);
  });

  it("holds ten open stalls at most: the 11th is 409", async () => {
    for (let i = 0; i < 10; i++) await list(landowner, "wine", 1, 9 + i);
    const eleventh = await m.market.listGood(await ctx(landowner), "wine", 1, 9, NOW);
    expect(eleventh).toEqual({ ok: false, code: 409, error: "Ten stalls is the most one house may keep." });
    expect(await listingCount()).toBe(10);
    expect(await stock(landowner, "wine")).toBe(40);
    expect((await m.market.marketView(await ctx(landowner), NOW)).open).toBe(10);
  });

  // --- view -------------------------------------------------------------------

  it("the view lists open stalls by good, price, age, with the seller's facts", async () => {
    const a = await list(landowner, "wine", 5, 12);
    const b = await list(trader, "wine", 5, 8);
    const view = await m.market.marketView(await ctx(buyer), NOW);
    expect(view.listings.map((l) => l.id)).toEqual([b, a]);
    expect(view.open).toBe(0);
    expect(view.cap).toBe(10);
    expect(view.taxExempt).toBe(false);
    const seller = view.listings[1]!.seller;
    expect(seller).toMatchObject({ playerId: landowner, name: "Kallias", houseSlug: "test-house", houseName: await houseName() });
    expect(seller.portrait).toMatch(/^\/portraits\//);
    expect((await m.market.marketView(await ctx(trader), NOW)).taxExempt).toBe(true);
    expect((await m.market.marketView(await ctx(trader), NOW)).listings.find((l) => l.id === b)!.mine).toBe(true);
  });

  // --- buy --------------------------------------------------------------------

  it("a buy moves the goods, pays the seller total − tax, taxes into the treasury and writes both trade rows", async () => {
    const id = await list(landowner, "wine", 20, 9);
    const res = await m.market.buyListing(await ctx(buyer), id, 5, NOW);
    expect(res).toEqual({ ok: true, qty: 5, total: 45, tax: 4, wallet: 955, balance: 5, remaining: 15 });
    expect(await stock(buyer, "wine")).toBe(5);
    expect(await wallet(buyer)).toBe(955);
    expect(await wallet(landowner)).toBe(41);
    expect(await treasury()).toBe(4);

    // Partial buy: the stall stays open with the rest.
    const row = await listing(id);
    expect(row.remaining).toBe(15);
    expect(row.closedAt).toBeNull();

    const house = await houseName();
    const detail = {
      listingId: id,
      good: "wine",
      goodLabel: "Wine",
      qty: 5,
      price: 9,
      total: 45,
      tax: 4,
      net: 41,
      sellerName: "Kallias",
      sellerHouseName: house,
      buyerName: "Nikias",
      buyerHouseName: house,
      source: "market",
    };
    const rows = await effectRows();
    const characterOf = async (playerId: string) =>
      (await db.select({ id: m.dbPkg.playerCharacters.id }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)).limit(1))[0]!.id;
    const sale = rows.find((r) => r.kind === "market_sale")!;
    const purchase = rows.find((r) => r.kind === "market_purchase")!;
    expect(rows).toHaveLength(2);
    expect(sale.characterId).toBe(await characterOf(landowner));
    expect(purchase.characterId).toBe(await characterOf(buyer));
    expect(sale.detail).toEqual(detail);
    expect(purchase.detail).toEqual(detail);
    expect(sale.detail).not.toHaveProperty("chronicle");
    expect(purchase.detail).not.toHaveProperty("chronicle");
  });

  it("a Trader seller receives the full total and the treasury is unchanged", async () => {
    const id = await list(trader, "wine", 20, 9);
    const res = await m.market.buyListing(await ctx(buyer), id, 5, NOW);
    expect(res).toMatchObject({ ok: true, total: 45, tax: 0 });
    expect(await wallet(trader)).toBe(45);
    expect(await treasury()).toBe(0);
    expect((await effectRows()).find((r) => r.kind === "market_sale")!.detail).toMatchObject({ tax: 0, net: 45 });
  });

  it("buy refuses the seller's own stall (409), a short wallet (402, nothing written) and more than remains (409)", async () => {
    const id = await list(landowner, "wine", 20, 90);
    expect(await m.market.buyListing(await ctx(landowner), id, 1, NOW)).toEqual({ ok: false, code: 409, error: "That is your own stall. Cancel it instead." });

    const pricey = await m.market.buyListing(await ctx(buyer), id, 12, NOW); // 1080 > 1000
    expect(pricey).toEqual({ ok: false, code: 402, error: "You need 1080 drachmae for that." });
    expect((await listing(id)).remaining).toBe(20);
    expect(await wallet(buyer)).toBe(1000);
    expect(await wallet(landowner)).toBe(0);
    expect(await stock(buyer, "wine")).toBe(0);
    expect(await treasury()).toBe(0);
    expect(await effectRows()).toHaveLength(0);

    expect(await m.market.buyListing(await ctx(buyer), id, 21, NOW)).toEqual({ ok: false, code: 409, error: "Only 20 remain at that stall." });
    expect(await m.market.buyListing(await ctx(buyer), id, 0, NOW)).toMatchObject({ ok: false, code: 400 });
  });

  it("a full buy closes the stall; a buy on a closed stall is 404", async () => {
    const id = await list(landowner, "wine", 3, 10);
    const res = await m.market.buyListing(await ctx(buyer), id, 3, NOW);
    expect(res).toMatchObject({ ok: true, remaining: 0, total: 30, tax: 3 });
    const row = await listing(id);
    expect(row.remaining).toBe(0);
    expect(row.closedAt).not.toBeNull();
    expect(await m.market.buyListing(await ctx(buyer), id, 1, NOW)).toEqual({ ok: false, code: 404, error: "That stall is gone." });
    expect((await m.market.marketView(await ctx(buyer), NOW)).listings).toHaveLength(0);
  });

  // --- cancel -----------------------------------------------------------------

  it("cancel returns the remainder and closes; a second cancel and a buy after it are 404", async () => {
    const id = await list(landowner, "wine", 20, 9);
    await m.market.buyListing(await ctx(buyer), id, 5, NOW);
    expect(await stock(landowner, "wine")).toBe(30);

    expect(await m.market.cancelListing(await ctx(buyer), id, NOW)).toMatchObject({ ok: false, code: 404 }); // not the seller
    const res = await m.market.cancelListing(await ctx(landowner), id, NOW);
    expect(res).toEqual({ ok: true, returned: 15, balance: 45 });
    expect(await stock(landowner, "wine")).toBe(45);
    expect((await listing(id)).closedAt).not.toBeNull();

    expect(await m.market.cancelListing(await ctx(landowner), id, NOW)).toEqual({ ok: false, code: 404, error: "That stall is gone." });
    expect(await m.market.buyListing(await ctx(buyer), id, 1, NOW)).toMatchObject({ ok: false, code: 404 });
    expect(await stock(landowner, "wine")).toBe(45);
  });

  // --- race -------------------------------------------------------------------

  it(`two buyers racing for the last unit: exactly one succeeds, every run (${RACE_RUNS} runs)`, async () => {
    const second = await freshPlayer("Theron", "hoplite", 1000);
    for (let run = 0; run < RACE_RUNS; run++) {
      const id = await list(landowner, "wine", 1, 10);
      const [c1, c2] = [await ctx(buyer), await ctx(second)];
      const results = await Promise.all([m.market.buyListing(c1, id, 1, NOW), m.market.buyListing(c2, id, 1, NOW)]);
      const wins = results.filter((r) => r.ok);
      const losses = results.filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      expect(losses).toEqual([{ ok: false, code: 409, error: "Only 0 remain at that stall." }]);
      expect((await listing(id)).remaining).toBe(0);
    }
    // Stock and money add up across every run.
    expect((await stock(buyer, "wine")) + (await stock(second, "wine"))).toBe(RACE_RUNS);
    expect(await stock(landowner, "wine")).toBe(50 - RACE_RUNS);
    expect((await wallet(buyer)) + (await wallet(second))).toBe(2000 - 10 * RACE_RUNS);
    expect(await wallet(landowner)).toBe(9 * RACE_RUNS);
    expect(await treasury()).toBe(RACE_RUNS);
    expect(await effectRows()).toHaveLength(2 * RACE_RUNS);
  });
});
