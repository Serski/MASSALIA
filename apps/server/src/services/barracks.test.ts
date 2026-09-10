import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Barracks (integration): levy growth, the militia gate, recruit (gear + levy),
// the seeded per-season market, hire (offer + cap + claim), settle (goods from
// stock, shortfall bought at the seasonal price, band drachmae, rows still in
// training free, a row ready mid-gap charged for the post-ready days only),
// insolvency (bands by pay, then trained by cost, men back to the levy),
// contract ends on contract_end_at (seeded renewal) and disband gating by
// elapsed time. Against a REAL Postgres guarded to a *_test database (mirrors
// merc.test.ts). One season = one day on a synthetic clock anchored at T0;
// training and contract timers are durations from the action (0054).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (seasons: number) => new Date(T0 + seasons * DAY);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const shared = await import("@massalia/shared");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const lock = await import("./lock.js");
  return { dbPkg, shared, buildings, barracks, mapGraph, lock };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Barracks (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  type Ctx = { playerId: string; worldId: string; worldStartedMs: number };

  async function makePlayer(opts: { militia?: number; drachmae?: number } = {}): Promise<{ ctx: Ctx; characterId: string }> {
    const { users, players, playerCharacters, dynasties } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Xanthippos-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    const ch = (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: opts.militia ?? 20, drachmae: opts.drachmae ?? 1000, startAge: 30, deathAge: 90 })
        .returning()
    )[0]!;
    return { ctx: { playerId: player.id, worldId, worldStartedMs: T0 }, characterId: ch.id };
  }
  const give = (ctx: Ctx, type: string, amount: number) =>
    db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: ctx.playerId, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: at(0) });
  const giveAll = async (ctx: Ctx, goods: Record<string, number>) => {
    for (const [g, n] of Object.entries(goods)) await give(ctx, g, n);
  };
  const stock = async (ctx: Ctx, type: string) =>
    Number((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, type))))[0]?.amount ?? 0);
  const wallet = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, ctx.playerId)))[0]!.drachmae;
  const levy = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerLevy).where(eq(m.dbPkg.playerLevy.ownerPlayerId, ctx.playerId)))[0];
  const rows = (ctx: Ctx) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt));
  const logs = (characterId: string, kind: string) =>
    db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, characterId), eq(m.dbPkg.effectLog.kind, kind))).orderBy(asc(m.dbPkg.effectLog.createdAt), asc(m.dbPkg.effectLog.id));
  // Run settleBarracks alone, under the player lock, as settleAll would.
  const settle = (ctx: Ctx, season: number) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.barracks.settleBarracks(tx, ctx, at(season));
    });
  const roll = (ctx: Ctx, season: number) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      await m.barracks.rollOffers(tx, ctx, season);
      return m.barracks.offersFor(tx, ctx, season);
    });
  // Insert a roster row directly (createdAt on the synthetic clock, like the
  // service). readyAt / contractEndAt are given in seasons on that clock.
  type RowOpts = { id?: string; source: "trained" | "band"; unitId: string; count: number; recruitedSeason: number; readyAt?: number | null; contractEndAt?: number | null; createdSeason?: number };
  const insertRow = async (ctx: Ctx, o: RowOpts) =>
    (
      await db
        .insert(m.dbPkg.playerUnits)
        .values({
          ...(o.id ? { id: o.id } : {}),
          worldId,
          ownerPlayerId: ctx.playerId,
          source: o.source,
          unitId: o.unitId,
          count: o.count,
          startCount: o.count,
          recruitedSeason: o.recruitedSeason,
          readyAt: o.readyAt == null ? null : at(o.readyAt),
          contractEndAt: o.contractEndAt == null ? null : at(o.contractEndAt),
          createdAt: at(o.createdSeason ?? o.recruitedSeason),
        })
        .returning()
    )[0]!;
  // The vendor "buy" price the settle pays for a short good at a given instant.
  const buyPrice = (good: string, season: number) => {
    const c = m.buildings.getBuildingsContent();
    return m.shared.vendorUnitPrice(c.vendor[good]!, "buy", c.seasonal, m.shared.goodCategoryFor(c.seasonal, good), m.shared.seasonAt(at(season).getTime(), T0));
  };
  // A deterministic uuid whose renewal roll at contract_end_at = at(endSeason)
  // lands where the test needs (the seed is the end timestamp in ms). `not`
  // skips an id already picked for another row (two predicates can overlap).
  const uuidWhere = (endSeason: number, pred: (r: number) => boolean, not?: string): string => {
    for (let i = 0; i < 10_000; i++) {
      const w = m.shared.sha256Words(`barracks-test-${i}`);
      const hex = Array.from(w, (x) => x.toString(16).padStart(8, "0")).join("");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      if (id !== not && pred(m.shared.seededRoll([id, String(at(endSeason).getTime())]))) return id;
    }
    throw new Error("no uuid satisfied the roll predicate");
  };

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE player_units, player_holdings, player_levy, band_offers, effect_log, resources, player_buildings, player_pops, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Barracks Test", seed: "btest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  describe("levy", () => {
    it("a fresh player at season 9 starts with 120 men anchored on season 8", async () => {
      const { ctx } = await makePlayer();
      await settle(ctx, 9);
      expect(await levy(ctx)).toMatchObject({ men: 120, lastGrowthSeason: 8 });
    });

    it("growth accrues closed-form: settled at 3 then at 11 gains exactly 20 (years at 4 and 8); at 12 a third year lands", async () => {
      const { ctx } = await makePlayer();
      await settle(ctx, 3);
      expect(await levy(ctx)).toMatchObject({ men: 100, lastGrowthSeason: 0 });
      await settle(ctx, 11);
      expect(await levy(ctx)).toMatchObject({ men: 120, lastGrowthSeason: 8 });
      await settle(ctx, 12);
      expect(await levy(ctx)).toMatchObject({ men: 130, lastGrowthSeason: 12 });
    });
  });

  describe("gate", () => {
    it("militia 19 refuses recruit and hire with 403; militia 20 succeeds", async () => {
      const low = await makePlayer({ militia: 19 });
      await giveAll(low.ctx, { timber: 50, leather: 50 });
      expect(await m.barracks.recruitUnits(low.ctx, "peltast", 1, at(9))).toMatchObject({ ok: false, code: 403 });
      const offers = await roll(low.ctx, 9);
      expect(await m.barracks.hireBand(low.ctx, offers[0]!.bandId, at(9))).toMatchObject({ ok: false, code: 403 });
      expect(await rows(low.ctx)).toHaveLength(0);

      const ok = await makePlayer({ militia: 20 });
      await giveAll(ok.ctx, { timber: 50, leather: 50 });
      expect(await m.barracks.recruitUnits(ok.ctx, "peltast", 1, at(9))).toMatchObject({ ok: true, unitId: "peltast", count: 1 });
      const offers2 = await roll(ok.ctx, 9);
      expect(await m.barracks.hireBand(ok.ctx, offers2[0]!.bandId, at(9))).toMatchObject({ ok: true, bandId: offers2[0]!.bandId });
    });
  });

  describe("recruit", () => {
    it("debits every gear good, draws the levy and sets ready_at = now + trainSeasons days", async () => {
      const { ctx, characterId } = await makePlayer();
      await giveAll(ctx, { timber: 20, iron: 20, tin: 20 });
      const r = await m.barracks.recruitUnits(ctx, "hoplite", 5, at(9));
      expect(r).toMatchObject({ ok: true, unitId: "hoplite", count: 5, readyAt: at(11).toISOString(), levy: 115 });
      // hoplite gear per man: timber 1, iron 1, tin 2
      expect(await stock(ctx, "timber")).toBe(15);
      expect(await stock(ctx, "iron")).toBe(15);
      expect(await stock(ctx, "tin")).toBe(10);
      expect((await levy(ctx))!.men).toBe(115);
      const row = (await rows(ctx))[0]!;
      expect(row).toMatchObject({ source: "trained", unitId: "hoplite", count: 5, startCount: 5, recruitedSeason: 9, readyAt: at(11), contractEndAt: null, readyAtSeason: null, basedAt: "R060", movingTo: null, arrivesAt: null });
      expect((await logs(characterId, "barracks_recruit")).map((e) => e.detail)).toEqual([{ unitId: "hoplite", count: 5, readyAt: at(11).toISOString(), source: "barracks" }]);
    });

    it("refuses with nothing debited when one gear good is short", async () => {
      const { ctx } = await makePlayer();
      await giveAll(ctx, { timber: 20, iron: 20, tin: 3 }); // 5 hoplites need 10 tin
      const r = await m.barracks.recruitUnits(ctx, "hoplite", 5, at(9));
      expect(r).toMatchObject({ ok: false, code: 409 });
      expect((r as { error: string }).error).toContain("7 tin");
      expect(await stock(ctx, "timber")).toBe(20);
      expect(await stock(ctx, "iron")).toBe(20);
      expect(await stock(ctx, "tin")).toBe(3);
      expect((await levy(ctx))!.men).toBe(120);
      expect(await rows(ctx)).toHaveLength(0);
    });

    it("refuses when the levy cannot spare the men, and a bad count or unit", async () => {
      const { ctx } = await makePlayer();
      await giveAll(ctx, { timber: 9999, leather: 9999 });
      expect(await m.barracks.recruitUnits(ctx, "peltast", 121, at(9))).toMatchObject({ ok: false, code: 409 });
      expect(await m.barracks.recruitUnits(ctx, "peltast", 0, at(9))).toMatchObject({ ok: false, code: 400 });
      expect(await m.barracks.recruitUnits(ctx, "peltast", 1.5, at(9))).toMatchObject({ ok: false, code: 400 });
      expect(await m.barracks.recruitUnits(ctx, "chariot", 1, at(9))).toMatchObject({ ok: false, code: 404 });
      expect(await stock(ctx, "timber")).toBe(9999);
    });
  });

  describe("offers", () => {
    it("rolls exactly 3 a season, identical on a second roll, and never a band under contract", async () => {
      const { ctx } = await makePlayer();
      const first = await roll(ctx, 9);
      expect(first).toHaveLength(3);
      expect(new Set(first.map((o) => o.bandId)).size).toBe(3);
      const second = await roll(ctx, 9);
      expect(second.map((o) => o.bandId)).toEqual(first.map((o) => o.bandId));
      // Hold a band, then roll a fresh season: the held band cannot be offered.
      const held = first[0]!.bandId;
      await insertRow(ctx, { source: "band", unitId: held, count: 20, recruitedSeason: 9, contractEndAt: 11 });
      for (let season = 10; season < 40; season++) {
        const offers = await roll(ctx, season);
        expect(offers).toHaveLength(3);
        expect(offers.map((o) => o.bandId)).not.toContain(held);
      }
    });

    it("the draw is a function of (world, player, season): a second player sees different seasons differently", async () => {
      const a = await makePlayer();
      const b = await makePlayer();
      const s9a = (await roll(a.ctx, 9)).map((o) => o.bandId);
      const s10a = (await roll(a.ctx, 10)).map((o) => o.bandId);
      const s9b = (await roll(b.ctx, 9)).map((o) => o.bandId);
      // Not a strict guarantee for any single pair, but across 3-of-20 draws these
      // three sets coinciding would mean the seed ignored its inputs.
      expect([s9a, s10a, s9b].map((x) => x.join(",")).every((x, _, arr) => arr[0] === x)).toBe(false);
    });
  });

  describe("hire", () => {
    it("refuses a band not in this season's offers, marks the offer hired, and refuses a third band", async () => {
      const { ctx, characterId } = await makePlayer();
      const offers = await roll(ctx, 9);
      const notOffered = Object.keys(m.barracks.getBandsContent().bands).find((id) => !offers.some((o) => o.bandId === id))!;
      expect(await m.barracks.hireBand(ctx, notOffered, at(9))).toMatchObject({ ok: false, code: 404 });
      expect(await m.barracks.hireBand(ctx, "not-a-band", at(9))).toMatchObject({ ok: false, code: 404 });

      const def = m.barracks.getBandsContent().bands[offers[0]!.bandId]!;
      const h = await m.barracks.hireBand(ctx, offers[0]!.bandId, at(9));
      expect(h).toMatchObject({ ok: true, bandId: offers[0]!.bandId, men: def.men, contractEndAt: at(11).toISOString() });
      expect((await roll(ctx, 9)).find((o) => o.bandId === offers[0]!.bandId)!.hired).toBe(true);
      // Hiring again is refused: the offer is spent.
      expect(await m.barracks.hireBand(ctx, offers[0]!.bandId, at(9))).toMatchObject({ ok: false, code: 404 });

      expect(await m.barracks.hireBand(ctx, offers[1]!.bandId, at(9))).toMatchObject({ ok: true });
      expect(await m.barracks.hireBand(ctx, offers[2]!.bandId, at(9))).toMatchObject({ ok: false, code: 409 });
      expect((await rows(ctx)).filter((r) => r.source === "band")).toHaveLength(2);
      expect((await rows(ctx))[0]).toMatchObject({ source: "band", count: def.men, startCount: def.men, recruitedSeason: 9, readyAt: null, contractEndAt: at(11), contractEndSeason: null, basedAt: "R060" });
      expect(await logs(characterId, "barracks_hire")).toHaveLength(2);
      // Bands never touch the levy.
      expect((await levy(ctx))!.men).toBe(120);
    });
  });

  describe("settle", () => {
    it("charges a trained row's grain and oil from stock per man per day; buys the shortfall at the seasonal price", async () => {
      const { ctx } = await makePlayer({ drachmae: 1000 });
      await giveAll(ctx, { grain: 5, oliveoil: 100 });
      // 10 hoplites, ready: grain 2 + oil 1 per man per day.
      await insertRow(ctx, { source: "trained", unitId: "hoplite", count: 10, recruitedSeason: 7, readyAt: 9, createdSeason: 9 });
      const s = await settle(ctx, 10);
      expect(s.days).toBe(1);
      expect(s.drawn).toEqual({ grain: 5, oliveoil: 10 });
      expect(s.bought).toEqual({ grain: 15 });
      const expected = Math.round(15 * buyPrice("grain", 10));
      expect(s.cost).toBe(expected);
      expect(s.drachmaeDirect).toBe(0);
      expect(await stock(ctx, "grain")).toBe(0);
      expect(await stock(ctx, "oliveoil")).toBe(90);
      expect(await wallet(ctx)).toBe(1000 - expected);
      // A second settle inside the same day charges nothing (the marker carries).
      const again = await settle(ctx, 10.5);
      expect(again.days).toBe(0);
      expect(await wallet(ctx)).toBe(1000 - expected);
    });

    it("debits a band's drachmae per band (not per man) and its goods per band; two days charge twice", async () => {
      const { ctx } = await makePlayer({ drachmae: 1000 });
      await giveAll(ctx, { wine: 100, chicken: 100, herbal: 100 });
      const def = m.barracks.getBandsContent().bands["salluvii-warband"]!; // 75 dr, wine 4, chicken 4, herbal 2; 30 men
      await insertRow(ctx, { source: "band", unitId: "salluvii-warband", count: def.men, recruitedSeason: 9, contractEndAt: 20 });
      const s = await settle(ctx, 11);
      expect(s.days).toBe(2);
      expect(s.drachmaeDirect).toBe(2 * def.upkeepPerDay.drachmae!);
      expect(s.drawn).toEqual({ wine: 8, chicken: 8, herbal: 4 });
      expect(s.bought).toEqual({});
      expect(s.cost).toBe(150);
      expect(await wallet(ctx)).toBe(850);
    });

    it("a trained row still in training costs nothing; upkeep starts only for days after ready_at", async () => {
      const { ctx } = await makePlayer({ drachmae: 1000 });
      await giveAll(ctx, { grain: 100, oliveoil: 100 });
      // Recruited at 9, ready at 11 (two seasons of training).
      await insertRow(ctx, { source: "trained", unitId: "hoplite", count: 10, recruitedSeason: 9, readyAt: 11, createdSeason: 9 });
      const s = await settle(ctx, 10);
      expect(s.days).toBe(1);
      expect(s.cost).toBe(0);
      expect(s.drawn).toEqual({});
      expect(await stock(ctx, "grain")).toBe(100);
      expect(await wallet(ctx)).toBe(1000);
      // The day [10, 11) ends exactly at ready_at: still nothing owed.
      const s2 = await settle(ctx, 11);
      expect(s2.days).toBe(1);
      expect(s2.drawn).toEqual({});
      // The first whole day after ready_at is charged.
      const s3 = await settle(ctx, 12);
      expect(s3.days).toBe(1);
      expect(s3.drawn).toEqual({ grain: 20, oliveoil: 10 });
    });

    it("a row that became ready mid-gap is charged for the post-ready days only; a band for the whole gap", async () => {
      const { ctx } = await makePlayer({ drachmae: 1000 });
      await giveAll(ctx, { grain: 100, oliveoil: 100, wine: 100, chicken: 100, herbal: 100 });
      // Hoplites recruited at 9, ready at 10; a Volcae band (40 dr/day) from 9.
      await insertRow(ctx, { source: "trained", unitId: "hoplite", count: 10, recruitedSeason: 9, readyAt: 10, createdSeason: 9 });
      await insertRow(ctx, { source: "band", unitId: "volcae-irregulars", count: 40, recruitedSeason: 9, contractEndAt: 20 });
      // One settle spanning 9 → 12: three whole days, of which the hoplites stood
      // ready for two ([10, 11) and [11, 12)).
      const s = await settle(ctx, 12);
      expect(s.days).toBe(3);
      expect(s.drawn).toEqual({ grain: 40, oliveoil: 20, wine: 12, chicken: 12, herbal: 6 });
      expect(s.bought).toEqual({});
      expect(s.drachmaeDirect).toBe(120);
      expect(s.cost).toBe(120);
      expect(await wallet(ctx)).toBe(880);
      // A row whose ready_at is still ahead owes nothing even inside a charged gap.
      await insertRow(ctx, { source: "trained", unitId: "peltast", count: 10, recruitedSeason: 12, readyAt: 13, createdSeason: 12 });
      const s2 = await settle(ctx, 13);
      expect(s2.days).toBe(1);
      expect(s2.drawn).toEqual({ grain: 20, oliveoil: 10, wine: 4, chicken: 4, herbal: 2 });
    });

    it("a relocation whose arrives_at has passed lands the row at moving_to; one still in flight is untouched", async () => {
      const { ctx, characterId } = await makePlayer({ drachmae: 1000 });
      await giveAll(ctx, { grain: 100, oliveoil: 100 });
      const landed = await insertRow(ctx, { source: "trained", unitId: "hoplite", count: 5, recruitedSeason: 7, readyAt: 9, createdSeason: 9 });
      const flying = await insertRow(ctx, { source: "trained", unitId: "peltast", count: 5, recruitedSeason: 7, readyAt: 9, createdSeason: 9 });
      await db.update(m.dbPkg.playerUnits).set({ movingTo: "R046", arrivesAt: at(9.5) }).where(eq(m.dbPkg.playerUnits.id, landed.id));
      await db.update(m.dbPkg.playerUnits).set({ movingTo: "R047", arrivesAt: at(10.5) }).where(eq(m.dbPkg.playerUnits.id, flying.id));
      const s = await settle(ctx, 10);
      expect(s.arrived.map((a) => a.rowId)).toEqual([landed.id]);
      const after = await rows(ctx);
      expect(after.find((r) => r.id === landed.id)).toMatchObject({ basedAt: "R046", movingTo: null, arrivesAt: null });
      expect(after.find((r) => r.id === flying.id)).toMatchObject({ basedAt: "R060", movingTo: "R047", arrivesAt: at(10.5) });
      expect((await logs(characterId, "barracks_arrive")).map((e) => e.detail)).toEqual([{ unitId: "hoplite", count: 5, from: "R060", to: "R046", source: "barracks" }]);
    });

    it("with no rows and no marker nothing happens and no marker is written", async () => {
      const { ctx } = await makePlayer();
      const s = await settle(ctx, 10);
      expect(s.days).toBe(0);
      const markers = await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, "barracks_upkeep")));
      expect(markers).toHaveLength(0);
    });
  });

  describe("insolvency", () => {
    it("wallet 0: the higher-drachmae band goes first, then the second, then the hoplites — men back to the levy, each logged as insolvency", async () => {
      const { ctx, characterId } = await makePlayer({ drachmae: 0 });
      // No stock at all: every good must be bought, so the hoplites cost money too.
      await insertRow(ctx, { source: "band", unitId: "volcae-irregulars", count: 40, recruitedSeason: 9, contractEndAt: 20 }); // 40 dr
      await insertRow(ctx, { source: "band", unitId: "spartan-hoplites", count: 20, recruitedSeason: 9, contractEndAt: 20 }); // 200 dr
      await insertRow(ctx, { source: "trained", unitId: "hoplite", count: 10, recruitedSeason: 7, readyAt: 9, createdSeason: 9 });
      const s = await settle(ctx, 10);
      expect(s.insolvent.map((d) => d.unitId)).toEqual(["spartan-hoplites", "volcae-irregulars", "hoplite"]);
      expect(s.cost).toBe(0);
      expect(s.owed).toBe(0);
      expect(await rows(ctx)).toHaveLength(0);
      expect((await levy(ctx))!.men).toBe(130); // 120 at season 10 + 10 hoplites returned
      // The three log rows share one transaction timestamp, so compare as a set —
      // the removal order is proven by `s.insolvent` above.
      const l = await logs(characterId, "barracks_disband");
      expect(l.map((e) => (e.detail as { source: string }).source)).toEqual(["insolvency", "insolvency", "insolvency"]);
      expect(l.map((e) => (e.detail as { unitId: string }).unitId).sort()).toEqual(["hoplite", "spartan-hoplites", "volcae-irregulars"]);
      expect(await wallet(ctx)).toBe(0);
    });

    it("a row still in training is never an insolvency victim: only rows that owe something are removed", async () => {
      const { ctx } = await makePlayer({ drachmae: 0 });
      await insertRow(ctx, { source: "band", unitId: "volcae-irregulars", count: 40, recruitedSeason: 9, contractEndAt: 20 }); // 40 dr
      await insertRow(ctx, { source: "trained", unitId: "hippeis", count: 5, recruitedSeason: 9, readyAt: 11, createdSeason: 9 }); // still training at 10
      const s = await settle(ctx, 10);
      expect(s.insolvent.map((d) => d.unitId)).toEqual(["volcae-irregulars"]);
      expect((await rows(ctx)).map((r) => r.unitId)).toEqual(["hippeis"]);
      expect(s.cost).toBe(0);
    });

    it("stops removing as soon as the remainder fits: the kept rows carry the whole gap", async () => {
      const { ctx } = await makePlayer({ drachmae: 60 });
      await giveAll(ctx, { wine: 100, chicken: 100, herbal: 100, grain: 100, oliveoil: 100 });
      await insertRow(ctx, { source: "band", unitId: "volcae-irregulars", count: 40, recruitedSeason: 9, contractEndAt: 20 }); // 40 dr
      await insertRow(ctx, { source: "band", unitId: "spartan-hoplites", count: 20, recruitedSeason: 9, contractEndAt: 20 }); // 200 dr
      await insertRow(ctx, { source: "trained", unitId: "hoplite", count: 10, recruitedSeason: 7, readyAt: 9, createdSeason: 9 });
      const s = await settle(ctx, 10);
      expect(s.insolvent.map((d) => d.unitId)).toEqual(["spartan-hoplites"]);
      expect(s.cost).toBe(40);
      expect(await wallet(ctx)).toBe(20);
      expect((await rows(ctx)).map((r) => r.unitId)).toEqual(["volcae-irregulars", "hoplite"]);
      // Only the kept rows' goods were drawn.
      expect(s.drawn).toEqual({ wine: 4, chicken: 4, herbal: 2, grain: 20, oliveoil: 10 });
    });
  });

  describe("contract end", () => {
    it("at contract_end_at a renewing roll extends by termSeasons days; a failing roll deletes the row with source contract_end", async () => {
      const { ctx, characterId } = await makePlayer({ drachmae: 100_000 });
      await giveAll(ctx, { wine: 1000, chicken: 1000, herbal: 1000 });
      const bands = m.barracks.getBandsContent();
      // Rhodian slingers renew at 0.9, Volcae at 0.6: pick row ids whose seeded roll
      // at contract_end_at = at(11) lands below / above those chances.
      const renewId = uuidWhere(11, (r) => r < bands.bands["rhodian-slingers"]!.renew!);
      const leaveId = uuidWhere(11, (r) => r >= bands.bands["volcae-irregulars"]!.renew!, renewId);
      await insertRow(ctx, { id: renewId, source: "band", unitId: "rhodian-slingers", count: 20, recruitedSeason: 9, contractEndAt: 11 });
      await insertRow(ctx, { id: leaveId, source: "band", unitId: "volcae-irregulars", count: 40, recruitedSeason: 9, contractEndAt: 11 });
      const before = await settle(ctx, 10);
      expect(before.renewed).toEqual([]);
      expect(before.departed).toEqual([]);
      // A moment before the end nothing resolves either: the timer is the instant, not the season.
      const justBefore = await settle(ctx, 10.999);
      expect(justBefore.renewed).toEqual([]);
      expect(justBefore.departed).toEqual([]);
      const s = await settle(ctx, 11);
      expect(s.renewed).toEqual([renewId]);
      expect(s.departed.map((d) => d.rowId)).toEqual([leaveId]);
      const left = await rows(ctx);
      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({ id: renewId, contractEndAt: at(11 + bands.contract.termSeasons) });
      expect((await logs(characterId, "barracks_renew")).map((e) => e.detail)).toEqual([{ bandId: "rhodian-slingers", count: 20, contractEndAt: at(13).toISOString(), source: "barracks" }]);
      expect((await logs(characterId, "barracks_disband")).map((e) => e.detail)).toEqual([{ unitId: "volcae-irregulars", count: 40, source: "contract_end" }]);
      // Deterministic: the same seed rolled again would give the same answer.
      const seed = String(at(11).getTime());
      expect(m.shared.seededRoll([renewId, seed])).toBe(m.shared.seededRoll([renewId, seed]));
    });
  });

  describe("disband", () => {
    it("trained: refused before minServiceSeasons days have elapsed, allowed after, men restored to the levy", async () => {
      const { ctx, characterId } = await makePlayer({ drachmae: 100_000 });
      await giveAll(ctx, { grain: 1000, oliveoil: 1000, timber: 100, iron: 100, tin: 100 });
      const r = await m.barracks.recruitUnits(ctx, "hoplite", 10, at(9));
      expect(r.ok).toBe(true);
      const rowId = (r as { rowId: string }).rowId;
      expect(await m.barracks.disbandRow(ctx, rowId, at(10))).toMatchObject({ ok: false, code: 409 });
      // Elapsed time, not the season index: a minute short of two days is still refused.
      const shy = await m.barracks.disbandRow(ctx, rowId, new Date(at(11).getTime() - 60_000));
      expect(shy).toMatchObject({ ok: false, code: 409 });
      expect((shy as { error: string }).error).toContain("1m to go");
      expect((await levy(ctx))!.men).toBe(110);
      expect(await m.barracks.disbandRow(ctx, rowId, at(11))).toMatchObject({ ok: true, unitId: "hoplite", count: 10, returnedToLevy: 10 });
      expect((await levy(ctx))!.men).toBe(120);
      expect(await rows(ctx)).toHaveLength(0);
      expect((await logs(characterId, "barracks_disband")).map((e) => e.detail)).toEqual([{ unitId: "hoplite", count: 10, source: "player" }]);
      // Gone rows and foreign ids are 404.
      expect(await m.barracks.disbandRow(ctx, rowId, at(12))).toMatchObject({ ok: false, code: 404 });
      expect(await m.barracks.disbandRow(ctx, "not-a-uuid", at(12))).toMatchObject({ ok: false, code: 404 });
    });

    it("band: refused inside the first term, allowed after, and nothing returns to the levy", async () => {
      const { ctx } = await makePlayer({ drachmae: 100_000 });
      await giveAll(ctx, { wine: 1000, chicken: 1000, herbal: 1000, grain: 1000 });
      // The disband settles first, and at contract_end_at = at(11) the contract end
      // rolls for renewal — pick a row id whose roll renews so the row is still there to release.
      const renewId = uuidWhere(11, (r) => r < m.barracks.getBandsContent().contract.renewDefault);
      const row = await insertRow(ctx, { id: renewId, source: "band", unitId: "samnite-infantry", count: 30, recruitedSeason: 9, contractEndAt: 11 });
      expect(await m.barracks.disbandRow(ctx, row.id, at(10))).toMatchObject({ ok: false, code: 409 });
      expect(await m.barracks.disbandRow(ctx, row.id, at(10.5))).toMatchObject({ ok: false, code: 409 });
      const before = (await levy(ctx))!.men;
      expect(await m.barracks.disbandRow(ctx, row.id, at(11))).toMatchObject({ ok: true, source: "band", count: 30, returnedToLevy: 0 });
      expect((await levy(ctx))!.men).toBe(before);
      expect(await rows(ctx)).toHaveLength(0);
    });

    it("another player's row is 404", async () => {
      const a = await makePlayer();
      const b = await makePlayer();
      const row = await insertRow(ctx(a), { source: "trained", unitId: "peltast", count: 5, recruitedSeason: 1, readyAt: 2 });
      expect(await m.barracks.disbandRow(b.ctx, row.id, at(9))).toMatchObject({ ok: false, code: 404 });
      expect(await rows(a.ctx)).toHaveLength(1);
      function ctx(p: { ctx: Ctx }) {
        return p.ctx;
      }
    });
  });
});
