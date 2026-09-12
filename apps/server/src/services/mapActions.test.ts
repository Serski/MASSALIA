import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Map actions (integration): scout intel, raid plunder, conquest, defeat,
// selection rules (moving rows, one base), the hull reason on a sea route,
// warband regeneration, holding reversion, and the towns refusal. Against a
// REAL Postgres guarded to a *_test database, on the synthetic clock the
// barracks suite uses (one season = one day from T0). Targets: R046 (townless,
// unclaimed, one land step from R060), R078 (townless, two seas out), R047
// (holds the town reii).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (seasons: number) => new Date(T0 + seasons * DAY);
const HOUR = 3_600_000;
// Recovery after an action: max(1, steps) × 3 hours (battle.json recovery.hoursPerStep).
const recovered = (from: Date, steps: number) => new Date(from.getTime() + Math.max(1, steps) * 3 * HOUR);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const shared = await import("@massalia/shared");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const mapPools = await import("./mapPools.js");
  const holdings = await import("./holdings.js");
  const actions = await import("./mapActions.js");
  const lock = await import("./lock.js");
  const mapReach = await import("./mapReach.js");
  return { dbPkg, shared, buildings, barracks, mapGraph, mapPools, holdings, actions, lock, mapReach };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

const chronicleLines: string[] = [];

