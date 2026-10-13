import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MapActReport } from "./mapActions.js";

// ---------------------------------------------------------------------------
// The League's army takes orders (government prompt 5b). A sitting Archon or
// Strategos orders its men through the map's own act, move and resolveMarch
// with a League context: the war gate at the order and at the arrival (from
// league_wars at the instant, never the flag), Winter for its moves, naval
// supplies bought from the treasury, plunder sold to the treasury as one ledger
// row, a conquest as a League holding, what a party saw into the orderer's
// house, the holder refusals both ways, and no effect_log row anywhere.
// Integration test against a REAL Postgres, guarded to a *_test database (it
// truncates), on the synthetic clock the map suite uses (one season = one day
// from T0; season 8 is a Winter, season 9 a Spring).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const MIN = 60_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (seasons: number) => new Date(T0 + seasons * DAY);
const plus = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MIN);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const shared = await import("@massalia/shared");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const mapPools = await import("./mapPools.js");
  const holdings = await import("./holdings.js");
  const actions = await import("./mapActions.js");
  const muster = await import("./koinonMuster.js");
  const mapReach = await import("./mapReach.js");
  const league = await import("./leagueOrders.js");
  const traits = await import("./traits.js");
  const age = await import("./age.js");
  return { dbPkg, shared, buildings, barracks, mapGraph, mapPools, holdings, actions, muster, mapReach, league, traits, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

// What STOP 1 quotes: a raid at war from order to ledger, and a conquest with its first tribute.
const captures: Record<string, unknown> = {};

suite("the League's orders (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let leagueId: string;
  type Ctx = { playerId: string; worldId: string; worldStartedMs: number };
  type LeagueCtx = NonNullable<Awaited<ReturnType<Mods["league"]["leagueContext"]>>>;
  type Orderer = NonNullable<Awaited<ReturnType<Mods["league"]["ordererFor"]>>>;

  // A house with a character; `office` seats him.
  async function makePlayer(seat?: { office: string; side: string | null }) {
    const { users, players, playerCharacters, dynasties, offices, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Kleon-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    const ch = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: 20, drachmae: 1000, startAge: 30, deathAge: 90 }).returning())[0]!;
    if (seat) await db.insert(offices).values({ worldId, office: seat.office, side: seat.side, seatSlot: 0, holderCharacterId: ch.id, acquiredVia: "elected" });
    const ctx: Ctx = { playerId: player.id, worldId, worldStartedMs: T0 };
    // Stock for the upkeep a house's settle charges, and supplies for its voyages.
    for (const [type, amount] of Object.entries({ grain: 5000, oliveoil: 5000, chicken: 5000, "naval-supplies": 100 })) await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: at(0) });
    return { ctx, characterId: ch.id, dynastyId: dynasty.id, seatOf: () => m.league.ordererFor(db, { id: ch.id, worldId }) };
  }
  // An Archon of the Dynatoi and the League's context with him ordering.
  async function archon() {
    const p = await makePlayer({ office: "archon", side: "dynatoi" });
    const orderer = (await p.seatOf()) as Orderer;
    return { ...p, orderer, lctx: (await m.league.leagueContext(db, { id: worldId, startedMs: T0 }, orderer)) as LeagueCtx };
  }
  let warYear = 0;
  const war = (factionId: string, startsAt: Date, endsAt: Date) => db.insert(m.dbPkg.leagueWars).values({ worldId, factionId, gameYear: ++warYear, cost: 2000, startsAt, endsAt });

  const units = (playerId = leagueId) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt), asc(m.dbPkg.playerUnits.id));
  const standing = async (basedAt: string, unitId: string) => (await units()).filter((r) => r.basedAt === basedAt && r.unitId === unitId && r.movingTo === null);
  const leagueRow = async (basedAt: string, unitId: string) => (await standing(basedAt, unitId))[0]!;
  const houseRow = async (ctx: Ctx, unitId: string, count: number) =>
    (await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: ctx.playerId, source: "trained", unitId, count, startCount: count, recruitedSeason: 5, readyAt: at(6), basedAt: "R060", createdAt: at(5) }).returning())[0]!;
  const balance = () => m.dbPkg.treasuryBalance(worldId, "league");
  const setBalance = (value: number) => db.update(m.dbPkg.treasuries).set({ balance: value }).where(and(eq(m.dbPkg.treasuries.worldId, worldId), eq(m.dbPkg.treasuries.owner, "league")));
  const ledger = async () =>
    (await db.select({ reason: m.dbPkg.treasuryLedger.reason, delta: m.dbPkg.treasuryLedger.delta }).from(m.dbPkg.treasuryLedger).where(and(eq(m.dbPkg.treasuryLedger.worldId, worldId), eq(m.dbPkg.treasuryLedger.owner, "league"))).orderBy(m.dbPkg.treasuryLedger.createdAt, m.dbPkg.treasuryLedger.reason)).map((l) => [l.reason, l.delta]);
  const orders = () => db.select().from(m.dbPkg.leagueOrders).where(eq(m.dbPkg.leagueOrders.worldId, worldId)).orderBy(asc(m.dbPkg.leagueOrders.orderedAt));
  const marches = () => db.select().from(m.dbPkg.playerMarches).where(eq(m.dbPkg.playerMarches.worldId, worldId));
  const voyages = () => db.select().from(m.dbPkg.playerVoyages).where(eq(m.dbPkg.playerVoyages.ownerPlayerId, leagueId));
  const fleet = () => m.dbPkg.leagueFleet(db, worldId);
  const effectLogs = () => db.select().from(m.dbPkg.effectLog);
  const holdingsOf = (playerId = leagueId) => db.select().from(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, playerId));
  const setGarrison = (townId: string, value: number, when: Date) => m.mapPools.writeTownGarrison(db, worldId, townId, value, when);
  const garrison = async (townId: string) => (await db.select().from(m.dbPkg.townMilitary).where(and(eq(m.dbPkg.townMilitary.worldId, worldId), eq(m.dbPkg.townMilitary.townId, townId))))[0]?.garrison;
  const townIntelOf = async (dynastyId: string, townId: string) => (await db.select().from(m.dbPkg.townIntel).where(and(eq(m.dbPkg.townIntel.dynastyId, dynastyId), eq(m.dbPkg.townIntel.townId, townId))))[0];
  const regionIntelOf = async (dynastyId: string, regionId: string) => (await db.select().from(m.dbPkg.regionIntel).where(and(eq(m.dbPkg.regionIntel.dynastyId, dynastyId), eq(m.dbPkg.regionIntel.regionId, regionId))))[0];
  const settleLeague = (lctx: LeagueCtx, when: Date) =>
    db.transaction(async (tx) => {
      await m.league.lockLeagueWrite(tx, lctx);
      return m.league.settleLeague(tx, lctx, when);
    });
  // The party arrives as it does in the game: through the campaign hook's resolver.
  const arrive = async (marchId: string, when: Date): Promise<MapActReport> => {
    await m.muster.resolveDueCampaigns(when);
    const march = (await db.select().from(m.dbPkg.playerMarches).where(eq(m.dbPkg.playerMarches.id, marchId)))[0]!;
    expect(march.status).toBe("resolved");
    return march.report as unknown as MapActReport;
  };
  const price = (good: string, action: "buy" | "sell", when: Date) => m.league.marketPrice(good, action, when, T0);

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    await m.traits.loadTraitDefs();
    await m.age.loadAgeConfig();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_orders, league_wars, faction_relations, league_projects, player_marches, player_voyages, player_holdings, player_units, player_levy, band_offers, region_intel, region_military, town_intel, town_military, offices, resources, treasury_ledger, treasuries, effect_log, player_buildings, player_pops, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "League Orders", seed: "lorders", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
    await db.insert(m.dbPkg.treasuries).values({ worldId, owner: "league", balance: 5000 });
    expect(await m.dbPkg.ensureLeagueArmy(worldId, at(0))).toBe(true);
    leagueId = (await m.dbPkg.leaguePlayerId(db, worldId))!;
    warYear = 0;
  });

  afterAll(() => {
    if (Object.keys(captures).length) console.log(`\nLEAGUE ORDERS CAPTURES\n${JSON.stringify(captures, null, 2)}\n`);
  });

  it("only a sitting Archon or Strategos commands: an Ephor and a citizen have no seat to order from", async () => {
    expect(await (await makePlayer({ office: "archon", side: "palaioi" })).seatOf()).toMatchObject({ office: "archon", side: "palaioi" });
    expect(await (await makePlayer({ office: "strategos", side: null })).seatOf()).toMatchObject({ office: "strategos", side: null });
    expect(await (await makePlayer({ office: "ephor", side: "palaioi" })).seatOf()).toBeNull();
    expect(await (await makePlayer({ office: "party_archon", side: "dynatoi" })).seatOf()).toBeNull();
    expect(await (await makePlayer()).seatOf()).toBeNull();
    expect(m.shared.LEAGUE_COMMAND_REFUSAL).toBe("Only a sitting Archon or Strategos commands the League's army.");
  });

  it("the League's places: its ten home towns are its bases and its move targets, never the Massalia region; it has no supplies but what the treasury can buy", async () => {
    const { lctx } = await archon();
    const view = await m.mapReach.leagueMapView(db, lctx, at(9));
    expect(view.bases.map((b) => b.id)).toEqual(["massalia", "emporion", "nikaia", "olbia-provence", "rhoda", "agathe", "antipolis", "arelate", "athinopolis", "monoikos"]);
    expect(view.bases.every((b) => b.kind === "home" && b.townId === b.id && b.holding === null)).toBe(true);
    expect(view.bases[0]).toMatchObject({ id: "massalia", regionId: "R060", name: "Massalia" });
    expect(view.moveTargets.map((t) => t.id)).toEqual(view.bases.map((b) => b.id));
    expect(view.force.men).toBe(2050);
    expect(view.roster).toHaveLength(40);
    expect(view.roster.every((r) => r.canDisband === false && r.active)).toBe(true);
    expect(view.fleet.ships).toEqual({ "trade-ship": 29, galley: 40 });
    const unit = price("naval-supplies", "buy", at(9));
    expect(unit).toBeGreaterThan(0);
    expect(view).toMatchObject({ treasury: { balance: 5000 }, supplyPrice: unit, sightings: { towns: {}, regions: {} } });
    expect(view.fleet.supplies).toBe(Math.floor(5000 / unit));
    // The war gate, by place: a nation at peace, land of no nation; Massalia's own is not in it.
    expect(view.gate.towns.reii).toBe("The League is not at war with the Saluvii.");
    expect(view.gate.towns.aleria).toBe("The League makes war only on nations, and no nation holds this land.");
    expect(view.gate.regions.R046).toBe("The League makes war only on nations, and no nation holds this land.");
    expect(view.gate.towns.nikaia).toBeUndefined();
    // At war with the Saluvii, their town passes the gate.
    await war("saluvii", at(8), at(16));
    expect((await m.mapReach.leagueMapView(db, lctx, at(9))).gate.towns.reii).toBeUndefined();
    expect((await m.mapReach.leagueMapView(db, lctx, at(16))).gate.towns.reii).toBe("The League is not at war with the Saluvii.");
  });

  it("a raid or an attack on a nation at peace is refused, and so is one on land of no nation; nothing is written. The gate reads league_wars at the instant, never the flag", async () => {
    const { lctx } = await archon();
    const peltasts = await leagueRow("massalia", "peltast");
    const send = (type: "raid" | "attack" | "scout", target: { townId: string } | { regionId: string }, when = at(9)) => m.actions.act(lctx, { type, ...target, rows: [{ rowId: peltasts.id, count: 40 }] }, when);
    for (const type of ["raid", "attack"] as const) {
      expect(await send(type, { townId: "reii" })).toEqual({ ok: false, code: 409, error: "The League is not at war with the Saluvii." });
      expect(await send(type, { regionId: "R046" })).toEqual({ ok: false, code: 409, error: "The League makes war only on nations, and no nation holds this land." });
    }
    // The flag alone is no war, and a war that has not begun or is over is none.
    await db.insert(m.dbPkg.factionRelations).values({ worldId, factionId: "saluvii", stance: "hostile", opinion: -200, atWar: true });
    expect(await send("raid", { townId: "reii" })).toMatchObject({ ok: false, error: "The League is not at war with the Saluvii." });
    await war("saluvii", at(10), at(11));
    expect(await send("raid", { townId: "reii" }, at(9))).toMatchObject({ ok: false, error: "The League is not at war with the Saluvii." });
    expect(await send("raid", { townId: "reii" }, at(11))).toMatchObject({ ok: false, error: "The League is not at war with the Saluvii." });
    // Nothing was written: no split, no march, no order, no ledger row.
    expect(await standing("massalia", "peltast")).toHaveLength(1);
    expect((await leagueRow("massalia", "peltast")).count).toBe(250);
    expect(await marches()).toEqual([]);
    expect(await orders()).toEqual([]);
    expect(await ledger()).toEqual([]);
    // Inside the war the same order sets out.
    expect(await send("raid", { townId: "reii" }, at(10))).toMatchObject({ ok: true });
  });

  it("a raid at war: the party fights, the plunder is sold to the treasury as one ledger row, no grudge is rolled, the order is recorded, the orderer's house sees what the men saw, and the men come home", async () => {
    const { lctx, ctx: own, characterId, dynastyId, orderer } = await archon();
    expect(orderer.name).toMatch(/^Kleon-/);
    await war("saluvii", at(8), at(16));
    await setGarrison("reii", 10, at(9)); // 3 meet the raid behind walls 1: 2 or 3 are slain on every seed
    const peltasts = await leagueRow("massalia", "peltast");
    const res = await m.actions.act(lctx, { type: "raid", townId: "reii", rows: [{ rowId: peltasts.id, count: 40 }] }, at(9));
    if (!res.ok) throw new Error(res.error);
    const marchId = res.report.marchId;
    // The order: who gave it, from which seat, what he sent, and its march.
    const order = (await orders())[0]!;
    expect(await orders()).toHaveLength(1);
    expect(order).toMatchObject({ orderedByCharacterId: characterId, orderedByName: orderer.name, office: "archon", side: "dynatoi", kind: "raid", baseId: "massalia", regionId: "R047", townId: "reii", men: 40, force: [{ unitId: "peltast", count: 40 }], ships: {}, supplies: 0, suppliesCost: 0, marchId, report: null, orderedAt: at(9), arrivesAt: plus(at(9), 30) });
    // The order keeps his name as he gave it: an heir who takes the players row later does not rename it.
    await db.update(m.dbPkg.players).set({ name: "Kleon II" }).where(eq(m.dbPkg.players.id, own.playerId));
    expect((await orders())[0]!.orderedByName).toBe(orderer.name);
    // 40 split from the 250 and are on the road; the answer is the League's map again.
    expect((await leagueRow("massalia", "peltast")).count).toBe(210);
    expect(res.roster).toHaveLength(41);
    expect(res.force.men).toBe(2010);
    // The League's own settle never lands a party on its way out.
    await settleLeague(lctx, plus(at(9), 45));
    expect((await units()).find((r) => r.mission?.marchId === marchId)).toMatchObject({ count: 40, movingTo: "reii" });

    const report = await arrive(marchId, plus(at(9), 45));
    expect(report).toMatchObject({ type: "raid", townId: "reii", winner: "attacker", opinion: null, conquest: null, defender: { label: "Town garrison", start: 10, turnout: 3 } });
    const killed = report.defender!.losses;
    expect([2, 3]).toContain(killed);
    const plunder = report.plunder!;
    const spoil = plunder.spoil!;
    // The war's plunder: the town's double times the war's 1.5, from the same gate.
    const raid = m.barracks.getBattleContent().raid;
    for (const [amount, bounds] of [[plunder.drachmae, m.shared.rateBounds(raid.plunderPerKill)], [plunder.grain, m.shared.rateBounds(raid.grainPerKill)], [spoil.amount, m.shared.rateBounds(raid.spoilPerKill)]] as const) {
      const rate = amount / (killed * 3);
      expect(Number.isInteger(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(bounds.min);
      expect(rate).toBeLessThanOrEqual(bounds.max);
    }
    // One ledger row: the drachmae, and the grain and the spoil at what the market pays at the arrival.
    const arrival = plus(at(9), 30);
    const sold = plunder.grain * price("grain", "sell", arrival) + spoil.amount * price(spoil.good, "sell", arrival);
    expect(sold).toBeGreaterThan(0);
    expect(await ledger()).toEqual([[`plunder:reii:${marchId}`, plunder.drachmae + sold]]);
    expect(await balance()).toBe(5000 + plunder.drachmae + sold);
    expect(m.shared.treasuryReasonLabel(`plunder:reii:${marchId}`, undefined, plunder.drachmae + sold, () => "Reii")).toBe("Plunder of Reii");
    // Sold, not stocked; no grudge row; the garrison is thinned.
    expect(await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, leagueId), sql`type NOT IN ('trade-ship', 'galley')`))).toEqual([]);
    expect(await db.select().from(m.dbPkg.factionRelations)).toEqual([]);
    expect(await garrison("reii")).toBe(10 - killed);
    // What the men saw is the League's, on the report and in its sightings; the orderer's house learns nothing.
    expect(report.intel).toMatchObject({ warband: 10 - killed, pentekonters: 0, triremes: 0 });
    expect((await m.league.leagueSightings(db, lctx)).towns.reii).toEqual({ garrison: 10 - killed, pentekonters: 0, triremes: 0, scoutedGameDate: report.intel!.scoutedGameDate });
    expect(await townIntelOf(dynastyId, "reii")).toBeUndefined();
    expect(await db.select().from(m.dbPkg.townIntel)).toEqual([]);
    // The League has no character: not one effect_log row, for the split, the losses or the report.
    expect(await effectLogs()).toEqual([]);
    // The men are on the road home, and the League's settle lands them and folds them in.
    const lost = report.attacker.losses;
    expect((await units()).filter((r) => r.movingTo === "massalia").reduce((n, r) => n + r.count, 0)).toBe(40 - lost);
    await settleLeague(lctx, plus(at(9), 60));
    expect(await standing("massalia", "peltast")).toHaveLength(1);
    expect((await leagueRow("massalia", "peltast")).count).toBe(250 - lost);
    captures.raidAtWar = { order: { ...order, id: "<order id>", orderedByCharacterId: "<the Archon>", worldId: "<world>", marchId: "<march id>" }, report: { ...report, marchId: "<march id>" }, ledger: (await ledger()).map(([reason, delta]) => [String(reason).replace(marchId, "<march id>"), delta]), balance: await balance() };
  });

  it("a party that arrives after the peace turns back whole, with the peace's line, and takes nothing", async () => {
    const { lctx } = await archon();
    await war("saluvii", at(8), plus(at(9), 10)); // peace ten minutes after the order, twenty before the arrival
    await setGarrison("reii", 10, at(9));
    const hoplites = await leagueRow("massalia", "hoplite");
    const res = await m.actions.act(lctx, { type: "attack", townId: "reii", rows: [{ rowId: hoplites.id, count: 60 }] }, at(9));
    if (!res.ok) throw new Error(res.error);
    const report = await arrive(res.report.marchId, plus(at(9), 30));
    expect(report).toMatchObject({ type: "attack", winner: "turned_back", rounds: 0, attacker: { losses: 0 }, defender: null, plunder: null, conquest: null, intel: null, opinion: null, line: "60 hoplites reached Reii after the peace with the Saluvii and turned back.", homeAt: plus(at(9), 60).toISOString() });
    expect(await garrison("reii")).toBe(10);
    expect(await holdingsOf()).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect((await units()).filter((r) => r.movingTo === "massalia").reduce((n, r) => n + r.count, 0)).toBe(60);
    await settleLeague(lctx, plus(at(9), 60));
    expect((await leagueRow("massalia", "hoplite")).count).toBe(500);
    expect(await effectLogs()).toEqual([]);
  });

  it("an attack at war takes the town as a League holding: every map shows it held by the League, its men stand there, and its tribute goes to the treasury", async () => {
    const { lctx, dynastyId } = await archon();
    await war("saluvii", at(8), at(16));
    await setGarrison("reii", 10, at(9));
    const hoplites = await leagueRow("massalia", "hoplite");
    const res = await m.actions.act(lctx, { type: "attack", townId: "reii", rows: [{ rowId: hoplites.id, count: 60 }] }, at(9));
    if (!res.ok) throw new Error(res.error);
    const arrival = plus(at(9), 30);
    const report = await arrive(res.report.marchId, arrival);
    expect(report).toMatchObject({ type: "attack", winner: "attacker", conquest: { regionId: "R047", townId: "reii", previousOwner: "saluvii" }, destination: "reii", homeAt: null, opinion: null });
    expect(await garrison("reii")).toBe(0);
    const held = await holdingsOf();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ regionId: "R047", townId: "reii", kind: "conquest", previousOwner: "saluvii", lastGarrisonedAt: arrival, lastTributeAt: arrival });
    const survivors = 60 - report.attacker.losses;
    expect(await standing("reii", "hoplite")).toMatchObject([{ count: survivors, mission: null }]);
    expect((await m.league.leagueSightings(db, lctx)).towns.reii).toMatchObject({ garrison: 0 });
    expect(await townIntelOf(dynastyId, "reii")).toBeUndefined();
    // Every player's map reads the holder: the League's name, no house, and the League's mark.
    const world = await m.holdings.listWorldHoldings(db, worldId);
    expect(world).toEqual([{ regionId: "R047", townId: "reii", playerId: leagueId, characterName: "The League", houseName: null, league: true }]);
    // The town is one of the League's places now: a base with what it pays, and a move target.
    const view = await m.mapReach.leagueMapView(db, lctx, plus(arrival, 1));
    const rate = await m.holdings.tributeRateOf({ regionId: "R047", townId: "reii" });
    expect(view.bases.find((b) => b.id === "reii")).toMatchObject({ kind: "conquest", regionId: "R047", townId: "reii", name: "Reii", holding: { garrison: survivors, minGarrison: rate.minGarrison, perDay: { drachmae: rate.drachmae }, levyPerYear: 0 } });
    expect(view.moveTargets.some((t) => t.id === "reii")).toBe(true);
    // A day on, its first tribute is in the treasury, as one ledger row.
    expect(survivors).toBeGreaterThanOrEqual(rate.minGarrison);
    const day = new Date(arrival.getTime() + DAY);
    expect(await m.league.settleLeagueIfDue(day)).toBe(true);
    const tributeReason = `tribute:reii:d${Math.floor(day.getTime() / DAY)}`;
    expect(await ledger()).toEqual([[tributeReason, rate.drachmae]]);
    expect(await balance()).toBe(5000 + rate.drachmae);
    expect(m.shared.treasuryReasonLabel(tributeReason, undefined, rate.drachmae, () => "Reii")).toBe("Tribute of Reii");
    expect(await effectLogs()).toEqual([]);
    captures.conquest = { report: { ...report, marchId: "<march id>" }, holding: world.map((h) => ({ ...h, playerId: "<the League>" })), ledger: await ledger(), balance: await balance() };
  });

  it("a scout goes where a house's may, at peace and on land of no nation, and what it sees is the League's: on its report and the League's map, never in the orderer's house's intel", async () => {
    const { lctx, dynastyId } = await archon();
    const riders = await leagueRow("massalia", "hippeis");
    const res = await m.actions.act(lctx, { type: "scout", regionId: "R046", rows: [{ rowId: riders.id, count: 5 }] }, at(9));
    if (!res.ok) throw new Error(res.error);
    const report = await arrive(res.report.marchId, plus(at(9), 30));
    expect(report).toMatchObject({ type: "scout", winner: null });
    expect(report.intel!.warband).toBeGreaterThan(0);
    expect(await regionIntelOf(dynastyId, "R046")).toBeUndefined();
    expect(await db.select().from(m.dbPkg.regionIntel)).toEqual([]);
    // The League's map carries the sighting for whoever commands next; before it, there was none.
    const view = await m.mapReach.leagueMapView(db, lctx, plus(at(9), 31));
    expect(view.sightings).toEqual({ towns: {}, regions: { R046: { warband: report.intel!.warband, scoutedGameDate: report.intel!.scoutedGameDate } } });
    // A second official, of another house, reads the same sighting; neither house has it.
    const other = await makePlayer({ office: "strategos", side: null });
    const otherCtx = (await m.league.leagueContext(db, { id: worldId, startedMs: T0 }, (await other.seatOf())!))!;
    expect((await m.mapReach.leagueMapView(db, otherCtx, plus(at(9), 31))).sightings.regions.R046).toBeDefined();
    expect(await regionIntelOf(other.dynastyId, "R046")).toBeUndefined();
    expect((await orders())[0]).toMatchObject({ kind: "scout", regionId: "R046", townId: null, men: 5, force: [{ unitId: "hippeis", count: 5 }] });
    // A town of a nation at peace is scouted too.
    const more = await m.actions.act(lctx, { type: "scout", townId: "reii", rows: [{ rowId: (await leagueRow("massalia", "hippeis")).id, count: 5 }] }, at(9));
    expect(more).toMatchObject({ ok: true });
    expect(await effectLogs()).toEqual([]);
  });

  it("a move: refused in Winter, as nothing of the League's sets out then; a house's move is not. In Spring the men go to another League town and the order carries the report", async () => {
    const { lctx, characterId } = await archon();
    const hoplites = await leagueRow("massalia", "hoplite");
    const move = (baseId: string, when: Date) => m.actions.move(lctx, { baseId, rows: [{ rowId: hoplites.id, count: 30 }] }, when);
    expect(m.shared.campaignSeason(at(8).getTime(), T0)).toMatchObject({ season: "Winter", open: false });
    expect(await move("arelate", at(8))).toEqual({ ok: false, code: 409, error: "The passes are closed until spring." });
    expect(await orders()).toEqual([]);
    expect(await standing("massalia", "hoplite")).toMatchObject([{ count: 500 }]);
    // A house's move has no such rule.
    const house = await makePlayer();
    const own = await houseRow(house.ctx, "hoplite", 20);
    expect(await m.actions.move(house.ctx, { baseId: "arelate", rows: [{ rowId: own.id, count: 20 }] }, at(8))).toMatchObject({ ok: true });

    // The League's men move only between its own places.
    expect(await move("R060", at(9))).toEqual({ ok: false, code: 409, error: "The League's men move only between its towns and its holdings." });
    expect(await move("reii", at(9))).toEqual({ ok: false, code: 409, error: "The League's men move only between its towns and its holdings." });
    expect(await move("massalia", at(9))).toEqual({ ok: false, code: 409, error: "The men already stand there." });

    const logsBefore = (await effectLogs()).length; // the house's own move
    const res = await move("arelate", at(9));
    if (!res.ok) throw new Error(res.error);
    expect(res.report).toMatchObject({ type: "move", from: "massalia", fromName: "Massalia", baseId: "arelate", townId: "arelate", men: 30 });
    const order = (await orders())[0]!;
    expect(order).toMatchObject({ orderedByCharacterId: characterId, kind: "move", baseId: "massalia", townId: "arelate", men: 30, force: [{ unitId: "hoplite", count: 30 }], marchId: null, arrivesAt: new Date(res.report.arrivesAt) });
    expect(order.report).toMatchObject({ type: "move", line: res.report.line });
    expect((await effectLogs()).length).toBe(logsBefore);
    expect(await marches()).toEqual([]);
    // The road ends: the League's settle stands them at Arelate with the men already there.
    await settleLeague(lctx, new Date(res.report.arrivesAt));
    expect(await standing("arelate", "hoplite")).toMatchObject([{ count: 50 + 30 }]);
    expect(await standing("massalia", "hoplite")).toMatchObject([{ count: 470 }]);
  });

  it("a voyage: the naval supplies are bought from the treasury at what the market asks, as one ledger row with the order's id; one the treasury cannot pay is refused and writes nothing", async () => {
    const { lctx } = await archon();
    await war("carthage", at(8), at(16));
    const peltasts = await leagueRow("massalia", "peltast");
    const send = () => m.actions.act(lctx, { type: "raid", townId: "thapsus", rows: [{ rowId: peltasts.id, count: 40 }] }, at(9));
    const unit = price("naval-supplies", "buy", at(9));
    const cost = 2 * unit; // two pentekonters carry 40 men; a trireme cannot make five seas, so no escort sails

    // One drachma short: refused, and nothing moved or was written.
    await setBalance(cost - 1);
    expect(await send()).toEqual({ ok: false, code: 409, error: m.shared.leagueSuppliesRefusal(cost, cost - 1) });
    expect(m.shared.leagueSuppliesRefusal(1568, 912)).toBe("The treasury cannot pay for the voyage: 1,568 drachmae of naval supplies, 912 in the treasury.");
    expect(await standing("massalia", "peltast")).toMatchObject([{ count: 250 }]);
    expect(await marches()).toEqual([]);
    expect(await voyages()).toEqual([]);
    expect(await orders()).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect(await balance()).toBe(cost - 1);
    expect(await fleet()).toEqual({ pentekonters: 29, triremes: 40 });

    // With the money: the party sails, and the treasury paid.
    await setBalance(5000);
    const res = await send();
    if (!res.ok) throw new Error(res.error);
    expect(res.report).toMatchObject({ route: "sea", steps: 5, ships: { "trade-ship": 2 }, supplies: 2 });
    const order = (await orders())[0]!;
    expect(order).toMatchObject({ kind: "raid", townId: "thapsus", ships: { "trade-ship": 2 }, supplies: 2, suppliesCost: cost });
    expect(await ledger()).toEqual([[`supplies:${order.id}`, -cost]]);
    expect(m.shared.treasuryReasonLabel(`supplies:${order.id}`)).toBe("Naval supplies");
    expect(await balance()).toBe(5000 - cost);
    expect(await fleet()).toEqual({ pentekonters: 27, triremes: 40 });
    // No stock of supplies was ever the League's.
    expect(await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, leagueId), eq(m.dbPkg.resources.type, "naval-supplies")))).toEqual([]);
    // Thapsus's fleet turns two pentekonters away; the men sail home, and the hulls come back to stock.
    const report = await arrive(res.report.marchId, new Date(res.report.arrivesAt));
    expect(report).toMatchObject({ winner: "repulsed", plunder: null, opinion: null });
    const back = (await voyages())[0]!.returnsAt;
    expect(await m.league.settleLeagueIfDue(back)).toBe(true);
    expect(await fleet()).toEqual({ pentekonters: 29, triremes: 40 });
    expect((await leagueRow("massalia", "peltast")).count).toBe(250);
    expect(await effectLogs()).toEqual([]);
  });

  it("holders, both ways: a house may not raid or attack what the League holds, nor the League what a house holds, and a house's party that finds the League there turns back", async () => {
    const { lctx } = await archon();
    await war("saluvii", at(8), at(16));
    const house = await makePlayer();
    const own = await houseRow(house.ctx, "peltast", 40);
    const houseSends = (type: "raid" | "attack" | "scout") => m.actions.act(house.ctx, { type, townId: "reii", rows: [{ rowId: own.id, count: 40 }] }, at(9));
    const peltasts = await leagueRow("massalia", "peltast");
    const leagueSends = (type: "raid" | "attack") => m.actions.act(lctx, { type, townId: "reii", rows: [{ rowId: peltasts.id, count: 40 }] }, at(9));

    // The League holds Reii.
    await m.holdings.insertTownConquest(db, lctx, "R047", "reii", "saluvii", at(8));
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: leagueId, source: "trained", unitId: "hoplite", count: 30, startCount: 30, recruitedSeason: 0, readyAt: at(0), basedAt: "reii", createdAt: at(8) });
    expect(await houseSends("raid")).toEqual({ ok: false, code: 409, error: "The League holds this town." });
    expect(await houseSends("attack")).toEqual({ ok: false, code: 409, error: "The League holds this town." });
    expect(await leagueSends("raid")).toEqual({ ok: false, code: 409, error: "The League holds this town." });
    expect(await leagueSends("attack")).toEqual({ ok: false, code: 409, error: "The League holds this town." });

    // A house holds it instead: the League is refused as another house would be, war or no war.
    await db.update(m.dbPkg.playerHoldings).set({ ownerPlayerId: house.ctx.playerId }).where(eq(m.dbPkg.playerHoldings.townId, "reii"));
    expect(await leagueSends("raid")).toEqual({ ok: false, code: 409, error: "Another house holds this town." });
    expect(await leagueSends("attack")).toEqual({ ok: false, code: 409, error: "Another house holds this town." });
    expect(await houseSends("raid")).toEqual({ ok: false, code: 409, error: "You hold this town." });

    // No one holds it when a house's raid sets out; the League has it by the time the party arrives.
    await db.delete(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.townId, "reii"));
    const res = await houseSends("raid");
    if (!res.ok) throw new Error(res.error);
    await m.holdings.insertTownConquest(db, lctx, "R047", "reii", "saluvii", plus(at(9), 1));
    const report = await arrive(res.report.marchId, plus(at(9), 30));
    expect(report).toMatchObject({ winner: "turned_back", attacker: { losses: 0 }, line: "40 peltasts found Reii held by the League and turned back." });
  });

  // Ruling at STOP 1: nothing of the army's reaches an official. Its men, its
  // hulls and its places are never mixed with a house's, in either direction.
  it("no mix, both ways: a League order naming a house's row is refused, a house's order naming a League row is refused, a house cannot sail the League's hulls, and neither stands men in the other's holding", async () => {
    const { lctx, ctx: own } = await archon();
    await war("saluvii", at(8), at(16));
    // The Archon's own men, at his house's base, and the League's, in Massalia.
    const mine = await houseRow(own, "peltast", 40);
    const leagues = await leagueRow("massalia", "peltast");
    const noSuch = { ok: false, code: 404, error: "No such unit." };

    // The League's order, naming his own row, alone or beside a League row.
    for (const rows of [[{ rowId: mine.id, count: 40 }], [{ rowId: leagues.id, count: 40 }, { rowId: mine.id, count: 40 }]]) {
      expect(await m.actions.act(lctx, { type: "raid", townId: "reii", rows }, at(9))).toEqual(noSuch);
      expect(await m.actions.act(lctx, { type: "scout", regionId: "R046", rows }, at(9))).toEqual(noSuch);
      expect(await m.actions.move(lctx, { baseId: "arelate", rows }, at(9))).toEqual(noSuch);
    }
    // His own order, naming a League row, alone or beside his own.
    for (const rows of [[{ rowId: leagues.id, count: 40 }], [{ rowId: mine.id, count: 40 }, { rowId: leagues.id, count: 40 }]]) {
      expect(await m.actions.act(own, { type: "raid", townId: "reii", rows }, at(9))).toEqual(noSuch);
      expect(await m.actions.act(own, { type: "scout", regionId: "R046", rows }, at(9))).toEqual(noSuch);
      expect(await m.actions.move(own, { baseId: "arelate", rows }, at(9))).toEqual(noSuch);
    }

    // The League's hulls carry the League's men alone. His house has no ship,
    // so to him the fleet reaches nowhere, whether he names the League's hulls
    // or leaves the crossing to the server: 29 pentekonters in port are not his.
    const noFleet = { ok: false, code: 409, error: "Beyond the fleet's range (5 seas, fleet reaches 0)." };
    expect(await m.actions.act(own, { type: "raid", townId: "thapsus", rows: [{ rowId: mine.id, count: 40 }], ships: { "trade-ship": 2 } }, at(9))).toEqual(noFleet);
    expect(await m.actions.act(own, { type: "raid", townId: "thapsus", rows: [{ rowId: mine.id, count: 40 }] }, at(9))).toEqual(noFleet);
    expect((await m.mapReach.reachView(db, own, at(9))).fleet.ships).toEqual({ "trade-ship": 0, galley: 0 });
    expect(await fleet()).toEqual({ pentekonters: 29, triremes: 40 });
    expect(await voyages()).toEqual([]);

    // Places: the League's men move only between the League's, and a house's
    // men are not sent to a League holding (taken this instant, so no tribute is yet due).
    await m.holdings.insertTownConquest(db, lctx, "R047", "reii", "saluvii", at(9));
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: leagueId, source: "trained", unitId: "hoplite", count: 30, startCount: 30, recruitedSeason: 0, readyAt: at(0), basedAt: "reii", createdAt: at(8) });
    expect(await m.actions.move(own, { baseId: "reii", rows: [{ rowId: mine.id, count: 40 }] }, at(9))).toEqual({ ok: false, code: 409, error: "Men may only be sent to Massalia's own ground or a holding of yours." });
    await m.holdings.insertConquest(db, own, "R046", "unclaimed", at(8));
    expect(await m.actions.move(lctx, { baseId: "R046", rows: [{ rowId: leagues.id, count: 40 }] }, at(9))).toEqual({ ok: false, code: 409, error: "The League's men move only between its towns and its holdings." });

    // Nothing moved and nothing was written: every row whole and standing, no march, no order, no ledger row.
    expect(await standing("massalia", "peltast")).toMatchObject([{ count: 250 }]);
    expect((await units(own.playerId)).map((r) => [r.count, r.basedAt, r.movingTo])).toEqual([[40, "R060", null]]);
    expect(await marches()).toEqual([]);
    expect(await orders()).toEqual([]);
    expect(await ledger()).toEqual([]);
  });

  // Ruling 3 at STOP 1: no harvest of the League's work.
  it("no harvest: for a year after the League's army fights at a place, the house of a sitting Archon or Strategos may not raid or attack it; a scout may, and so may an Ephor's house and a citizen's", async () => {
    const a = await archon();
    await war("saluvii", at(8), at(20));
    await setGarrison("reii", 10, at(9));
    const sent = await m.actions.act(a.lctx, { type: "raid", townId: "reii", rows: [{ rowId: (await leagueRow("massalia", "peltast")).id, count: 40 }] }, at(9));
    if (!sent.ok) throw new Error(sent.error);
    const fought = plus(at(9), 30);
    expect((await arrive(sent.report.marchId, fought)).winner).toBe("attacker");

    // A year of four seasons from the fight: season 13, half an hour in.
    const ends = plus(at(13), 30);
    const until = m.shared.formatGameDate(m.shared.gameDate(ends.getTime(), T0));
    const sentence = `The League's army fought at Reii. No Archon or Strategos may raid or attack it with his own men until ${until}.`;
    expect(await m.league.leagueHarvestMap(db, a.lctx, at(10))).toEqual({ towns: { reii: sentence }, regions: {} });

    const strategos = await makePlayer({ office: "strategos", side: null });
    const ephor = await makePlayer({ office: "ephor", side: "palaioi" });
    const citizen = await makePlayer();
    // Each house has 200 peltasts at its base and sends 20 of them at a time (the
    // house's settle folds its standing rows into one, so the row is read back each time).
    for (const who of [a, strategos, ephor, citizen]) await houseRow(who.ctx, "peltast", 200);
    const send = async (who: { ctx: Ctx }, type: "raid" | "attack" | "scout", when: Date) => {
      const row = (await units(who.ctx.playerId)).find((r) => r.movingTo === null)!;
      return m.actions.act(who.ctx, { type, townId: "reii", rows: [{ rowId: row.id, count: 20 }] }, when);
    };
    const refused = { ok: false, code: 409, error: sentence };
    // The Archon who ordered it, and a Strategos who did not: both sit, both are refused.
    expect(await send(a, "raid", at(10))).toEqual(refused);
    expect(await send(a, "attack", at(10))).toEqual(refused);
    expect(await send(strategos, "raid", at(10))).toEqual(refused);
    expect(await send(strategos, "attack", at(10))).toEqual(refused);
    // A scout is no harvest; an Ephor commands no army, and a citizen none.
    expect(await send(a, "scout", at(10))).toMatchObject({ ok: true });
    expect(await send(ephor, "raid", at(10))).toMatchObject({ ok: true });
    expect(await send(citizen, "raid", at(10))).toMatchObject({ ok: true });
    // The refusals wrote nothing for the two officials but the Archon's scout.
    expect((await marches()).filter((x) => x.ownerPlayerId === strategos.ctx.playerId)).toEqual([]);
    expect((await marches()).filter((x) => x.ownerPlayerId === a.ctx.playerId).map((x) => x.kind)).toEqual(["scout"]);

    // To the last minute of the year, and no longer.
    expect(await send(strategos, "raid", plus(at(13), 29))).toEqual(refused);
    expect(await m.league.leagueHarvestMap(db, a.lctx, ends)).toEqual({ towns: {}, regions: {} });
    expect(await send(strategos, "raid", ends)).toMatchObject({ ok: true });
  });

  it("no harvest reads the seat at the order: an official who has left his seat is refused nothing", async () => {
    const a = await archon();
    // A raid that fights at Reii; then the Archon leaves his seat.
    await war("saluvii", at(8), plus(at(9), 60));
    await setGarrison("reii", 10, at(9));
    const sent = await m.actions.act(a.lctx, { type: "raid", townId: "reii", rows: [{ rowId: (await leagueRow("massalia", "peltast")).id, count: 40 }] }, at(9));
    if (!sent.ok) throw new Error(sent.error);
    expect((await arrive(sent.report.marchId, plus(at(9), 30))).winner).toBe("attacker");
    const own = await houseRow(a.ctx, "peltast", 40);
    const raid = (townId: string, when: Date) => m.actions.act(a.ctx, { type: "raid", townId, rows: [{ rowId: own.id, count: 40 }] }, when);
    expect(await raid("reii", at(10))).toMatchObject({ ok: false, error: expect.stringMatching(/^The League's army fought at Reii\./) });
    await db.delete(m.dbPkg.offices).where(eq(m.dbPkg.offices.holderCharacterId, a.characterId));
    expect(await raid("reii", at(10))).toMatchObject({ ok: true });
  });

  it("a scout, a party that turned back and a landing driven off are no fight: the officials' houses are refused nothing there", async () => {
    const a = await archon();
    // A scout of the Salyes; an attack on Reii that arrives after the peace; a raid on Thapsus driven off at sea.
    await war("saluvii", at(8), plus(at(9), 10));
    await war("carthage", at(8), at(20));
    const riders = await leagueRow("massalia", "hippeis");
    const scouted = await m.actions.act(a.lctx, { type: "scout", regionId: "R046", rows: [{ rowId: riders.id, count: 5 }] }, at(9));
    const turned = await m.actions.act(a.lctx, { type: "attack", townId: "reii", rows: [{ rowId: (await leagueRow("massalia", "hoplite")).id, count: 60 }] }, at(9));
    const landed = await m.actions.act(a.lctx, { type: "raid", townId: "thapsus", rows: [{ rowId: (await leagueRow("massalia", "peltast")).id, count: 40 }] }, at(9));
    if (!scouted.ok || !turned.ok || !landed.ok) throw new Error("an order was refused");
    expect((await arrive(scouted.report.marchId, plus(at(9), 30))).winner).toBeNull();
    expect((await arrive(turned.report.marchId, plus(at(9), 30))).winner).toBe("turned_back");
    expect((await arrive(landed.report.marchId, new Date(landed.report.arrivesAt))).winner).toBe("repulsed");
    expect(await m.league.leagueHarvestMap(db, a.lctx, at(10))).toEqual({ towns: {}, regions: {} });
    // The Archon's own men raid the Salyes and Reii as any house's may.
    const own = await houseRow(a.ctx, "peltast", 80);
    expect(await m.actions.act(a.ctx, { type: "raid", regionId: "R046", rows: [{ rowId: own.id, count: 40 }] }, at(10))).toMatchObject({ ok: true });
    const rest = (await units(a.ctx.playerId)).find((r) => r.movingTo === null)!;
    expect(await m.actions.act(a.ctx, { type: "raid", townId: "reii", rows: [{ rowId: rest.id, count: 40 }] }, at(10))).toMatchObject({ ok: true });
  });

  it("a League battle with the Temple standing: its blessing is the League's army's too", async () => {
    const { lctx } = await archon();
    // The Temple of Artemis stood at season 4: every army's morale is raised for 8 seasons.
    await db.insert(m.dbPkg.leagueProjects).values({ worldId, cityId: "massalia", buildingId: "temple", cost: 1000, startedAt: at(0), completesAt: at(4) });
    const blessing = await db.transaction((tx) => m.barracks.moraleBonusFor(tx, worldId, [leagueId], plus(at(9), 30)));
    expect(blessing.get(leagueId)).toBe(3);
    await war("saluvii", at(8), at(16));
    const report = await fightReii(lctx);
    expect(TEMPLE_OUTCOMES.blessed).toContain(report.winner);
    expect(report.line).toMatch(/^Attacked Reii with 60 hoplites and withdrew/);
  });

  it("the same League battle with no Temple: the men fight on their own morale", async () => {
    const { lctx } = await archon();
    const blessing = await db.transaction((tx) => m.barracks.moraleBonusFor(tx, worldId, [leagueId], plus(at(9), 30)));
    expect(blessing.get(leagueId) ?? 0).toBe(0);
    await war("saluvii", at(8), at(16));
    const report = await fightReii(lctx);
    expect(TEMPLE_OUTCOMES.unblessed).toContain(report.winner);
    expect(report.line).toMatch(/^Attacked Reii with 60 hoplites and were broken/);
  });
  // 60 hoplites against a garrison of 120 behind Reii's walls. On every seed
  // (the pure resolver over 400 of them): steadied by the Temple's +3 they stand
  // and withdraw; without it they break.
  const TEMPLE_GARRISON = 120;
  const TEMPLE_OUTCOMES = { blessed: ["stand"], unblessed: ["defender"] };
  const fightReii = async (lctx: LeagueCtx) => {
    await setGarrison("reii", TEMPLE_GARRISON, at(9));
    const hoplites = await leagueRow("massalia", "hoplite");
    const res = await m.actions.act(lctx, { type: "attack", townId: "reii", rows: [{ rowId: hoplites.id, count: 60 }] }, at(9));
    if (!res.ok) throw new Error(res.error);
    return arrive(res.report.marchId, plus(at(9), 30));
  };

  it("an order and the army's upkeep settle at once, twenty rounds: both finish and neither deadlocks", async () => {
    const { lctx } = await archon();
    await setBalance(50_000); // twenty seasons of upkeep within the treasury, so no man deserts
    let sent = 0;
    for (let round = 0; round < 20; round++) {
      const when = at(10 + round); // a new season each round: the upkeep is due
      const hoplites = await leagueRow("massalia", "hoplite");
      const [army, order] = await Promise.all([m.dbPkg.settleLeagueArmy(when), m.actions.move(lctx, { baseId: "arelate", rows: [{ rowId: hoplites.id, count: 1 }] }, when)]);
      expect(army.charged, `round ${round}`).toBe(true);
      // In a Winter the order is refused, after taking the same locks.
      if (m.shared.campaignSeason(when.getTime(), T0).open) {
        expect(order, `round ${round}`).toMatchObject({ ok: true });
        sent++;
      } else expect(order, `round ${round}`).toEqual({ ok: false, code: 409, error: "The passes are closed until spring." });
    }
    expect(sent).toBe(15);
    expect((await ledger()).filter(([reason]) => String(reason).startsWith("army:s"))).toHaveLength(20);
    expect(await orders()).toHaveLength(15);
    await settleLeague(lctx, at(31));
    expect(await standing("arelate", "hoplite")).toMatchObject([{ count: 50 + 15 }]);
    expect(await standing("massalia", "hoplite")).toMatchObject([{ count: 500 - 15 }]);
  });
});
