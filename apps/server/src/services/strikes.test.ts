import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Strikes prompt 1: the strikes called and fought, through the campaign
// resolver the requests run (resolveDueCampaigns). The Volcae hold Nemausus
// (200) and Tolosa (2,300) next to Agathe; the League's army stands 100 men in
// Agathe and in Arelate, 120 in Rhoda and 250 in Emporion. Integration test
// against a REAL Postgres, guarded to a *_test database (it truncates), on the
// synthetic clock the map suite uses (one season = one day from T0; season 8
// is a Winter, 9 a Spring).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (seasons: number) => new Date(T0 + seasons * DAY);
const plus = (from: Date, ms: number) => new Date(from.getTime() + ms);
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const mapPools = await import("./mapPools.js");
  const holdings = await import("./holdings.js");
  const muster = await import("./koinonMuster.js");
  const strikes = await import("./strikes.js");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const lock = await import("./lock.js");
  return { dbPkg, buildings, barracks, mapGraph, mapPools, holdings, muster, strikes, age, traits, lock };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the strikes (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let leagueId: string;
  let houseName: string;
  type Ctx = { playerId: string; worldId: string; worldStartedMs: number };

  // A house with a character, a wallet and stock for its upkeep.
  async function makePlayer(drachmae = 1000) {
    const { users, players, playerCharacters, dynasties, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Kleon-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    const ch = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: 20, drachmae, startAge: 30, deathAge: 90 }).returning())[0]!;
    for (const [type, amount] of Object.entries({ grain: 5000, oliveoil: 5000, chicken: 5000 })) await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: at(0) });
    const ctx: Ctx = { playerId: player.id, worldId, worldStartedMs: T0 };
    return { ctx, characterId: ch.id };
  }
  const row = async (ownerPlayerId: string, unitId: string, count: number, basedAt: string, over: Record<string, unknown> = {}) =>
    (await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId, source: "trained", unitId, count, startCount: count, recruitedSeason: 0, readyAt: at(0), basedAt, createdAt: at(5), ...over }).returning())[0]!;
  const rowsAt = async (playerId: string, basedAt: string) => (await db.select().from(m.dbPkg.playerUnits).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, playerId), eq(m.dbPkg.playerUnits.basedAt, basedAt))).orderBy(asc(m.dbPkg.playerUnits.createdAt))).filter((r) => r.movingTo === null);
  const menAt = async (playerId: string, basedAt: string) => (await rowsAt(playerId, basedAt)).reduce((n, r) => n + r.count, 0);
  const strikeRows = () => db.select().from(m.dbPkg.strikes).orderBy(asc(m.dbPkg.strikes.calledAt), asc(m.dbPkg.strikes.id));
  const strikeOf = async (id: string) => (await db.select().from(m.dbPkg.strikes).where(eq(m.dbPkg.strikes.id, id)))[0]!;
  const partsOf = (id: string) => db.select().from(m.dbPkg.strikeParts).where(eq(m.dbPkg.strikeParts.strikeId, id));
  const war = (factionId: string, startsAt: Date, endsAt: Date, year = 1) => db.insert(m.dbPkg.leagueWars).values({ worldId, factionId, gameYear: year, cost: 2000, startsAt, endsAt });
  const balance = () => m.dbPkg.treasuryBalance(worldId, "league");
  const ledger = async () => (await db.select().from(m.dbPkg.treasuryLedger).where(and(eq(m.dbPkg.treasuryLedger.worldId, worldId), eq(m.dbPkg.treasuryLedger.owner, "league")))).map((l) => [l.reason, l.delta]);
  const city = async (cityId: string) => (await db.select().from(m.dbPkg.leagueCities).where(and(eq(m.dbPkg.leagueCities.worldId, worldId), eq(m.dbPkg.leagueCities.cityId, cityId))))[0];
  const garrison = (townId: string, when: Date) => m.mapPools.readTownGarrison(db, worldId, townId, when);
  const wallet = async (playerId: string) => (await db.select({ d: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)))[0]!.d;
  const settle = (ctx: Ctx, when: Date) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.barracks.settleBarracks(tx, ctx, when);
    });
  // The resolver as a request runs it: calls, then everything due in order.
  const pass = (when: Date) => m.muster.resolveDueCampaigns(when);
  // A march written directly, for a battle with chosen numbers.
  const march = (over: Partial<typeof m.dbPkg.strikes.$inferInsert> = {}) =>
    db
      .insert(m.dbPkg.strikes)
      .values({ id: uid(900), worldId, nationId: "volcae", trigger: "raids", triggerPlaceId: "nemausus", triggerAt: at(9), mode: "raid", seasonIndex: 9, regionId: "R050", townId: "agathe", targetKind: "home", force: 50, about: 50, draws: [{ placeId: "nemausus", kind: "town", men: 4 }, { placeId: "tolosa", kind: "town", men: 46 }], calledAt: at(9), strikesAt: plus(at(9), 12 * HOUR), ...over })
      .returning()
      .then((r) => r[0]!);
  const holdingRow = (ownerPlayerId: string, regionId: string, townId: string, previousOwner: string, since = at(8)) => ({ worldId, regionId, townId, ownerPlayerId, kind: "conquest" as const, previousOwner, since, lastGarrisonedAt: plus(at(9), 6 * HOUR), lastTributeAt: plus(at(9), 6 * HOUR) });

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    await m.traits.loadTraitDefs();
    await m.age.loadAgeConfig();
    await m.strikes.loadStrikesContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE strike_parts, strikes, league_orders, league_wars, faction_relations, league_cities, player_marches, player_voyages, player_holdings, player_units, player_levy, region_military, town_military, koinon_musters, resources, treasury_ledger, treasuries, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    // The houses row outlives every file with its first seeder's name: read it back.
    houseName = (await db.select({ name: m.dbPkg.houses.name }).from(m.dbPkg.houses).where(eq(m.dbPkg.houses.slug, "test-house")))[0]!.name;
    // A fixed id: a battle's seed is (world, strike, place, instant).
    worldId = (await db.insert(m.dbPkg.worlds).values({ id: uid(1), name: "Strikes", seed: "strikes", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
    await db.insert(m.dbPkg.treasuries).values({ worldId, owner: "league", balance: 5000 });
    expect(await m.dbPkg.ensureLeagueArmy(worldId, at(0))).toBe(true);
    leagueId = (await m.dbPkg.leaguePlayerId(db, worldId))!;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- calling -------------------------------------------------------------------

  it("a war march is called at the season's start and strikes 12 hours later: the Volcae on Agathe with a fifth of Tolosa's and Nemausus's men", async () => {
    await war("volcae", at(8), at(16));
    await pass(plus(at(9), MIN));
    const [s, ...rest] = await strikeRows();
    expect(rest.map((r) => [r.nationId, r.trigger, r.seasonIndex, r.townId ?? r.regionId, r.status, r.calledAt.toISOString()])).toEqual([]);
    expect(s).toMatchObject({ nationId: "volcae", trigger: "war", mode: "raid", seasonIndex: 9, regionId: "R050", townId: "agathe", targetKind: "home", holderPlayerId: null, takenFrom: false, force: 500, about: 500, status: "marching" });
    expect(s!.draws).toEqual([{ placeId: "nemausus", kind: "town", men: 40 }, { placeId: "tolosa", kind: "town", men: 460 }]);
    expect(s!.calledAt).toEqual(at(9));
    expect(s!.strikesAt).toEqual(plus(at(9), 12 * HOUR));
    // Not before: a pass before the strike leaves it on the road; one after fights it.
    await pass(plus(at(9), 11 * HOUR));
    expect((await strikeOf(s!.id)).status).toBe("marching");
    await pass(plus(at(9), 13 * HOUR));
    expect((await strikeOf(s!.id)).status).toBe("struck");
    expect((await strikeOf(s!.id)).resolvedAt).toEqual(plus(at(9), 12 * HOUR));
    // Nothing more that season.
    await pass(plus(at(9), 20 * HOUR));
    expect(await strikeRows()).toHaveLength(1);
    // Nothing in Winter (season 12); a pass then still weighs the season before
    // it (Autumn, 11), called at its start and fought at once.
    await pass(plus(at(12), HOUR));
    expect((await strikeRows()).map((r) => [r.seasonIndex, r.calledAt.getTime() === at(r.seasonIndex).getTime(), r.status])).toEqual([[9, true, "struck"], [11, true, "struck"]]);
  });

  // Military 6a, ruling 3: a war march leaves a place on alert out of its draws.
  it("a war march draws nobody from a place of the nation's on alert: Nemausus at 80 of 200 stays home, and Tolosa sends a fifth of its men", async () => {
    await war("volcae", at(8), at(16));
    await m.mapPools.writeTownGarrison(db, worldId, "nemausus", 80, at(9));
    await pass(plus(at(9), MIN));
    const [s] = await strikeRows();
    expect(s).toMatchObject({ nationId: "volcae", trigger: "war", townId: "agathe", force: 460, about: 460, draws: [{ placeId: "tolosa", kind: "town", men: 460 }] });
  });

  it("one march per nation at a time: a war march held up by a raids march is called when the road clears, within the season", async () => {
    // A war begins at a season's start (the vote closes then) with a raids march on the road.
    await war("volcae", at(10), at(16));
    await march({ trigger: "raids", triggerPlaceId: "nemausus", triggerAt: plus(at(10), -HOUR), calledAt: plus(at(10), -HOUR), strikesAt: plus(at(10), 4 * HOUR) });
    await pass(plus(at(10), 3 * HOUR));
    expect((await strikeRows()).map((s) => [s.trigger, s.status])).toEqual([["raids", "marching"]]);
    // The raids march meets the war: it turns back; the war march is called at that instant, in the same pass.
    await pass(plus(at(10), 5 * HOUR));
    const [raids, warMarch] = await strikeRows();
    expect(raids).toMatchObject({ trigger: "raids", status: "called_off", report: { outcome: "called_off", line: "The Volcae turned back from Agathe: they are at war with the League now." } });
    expect(warMarch).toMatchObject({ trigger: "war", status: "marching", seasonIndex: 10 });
    expect(warMarch!.calledAt).toEqual(plus(at(10), 4 * HOUR));
  });

  it("a raids march: R057's 11th fight calls the Sordones with its full 400, on Agathe (100) over Rhoda (120) and Emporion (250)", async () => {
    const house = await makePlayer();
    for (let i = 0; i < 11; i++) {
      await db.insert(m.dbPkg.playerMarches).values({ worldId, ownerPlayerId: house.ctx.playerId, kind: "raid", regionId: "R057", townId: null, baseId: "R060", route: "land", steps: 1, minutes: 30, departedAt: plus(at(9), i * HOUR), arrivesAt: plus(at(9), i * HOUR + 30 * MIN), status: "resolved", resolvedAt: plus(at(9), i * HOUR + 30 * MIN), report: { winner: i === 3 ? "stand" : "attacker" } });
    }
    // A scout and a turn-back are no fight.
    await db.insert(m.dbPkg.playerMarches).values({ worldId, ownerPlayerId: house.ctx.playerId, kind: "scout", regionId: "R057", townId: null, baseId: "R060", route: "land", steps: 1, minutes: 30, departedAt: at(9), arrivesAt: plus(at(9), 10 * MIN), status: "resolved", report: { winner: "attacker" } });
    const eleventh = plus(at(9), 10 * HOUR + 30 * MIN);
    await m.strikes.callDueStrikes(plus(eleventh, MIN), { raids: true });
    const [s] = await strikeRows();
    expect(s).toMatchObject({ nationId: "sordones", trigger: "raids", mode: "raid", triggerPlaceId: "R057", regionId: "R050", townId: "agathe", force: 400, about: 400, draws: [{ placeId: "R057", kind: "region", men: 400 }] });
    expect(s!.triggerAt).toEqual(eleventh);
    expect(s!.calledAt).toEqual(eleventh);
    expect(s!.strikesAt).toEqual(plus(eleventh, 12 * HOUR));
    // The count starts again: no second march for the same fights.
    await m.strikes.callDueStrikes(plus(eleventh, 2 * MIN), { raids: true });
    expect(await strikeRows()).toHaveLength(1);
  });

  // Military 6a, ruling 3: a raids march sends what its place has, and none marches from a place on alert.
  // A house raids R057 eleven times on `day`, an hour apart; the 11th, at 10:30, tips the count over.
  async function r057Fights(day: number): Promise<Date> {
    const house = await makePlayer();
    for (let i = 0; i < 11; i++) {
      await db.insert(m.dbPkg.playerMarches).values({ worldId, ownerPlayerId: house.ctx.playerId, kind: "raid", regionId: "R057", townId: null, baseId: "R060", route: "land", steps: 1, minutes: 30, departedAt: plus(at(day), i * HOUR), arrivesAt: plus(at(day), i * HOUR + 30 * MIN), status: "resolved", resolvedAt: plus(at(day), i * HOUR + 30 * MIN), report: { winner: "attacker" } });
    }
    return plus(at(day), 10 * HOUR + 30 * MIN);
  }
  const setR057 = (warband: number, when: Date) => m.mapPools.writeRegionWarband(db, worldId, "R057", warband, when);

  it("a raids march sends what the raided place has at the call, never more than its full strength", async () => {
    const eleventh = await r057Fights(9);
    await setR057(260, at(9)); // above half its full 400
    await m.strikes.callDueStrikes(plus(eleventh, MIN), { raids: true });
    expect(await strikeRows()).toMatchObject([{ trigger: "raids", triggerPlaceId: "R057", townId: "agathe", force: 260, about: 260, draws: [{ placeId: "R057", kind: "region", men: 260 }] }]);
  });

  it("a raids march from a pool above its full strength sends no more than full", async () => {
    const eleventh = await r057Fights(9);
    await setR057(500, at(9));
    await m.strikes.callDueStrikes(plus(eleventh, MIN), { raids: true });
    expect(await strikeRows()).toMatchObject([{ force: 400, draws: [{ placeId: "R057", kind: "region", men: 400 }] }]);
  });

  it("a raids march called while its place is on alert waits for the first whole day of the pool's regrowth above half, and sends what the place has then", async () => {
    const eleventh = await r057Fights(9);
    await setR057(150, eleventh); // under half its full 400; its clock starts at the 11th fight
    await m.strikes.callDueStrikes(plus(eleventh, MIN), { raids: true });
    await m.strikes.callDueStrikes(plus(eleventh, DAY - MIN), { raids: true });
    expect(await strikeRows()).toEqual([]);
    // A day on, 150 has won back 120 (30% of 400): 270, above half. The march is called at that instant.
    await m.strikes.callDueStrikes(plus(eleventh, DAY + MIN), { raids: true });
    const [s, ...rest] = await strikeRows();
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ nationId: "sordones", trigger: "raids", triggerPlaceId: "R057", townId: "agathe", force: 270, about: 270, draws: [{ placeId: "R057", kind: "region", men: 270 }] });
    expect(s!.triggerAt).toEqual(eleventh);
    expect(s!.calledAt).toEqual(plus(eleventh, DAY));
    expect(s!.strikesAt).toEqual(plus(eleventh, DAY + 12 * HOUR));
  });

  it("a raids march whose wait ends in Winter is called at the next Spring's start", async () => {
    // The 11th fight is in Autumn (day 11); a day of regrowth lands in Winter (day 12): the call waits for Spring (day 13).
    const eleventh = await r057Fights(11);
    await setR057(150, eleventh);
    await m.strikes.callDueStrikes(plus(eleventh, DAY + MIN), { raids: true });
    expect(await strikeRows()).toEqual([]);
    await m.strikes.callDueStrikes(plus(at(13), MIN), { raids: true });
    const [s] = await strikeRows();
    // Spring starts 37½ hours after the 11th fight: one whole day of the pool's clock, 150 + 120 = 270.
    expect(s).toMatchObject({ trigger: "raids", triggerPlaceId: "R057", force: 270 });
    expect(s!.calledAt).toEqual(at(13));
  });

  // Military 6a, ruling 4: the call counts men whose move has arrived, as the strike's owners do.
  it("a march's call counts the men whose move to a place has arrived though their owner is not settled: 250 arrived in Agathe send the Sordones to Rhoda", async () => {
    const house = await makePlayer();
    const eleventh = await r057Fights(9);
    // Arrived at Agathe an hour before the 11th fight, his settle not yet run; a party on a march's mission does not count.
    await row(house.ctx.playerId, "hoplite", 250, "R060", { movingTo: "agathe", arrivesAt: plus(eleventh, -HOUR), mission: { kind: "move", regionId: "R050", townId: "agathe", departedAt: plus(eleventh, -2 * HOUR).toISOString() } });
    await row(house.ctx.playerId, "peltast", 500, "R060", { movingTo: "rhoda", arrivesAt: plus(eleventh, -HOUR), mission: { kind: "raid", regionId: "R065", townId: "rhoda", departedAt: plus(eleventh, -2 * HOUR).toISOString(), marchId: uid(950) } });
    await m.strikes.callDueStrikes(plus(eleventh, MIN), { raids: true });
    // Agathe's 100 and the 250: 350; Rhoda's 120 alone: the 400 most outnumber Rhoda's men.
    expect(await strikeRows()).toMatchObject([{ trigger: "raids", triggerPlaceId: "R057", townId: "rhoda", force: 400 }]);
  });

  // --- the battle ------------------------------------------------------------------

  it("a raid on Agathe is driven off by the League's men and a house's together, each owner losing his own; the enemy's dead come off Tolosa and Nemausus in proportion", async () => {
    const house = await makePlayer();
    await row(house.ctx.playerId, "hoplite", 60, "agathe");
    const s = await march({ force: 120, about: 120, draws: [{ placeId: "nemausus", kind: "town", men: 10 }, { placeId: "tolosa", kind: "town", men: 110 }] });
    await pass(plus(s.strikesAt, MIN));
    const done = await strikeOf(s.id);
    const report = done.report as Record<string, unknown> & { theirDead: number; ourDead: number; deadOff: { placeId: string; men: number }[]; parts: { playerId: string; men: number; lost: number }[] };
    expect(done.status).toBe("struck");
    expect(report).toMatchObject({ outcome: "driven_off", mode: "raid", defenders: 160, survivors: 120 - report.theirDead, paid: 0, payer: null });
    expect(report.line).toBe(`The Volcae struck at Agathe and were driven off. ${report.theirDead} of them fell, and ${report.ourDead} of the defenders.`);
    expect(report.theirDead).toBeGreaterThan(0);
    // Each owner's losses on his own rows.
    const parts = await partsOf(s.id);
    const houseLost = 60 - (await menAt(house.ctx.playerId, "agathe"));
    const leagueLost = 100 - (await menAt(leagueId, "agathe"));
    expect(parts.map((p) => [p.playerId === leagueId ? "league" : "house", p.men, p.lost]).sort()).toEqual([["house", 60, houseLost], ["league", 100, leagueLost]]);
    expect(houseLost + leagueLost).toBe(report.ourDead);
    expect(await balance()).toBe(5000);
    // The enemy's dead off its pools, in proportion to what each sent.
    const offN = report.deadOff.find((d) => d.placeId === "nemausus")!.men;
    const offT = report.deadOff.find((d) => d.placeId === "tolosa")!.men;
    expect(offN + offT).toBe(report.theirDead);
    expect(Math.abs(offT - (report.theirDead * 110) / 120)).toBeLessThanOrEqual(1);
    expect(await garrison("nemausus", s.strikesAt)).toBe(200 - offN);
    expect(await garrison("tolosa", s.strikesAt)).toBe(2300 - offT);
    // The house's report row; the League writes none.
    expect((await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, house.characterId), eq(m.dbPkg.effectLog.kind, "strike")))).map((l) => (l.detail as { men: number }).men)).toEqual([60]);
  });

  // Military 6a, ruling 6: the players' raids fight two rounds, a strike fought as a raid the strikes' one.
  it("a raids strike is fought in one round, where the players' raids now fight two", async () => {
    const { resolveBattle } = await import("@massalia/shared");
    const battle = m.barracks.getBattleContent();
    expect(battle.raid.rounds).toBe(2);
    expect((await m.strikes.getStrikesContent()).raidRounds).toBe(1);
    const s = await march({ force: 100, about: 100, draws: [{ placeId: "tolosa", kind: "town", men: 100 }] });
    // The League's 100 in Agathe behind its walls: at the players' two rounds the same fight goes on into a second, on every seed.
    await m.dbPkg.ensureLeagueCities(db, worldId);
    const walls = Math.min((await city("agathe"))!.fortifications, battle.town.wallsDefCap);
    const defenders = (await rowsAt(leagueId, "agathe")).map((r) => {
      const def = m.barracks.getUnitsContent().units[r.unitId]!;
      return { id: r.id, label: def.label, count: r.count, stats: { ...def.stats, def: def.stats.def + walls } };
    });
    expect(defenders.reduce((n, d) => n + d.count, 0)).toBe(100);
    const raiders = [{ id: "raiders", label: battle.npc.warband.label, count: 100, stats: battle.npc.warband.stats }];
    for (let i = 0; i < 50; i++) expect(resolveBattle({ attacker: raiders, defender: defenders, seed: `two-${i}`, config: battle, mode: "raid" }).rounds).toHaveLength(2);
    await pass(plus(s.strikesAt, MIN));
    expect((await strikeOf(s.id)).report).toMatchObject({ outcome: "driven_off", mode: "raid", rounds: 1 });
  });

  // Military 6a, ruling 3: a strike's dead never empty the places it drew from.
  it("a strike's dead never take a pool it drew from below half: Nemausus at 105 loses 5 and stands at 100, on alert; Tolosa below half loses none", async () => {
    const house = await makePlayer();
    await row(house.ctx.playerId, "hoplite", 60, "agathe");
    await m.mapPools.writeTownGarrison(db, worldId, "nemausus", 105, at(9)); // may lose 5, to 100 of 200
    await m.mapPools.writeTownGarrison(db, worldId, "tolosa", 1000, at(9)); // under 1,150, half of 2,300
    const s = await march({ force: 120, about: 120, draws: [{ placeId: "nemausus", kind: "town", men: 60 }, { placeId: "tolosa", kind: "town", men: 60 }] });
    await pass(plus(s.strikesAt, MIN));
    const report = (await strikeOf(s.id)).report as { outcome: string; theirDead: number; survivors: number; deadOff: { placeId: string; men: number }[] };
    // 21 to 24 of the 120 fall on every seed, half of them Nemausus's: more than its room.
    expect(report.theirDead).toBeGreaterThanOrEqual(21);
    expect(report.survivors).toBe(120 - report.theirDead);
    expect(report.deadOff).toEqual([{ placeId: "nemausus", kind: "town", men: 5 }, { placeId: "tolosa", kind: "town", men: 0 }]);
    expect(await garrison("nemausus", s.strikesAt)).toBe(100);
    expect(await garrison("tolosa", s.strikesAt)).toBe(1000);
  });

  it("a raid that wins on Agathe: the treasury pays 2 a raider standing, with its ledger row, and Agathe loses 2% of its people and 1 stability", async () => {
    await db.update(m.dbPkg.treasuries).set({ balance: 100_000 }).where(eq(m.dbPkg.treasuries.worldId, worldId));
    const s = await march({ force: 3000, about: 3000 });
    await m.dbPkg.ensureLeagueCities(db, worldId);
    const before = (await city("agathe"))!;
    await pass(plus(s.strikesAt, MIN));
    const report = (await strikeOf(s.id)).report as { outcome: string; survivors: number; paid: number; peopleLost: number; line: string };
    expect(report.outcome).toBe("won");
    expect(report.paid).toBe(2 * report.survivors);
    expect(await balance()).toBe(100_000 - report.paid);
    expect(await ledger()).toContainEqual([`strike:volcae:agathe:${s.id}`, -report.paid]);
    const peopleLost = Math.round(before.population * 0.02);
    expect(report.peopleLost).toBe(peopleLost);
    expect(await city("agathe")).toMatchObject({ population: before.population - peopleLost, stability: before.stability - 1 });
    expect(report.line).toBe(`The Volcae broke into Agathe. They carried off ${report.paid.toLocaleString("en-US")} drachmae from the treasury, and ${peopleLost} of its people were lost.`);
  });

  it("a raid that wins on Arelate costs the treasury alone: it has no polis; the treasury pays as much as it has", async () => {
    const s = await march({ regionId: "R052", townId: "arelate", force: 3000, about: 3000, draws: [{ placeId: "nemausus", kind: "town", men: 40 }] });
    await m.dbPkg.ensureLeagueCities(db, worldId);
    const cities = await db.select().from(m.dbPkg.leagueCities).where(eq(m.dbPkg.leagueCities.worldId, worldId)).orderBy(asc(m.dbPkg.leagueCities.cityId));
    await pass(plus(s.strikesAt, MIN));
    const report = (await strikeOf(s.id)).report as { outcome: string; survivors: number; paid: number; peopleLost: number | null; line: string };
    expect(report.survivors * 2).toBeGreaterThan(5000);
    expect(report).toMatchObject({ outcome: "won", peopleLost: null, paid: 5000 });
    expect(await balance()).toBe(0);
    expect(report.line).toBe(`The Volcae broke into Arelate. They carried off ${report.paid.toLocaleString("en-US")} drachmae from the treasury.`);
    expect(await db.select().from(m.dbPkg.leagueCities).where(eq(m.dbPkg.leagueCities.worldId, worldId)).orderBy(asc(m.dbPkg.leagueCities.cityId))).toEqual(cities);
  });

  it("a raids-trigger raid that wins on a house's holding takes 2 a raider standing from the holder, as much as he has", async () => {
    const holder = await makePlayer(30);
    await db.insert(m.dbPkg.playerHoldings).values(holdingRow(holder.ctx.playerId, "R046", "", "unclaimed"));
    await row(holder.ctx.playerId, "hoplite", 5, "R046");
    const s = await march({ nationId: "volcae", trigger: "raids", triggerPlaceId: "nemausus", triggerAt: at(9), regionId: "R046", townId: null, targetKind: "holding", holderPlayerId: holder.ctx.playerId, force: 200, about: 200, draws: [{ placeId: "nemausus", kind: "town", men: 200 }] });
    await pass(plus(s.strikesAt, MIN));
    const report = (await strikeOf(s.id)).report as { outcome: string; paid: number; payer: string; line: string };
    expect(report).toMatchObject({ outcome: "won", paid: 30, payer: "holder" });
    expect(await wallet(holder.ctx.playerId)).toBe(0);
    expect(report.line).toBe(`The Volcae broke into Salyes and carried off 30 drachmae from House ${houseName}.`);
    expect(await partsOf(s.id)).toMatchObject([{ playerId: holder.ctx.playerId, men: 5, holder: true, paid: 30 }]);
    // Still his: a raid takes nothing but plunder.
    expect(await db.select().from(m.dbPkg.playerHoldings)).toHaveLength(1);
  });

  it("a war attack that wins on a house's holding ends it and returns the place to its people; the holder's and a guest's survivors turn home at their settles", async () => {
    const holder = await makePlayer();
    const guest = await makePlayer();
    await db.insert(m.dbPkg.playerHoldings).values(holdingRow(holder.ctx.playerId, "R047", "reii", "saluvii"));
    await m.mapPools.writeTownGarrison(db, worldId, "reii", 0, at(8));
    // 40 peltasts of his, 40 peltasts and 20 hoplites of a guest, against 3,000:
    // the pure resolver storms them on 300 of 300 seeds with peltasts of both left.
    await row(holder.ctx.playerId, "peltast", 40, "reii");
    await row(guest.ctx.playerId, "peltast", 40, "reii");
    await row(guest.ctx.playerId, "hoplite", 20, "reii");
    await war("saluvii", at(8), at(16));
    const s = await march({ nationId: "saluvii", trigger: "war", triggerPlaceId: null, triggerAt: null, mode: "attack", regionId: "R047", townId: "reii", targetKind: "holding", holderPlayerId: holder.ctx.playerId, force: 3000, about: 3000, draws: [] });
    await pass(plus(s.strikesAt, MIN));
    const report = (await strikeOf(s.id)).report as { outcome: string; holdingLost: boolean; line: string };
    expect(report).toMatchObject({ outcome: "stormed", holdingLost: true, line: `The Saluvii stormed Reii. House ${houseName} has lost it.` });
    expect(await db.select().from(m.dbPkg.playerHoldings)).toEqual([]);
    expect(await garrison("reii", s.strikesAt)).toBe(160);
    // The survivors fall back at their own settles (holdings prompt 3, rule 4).
    for (const p of [holder, guest]) {
      const left = await rowsAt(p.ctx.playerId, "reii");
      expect(left.length).toBeGreaterThan(0);
      await settle(p.ctx, plus(s.strikesAt, 5 * MIN));
      for (const r of left) expect((await db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.id, r.id)))[0]).toMatchObject({ basedAt: "reii", movingTo: "R060" });
    }
  });

  it("the same for a League holding: stormed, the League's line, and its men turn for the town of Massalia at its settle", async () => {
    const lctx = (await m.strikes.nationById("saluvii")) && { playerId: leagueId, worldId, worldStartedMs: T0 };
    await db.insert(m.dbPkg.playerHoldings).values(holdingRow(leagueId, "R047", "reii", "saluvii"));
    // 120 peltasts against 3,000: stormed on 300 of 300 seeds with men left (the pure resolver).
    await row(leagueId, "peltast", 120, "reii");
    await war("saluvii", at(8), at(16));
    const s = await march({ nationId: "saluvii", trigger: "war", triggerPlaceId: null, triggerAt: null, mode: "attack", regionId: "R047", townId: "reii", targetKind: "holding", holderPlayerId: leagueId, force: 3000, about: 3000, draws: [] });
    await pass(plus(s.strikesAt, MIN));
    const report = (await strikeOf(s.id)).report as { outcome: string; line: string };
    expect(report).toMatchObject({ outcome: "stormed", line: "The Saluvii stormed Reii. The League has lost it." });
    expect(await db.select().from(m.dbPkg.playerHoldings)).toEqual([]);
    const left = await rowsAt(leagueId, "reii");
    expect(left.length).toBeGreaterThan(0);
    const leagueOrders = await import("./leagueOrders.js");
    await db.transaction(async (tx) => {
      await leagueOrders.lockLeagueWrite(tx, lctx!);
      await leagueOrders.settleLeague(tx, { ...lctx!, league: { orderer: null } }, plus(s.strikesAt, 5 * MIN));
    });
    for (const r of left) expect((await db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.id, r.id)))[0]).toMatchObject({ basedAt: "reii", movingTo: "massalia" });
  });

  it("men who arrive between the call and the strike fight", async () => {
    const house = await makePlayer();
    await row(house.ctx.playerId, "hoplite", 40, "R060", { movingTo: "agathe", arrivesAt: plus(at(9), 6 * HOUR), mission: { kind: "move", regionId: "R050", townId: "agathe", departedAt: at(9).toISOString() } });
    const s = await march({ force: 60, about: 60 });
    await pass(plus(s.strikesAt, MIN));
    expect((await partsOf(s.id)).find((p) => p.playerId === house.ctx.playerId)).toMatchObject({ men: 40 });
    expect((await strikeOf(s.id)).report).toMatchObject({ defenders: 140 });
  });

  it("a peace calls off a war march: it turns back with its line, and nobody fights", async () => {
    await war("volcae", at(8), plus(at(9), 6 * HOUR));
    const s = await march({ trigger: "war", triggerPlaceId: null, triggerAt: null });
    await pass(plus(s.strikesAt, MIN));
    expect(await strikeOf(s.id)).toMatchObject({ status: "called_off", report: { outcome: "called_off", calledOff: "peace", line: "The Volcae turned back from Agathe: peace is made." } });
    expect(await partsOf(s.id)).toEqual([]);
    expect(await menAt(leagueId, "agathe")).toBe(100);
  });

  it("two passes at once resolve a strike once", async () => {
    for (let run = 0; run < 5; run++) {
      await db.execute(sql`TRUNCATE TABLE strike_parts, strikes, treasury_ledger CASCADE`);
      await db.update(m.dbPkg.treasuries).set({ balance: 5000 }).where(eq(m.dbPkg.treasuries.worldId, worldId));
      await db.delete(m.dbPkg.playerUnits).where(and(eq(m.dbPkg.playerUnits.ownerPlayerId, leagueId), eq(m.dbPkg.playerUnits.basedAt, "agathe")));
      await row(leagueId, "hoplite", 100, "agathe");
      const s = await march({ id: uid(910 + run), force: 3000, about: 3000 });
      const results = await Promise.all([m.strikes.resolveStrike(s.id, plus(s.strikesAt, MIN)), m.strikes.resolveStrike(s.id, plus(s.strikesAt, MIN))]);
      expect(results.filter((r) => r.outcome === "struck")).toHaveLength(1);
      const report = (await strikeOf(s.id)).report as { paid: number };
      expect((await ledger()).filter(([reason]) => String(reason).startsWith("strike:"))).toHaveLength(1);
      expect(await balance()).toBe(5000 - report.paid);
      expect(await partsOf(s.id)).toHaveLength(1);
    }
  });

  // --- what everyone sees -------------------------------------------------------------

  it("a house that fought finds the strike's report in its Barracks, its own part in it, unread until opened; a holder with no men there gets one too", async () => {
    const house = await makePlayer();
    await row(house.ctx.playerId, "hoplite", 60, "agathe");
    const s = await march({ force: 120, about: 120, draws: [{ placeId: "nemausus", kind: "town", men: 10 }, { placeId: "tolosa", kind: "town", men: 110 }] });
    await pass(plus(s.strikesAt, MIN));
    const view = await m.barracks.barracksView(house.ctx, plus(s.strikesAt, 2 * MIN));
    const lost = 60 - (await menAt(house.ctx.playerId, "agathe"));
    const report = view.reports.find((r) => r.kind === "strike")!;
    expect(report).toMatchObject({ id: s.id, kind: "strike", townId: "agathe", seen: false, title: "The Volcae at Agathe", yourPart: `60 of your men were among the defenders, and ${lost} of them fell.`, arrivedAt: s.strikesAt.toISOString() });
    expect(report).toMatchObject({ line: ((await strikeOf(s.id)).report as { line: string }).line });
    expect(JSON.stringify(report)).not.toContain("draws");
    expect(await m.barracks.markStrikeReportRead(house.ctx, s.id, plus(s.strikesAt, 3 * MIN))).toEqual({ ok: true });
    expect((await m.barracks.barracksView(house.ctx, plus(s.strikesAt, 4 * MIN))).reports.find((r) => r.kind === "strike")).toMatchObject({ seen: true });
    expect(await m.barracks.markStrikeReportRead(house.ctx, s.id, plus(s.strikesAt, 5 * MIN))).toEqual({ ok: true });
    // Another house has no such report.
    const other = await makePlayer();
    expect(await m.barracks.markStrikeReportRead(other.ctx, s.id, plus(s.strikesAt, 5 * MIN))).toEqual({ ok: false, code: 404, error: "No such report." });

    // A holder whose men were all elsewhere: his report, with no part line.
    await db.execute(sql`TRUNCATE TABLE strike_parts, strikes CASCADE`);
    const holder = await makePlayer(30);
    await db.insert(m.dbPkg.playerHoldings).values(holdingRow(holder.ctx.playerId, "R046", "", "unclaimed"));
    await row(holder.ctx.playerId, "hoplite", 5, "R060");
    const h = await march({ id: uid(901), regionId: "R046", townId: null, targetKind: "holding", holderPlayerId: holder.ctx.playerId, force: 50, about: 50 });
    await pass(plus(h.strikesAt, MIN));
    expect((await m.barracks.barracksView(holder.ctx, plus(h.strikesAt, 2 * MIN))).reports.find((r) => r.kind === "strike")).toMatchObject({ title: "The Volcae at Salyes", yourPart: null, line: `The Volcae broke into Salyes and carried off 30 drachmae from House ${houseName}.` });
  });

  // --- the alarms (strikes prompt 2) ----------------------------------------------------

  it("the alarms: a sitting official counts every march on the road, a player with no seat none; a holder sees the march on his holding and not one on another's, a guest with men there nothing; all clear when the march strikes or turns back", async () => {
    const official = await makePlayer();
    const holder = await makePlayer();
    const other = await makePlayer();
    const guest = await makePlayer();
    const plain = await makePlayer();
    await db.insert(m.dbPkg.offices).values({ worldId, office: "strategos", side: null, seatSlot: 0, holderCharacterId: official.characterId, acquiredVia: "appointed" });
    await db.insert(m.dbPkg.playerHoldings).values([holdingRow(holder.ctx.playerId, "R046", "", "unclaimed"), holdingRow(other.ctx.playerId, "R047", "reii", "saluvii")]);
    await row(holder.ctx.playerId, "hoplite", 5, "R046");
    await row(guest.ctx.playerId, "hoplite", 30, "R046");
    await row(other.ctx.playerId, "hoplite", 5, "reii");
    const alarms = (p: { ctx: Ctx; characterId: string }) => m.strikes.strikeAlarms(db, { worldId, playerId: p.ctx.playerId, characterId: p.characterId });
    // Nothing on the road: nothing for anyone.
    for (const p of [official, holder, plain]) expect(await alarms(p)).toEqual({ government: 0, incoming: [] });

    // A raids march on Agathe (a home town) and one on the holder's Salyes.
    await march({ id: uid(950), nationId: "sordones", triggerPlaceId: "R057", strikesAt: plus(at(9), 12 * HOUR) });
    const onSalyes = await march({ id: uid(951), nationId: "volcae", regionId: "R046", townId: null, targetKind: "holding", holderPlayerId: holder.ctx.playerId, force: 200, about: 200, strikesAt: plus(at(9), 13 * HOUR) });
    expect(await alarms(official)).toEqual({ government: 2, incoming: [] });
    expect(await alarms(plain)).toEqual({ government: 0, incoming: [] });
    expect(await alarms(guest)).toEqual({ government: 0, incoming: [] });
    expect(await alarms(other)).toEqual({ government: 0, incoming: [] });
    expect(await alarms(holder)).toEqual({
      government: 0,
      incoming: [{ id: onSalyes.id, nation: "the Volcae", place: "Salyes", regionId: "R046", townId: null, about: 200, strikesAt: onSalyes.strikesAt.toISOString(), line: "Raided once too often, the Volcae march on Salyes with about 200 men. They strike at 13:00 UTC." }],
    });

    // The Agathe march strikes: the official's count falls to one; the holder's entry stays.
    await pass(plus(at(9), 12 * HOUR + MIN));
    expect((await alarms(official)).government).toBe(1);
    expect((await alarms(holder)).incoming).toHaveLength(1);
    // The march on Salyes turns back (the Volcae go to war): all clear.
    await war("volcae", plus(at(9), 12 * HOUR + 30 * MIN), at(16));
    await pass(plus(at(9), 13 * HOUR + MIN));
    expect((await strikeOf(onSalyes.id)).status).toBe("called_off");
    for (const p of [official, holder]) expect(await alarms(p)).toEqual({ government: 0, incoming: [] });
  });

  it("a failure in the strikes is logged and never stops the campaigns", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await m.muster.resolveDueCampaigns(plus(at(9), MIN), {
      callStrikes: async () => {
        throw new Error("the call broke");
      },
    });
    expect(logged.mock.calls.map((c) => c[0])).toContain("strikes: failed the call broke");
  });
});