suite("Map actions (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  type Ctx = { playerId: string; worldId: string; worldStartedMs: number };

  async function makePlayer(opts: { militia?: number; drachmae?: number } = {}): Promise<{ ctx: Ctx; characterId: string; dynastyId: string }> {
    const { users, players, playerCharacters, dynasties } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Kleon-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    const ch = (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: opts.militia ?? 20, drachmae: opts.drachmae ?? 1000, startAge: 30, deathAge: 90 })
        .returning()
    )[0]!;
    const ctx = { playerId: player.id, worldId, worldStartedMs: T0 };
    // Stock for the upkeep the settle charges before every action, so no fixture
    // row is disbanded for insolvency on the way in.
    await give(ctx, "grain", 5000);
    await give(ctx, "oliveoil", 5000);
    return { ctx, characterId: ch.id, dynastyId: dynasty.id };
  }
  const give = (ctx: Ctx, type: string, amount: number) =>
    db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: ctx.playerId, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: at(0) });
  const giveAll = async (ctx: Ctx, goods: Record<string, number>) => {
    for (const [type, amount] of Object.entries(goods)) await give(ctx, type, amount);
  };
  const stock = async (ctx: Ctx, type: string) =>
    Number((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, type))))[0]?.amount ?? 0);
  const wallet = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, ctx.playerId)))[0]!.drachmae;
  const rows = (ctx: Ctx) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt));
  const holdingsOf = (ctx: Ctx) => db.select().from(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
  const logs = (characterId: string, kind: string) =>
    db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, characterId), eq(m.dbPkg.effectLog.kind, kind))).orderBy(asc(m.dbPkg.effectLog.createdAt));
  const warband = async (regionId: string) => (await db.select().from(m.dbPkg.regionMilitary).where(and(eq(m.dbPkg.regionMilitary.worldId, worldId), eq(m.dbPkg.regionMilitary.regionId, regionId))))[0]?.warband;
  const setWarband = (regionId: string, value: number, when: Date) => m.mapPools.writeRegionWarband(db, worldId, regionId, value, when);
  const garrison = async (townId: string) => (await db.select().from(m.dbPkg.townMilitary).where(and(eq(m.dbPkg.townMilitary.worldId, worldId), eq(m.dbPkg.townMilitary.townId, townId))))[0]?.garrison;
  const setGarrison = (townId: string, value: number, when: Date) => m.mapPools.writeTownGarrison(db, worldId, townId, value, when);
  const levy = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerLevy).where(eq(m.dbPkg.playerLevy.ownerPlayerId, ctx.playerId)))[0];
  // A ready row standing at a base (created and ready well before the action).
  type RowOpts = { source?: "trained" | "band"; unitId: string; count: number; basedAt?: string; ready?: boolean; movingTo?: string | null; season?: number };
  const insertRow = async (ctx: Ctx, o: RowOpts) =>
    (
      await db
        .insert(m.dbPkg.playerUnits)
        .values({
          worldId,
          ownerPlayerId: ctx.playerId,
          source: o.source ?? "trained",
          unitId: o.unitId,
          count: o.count,
          startCount: o.count,
          recruitedSeason: o.season ?? 5,
          readyAt: o.source === "band" ? null : at((o.season ?? 5) + (o.ready === false ? 100 : 1)),
          contractEndAt: o.source === "band" ? at(100) : null,
          basedAt: o.basedAt ?? "R060",
          movingTo: o.movingTo ?? null,
          arrivesAt: o.movingTo ? at(100) : null,
          createdAt: at(o.season ?? 5),
        })
        .returning()
    )[0]!;
  const settle = (ctx: Ctx, when: Date) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.barracks.settleBarracks(tx, ctx, when);
    });
  // Whole rows by id (the count is read back from the row); partial sends use actRows.
  const act = async (ctx: Ctx, type: "scout" | "raid" | "attack", regionId: string, rowIds: string[], when = at(9)) => {
    const all = await rows(ctx);
    return m.actions.act(ctx, { type, regionId, rows: rowIds.map((id) => ({ rowId: id, count: all.find((r) => r.id === id)?.count ?? 1 })) }, when);
  };
  const actRows = (ctx: Ctx, type: "scout" | "raid" | "attack", regionId: string, sent: { rowId: string; count: number }[], when = at(9)) => m.actions.act(ctx, { type, regionId, rows: sent }, when);
  const actTown = async (ctx: Ctx, type: "scout" | "raid" | "attack", townId: string, rowIds: string[], when = at(9)) => {
    const all = await rows(ctx);
    return m.actions.act(ctx, { type, townId, rows: rowIds.map((id) => ({ rowId: id, count: all.find((r) => r.id === id)?.count ?? 1 })) }, when);
  };
  const moveTo = async (ctx: Ctx, baseId: string, rowIds: string[], when = at(9)) => {
    const all = await rows(ctx);
    return m.actions.move(ctx, { baseId, rows: rowIds.map((id) => ({ rowId: id, count: all.find((r) => r.id === id)?.count ?? 1 })) }, when);
  };
  const reach = (ctx: Ctx, when: Date) =>
    db.transaction(async (tx) => {
      await m.lock.lockPlayer(tx, ctx.playerId);
      return m.mapReach.reachView(tx, ctx, when);
    });
  const recordChronicle = async (characterId: string) => {
    const entries = await m.dbPkg.gatherChronicleForCharacter(characterId);
    for (const e of entries) if (e.type === "map_action" || e.type === "holding_reverted" || e.type === "holding_tribute") chronicleLines.push(`${e.label} — ${m.shared.renderCampaignLine(e.type, e.payload as never)}`);
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
    await db.execute(sql`TRUNCATE TABLE player_units, player_holdings, player_levy, band_offers, region_intel, region_military, town_intel, town_military, effect_log, resources, player_buildings, player_pops, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Actions Test", seed: "atest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  afterAll(async () => {
    console.log("\nCHRONICLE LINES\n" + chronicleLines.map((l) => `  ${l}`).join("\n") + "\n");
    await db.$client.end();
  });

  it("scout: needs a row at Spd 6+, writes the dynasty's intel with the regenerated warband, and sends the party into recovery", async () => {
    const { ctx, characterId, dynastyId } = await makePlayer();
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 10 });
    const slow = await act(ctx, "scout", "R046", [hoplites.id]);
    expect(slow).toMatchObject({ ok: false, code: 409 });
    expect((slow as { error: string }).error).toMatch(/Spd 6/);
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    const r = await act(ctx, "scout", "R046", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ type: "scout", regionId: "R046", regionName: "Salyes", route: "land", steps: 1, recoveryHours: 3, destination: "R060", intel: { warband: 100 }, winner: null });
    expect(r.report.arrivesAt).toBe(recovered(at(9), 1).toISOString());
    const intel = (await db.select().from(m.dbPkg.regionIntel).where(and(eq(m.dbPkg.regionIntel.dynastyId, dynastyId), eq(m.dbPkg.regionIntel.regionId, "R046"))))[0]!;
    expect(intel).toMatchObject({ warband: 100 });
    expect(typeof intel.scoutedGameDate).toBe("string");
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)).toMatchObject({ movingTo: "R060", arrivesAt: recovered(at(9), 1), count: 10, mission: { kind: "scout", regionId: "R046", departedAt: at(9).toISOString() } });
    // The moving party is out of the roster's force.
    expect(r.force.men).toBe(10); // the hoplites still stand
    expect(await logs(characterId, "map_action")).toHaveLength(1);
    await recordChronicle(characterId);
  });

  it("raid win: plunder credited, the warband reduced, losses logged per row, party home in a day", async () => {
    const { ctx, characterId } = await makePlayer({ drachmae: 100 });
    await setWarband("R046", 20, at(9)); // a thin warband so 40 peltasts win on the exchange
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const r = await act(ctx, "raid", "R046", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("attacker");
    expect(r.report.defender!.start).toBe(20);
    const killed = r.report.defender!.losses;
    expect(killed).toBeGreaterThan(0);
    expect(r.report.plunder).toEqual({ drachmae: killed * 20, grain: killed * 5 });
    expect(await wallet(ctx)).toBe(100 + killed * 20);
    expect(await stock(ctx, "grain")).toBe(5000 - 3 * 40 + killed * 5); // 3 whole days after ready_at (at 6) × 40 peltasts × 1 grain, then the plunder
    expect(await warband("R046")).toBe(20 - killed);
    const row = (await rows(ctx)).find((x) => x.id === peltasts.id)!;
    expect(row).toMatchObject({ movingTo: "R060", arrivesAt: recovered(at(9), 1), count: 40 - r.report.attacker.losses, mission: { kind: "raid", regionId: "R046", departedAt: at(9).toISOString() } });
    expect((await logs(characterId, "battle_loss")).length).toBe(r.report.attacker.losses > 0 ? 1 : 0);
    expect(await holdingsOf(ctx)).toHaveLength(0);
    expect(r.report.line).toMatch(/^Raided Salyes with 40 peltasts: \d+ tribesm[ae]n slain, (none|\d+) of ours lost, \d+ drachmae and \d+ grain of plunder\.$/);
    await recordChronicle(characterId);
  });

  it("attack win: a conquest holding, survivors rebased there and recovering, the warband at 0", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 10, at(9));
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 30 });
    const r = await act(ctx, "attack", "R046", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("attacker");
    expect(r.report.conquest).toEqual({ regionId: "R046", townId: null, previousOwner: "unclaimed" });
    expect(r.report.destination).toBe("R046");
    const h = await holdingsOf(ctx);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ regionId: "R046", kind: "conquest", previousOwner: "unclaimed", since: at(9), lastGarrisonedAt: recovered(at(9), 1) });
    expect(await warband("R046")).toBe(0);
    expect((await rows(ctx)).find((x) => x.id === hoplites.id)).toMatchObject({ basedAt: "R046", movingTo: "R046", arrivesAt: recovered(at(9), 1) });
    expect(r.reach.bases.map((b) => b.regionId)).toEqual(["R060", "R046"]);
    expect(r.reach.reach.R046).toBeUndefined(); // our own land is a base now, not a target
    expect(r.report.line).toMatch(/^Took Salyes with 30 hoplites: \d+ tribesm[ae]n slain, (none|\d+) of ours lost\. The land is ours\.$/);
    // A second attack on our own holding is refused.
    const again = await act(ctx, "attack", "R046", [hoplites.id], at(11));
    expect(again).toMatchObject({ ok: false, code: 409 });
    await recordChronicle(characterId);
  });

  it("attack against a stronger warband: survivors go home, no holding, the warband keeps what it lost", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 100, at(9));
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 5 });
    const r = await act(ctx, "attack", "R046", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("defender");
    expect(r.report.conquest).toBeNull();
    expect(r.report.destination).toBe("R060");
    expect(await holdingsOf(ctx)).toHaveLength(0);
    expect(await warband("R046")).toBe(100 - r.report.defender!.losses);
    const survivor = (await rows(ctx)).find((x) => x.id === hoplites.id);
    if (survivor) expect(survivor).toMatchObject({ basedAt: "R060", movingTo: "R060", arrivesAt: recovered(at(9), 1) });
    else expect(r.report.attacker.rows[0]!.end).toBe(0);
    expect(r.report.line).toMatch(/^Attacked Salyes with 5 hoplites and were broken/);
    await recordChronicle(characterId);
  });

  it("selection: a moving row, rows from two bases, a row still training, and an empty force are refused", async () => {
    const { ctx } = await makePlayer();
    const moving = await insertRow(ctx, { unitId: "hoplite", count: 5, movingTo: "R060" });
    expect(await act(ctx, "raid", "R046", [moving.id])).toMatchObject({ ok: false, code: 409, error: "Hoplite are still on the march." });
    const training = await insertRow(ctx, { unitId: "hoplite", count: 5, ready: false });
    expect(await act(ctx, "raid", "R046", [training.id])).toMatchObject({ ok: false, code: 409, error: "Hoplite are still training." });
    await m.holdings.insertConquest(db, ctx, "R059", null, at(8));
    const there = await insertRow(ctx, { unitId: "peltast", count: 5, basedAt: "R059" });
    const here = await insertRow(ctx, { unitId: "peltast", count: 5 });
    expect(await act(ctx, "raid", "R046", [there.id, here.id])).toMatchObject({ ok: false, code: 409, error: "A force marches from one base." });
    expect(await act(ctx, "raid", "R046", [])).toMatchObject({ ok: false, code: 400 });
    expect(await act(ctx, "raid", "R046", ["00000000-0000-4000-a000-000000000000"])).toMatchObject({ ok: false, code: 404 });
    expect(await rows(ctx)).toHaveLength(4); // nothing moved
  });

  it("a sea target without enough hulls is refused with the hull reason; with hulls the raid sails", async () => {
    const { ctx } = await makePlayer();
    await give(ctx, "trade-ship", 1); // 20 space
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 }); // 40 space
    const short = await act(ctx, "raid", "R078", [peltasts.id]);
    expect(short).toMatchObject({ ok: false, code: 409, error: "Not enough hulls: 40 space needed, 20 aboard." });
    await give(ctx, "galley", 5); // +20 space, range 4 ≥ 2 seas
    await setWarband("R078", 10, at(9));
    const r = await act(ctx, "raid", "R078", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ route: "sea", steps: 2, recoveryHours: 6, ships: { "trade-ship": 1, galley: 5 } });
    expect(r.report.arrivesAt).toBe(recovered(at(9), 2).toISOString());
    // Ships are counted, never debited.
    expect(await stock(ctx, "trade-ship")).toBe(1);
    expect(await stock(ctx, "galley")).toBe(5);
  });

  it("regeneration: a reduced warband comes back 5 a day up to its content value", async () => {
    await setWarband("R046", 80, at(9));
    expect(await m.mapPools.readRegionWarband(db, worldId, "R046", at(9.5))).toBe(80);
    expect(await m.mapPools.readRegionWarband(db, worldId, "R046", at(11))).toBe(90);
    // Persisted with updated_at moved: another 1.5 days adds one more day's worth.
    expect(await m.mapPools.readRegionWarband(db, worldId, "R046", at(12.5))).toBe(95);
    expect(await m.mapPools.readRegionWarband(db, worldId, "R046", at(30))).toBe(100);
    expect(await m.mapPools.readRegionWarband(db, worldId, "R046", at(40))).toBe(100);
  });

  it("an empty holding reverts after a full day and the warband comes back; a garrisoned one stays", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 0, at(9));
    await m.holdings.insertConquest(db, ctx, "R046", "unclaimed", at(9));
    // Half a day empty: still ours.
    const early = await settle(ctx, at(9.5));
    expect(early.holdings.reverted).toEqual([]);
    expect(await holdingsOf(ctx)).toHaveLength(1);
    // A garrison arriving keeps it: a row standing there at the next settle.
    const garrison = await insertRow(ctx, { unitId: "hoplite", count: 5, basedAt: "R046", season: 8 });
    const kept = await settle(ctx, at(11));
    expect(kept.holdings.reverted).toEqual([]);
    expect((await holdingsOf(ctx))[0]!.lastGarrisonedAt).toEqual(at(11));
    // The garrison marches off; a day later the land reverts and the tribes return.
    await db.update(m.dbPkg.playerUnits).set({ basedAt: "R060" }).where(eq(m.dbPkg.playerUnits.id, garrison.id));
    expect((await settle(ctx, at(11.9))).holdings.reverted).toEqual([]);
    const gone = await settle(ctx, at(12));
    expect(gone.holdings.reverted).toEqual([{ regionId: "R046", townId: "", kind: "conquest", previousOwner: "unclaimed" }]);
    expect(await holdingsOf(ctx)).toHaveLength(0);
    expect(await warband("R046")).toBe(100);
    expect(await logs(characterId, "holding_reverted")).toHaveLength(1);
    await recordChronicle(characterId);
  });

  it("the campaign line counts each unit as one figure and uses the unit plurals; the settle has already folded same-unit rows", async () => {
    const { ctx } = await makePlayer();
    await setWarband("R046", 20, at(9));
    const a = await insertRow(ctx, { unitId: "peltast", count: 7 });
    const b = await insertRow(ctx, { unitId: "peltast", count: 7 });
    const c = await insertRow(ctx, { unitId: "ekdromos", count: 1 });
    const d = await insertRow(ctx, { unitId: "hippeis", count: 2 });
    // The two peltast rows stand ready at one base, so the settle folds them
    // into one before any force is named (they share a created_at, so which
    // id survives is not fixed).
    await settle(ctx, at(9));
    const after = await rows(ctx);
    const peltasts = after.filter((x) => x.unitId === "peltast");
    expect(peltasts).toHaveLength(1);
    expect(peltasts[0]).toMatchObject({ count: 14, startCount: 14 });
    expect([a.id, b.id]).toContain(peltasts[0]!.id);
    expect(after).toHaveLength(3);
    const r = await act(ctx, "scout", "R046", [peltasts[0]!.id, c.id, d.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.line).toBe("Scouted Salyes with 14 peltasts, 1 ekdromos and 2 hippeis: 20 tribesmen under arms.");
  });

  it("winter closes campaigns: every action is refused in a Winter season, before any other check", async () => {
    const { ctx } = await makePlayer();
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    // Season 8 is a Winter (8 % 4 = 0); the closed message outranks even a town target.
    for (const type of ["scout", "raid", "attack"] as const) {
      expect(await act(ctx, type, "R046", [peltasts.id], at(8))).toMatchObject({ ok: false, code: 409, error: "The passes are closed until spring." });
    }
    expect(await act(ctx, "raid", "R047", [peltasts.id], at(8.5))).toMatchObject({ ok: false, code: 409, error: "The passes are closed until spring." });
    // Spring, the next instant: the same scout goes through.
    expect(await act(ctx, "scout", "R046", [peltasts.id], at(9))).toMatchObject({ ok: true });
  });

  it("partial force: sending 20 of 30 hoplites splits the row — the 20 march as their own row, the 10 stay home", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 20, at(9));
    const home = await insertRow(ctx, { unitId: "hoplite", count: 30 });
    // A refusal after the count check (hoplites cannot scout) leaves the row whole.
    const r = await actRows(ctx, "scout", "R046", [{ rowId: home.id, count: 20 }], at(9));
    expect(r).toMatchObject({ ok: false, code: 409 });
    expect(await rows(ctx)).toHaveLength(1);
    expect((await rows(ctx))[0]).toMatchObject({ count: 30, startCount: 30 });
    const raid = await actRows(ctx, "raid", "R046", [{ rowId: home.id, count: 20 }], at(9));
    expect(raid).toMatchObject({ ok: true });
    if (!raid.ok) return;
    const after = await rows(ctx);
    const stayed = after.find((x) => x.id === home.id)!;
    expect(stayed).toMatchObject({ count: 10, startCount: 10, basedAt: "R060", movingTo: null, arrivesAt: null });
    const marched = after.find((x) => x.id !== home.id)!;
    expect(marched).toMatchObject({ unitId: "hoplite", source: "trained", startCount: 20, basedAt: "R060", movingTo: "R060", recruitedSeason: home.recruitedSeason, readyAt: home.readyAt, createdAt: home.createdAt });
    expect(marched.count).toBe(20 - raid.report.attacker.losses);
    expect(raid.report.attacker.rows).toHaveLength(1);
    expect(raid.report.attacker.rows[0]).toMatchObject({ id: marched.id, start: 20, icon: "HOPLITE.webp" });
    expect(raid.report.line).toMatch(/^Raided Salyes with 20 hoplites/);
    expect(await logs(characterId, "barracks_split")).toHaveLength(1);
    // Bad counts are refused before anything moves.
    expect(await actRows(ctx, "raid", "R046", [{ rowId: home.id, count: 11 }], at(9.1))).toMatchObject({ ok: false, code: 400 });
    expect(await actRows(ctx, "raid", "R046", [{ rowId: home.id, count: 0 }], at(9.1))).toMatchObject({ ok: false, code: 400 });
  });

  it("a band at less than its full count is refused: a band marches as one", async () => {
    const { ctx } = await makePlayer();
    const band = await insertRow(ctx, { source: "band", unitId: "iberian-caetrati", count: 40 });
    expect(await actRows(ctx, "raid", "R046", [{ rowId: band.id, count: 20 }])).toMatchObject({ ok: false, code: 409, error: "A band marches as one." });
    expect(await rows(ctx)).toHaveLength(1);
    expect(await actRows(ctx, "raid", "R046", [{ rowId: band.id, count: 40 }])).toMatchObject({ ok: true });
  });

  // --- Towns (3c) --------------------------------------------------------------

  it("town scout: writes the dynasty's town intel with garrison and fleet; the report carries walls, population and the garrison's effective def", async () => {
    const { ctx, characterId, dynastyId } = await makePlayer();
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    // Reii (R047): one land step from Massalia, walls 1, garrison 160, no fleet.
    const r = await actTown(ctx, "scout", "reii", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ type: "scout", regionId: "R047", townId: "reii", townName: "Reii", route: "land", steps: 1, destination: "R060", town: { walls: 1, population: 1500, garrisonDef: 8 }, intel: { warband: 160, pentekonters: 0, triremes: 0 }, winner: null });
    const intel = (await db.select().from(m.dbPkg.townIntel).where(and(eq(m.dbPkg.townIntel.dynastyId, dynastyId), eq(m.dbPkg.townIntel.townId, "reii"))))[0]!;
    expect(intel).toMatchObject({ garrison: 160, pentekonters: 0, triremes: 0 });
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)!.mission).toEqual({ kind: "scout", regionId: "R047", townId: "reii", departedAt: at(9).toISOString() });
    expect(r.report.line).toBe("Scouted Reii with 10 peltasts: 160 soldiers under arms, no ships in the harbour.");
    // Walls above the cap: Rome (walls 4) defends at 7 + 3, scouted by sea (scouts are not stopped by a fleet).
    await give(ctx, "trade-ship", 1);
    const settledBack = await settle(ctx, at(10));
    expect(settledBack.arrived).toHaveLength(1);
    const rome = await actTown(ctx, "scout", "rome", [peltasts.id], at(10));
    expect(rome).toMatchObject({ ok: true });
    if (!rome.ok) return;
    expect(rome.report).toMatchObject({ route: "sea", town: { walls: 4, garrisonDef: 10 }, fleet: null, intel: { warband: 30000, pentekonters: 4, triremes: 6 } });
    await recordChronicle(characterId);
  });

  it("town raid: the garrison is the defender behind its walls, plunder pays double the region rate, the garrison is reduced", async () => {
    const { ctx, characterId } = await makePlayer({ drachmae: 100 });
    await setGarrison("reii", 10, at(9)); // a thin garrison so 40 peltasts win on the exchange
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const r = await actTown(ctx, "raid", "reii", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ type: "raid", townId: "reii", winner: "attacker", defender: { label: "Town garrison", start: 10 }, conquest: null });
    const killed = r.report.defender!.losses;
    expect(killed).toBeGreaterThan(0);
    expect(r.report.plunder).toEqual({ drachmae: killed * 20 * 2, grain: killed * 5 * 2 });
    expect(await wallet(ctx)).toBe(100 + killed * 40);
    expect(await garrison("reii")).toBe(10 - killed);
    expect(r.report.line).toMatch(/^Raided Reii with 40 peltasts: \d+ soldiers? slain/);
    await recordChronicle(characterId);
  });

  it("sea assault: a fleet weaker than the town's is repulsed with no battle, no losses and no garrison change; a stronger one lands", async () => {
    const { ctx, characterId } = await makePlayer();
    // Aleria (R073): two seas out, no land route, fleet 4 pentekonters and 4 triremes (naval 24).
    await setGarrison("aleria", 10, at(9));
    await give(ctx, "trade-ship", 2); // naval 1 each: 2 against 24
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const r = await actTown(ctx, "attack", "aleria", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({
      route: "sea",
      steps: 2,
      winner: "repulsed",
      rounds: 0,
      fleet: { ships: { "trade-ship": 2 }, naval: 2, defender: { pentekonters: 4, triremes: 4, naval: 24 }, held: false },
      attacker: { losses: 0 },
      defender: { start: 10, end: 10, losses: 0 },
      conquest: null,
      destination: "R060",
    });
    expect(r.report.attacker.rows[0]).toMatchObject({ start: 40, end: 40 });
    expect(await garrison("aleria")).toBe(10);
    expect(await holdingsOf(ctx)).toHaveLength(0);
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)).toMatchObject({ count: 40, movingTo: "R060", arrivesAt: recovered(at(9), 2) });
    expect(r.report.line).toBe("Sailed against Aleria with 40 peltasts and were driven off by its fleet before landing.");
    // The town's fleet is unchanged. Triremes in stock whose range covers the
    // crossing sail as an escort even though the pentekonters carry everyone:
    // naval 2 + 25 against 24, and the landing holds. The crossing itself is
    // still the two transports.
    expect(await m.mapPools.readTownFleet(db, worldId, "aleria", at(10))).toEqual({ pentekonters: 4, triremes: 4 });
    await settle(ctx, at(10));
    await give(ctx, "galley", 5); // range 4 ≥ 2 seas
    const again = await actTown(ctx, "attack", "aleria", [peltasts.id], at(10));
    expect(again).toMatchObject({ ok: true });
    if (!again.ok) return;
    expect(again.report.fleet).toEqual({ ships: { "trade-ship": 2, galley: 5 }, naval: 27, defender: { pentekonters: 4, triremes: 4, naval: 24 }, held: true });
    expect(again.report.ships).toEqual({ "trade-ship": 2 });
    expect(again.report.winner).toBe("attacker");
    expect(again.report.conquest).toEqual({ regionId: "R073", townId: "aleria", previousOwner: "etruscans" });
    // Out of range, the escort stays home and does not cap the fleet's range:
    // from Massalia, Thapsus (five seas, naval 8) is reached on the
    // pentekonters' range 7 with naval 2 alone, and the landing is repulsed.
    await settle(ctx, at(11));
    await setGarrison("thapsus", 10, at(11));
    const fresh = await insertRow(ctx, { unitId: "peltast", count: 40, season: 6 });
    const far = await actTown(ctx, "attack", "thapsus", [fresh.id], at(11));
    expect(far).toMatchObject({ ok: true });
    if (!far.ok) return;
    expect(far.report).toMatchObject({ base: "R060", route: "sea", steps: 5, winner: "repulsed", fleet: { ships: { "trade-ship": 2 }, naval: 2, defender: { naval: 8 }, held: false } });
    expect(far.report.fleet!.ships.galley).toBeUndefined();
    await recordChronicle(characterId);
  });

  it("taking a town: a town holding, the garrison at 0, survivors based at the town and recovering, the region untouched", async () => {
    const { ctx, characterId } = await makePlayer();
    await setGarrison("reii", 10, at(9));
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 60 });
    const r = await actTown(ctx, "attack", "reii", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ winner: "attacker", conquest: { regionId: "R047", townId: "reii", previousOwner: "saluvii" }, destination: "reii", town: { walls: 1, garrisonDef: 8 } });
    expect(await garrison("reii")).toBe(0);
    const held = await holdingsOf(ctx);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ regionId: "R047", townId: "reii", kind: "conquest", previousOwner: "saluvii", lastGarrisonedAt: recovered(at(9), 1), lastTributeAt: recovered(at(9), 1) });
    expect((await rows(ctx)).find((x) => x.id === hoplites.id)).toMatchObject({ basedAt: "reii", movingTo: "reii", mission: { kind: "attack", regionId: "R047", townId: "reii" } });
    // The region has no warband of its own to touch, and no row was created for it.
    expect(await warband("R047")).toBeUndefined();
    expect(r.report.line).toMatch(/^Took Reii with 60 hoplites: \d+ soldiers? slain, .* The town is ours\.$/);
    // Once home, the town is a base: its region is no target, and the next town over is a step away.
    await settle(ctx, at(10));
    const view = await reach(ctx, at(10));
    // The garrison is what survived (the seed carries the player id, so the losses vary by run).
    const survivors = r.report.attacker.rows[0]!.end;
    expect(view.bases).toContainEqual({ id: "reii", regionId: "R047", townId: "reii", kind: "conquest", name: "Reii", holding: { garrison: survivors, minGarrison: 15, perDay: { drachmae: 60, grain: 0, timber: 0 }, levyPerYear: 0 } });
    // The region of a held town keeps its entry (for other towns there), at 0 steps from the town; the next region over is a step.
    expect(view.reach.R047!.byBase.reii).toEqual({ landSteps: 0, seaSteps: null });
    expect(view.reach.R049!.byBase.reii).toEqual({ landSteps: 1, seaSteps: null }); // R047 is inland
    // The held town is not a target and the region rule still refuses R047 as a region.
    expect(await actTown(ctx, "raid", "reii", [hoplites.id], at(10))).toMatchObject({ ok: false, code: 409, error: "You hold this town." });
    await recordChronicle(characterId);
  });

  it("home towns are never targets; a town in a region the player holds a town in is at 0 steps and attackable", async () => {
    const { ctx } = await makePlayer();
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    expect(await actTown(ctx, "raid", "arelate", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Massalia does not act against her own." });
    expect(await actTown(ctx, "raid", "massalia", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Massalia does not act against her own." });
    expect(await actTown(ctx, "raid", "nowhere", [peltasts.id])).toMatchObject({ ok: false, code: 404 });
    // Holding Genoa (R049, three towns): Album is in the same region, 0 steps, a land route.
    await m.holdings.insertTownConquest(db, ctx, "R049", "genoa", "genoa", at(8));
    const garrisonRow = await insertRow(ctx, { unitId: "peltast", count: 10, basedAt: "genoa" });
    const view = await reach(ctx, at(9));
    expect(view.reach.R049!.byBase.genoa).toEqual({ landSteps: 0, seaSteps: expect.any(Number) as number | null });
    expect(view.reach.R049!.raid).toEqual({ ok: true });
    const r = await actTown(ctx, "scout", "album", [garrisonRow.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ townId: "album", base: "genoa", route: "land", steps: 0, recoveryHours: 3, destination: "genoa" });
  });

  it("town tribute: whole days only, only while the garrison meets the population minimum, and never after reversion", async () => {
    const { ctx, characterId } = await makePlayer({ drachmae: 1000 });
    await giveAll(ctx, { wine: 1000, chicken: 1000, herbal: 1000 });
    // Vienna (R032, population 3,000): 120 dr a day, 30 men needed.
    await m.holdings.insertTownConquest(db, ctx, "R032", "vienna", "cavares", at(9));
    const men = await insertRow(ctx, { unitId: "hoplite", count: 30, basedAt: "vienna", season: 8 });
    const before = await wallet(ctx);
    // Half a day: nothing yet.
    expect((await settle(ctx, at(9.5))).tribute.paid).toEqual([]);
    expect(await wallet(ctx)).toBe(before);
    // Two whole days: 240 dr, the marker at day 11 exactly.
    const two = await settle(ctx, at(11.25));
    expect(two.tribute.paid).toEqual([{ regionId: "R032", townId: "vienna", name: "Vienna", days: 2, drachmae: 240, grain: 0, timber: 0 }]);
    expect(await wallet(ctx)).toBe(before + 240);
    expect((await holdingsOf(ctx))[0]!.lastTributeAt).toEqual(at(11));
    expect(await logs(characterId, "holding_tribute")).toHaveLength(1);
    // Under the minimum: the day passes unpaid, the marker still advances.
    await db.update(m.dbPkg.playerUnits).set({ count: 29 }).where(eq(m.dbPkg.playerUnits.id, men.id));
    expect((await settle(ctx, at(12.5))).tribute.paid).toEqual([]);
    expect((await holdingsOf(ctx))[0]!.lastTributeAt).toEqual(at(12));
    expect(await wallet(ctx)).toBe(before + 240);
    // Back at 30: the next whole day pays 120.
    await db.update(m.dbPkg.playerUnits).set({ count: 30 }).where(eq(m.dbPkg.playerUnits.id, men.id));
    expect((await settle(ctx, at(13.5))).tribute.paid).toMatchObject([{ name: "Vienna", days: 1, drachmae: 120 }]);
    expect(await wallet(ctx)).toBe(before + 360);
    // The garrison marches away: a day later the town reverts and pays nothing more.
    await db.update(m.dbPkg.playerUnits).set({ basedAt: "R060" }).where(eq(m.dbPkg.playerUnits.id, men.id));
    const gone = await settle(ctx, at(15));
    expect(gone.holdings.reverted).toEqual([{ regionId: "R032", townId: "vienna", kind: "conquest", previousOwner: "cavares" }]);
    expect(gone.tribute.paid).toEqual([]);
    expect(await garrison("vienna")).toBe(120); // the content garrison is back
    expect(await wallet(ctx)).toBe(before + 360);
    await recordChronicle(characterId);
  });

  it("region tribute: a held, garrisoned region pays grain and timber a day and adds to the levy at the year boundary; empty, it pays nothing", async () => {
    const { ctx, characterId } = await makePlayer();
    await m.holdings.insertConquest(db, ctx, "R046", "unclaimed", at(9));
    const men = await insertRow(ctx, { unitId: "hoplite", count: 5, basedAt: "R046", season: 8 });
    const grain0 = await stock(ctx, "grain");
    // Season 9: the levy stands at 120 (100 + two years of 10), anchored on season 8.
    await settle(ctx, at(9));
    expect(await levy(ctx)).toMatchObject({ men: 120, lastGrowthSeason: 8 });
    // One whole day: max(15, 0.05 × 100) grain and max(8, 0.025 × 100) timber; upkeep drew the hoplites' grain too.
    const one = await settle(ctx, at(10));
    expect(one.tribute.paid).toEqual([{ regionId: "R046", townId: "", name: "Salyes", days: 1, drachmae: 0, grain: 15, timber: 8 }]);
    expect(await stock(ctx, "grain")).toBe(grain0 + 15 - one.drawn.grain!);
    expect(await stock(ctx, "timber")).toBe(8);
    // The year boundary at season 12 with the region garrisoned: +10 +5.
    await settle(ctx, at(12));
    expect(await levy(ctx)).toMatchObject({ men: 135, lastGrowthSeason: 12 });
    const view = await m.barracks.barracksView(ctx, at(12));
    expect(view.summary).toMatchObject({ growthPerYear: 15, baseGrowthPerYear: 10, heldRegions: 1 });
    // The men leave a day before the next boundary: at the boundary the region is
    // empty, so no bonus and no goods, and the land reverts in the same settle.
    await settle(ctx, at(15));
    await db.update(m.dbPkg.playerUnits).set({ basedAt: "R060" }).where(eq(m.dbPkg.playerUnits.id, men.id));
    expect((await settle(ctx, at(15.5))).holdings.reverted).toEqual([]);
    const sixteen = await settle(ctx, at(16));
    expect(sixteen.holdings.reverted).toHaveLength(1);
    expect(sixteen.tribute.paid).toEqual([]);
    expect(await levy(ctx)).toMatchObject({ men: 145, lastGrowthSeason: 16 });
    await recordChronicle(characterId);
  });

  it("garrison regeneration: a reduced garrison comes back 5 a day up to its content value", async () => {
    await setGarrison("reii", 140, at(9));
    expect(await m.mapPools.readTownGarrison(db, worldId, "reii", at(9.5))).toBe(140);
    expect(await m.mapPools.readTownGarrison(db, worldId, "reii", at(11))).toBe(150);
    expect(await m.mapPools.readTownGarrison(db, worldId, "reii", at(12.5))).toBe(155);
    expect(await m.mapPools.readTownGarrison(db, worldId, "reii", at(30))).toBe(160);
    expect(await m.mapPools.readTownGarrison(db, worldId, "reii", at(40))).toBe(160);
  });

  // --- Move (3c) ---------------------------------------------------------------

  it("move by land to an adjacent holding: 30 minutes, mission move, arrival rebases and merges with the men already there", async () => {
    const { ctx, characterId } = await makePlayer();
    await m.holdings.insertConquest(db, ctx, "R046", "unclaimed", at(8));
    const there = await insertRow(ctx, { unitId: "hoplite", count: 5, basedAt: "R046", season: 6 });
    const home = await insertRow(ctx, { unitId: "hoplite", count: 20, season: 7 });
    const r = await moveTo(ctx, "R046", [home.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const arrives = new Date(at(9).getTime() + 30 * 60_000);
    expect(r.report).toMatchObject({ type: "move", from: "R060", fromName: "Massalia", baseId: "R046", regionId: "R046", regionName: "Salyes", townId: null, route: "land", steps: 1, minutes: 30, arrivesAt: arrives.toISOString(), men: 20 });
    expect(r.report.line).toBe("20 hoplites march from Massalia to Salyes, arriving in 00:30:00.");
    expect((await rows(ctx)).find((x) => x.id === home.id)).toMatchObject({ basedAt: "R060", movingTo: "R046", arrivesAt: arrives, mission: { kind: "move", regionId: "R046", departedAt: at(9).toISOString() } });
    expect(r.force.men).toBe(5); // only the garrison stands
    expect(await logs(characterId, "map_action")).toHaveLength(1);
    // Arrival: rebased at Salyes and folded into the row already there.
    const settled = await settle(ctx, at(9.1));
    expect(settled.arrived).toHaveLength(1);
    expect(settled.merged).toMatchObject([{ rowId: there.id, basedAt: "R046", count: 25 }]);
    expect(await rows(ctx)).toHaveLength(1);
    await recordChronicle(characterId);
  });

  it("move to home ground: Arelate becomes a base while men stand there, lighting Nemausus's region, and goes dark once they leave", async () => {
    const { ctx, characterId } = await makePlayer();
    const home = await insertRow(ctx, { unitId: "hoplite", count: 20 });
    const r = await moveTo(ctx, "arelate", [home.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ baseId: "arelate", regionId: "R052", townId: "arelate", townName: "Arelate", route: "land", minutes: 30 });
    expect(r.report.line).toBe("20 hoplites march from Massalia to Arelate, arriving in 00:30:00.");
    expect((await rows(ctx))[0]!.mission).toEqual({ kind: "move", regionId: "R052", townId: "arelate", departedAt: at(9).toISOString() });
    // Not there yet: no base at Arelate, and Nemausus (R045) is two steps from Massalia — out of land reach.
    const before = await reach(ctx, at(9.25));
    expect(before.bases.map((b) => b.id)).toEqual(["R060"]);
    expect(before.reach.R045!.attack.ok).toBe(false);
    // Standing there: Arelate is a home base, R045 is one step and Attack ok; R052 itself stays no target.
    await settle(ctx, at(9.6));
    const standing = await reach(ctx, at(9.6));
    expect(standing.bases).toContainEqual({ id: "arelate", regionId: "R052", townId: "arelate", kind: "home", name: "Arelate", holding: null });
    expect(standing.reach.R045!.byBase.arelate).toEqual({ landSteps: 1, seaSteps: null });
    expect(standing.reach.R045!.attack).toEqual({ ok: true });
    expect(standing.reach.R052).toBeUndefined();
    // Home ground is never a holding: nothing to revert, no tribute.
    expect((await settle(ctx, at(12))).holdings.reverted).toEqual([]);
    expect(await holdingsOf(ctx)).toHaveLength(0);
    // Back to Massalia: once they leave, Arelate is no base and R045 is dark again.
    const back = await moveTo(ctx, "R060", [(await rows(ctx))[0]!.id], at(12));
    expect(back).toMatchObject({ ok: true });
    if (!back.ok) return;
    expect(back.report).toMatchObject({ from: "arelate", fromName: "Arelate", baseId: "R060", route: "land", minutes: 30 });
    const left = await reach(ctx, at(12.1));
    expect(left.bases.map((b) => b.id)).toEqual(["R060"]);
    expect(left.reach.R045!.byBase).toEqual({ R060: { landSteps: null, seaSteps: null } });
    expect(left.reach.R045!.attack.ok).toBe(false);
    await recordChronicle(characterId);
  });

  it("move refusals: a foreign region, the men's own base, a second base in the selection, and a sea crossing short of hulls", async () => {
    const { ctx } = await makePlayer();
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    expect(await moveTo(ctx, "R047", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Men may only be sent to Massalia's own ground or a holding of yours." });
    expect(await moveTo(ctx, "reii", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Men may only be sent to Massalia's own ground or a holding of yours." });
    expect(await moveTo(ctx, "R060", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "The men already stand there." });
    // Emporion (R065): four land steps, one sea; 40 space on one trade-ship's 20.
    await give(ctx, "trade-ship", 1);
    expect(await moveTo(ctx, "emporion", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Not enough hulls: 40 space needed, 20 aboard." });
    // Two ships carry them: one sea, 30 minutes.
    await db.update(m.dbPkg.resources).set({ amount: "2" }).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, "trade-ship")));
    const sailed = await moveTo(ctx, "emporion", [peltasts.id]);
    expect(sailed).toMatchObject({ ok: true });
    if (!sailed.ok) return;
    expect(sailed.report).toMatchObject({ route: "sea", steps: 1, minutes: 30, ships: { "trade-ship": 2 }, townId: "emporion" });
    expect(await stock(ctx, "trade-ship")).toBe(2);
    // The movers cannot be sent again while on the march.
    expect(await moveTo(ctx, "R060", [peltasts.id], at(9.01))).toMatchObject({ ok: false, code: 409, error: "Peltast are still on the march." });
  });

  it("move within one region: from a held town to its region's other town of ours takes 10 minutes", async () => {
    const { ctx } = await makePlayer();
    await m.holdings.insertTownConquest(db, ctx, "R049", "genoa", "genoa", at(8));
    // Album stands empty; dated garrisoned at 9 so it has not yet reverted when the men set out.
    await m.holdings.insertTownConquest(db, ctx, "R049", "album", "album", at(8), at(9));
    const men = await insertRow(ctx, { unitId: "hoplite", count: 10, basedAt: "genoa" });
    const r = await moveTo(ctx, "album", [men.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ from: "genoa", fromName: "Genoa", baseId: "album", townName: "Album", route: "within", steps: 0, minutes: 10 });
    expect(r.report.line).toBe("10 hoplites march from Genoa to Album, arriving in 00:10:00.");
    expect((await settle(ctx, at(9.01))).arrived).toHaveLength(1);
    expect((await rows(ctx))[0]).toMatchObject({ basedAt: "album", movingTo: null, mission: null });
  });

  it("a region with towns is not a target itself; home ground and fog are refused too", async () => {
    const { ctx } = await makePlayer();
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    expect(await act(ctx, "raid", "R047", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "This land answers to its towns: choose one." });
    // Home ground answers as such even where it holds a town (R052: arelate).
    expect(await act(ctx, "raid", "R052", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Massalia does not act against her own." });
    expect(await act(ctx, "raid", "R174", [peltasts.id])).toMatchObject({ ok: false, code: 404 });
    expect(await act(ctx, "raid", "R060", [peltasts.id])).toMatchObject({ ok: false, code: 409, error: "Massalia does not act against her own." });
  });
});
