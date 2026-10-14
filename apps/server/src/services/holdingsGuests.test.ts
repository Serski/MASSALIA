import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Holdings prompt 3: every house may stand in another house's holding. A guest
// moves men into another house's town or land holding, keeps them there, and
// sets out from it; the holder keeps the holding exactly as it was (only his
// own men count for its garrison, tribute and reversion); when a holding
// reverts, a guest's men standing there or arriving there turn for the
// Massalia region with a move's time and no ships, as do a house's own men on
// the road to its own holding when it reverts first; the League's holdings
// stay the League's alone. Integration test against a REAL Postgres guarded
// to a *_test database (it truncates), on the synthetic clock the map suite
// uses (one season = one day from T0; season 9 is a Spring). Reii stands in
// R047, one land step from the Massalia region; Segusio (R034) is a step from
// Reii and none from Massalia.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const MIN = 60_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (seasons: number) => new Date(T0 + seasons * DAY);
const plus = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MIN);
const REFUSAL = "Men may only be sent to Massalia's own ground or to a house's holding.";

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const holdings = await import("./holdings.js");
  const actions = await import("./mapActions.js");
  const lock = await import("./lock.js");
  const mapReach = await import("./mapReach.js");
  const league = await import("./leagueOrders.js");
  const traits = await import("./traits.js");
  const age = await import("./age.js");
  return { dbPkg, buildings, barracks, mapGraph, holdings, actions, lock, mapReach, league, traits, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("another house's holding (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  type Ctx = { playerId: string; worldId: string; worldStartedMs: number };

  async function makePlayer(name: string): Promise<{ ctx: Ctx; characterId: string }> {
    const { users, players, playerCharacters, dynasties, resources } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `${name}-${Math.random().toString(36).slice(2, 6)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    const ch = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: 20, drachmae: 1000, startAge: 30, deathAge: 90 }).returning())[0]!;
    // Stock for the upkeep each settle charges, so no row is disbanded for insolvency on the way.
    for (const [type, amount] of Object.entries({ grain: 5000, oliveoil: 5000, chicken: 5000 })) await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: at(0) });
    return { ctx: { playerId: player.id, worldId, worldStartedMs: T0 }, characterId: ch.id };
  }
  const insertRow = async (ctx: Ctx, unitId: string, count: number, basedAt = "R060", moving?: { to: string; arrivesAt: Date }) =>
    (
      await db
        .insert(m.dbPkg.playerUnits)
        .values({ worldId, ownerPlayerId: ctx.playerId, source: "trained", unitId, count, startCount: count, recruitedSeason: 5, readyAt: at(6), basedAt, movingTo: moving?.to ?? null, arrivesAt: moving?.arrivesAt ?? null, mission: moving ? ({ kind: "move", regionId: "R047", townId: moving.to, departedAt: at(8).toISOString() } as never) : null, createdAt: at(5) })
        .returning()
    )[0]!;
  const rows = (ctx: Ctx) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt), asc(m.dbPkg.playerUnits.id));
  const settle = (ctx: Ctx, when: Date) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.barracks.settleBarracks(tx, ctx, when);
    });
  const reach = (ctx: Ctx, when: Date) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.mapReach.reachView(tx, ctx, when);
    });
  const holdingsOf = (ctx: Ctx) => db.select().from(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
  const logs = (characterId: string, kind: string) => db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, characterId), eq(m.dbPkg.effectLog.kind, kind))).orderBy(asc(m.dbPkg.effectLog.createdAt));
  const voyages = (ctx: Ctx) => db.select().from(m.dbPkg.playerVoyages).where(eq(m.dbPkg.playerVoyages.ownerPlayerId, ctx.playerId));
  const move = async (ctx: Ctx, baseId: string, rowId: string, count: number, when: Date) => m.actions.move(ctx, { baseId, rows: [{ rowId, count }] }, when);
  // The holder: his town holding of Reii (or his land holding of the Salyes) with men of his own in it.
  // He always has men of his own somewhere: the settle passes over a house with
  // no unit row and no upkeep marker, holdings and all, as it always has.
  const holdReii = async (holder: Ctx, men = 20, since = at(8)) => {
    await m.holdings.insertTownConquest(db, holder, "R047", "reii", "saluvii", since);
    await insertRow(holder, "ekdromos", 5, "R060");
    return men > 0 ? insertRow(holder, "hoplite", men, "reii") : null;
  };

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
    await db.execute(sql`TRUNCATE TABLE league_orders, player_marches, player_voyages, player_units, player_holdings, player_levy, band_offers, region_intel, region_military, town_intel, town_military, treasury_ledger, treasuries, effect_log, resources, player_buildings, player_pops, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Holdings 3", seed: "h3", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("a guest moves men into another house's town holding: they stand there, it is a base of his with nothing of the holding's, and a raid sets out from it", async () => {
    const holder = await makePlayer("Konrad");
    const guest = await makePlayer("Kleon");
    await holdReii(holder.ctx);
    const peltasts = await insertRow(guest.ctx, "peltast", 30);
    const before = await m.holdings.listWorldHoldings(db, worldId);

    // Reii is a place he may send men to, as another house's holding.
    const targets = (await reach(guest.ctx, at(9))).moveTargets;
    expect(targets.find((t) => t.id === "reii")).toMatchObject({ kind: "guest", regionId: "R047", townId: "reii", name: "Reii" });
    const sent = await move(guest.ctx, "reii", peltasts.id, 30, at(9));
    expect(sent).toMatchObject({ ok: true });
    if (!sent.ok) return;
    expect(sent.report).toMatchObject({ baseId: "reii", route: "land", minutes: 30 });

    // They arrive and stand there; Reii is his base, a guest's, with no holding view.
    await settle(guest.ctx, plus(at(9), 30));
    expect((await rows(guest.ctx)).map((r) => [r.basedAt, r.movingTo, r.count])).toEqual([["reii", null, 30]]);
    const view = await reach(guest.ctx, plus(at(9), 31));
    expect(view.bases.map((b) => [b.id, b.kind, b.holding])).toEqual([["R060", "massalia", null], ["reii", "guest", null]]);
    // He may not raid or attack the place he stands in: it is another house's.
    const row = (await rows(guest.ctx))[0]!;
    expect(await m.actions.act(guest.ctx, { type: "raid", townId: "reii", rows: [{ rowId: row.id, count: 10 }] }, plus(at(9), 31))).toEqual({ ok: false, code: 409, error: "Another house holds this town." });
    // From Reii, Segusio is a step away (and none from Massalia): a raid sets out from his guest base.
    expect(view.reach.R034!.byBase.reii).toMatchObject({ landSteps: 1 });
    const raid = await m.actions.act(guest.ctx, { type: "raid", townId: "segusio", rows: [{ rowId: row.id, count: 20 }] }, plus(at(9), 31));
    expect(raid).toMatchObject({ ok: true });
    if (raid.ok) expect(raid.report).toMatchObject({ base: "reii", route: "land", steps: 1 });

    // Every map's holders, and the holder's own view, are as they were.
    expect(await m.holdings.listWorldHoldings(db, worldId)).toEqual(before);
    const held = (await reach(holder.ctx, plus(at(9), 31))).bases.find((b) => b.id === "reii")!;
    expect(held).toMatchObject({ kind: "conquest", holding: { garrison: 20 } });
  });

  it("a guest moves men into another house's land holding, and stands there", async () => {
    const holder = await makePlayer("Ajax");
    const guest = await makePlayer("Kleon");
    await m.holdings.insertConquest(db, holder.ctx, "R046", "unclaimed", at(8));
    await insertRow(holder.ctx, "peltast", 10, "R046");
    const hoplites = await insertRow(guest.ctx, "hoplite", 25);
    expect(await move(guest.ctx, "R046", hoplites.id, 25, at(9))).toMatchObject({ ok: true, report: { baseId: "R046", route: "land", minutes: 30 } });
    await settle(guest.ctx, plus(at(9), 30));
    const view = await reach(guest.ctx, plus(at(9), 31));
    expect(view.bases.find((b) => b.id === "R046")).toEqual({ id: "R046", regionId: "R046", townId: null, kind: "guest", name: "Salyes", holding: null });
    // The holder's land holding counts his own ten.
    expect((await reach(holder.ctx, plus(at(9), 31))).bases.find((b) => b.id === "R046")).toMatchObject({ kind: "conquest", holding: { garrison: 10 } });
  });

  it("the holder keeps it as it was: his garrison count, his tribute and his reversion ignore the guests", async () => {
    const holder = await makePlayer("Konrad");
    const guest = await makePlayer("Kleon");
    await holdReii(holder.ctx, 0, at(8));
    // A hundred of the guest's men stand in Reii; none of the holder's do.
    await insertRow(guest.ctx, "hoplite", 100, "reii");
    const view = (await reach(holder.ctx, plus(at(8), 60))).bases.find((b) => b.id === "reii")!;
    expect(view.holding).toMatchObject({ garrison: 0 });
    expect(await m.holdings.garrisonCount(db, holder.ctx, "reii", plus(at(8), 60))).toBe(0);
    // A day on: no tribute was paid for want of his own garrison, and the holding reverts.
    const settled = await settle(holder.ctx, at(9));
    expect(settled.tribute.paid).toEqual([]);
    expect(settled.holdings.reverted).toEqual([{ regionId: "R047", townId: "reii", kind: "conquest", previousOwner: "saluvii" }]);
    expect(await holdingsOf(holder.ctx)).toEqual([]);
  });

  it("when the holding reverts, the guest's own settle turns his men standing there for the Massalia region, with a move's time and no ships; the holder's settle never writes his rows", async () => {
    const holder = await makePlayer("Konrad");
    const guest = await makePlayer("Kleon");
    await holdReii(holder.ctx, 0, at(8));
    const guests = await insertRow(guest.ctx, "hoplite", 100, "reii");
    // The holder's settle reverts it and leaves the guest's row as it stood.
    await settle(holder.ctx, at(9));
    expect(await holdingsOf(holder.ctx)).toEqual([]);
    expect((await rows(guest.ctx))[0]).toMatchObject({ id: guests.id, basedAt: "reii", movingTo: null });

    // The guest's settle: Reii is no place of his now; his men turn for Massalia from it, thirty minutes by land.
    const turned = await settle(guest.ctx, plus(at(9), 5));
    expect(turned.turnedHome).toEqual([{ rowId: guests.id, unitId: "hoplite", count: 100, from: "reii", arrivesAt: plus(at(9), 35).toISOString() }]);
    expect((await rows(guest.ctx))[0]).toMatchObject({ basedAt: "reii", movingTo: "R060", arrivesAt: plus(at(9), 35), mission: { kind: "move", regionId: "R060", departedAt: plus(at(9), 5).toISOString() } });
    expect(await logs(guest.characterId, "barracks_turn_home")).toMatchObject([{ detail: { unitId: "hoplite", count: 100, from: "reii", to: "R060", reason: "not_a_base" } }]);
    expect(await voyages(guest.ctx)).toEqual([]);
    expect((await reach(guest.ctx, plus(at(9), 6))).bases.map((b) => b.id)).toEqual(["R060"]);
    // Home, they stand in the Massalia region.
    await settle(guest.ctx, plus(at(9), 35));
    expect((await rows(guest.ctx)).map((r) => [r.basedAt, r.movingTo, r.count])).toEqual([["R060", null, 100]]);
  });

  it("men on the road to a holding that reverted turn home when they arrive: a guest's, and a house's own on the road to its own holding", async () => {
    const holder = await makePlayer("Konrad");
    const guest = await makePlayer("Kleon");
    await holdReii(holder.ctx, 0, at(8));
    // Both houses have men on the road to Reii, arriving at season 10.
    const guests = await insertRow(guest.ctx, "peltast", 30, "R060", { to: "reii", arrivesAt: at(10) });
    const own = await insertRow(holder.ctx, "hoplite", 40, "R060", { to: "reii", arrivesAt: at(10) });
    // At season 9 the holder's settle finds it a day without a man of his: it reverts.
    await settle(holder.ctx, at(9));
    expect(await holdingsOf(holder.ctx)).toEqual([]);

    // The holder's own men arrive at season 10 and turn for Massalia from Reii, thirty minutes on.
    const ownTurn = await settle(holder.ctx, plus(at(10), 5));
    expect(ownTurn.arrived).toEqual([]);
    expect(ownTurn.turnedHome).toEqual([{ rowId: own.id, unitId: "hoplite", count: 40, from: "reii", arrivesAt: plus(at(10), 30).toISOString() }]);
    expect((await rows(holder.ctx)).find((r) => r.id === own.id)).toMatchObject({ basedAt: "reii", movingTo: "R060", arrivesAt: plus(at(10), 30), mission: { kind: "move", regionId: "R060", departedAt: at(10).toISOString() } });
    // No holding came back for them.
    expect(await holdingsOf(holder.ctx)).toEqual([]);

    // The guest's settle runs only later: his men turned at their arrival and are home by now.
    const guestTurn = await settle(guest.ctx, plus(at(10), 45));
    expect(guestTurn.turnedHome).toEqual([{ rowId: guests.id, unitId: "peltast", count: 30, from: "reii", arrivesAt: plus(at(10), 30).toISOString() }]);
    expect((await rows(guest.ctx)).map((r) => [r.basedAt, r.movingTo])).toEqual([["R060", null]]);
    expect(await voyages(guest.ctx)).toEqual([]);
  });

  it("men on the road to a holding still held land there as before", async () => {
    const holder = await makePlayer("Konrad");
    const guest = await makePlayer("Kleon");
    await holdReii(holder.ctx, 20, at(8));
    const guests = await insertRow(guest.ctx, "peltast", 30, "R060", { to: "reii", arrivesAt: at(9) });
    const out = await settle(guest.ctx, plus(at(9), 1));
    expect(out.turnedHome).toEqual([]);
    expect(out.arrived).toMatchObject([{ rowId: guests.id, count: 30 }]);
    expect((await rows(guest.ctx))[0]).toMatchObject({ basedAt: "reii", movingTo: null });
  });

  it("a house cannot move men into a League holding, and the League's holdings are no place of a house's", async () => {
    const guest = await makePlayer("Kleon");
    await db.insert(m.dbPkg.treasuries).values({ worldId, owner: "league", balance: 5000 });
    expect(await m.dbPkg.ensureLeagueArmy(worldId, at(0))).toBe(true);
    const lctx = (await m.league.leagueContext(db, { id: worldId, startedMs: T0 }))!;
    await m.holdings.insertTownConquest(db, lctx, "R047", "reii", "saluvii", at(8));
    const peltasts = await insertRow(guest.ctx, "peltast", 30);
    expect((await reach(guest.ctx, at(9))).moveTargets.some((t) => t.id === "reii")).toBe(false);
    expect(await move(guest.ctx, "reii", peltasts.id, 30, at(9))).toEqual({ ok: false, code: 409, error: REFUSAL });
    // A house's men found standing there turn home at his settle.
    const stray = await insertRow(guest.ctx, "hoplite", 5, "reii");
    const out = await settle(guest.ctx, at(9));
    expect(out.turnedHome.map((t) => [t.rowId, t.from])).toEqual([[stray.id, "reii"]]);
  });

  it("the move's refusal names where men may go", async () => {
    const guest = await makePlayer("Kleon");
    const peltasts = await insertRow(guest.ctx, "peltast", 30);
    expect(await move(guest.ctx, "R047", peltasts.id, 30, at(9))).toEqual({ ok: false, code: 409, error: REFUSAL });
    expect(await move(guest.ctx, "segusio", peltasts.id, 30, at(9))).toEqual({ ok: false, code: 409, error: REFUSAL });
  });
});
