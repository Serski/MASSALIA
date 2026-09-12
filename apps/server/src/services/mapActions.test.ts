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
  return { dbPkg, shared, buildings, barracks, mapGraph, mapPools, holdings, actions, lock };
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
  const stock = async (ctx: Ctx, type: string) =>
    Number((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, ctx.playerId), eq(m.dbPkg.resources.type, type))))[0]?.amount ?? 0);
  const wallet = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, ctx.playerId)))[0]!.drachmae;
  const rows = (ctx: Ctx) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt));
  const holdingsOf = (ctx: Ctx) => db.select().from(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
  const logs = (characterId: string, kind: string) =>
    db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, characterId), eq(m.dbPkg.effectLog.kind, kind))).orderBy(asc(m.dbPkg.effectLog.createdAt));
  const warband = async (regionId: string) => (await db.select().from(m.dbPkg.regionMilitary).where(and(eq(m.dbPkg.regionMilitary.worldId, worldId), eq(m.dbPkg.regionMilitary.regionId, regionId))))[0]?.warband;
  const setWarband = (regionId: string, value: number, when: Date) => m.mapPools.writeRegionWarband(db, worldId, regionId, value, when);
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
  const recordChronicle = async (characterId: string) => {
    const entries = await m.dbPkg.gatherChronicleForCharacter(characterId);
    for (const e of entries) if (e.type === "map_action" || e.type === "holding_reverted") chronicleLines.push(`${e.label} — ${m.shared.renderCampaignLine(e.type, e.payload as never)}`);
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
