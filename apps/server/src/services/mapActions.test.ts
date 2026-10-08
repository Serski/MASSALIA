import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import type { MapActReport } from "./mapActions.js";

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
const MIN = 60_000;
// The road (battle.json march): a party fights `minutes` after it sets out and
// is home twice that later. R046 and Reii are 30 minutes from Massalia, R078
// and Aleria 60, Thapsus 150, Album from Genoa 10.
const fought = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MIN);
const home = (from: Date, minutes: number) => new Date(from.getTime() + 2 * minutes * MIN);

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
  const traits = await import("./traits.js");
  const age = await import("./age.js");
  return { dbPkg, shared, buildings, barracks, mapGraph, mapPools, holdings, actions, lock, mapReach, traits, age };
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
    await give(ctx, "chicken", 5000);
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
  // The player's voyages (hulls at sea, home or not), by sailing then id.
  const voyages = (ctx: Ctx) => db.select().from(m.dbPkg.playerVoyages).where(eq(m.dbPkg.playerVoyages.ownerPlayerId, ctx.playerId)).orderBy(asc(m.dbPkg.playerVoyages.sailedAt), asc(m.dbPkg.playerVoyages.id));
  // The dynasty's intel rows, as a scout or a fight writes them.
  const regionIntelOf = async (dynastyId: string, regionId: string) => (await db.select().from(m.dbPkg.regionIntel).where(and(eq(m.dbPkg.regionIntel.dynastyId, dynastyId), eq(m.dbPkg.regionIntel.regionId, regionId))))[0];
  const townIntelOf = async (dynastyId: string, townId: string) => (await db.select().from(m.dbPkg.townIntel).where(and(eq(m.dbPkg.townIntel.dynastyId, dynastyId), eq(m.dbPkg.townIntel.townId, townId))))[0];
  const rows = (ctx: Ctx) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, ctx.playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt));
  const holdingsOf = (ctx: Ctx) => db.select().from(m.dbPkg.playerHoldings).where(eq(m.dbPkg.playerHoldings.ownerPlayerId, ctx.playerId));
  const logs = (characterId: string, kind: string) =>
    db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, characterId), eq(m.dbPkg.effectLog.kind, kind))).orderBy(asc(m.dbPkg.effectLog.createdAt));
  const warband = async (regionId: string) => (await db.select().from(m.dbPkg.regionMilitary).where(and(eq(m.dbPkg.regionMilitary.worldId, worldId), eq(m.dbPkg.regionMilitary.regionId, regionId))))[0]?.warband;
  const setWarband = (regionId: string, value: number, when: Date) => m.mapPools.writeRegionWarband(db, worldId, regionId, value, when);
  // The region row's regrowth marker.
  const marker = async (regionId: string) => (await db.select().from(m.dbPkg.regionMilitary).where(and(eq(m.dbPkg.regionMilitary.worldId, worldId), eq(m.dbPkg.regionMilitary.regionId, regionId))))[0]?.updatedAt;
  const garrison = async (townId: string) => (await db.select().from(m.dbPkg.townMilitary).where(and(eq(m.dbPkg.townMilitary.worldId, worldId), eq(m.dbPkg.townMilitary.townId, townId))))[0]?.garrison;
  const setGarrison = (townId: string, value: number, when: Date) => m.mapPools.writeTownGarrison(db, worldId, townId, value, when);
  const levy = async (ctx: Ctx) => (await db.select().from(m.dbPkg.playerLevy).where(eq(m.dbPkg.playerLevy.ownerPlayerId, ctx.playerId)))[0];
  // The world's opinion rows: one nation's, or all of them (a raid on land no faction holds writes none).
  const relation = async (factionId: string) => (await db.select().from(m.dbPkg.factionRelations).where(and(eq(m.dbPkg.factionRelations.worldId, worldId), eq(m.dbPkg.factionRelations.factionId, factionId))))[0];
  const relations = () => db.select().from(m.dbPkg.factionRelations).where(eq(m.dbPkg.factionRelations.worldId, worldId));
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
  // The raw act: the party sets out and the answer is the set-out card.
  // Whole rows by id (the count is read back from the row); partial sends use launchRows.
  const launch = async (ctx: Ctx, type: "scout" | "raid" | "attack", regionId: string, rowIds: string[], when = at(9)) => {
    const all = await rows(ctx);
    return m.actions.act(ctx, { type, regionId, rows: rowIds.map((id) => ({ rowId: id, count: all.find((r) => r.id === id)?.count ?? 1 })) }, when);
  };
  const launchRows = (ctx: Ctx, type: "scout" | "raid" | "attack", regionId: string, sent: { rowId: string; count: number }[], when = at(9)) => m.actions.act(ctx, { type, regionId, rows: sent }, when);
  const launchShips = async (ctx: Ctx, type: "scout" | "raid" | "attack", target: { regionId: string } | { townId: string }, rowIds: string[], ships: Record<string, number>, when = at(9)) => {
    const all = await rows(ctx);
    return m.actions.act(ctx, { type, ...target, rows: rowIds.map((id) => ({ rowId: id, count: all.find((r) => r.id === id)?.count ?? 1 })), ships }, when);
  };
  const launchTown = async (ctx: Ctx, type: "scout" | "raid" | "attack", townId: string, rowIds: string[], when = at(9)) => {
    const all = await rows(ctx);
    return m.actions.act(ctx, { type, townId, rows: rowIds.map((id) => ({ rowId: id, count: all.find((r) => r.id === id)?.count ?? 1 })) }, when);
  };
  // Send the party and let it arrive: the launch answer with the march's
  // stored battle report in place of the set-out card (kept as `setOut`). A
  // refusal is returned as it is.
  type Launch = Awaited<ReturnType<Mods["actions"]["act"]>>;
  type SetOut = Extract<Launch, { ok: true }>;
  type Arrived = Omit<SetOut, "report"> & { report: MapActReport; setOut: SetOut["report"] };
  const marchRow = async (id: string) => (await db.select().from(m.dbPkg.playerMarches).where(eq(m.dbPkg.playerMarches.id, id)))[0]!;
  const arrive = async (res: Launch): Promise<Extract<Launch, { ok: false }> | Arrived> => {
    if (!res.ok) return res;
    const setOut = res.report;
    expect(await m.actions.resolveMarch(setOut.marchId, new Date(setOut.arrivesAt))).toEqual({ outcome: "resolved" });
    return { ...res, setOut, report: (await marchRow(setOut.marchId)).report as unknown as MapActReport };
  };
  const act = async (ctx: Ctx, type: "scout" | "raid" | "attack", regionId: string, rowIds: string[], when = at(9)) => arrive(await launch(ctx, type, regionId, rowIds, when));
  const actRows = async (ctx: Ctx, type: "scout" | "raid" | "attack", regionId: string, sent: { rowId: string; count: number }[], when = at(9)) => arrive(await launchRows(ctx, type, regionId, sent, when));
  const actShips = async (ctx: Ctx, type: "scout" | "raid" | "attack", target: { regionId: string } | { townId: string }, rowIds: string[], ships: Record<string, number>, when = at(9)) => arrive(await launchShips(ctx, type, target, rowIds, ships, when));
  const actTown = async (ctx: Ctx, type: "scout" | "raid" | "attack", townId: string, rowIds: string[], when = at(9)) => arrive(await launchTown(ctx, type, townId, rowIds, when));
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
    await m.traits.loadTraitDefs();
    await m.age.loadAgeConfig();
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

  it("a raid sets out and fights when it arrives; the settle never lands a party on its way out", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 20, at(9));
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const sent = await launch(ctx, "raid", "R046", [peltasts.id]);
    expect(sent).toMatchObject({ ok: true });
    if (!sent.ok) return;
    expect(sent.report).toMatchObject({ type: "setout", action: "raid", regionId: "R046", regionName: "Salyes", townId: null, townName: null, base: "R060", route: "land", steps: 1, minutes: 30, departedAt: at(9).toISOString(), arrivesAt: fought(at(9), 30).toISOString(), men: 40, line: "40 peltasts set out to raid Salyes, arriving in 00:30:00." });
    const marchId = sent.report.marchId;
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)).toMatchObject({ movingTo: "R046", arrivesAt: fought(at(9), 30), mission: { kind: "raid", regionId: "R046", departedAt: at(9).toISOString(), marchId } });
    expect(await marchRow(marchId)).toMatchObject({ status: "marching", kind: "raid", baseId: "R060", minutes: 30, party: [peltasts.id], report: null, seenAt: null });
    expect(await warband("R046")).toBe(20);
    expect(await logs(characterId, "map_report")).toHaveLength(0);
    // The settle at the arrival instant leaves the party on the road: its march lands it.
    await settle(ctx, fought(at(9), 30));
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)).toMatchObject({ movingTo: "R046", mission: { marchId } });
    // Due at the arrival, once.
    expect(await m.actions.resolveMarch(marchId, new Date(fought(at(9), 30).getTime() - MIN))).toEqual({ outcome: "not_due" });
    expect(await m.actions.resolveMarch(marchId, fought(at(9), 30))).toEqual({ outcome: "resolved" });
    expect(await m.actions.resolveMarch(marchId, fought(at(9), 30))).toEqual({ outcome: "not_due" });
    const march = await marchRow(marchId);
    expect(march).toMatchObject({ status: "resolved", resolvedAt: fought(at(9), 30) });
    const report = march.report as unknown as MapActReport;
    expect(report).toMatchObject({ type: "raid", winner: "attacker", marchId, arrivedAt: fought(at(9), 30).toISOString(), homeAt: home(at(9), 30).toISOString() });
    const row = (await rows(ctx)).find((x) => x.id === peltasts.id)!;
    expect(row).toMatchObject({ movingTo: "R060", arrivesAt: home(at(9), 30), mission: { kind: "raid", regionId: "R046", departedAt: at(9).toISOString() } });
    expect(row.mission!.marchId).toBeUndefined();
    expect(await warband("R046")).toBe(20 - report.defender!.losses);
    const reports = await logs(characterId, "map_report");
    expect(reports).toHaveLength(1);
    expect(reports[0]!.createdAt).toEqual(fought(at(9), 30));
    expect(await logs(characterId, "map_action")).toHaveLength(0);
  });

  it("a party that finds the place taken turns back", async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await setWarband("R046", 10, at(9));
    const hoplitesA = await insertRow(a.ctx, { unitId: "hoplite", count: 30 });
    const peltastsA = await insertRow(a.ctx, { unitId: "peltast", count: 20 });
    const hoplitesB = await insertRow(b.ctx, { unitId: "hoplite", count: 30 });
    const attackA = await launch(a.ctx, "attack", "R046", [hoplitesA.id], at(9));
    const raidA = await launch(a.ctx, "raid", "R046", [peltastsA.id], fought(at(9), 5));
    const attackB = await launch(b.ctx, "attack", "R046", [hoplitesB.id], fought(at(9), 10));
    expect([attackA.ok, raidA.ok, attackB.ok]).toEqual([true, true, true]);
    if (!attackA.ok || !raidA.ok || !attackB.ok) return;
    // In arrival order: A takes the place; A's own raid finds it ours; B's attack finds it another house's.
    for (const sent of [attackA, raidA, attackB]) expect(await m.actions.resolveMarch(sent.report.marchId, new Date(sent.report.arrivesAt))).toEqual({ outcome: "resolved" });
    expect((await marchRow(attackA.report.marchId)).report).toMatchObject({ winner: "attacker", conquest: { regionId: "R046" } });
    expect((await marchRow(raidA.report.marchId)).report).toMatchObject({ winner: "turned_back", line: "20 peltasts found Salyes already ours and turned back." });
    expect((await marchRow(attackB.report.marchId)).report).toMatchObject({ winner: "turned_back", defender: null, line: "30 hoplites found Salyes held by another house and turned back." });
    expect((await rows(a.ctx)).find((x) => x.id === peltastsA.id)).toMatchObject({ count: 20, movingTo: "R060", arrivesAt: home(fought(at(9), 5), 30) });
    expect((await rows(b.ctx)).find((x) => x.id === hoplitesB.id)).toMatchObject({ count: 30, movingTo: "R060", arrivesAt: home(fought(at(9), 10), 30) });
    expect((await holdingsOf(a.ctx)).map((h) => h.regionId)).toEqual(["R046"]);
    expect(await warband("R046")).toBe(0);
  });

  it("a party whose men all left on the road breaks up", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 20, at(9));
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const sent = await launch(ctx, "raid", "R046", [peltasts.id]);
    expect(sent).toMatchObject({ ok: true });
    if (!sent.ok) return;
    // Gone on the road, as an unpaid-upkeep disband would take them.
    await db.delete(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.id, peltasts.id));
    expect(await m.actions.resolveMarch(sent.report.marchId, new Date(sent.report.arrivesAt))).toEqual({ outcome: "resolved" });
    const report = (await marchRow(sent.report.marchId)).report as unknown as MapActReport;
    expect(report).toMatchObject({ winner: "dispersed", homeAt: null, defender: null, line: "The party sent to Salyes broke up on the road." });
    expect(report.attacker.rows).toEqual([]);
    expect(await warband("R046")).toBe(20);
    expect(await logs(characterId, "battle_loss")).toHaveLength(0);
  });

  it("winter stops departures, not arrivals", async () => {
    // Day 8 opens Winter; a raid sent 10 minutes before, in Autumn, arrives 20 minutes into it and is fought.
    const { ctx } = await makePlayer();
    await setWarband("R046", 20, at(7.9));
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const autumn = new Date(at(8).getTime() - 10 * MIN);
    const sent = await launch(ctx, "raid", "R046", [peltasts.id], autumn);
    expect(sent).toMatchObject({ ok: true });
    if (!sent.ok) return;
    expect(await launch(ctx, "raid", "R046", [peltasts.id], at(8))).toMatchObject({ ok: false, code: 409, error: "The passes are closed until spring." });
    expect(await m.actions.resolveMarch(sent.report.marchId, fought(autumn, 30))).toEqual({ outcome: "resolved" });
    expect((await marchRow(sent.report.marchId)).report).toMatchObject({ winner: "attacker", arrivedAt: fought(autumn, 30).toISOString() });
  });

  it("reports: the Barracks lists them newest first, unread until opened", async () => {
    const { ctx } = await makePlayer();
    const other = await makePlayer();
    await setWarband("R046", 20, at(9));
    const scouts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 30 });
    const scout = await launch(ctx, "scout", "R046", [scouts.id], at(9));
    const raid = await launch(ctx, "raid", "R046", [hoplites.id], fought(at(9), 10));
    expect([scout.ok, raid.ok]).toEqual([true, true]);
    if (!scout.ok || !raid.ok) return;
    for (const sent of [scout, raid]) expect(await m.actions.resolveMarch(sent.report.marchId, new Date(sent.report.arrivesAt))).toEqual({ outcome: "resolved" });
    const reports = (await m.barracks.barracksView(ctx, at(10))).reports;
    expect(reports.map((r) => [r.id, r.kind, r.arrivedAt, r.seen])).toEqual([
      [raid.report.marchId, "raid", fought(at(9), 40).toISOString(), false],
      [scout.report.marchId, "scout", fought(at(9), 30).toISOString(), false],
    ]);
    for (const r of reports) {
      expect(typeof r.gameDate).toBe("string");
      expect(r.report).toMatchObject({ marchId: r.id, type: r.kind });
    }
    // Opened once: the highlight goes and stays gone; a second opening changes nothing.
    expect(await m.barracks.markReportRead(ctx, raid.report.marchId, at(10))).toEqual({ ok: true });
    expect((await m.barracks.barracksView(ctx, at(10))).reports.map((r) => r.seen)).toEqual([true, false]);
    expect(await m.barracks.markReportRead(ctx, raid.report.marchId, at(11))).toEqual({ ok: true });
    expect((await marchRow(raid.report.marchId)).seenAt).toEqual(at(10));
    // Not his, unknown, or not an id at all: no such report.
    expect(await m.barracks.markReportRead(other.ctx, raid.report.marchId, at(10))).toEqual({ ok: false, code: 404, error: "No such report." });
    expect(await m.barracks.markReportRead(ctx, "00000000-0000-4000-8000-000000000999", at(10))).toEqual({ ok: false, code: 404, error: "No such report." });
    expect(await m.barracks.markReportRead(ctx, "nope", at(10))).toEqual({ ok: false, code: 404, error: "No such report." });
  });

  it("scout: needs a row at Spd 6+, writes the dynasty's intel with the regenerated warband, and sends the party out and home", async () => {
    const { ctx, characterId, dynastyId } = await makePlayer();
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 10 });
    const slow = await act(ctx, "scout", "R046", [hoplites.id]);
    expect(slow).toMatchObject({ ok: false, code: 409 });
    expect((slow as { error: string }).error).toMatch(/Spd 6/);
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 10 });
    const r = await act(ctx, "scout", "R046", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ type: "scout", regionId: "R046", regionName: "Salyes", route: "land", steps: 1, minutes: 30, destination: "R060", intel: { warband: 100 }, winner: null });
    expect(r.report.homeAt).toBe(home(at(9), 30).toISOString());
    const intel = (await db.select().from(m.dbPkg.regionIntel).where(and(eq(m.dbPkg.regionIntel.dynastyId, dynastyId), eq(m.dbPkg.regionIntel.regionId, "R046"))))[0]!;
    expect(intel).toMatchObject({ warband: 100 });
    expect(typeof intel.scoutedGameDate).toBe("string");
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)).toMatchObject({ movingTo: "R060", arrivesAt: home(at(9), 30), count: 10, mission: { kind: "scout", regionId: "R046", departedAt: at(9).toISOString() } });
    // The moving party is out of the roster's force.
    expect(r.force.men).toBe(10); // the hoplites still stand
    expect(await logs(characterId, "map_report")).toHaveLength(1);
    expect(await logs(characterId, "map_action")).toHaveLength(0);
    await recordChronicle(characterId);
  });

  it("raid win: plunder credited, the warband reduced, losses logged per row, party home in a day", async () => {
    const { ctx, characterId, dynastyId } = await makePlayer({ drachmae: 100 });
    await setWarband("R046", 20, at(9)); // 40 peltasts meet 5 (a fourth of 20) and kill 4 or 5 on every seed, losing 0 or 1
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const r = await act(ctx, "raid", "R046", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("attacker");
    expect(r.report.defender).toMatchObject({ start: 20, turnout: 5 });
    const killed = r.report.defender!.losses;
    expect([4, 5]).toContain(killed);
    // The plunder: 50 drachmae, 5 grain and 5 of one of the four goods per kill.
    const good = r.report.plunder!.spoil!.good;
    expect(["oliveoil", "leather", "salt", "wool"]).toContain(good);
    const label = good === "oliveoil" ? "olive oil" : good;
    expect(r.report.plunder).toEqual({ drachmae: killed * 50, grain: killed * 5, spoil: { good, label, amount: killed * 5 } });
    expect(await wallet(ctx)).toBe(100 + killed * 50);
    expect(await stock(ctx, "grain")).toBe(5000 - 3 * 40 + killed * 5); // 3 whole days after ready_at (at 6) × 40 peltasts × 1 grain, then the plunder
    expect(await stock(ctx, good)).toBe((good === "oliveoil" ? 5000 - 3 * 40 : 0) + killed * 5); // the peltasts eat olive oil too
    expect(await warband("R046")).toBe(20 - killed);
    // Salyes is unclaimed: no nation to sour.
    expect(r.report.opinion).toBeNull();
    expect(await relations()).toEqual([]);
    // The fight wrote what the men saw to the dynasty's intel: the warband as it was left.
    expect(r.report.intel).toEqual({ warband: 20 - killed, scoutedGameDate: expect.any(String) });
    expect(await regionIntelOf(dynastyId, "R046")).toMatchObject({ warband: 20 - killed, scoutedAt: fought(at(9), 30), scoutedGameDate: r.report.intel!.scoutedGameDate });
    const row = (await rows(ctx)).find((x) => x.id === peltasts.id)!;
    expect(row).toMatchObject({ movingTo: "R060", arrivesAt: home(at(9), 30), count: 40 - r.report.attacker.losses, mission: { kind: "raid", regionId: "R046", departedAt: at(9).toISOString() } });
    expect((await logs(characterId, "battle_loss")).length).toBe(r.report.attacker.losses > 0 ? 1 : 0);
    expect(await holdingsOf(ctx)).toHaveLength(0);
    expect(r.report.line).toMatch(new RegExp(`^Raided Salyes with 40 peltasts: ${killed} tribesmen slain, (none|1) of ours lost, ${killed * 50} drachmae, ${killed * 5} grain and ${killed * 5} (olive oil|leather|salt|wool) of plunder\\.$`));
    await recordChronicle(characterId);
  });

  // The raids prompts: a raid meets half to all of the men it sends, between
  // one in fifty and one in four of the pool, so a small party can win against
  // a full warband, and sending too few still costs men. Each count below holds
  // on every seed (checked on 3000 random seeds).
  it("a small party raids a full warband: 20 peltasts meet 10 to 20 of 100 and win", async () => {
    const { ctx, characterId } = await makePlayer({ drachmae: 100 });
    await setWarband("R046", 100, at(9));
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 20 });
    const r = await act(ctx, "raid", "R046", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("attacker");
    expect(r.report.defender).toMatchObject({ start: 100 });
    expect(r.report.defender!.turnout).toBeGreaterThanOrEqual(10);
    expect(r.report.defender!.turnout).toBeLessThanOrEqual(20);
    const killed = r.report.defender!.losses;
    expect([2, 3, 4, 5]).toContain(killed);
    expect([0, 1]).toContain(r.report.attacker.losses);
    expect(await warband("R046")).toBe(100 - killed);
    expect(r.report.plunder!.drachmae).toBe(killed * 50);
    expect(await wallet(ctx)).toBe(100 + killed * 50);
    await recordChronicle(characterId);
  });

  it("hoplites raid a full warband: 30 hoplites meet 15 to 25 of 100 and win", async () => {
    const { ctx, characterId } = await makePlayer();
    await setWarband("R046", 100, at(9));
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 30 });
    const r = await act(ctx, "raid", "R046", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("attacker");
    expect(r.report.defender).toMatchObject({ start: 100 });
    expect(r.report.defender!.turnout).toBeGreaterThanOrEqual(15);
    expect(r.report.defender!.turnout).toBeLessThanOrEqual(25); // half to all of 30, capped at a fourth of 100
    expect([4, 5]).toContain(r.report.defender!.losses);
    expect([0, 1, 2, 3]).toContain(r.report.attacker.losses);
    await recordChronicle(characterId);
  });

  it("the number a scout wrote follows the fight: the raider's intel reads what is left, another house's stays as it scouted", async () => {
    await setWarband("R046", 100, at(9));
    const a = await makePlayer();
    const b = await makePlayer();
    for (const p of [a, b]) {
      const scouts = await insertRow(p.ctx, { unitId: "peltast", count: 10 });
      expect(await act(p.ctx, "scout", "R046", [scouts.id])).toMatchObject({ ok: true, report: { intel: { warband: 100 } } });
      expect(await regionIntelOf(p.dynastyId, "R046")).toMatchObject({ warband: 100, scoutedAt: fought(at(9), 30) });
    }
    const hoplites = await insertRow(a.ctx, { unitId: "hoplite", count: 30 });
    const r = await act(a.ctx, "raid", "R046", [hoplites.id], at(9.5));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const killed = r.report.defender!.losses;
    expect([4, 5]).toContain(killed);
    expect(r.report.intel).toMatchObject({ warband: 100 - killed });
    expect(await regionIntelOf(a.dynastyId, "R046")).toMatchObject({ warband: 100 - killed, scoutedAt: fought(at(9.5), 30) });
    expect(await regionIntelOf(b.dynastyId, "R046")).toMatchObject({ warband: 100, scoutedAt: fought(at(9), 30) });
  });

  it("too few for the tribe: 20 peltasts meet the 120 of 6000 the floor sends, are driven off and take nothing", async () => {
    const { ctx, characterId } = await makePlayer({ drachmae: 100 });
    await setWarband("R046", 6000, at(9)); // above the content 100: read back as written; one in fifty is 120
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 20 });
    const r = await act(ctx, "raid", "R046", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("defender");
    expect(r.report.defender).toMatchObject({ start: 6000, turnout: 120 });
    const killed = r.report.defender!.losses;
    expect([2, 3]).toContain(killed);
    expect(r.report.attacker.losses).toBe(3);
    expect(r.report.plunder).toBeNull();
    expect(await wallet(ctx)).toBe(100);
    expect(await warband("R046")).toBe(6000 - killed);
    expect(r.report.line).toMatch(/^Raided Salyes with 20 peltasts and were driven off: /);
    await recordChronicle(characterId);
  });

  it("attack win: a conquest holding, survivors standing there at once, the warband at 0", async () => {
    const { ctx, characterId, dynastyId } = await makePlayer();
    await setWarband("R046", 10, at(9));
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 30 });
    const r = await act(ctx, "attack", "R046", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report.winner).toBe("attacker");
    // A conquest leaves nothing: the intel reads 0.
    expect(r.report.intel).toMatchObject({ warband: 0 });
    expect(await regionIntelOf(dynastyId, "R046")).toMatchObject({ warband: 0, scoutedAt: fought(at(9), 30) });
    expect(r.report.conquest).toEqual({ regionId: "R046", townId: null, previousOwner: "unclaimed" });
    expect(r.report.destination).toBe("R046");
    const h = await holdingsOf(ctx);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ regionId: "R046", kind: "conquest", previousOwner: "unclaimed", since: fought(at(9), 30), lastGarrisonedAt: fought(at(9), 30) });
    expect(await warband("R046")).toBe(0);
    // The survivors hold the place from the instant they won it.
    expect((await rows(ctx)).find((x) => x.id === hoplites.id)).toMatchObject({ basedAt: "R046", movingTo: null, arrivesAt: null, mission: null });
    // The launch's answer predates the conquest: the reach after the fight shows the new base.
    const view = await reach(ctx, fought(at(9), 30));
    expect(view.bases.map((b) => b.regionId)).toEqual(["R060", "R046"]);
    expect(view.reach.R046).toBeUndefined(); // our own land is a base now, not a target
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
    expect(r.report.defender).toMatchObject({ start: 100, turnout: 100 }); // an attack meets everyone
    expect(r.report.conquest).toBeNull();
    expect(r.report.destination).toBe("R060");
    expect(await holdingsOf(ctx)).toHaveLength(0);
    expect(await warband("R046")).toBe(100 - r.report.defender!.losses);
    const survivor = (await rows(ctx)).find((x) => x.id === hoplites.id);
    if (survivor) expect(survivor).toMatchObject({ basedAt: "R060", movingTo: "R060", arrivesAt: home(at(9), 30) });
    else expect(r.report.attacker.rows[0]!.end).toBe(0);
    expect(r.report.line).toMatch(/^Attacked Salyes with 5 hoplites and were broken/);
    await recordChronicle(characterId);
  });

  it("another house's holding: an attack is refused at launch and nothing moves; a raid there still goes", async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await m.holdings.insertConquest(db, a.ctx, "R046", "unclaimed", at(8));
    await m.holdings.insertTownConquest(db, a.ctx, "R047", "reii", "saluvii", at(8));
    const hoplites = await insertRow(b.ctx, { unitId: "hoplite", count: 30 });
    expect(await act(b.ctx, "attack", "R046", [hoplites.id])).toEqual({ ok: false, code: 409, error: "Another house holds this land." });
    expect(await actTown(b.ctx, "attack", "reii", [hoplites.id])).toEqual({ ok: false, code: 409, error: "Another house holds this town." });
    expect((await rows(b.ctx)).find((x) => x.id === hoplites.id)).toMatchObject({ basedAt: "R060", count: 30, movingTo: null });
    expect((await holdingsOf(a.ctx)).map((h) => [h.regionId, h.townId])).toEqual([["R046", ""], ["R047", "reii"]]);
    // A raid on the held land goes on as before.
    await setWarband("R046", 100, at(9));
    const raid = await act(b.ctx, "raid", "R046", [hoplites.id]);
    expect(raid).toMatchObject({ ok: true, report: { type: "raid" } });
  });

  it("the altar: a bull lit before the fight raises every row's morale; a blessing that went cold before it gives nothing", async () => {
    // 40 hoplites against a warband of 90. Unblessed they are broken on every
    // seed; with a bull lit (+3 morale: 15 more points of losses before a row
    // breaks) both sides stand and the attack withdraws, on every seed.
    const fight = async (prep: (ctx: Ctx) => Promise<void>) => {
      const { ctx } = await makePlayer();
      await prep(ctx);
      await setWarband("R046", 90, at(9));
      const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 40 });
      const r = await act(ctx, "attack", "R046", [hoplites.id]);
      if (!r.ok) throw new Error(r.error);
      return r.report;
    };
    const cold = await fight(async () => {});
    expect(cold.winner).toBe("defender");
    expect(cold.line).toMatch(/^Attacked Salyes with 40 hoplites and were broken/);
    // A bull burned at season 8 burns until season 10: lit at the fight.
    const blessed = await fight(async (ctx) => {
      await give(ctx, "bull", 1);
      expect(await m.barracks.sacrifice(ctx, "bull", at(8))).toEqual({ ok: true, good: "bull", mor: 3, until: at(10) });
    });
    expect(blessed.winner).toBe("stand");
    expect(blessed.line).toMatch(/^Attacked Salyes with 40 hoplites and withdrew/);
    // A bull burned at season 6 went cold at season 8: nothing at the fight.
    const expired = await fight(async (ctx) => {
      await give(ctx, "bull", 1);
      expect(await m.barracks.sacrifice(ctx, "bull", at(6))).toMatchObject({ ok: true, until: at(8) });
    });
    expect(expired.winner).toBe("defender");
    expect(expired.line).toMatch(/^Attacked Salyes with 40 hoplites and were broken/);
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

  it("a sea target without enough hulls is refused with the hull reason; with hulls the raid sails, and the hulls are out of stock until the party is home", async () => {
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
    expect(r.report).toMatchObject({ route: "sea", steps: 2, minutes: 60, ships: { "trade-ship": 1, galley: 5 } });
    expect(r.report.homeAt).toBe(home(at(9), 60).toISOString());
    // The hulls that sailed are out of stock, on one voyage, until the party is home.
    expect(await stock(ctx, "trade-ship")).toBe(0);
    expect(await stock(ctx, "galley")).toBe(0);
    const v = await voyages(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ ships: { "trade-ship": 1, galley: 5 }, kind: "raid", regionId: "R078", townId: null, musterId: null, sailedAt: at(9), returnsAt: home(at(9), 60), returnedAt: null });
    expect((await m.barracks.barracksView(ctx, new Date(at(9).getTime() + 90 * MIN))).atSea).toEqual([
      { id: v[0]!.id, ships: [{ id: "trade-ship", label: "Pentekonter", count: 1 }, { id: "galley", label: "Trireme", count: 5 }], kind: "raid", musterId: null, regionId: "R078", townId: null, sailedAt: at(9).toISOString(), returnsAt: home(at(9), 60).toISOString() },
    ]);
    // The settle brings them home at the party's instant, not a minute before, and only once.
    const back = home(at(9), 60);
    expect((await settle(ctx, new Date(back.getTime() - 60_000))).shipsHome).toEqual([]);
    expect((await settle(ctx, back)).shipsHome).toEqual([{ voyageId: v[0]!.id, ships: { "trade-ship": 1, galley: 5 } }]);
    expect(await stock(ctx, "trade-ship")).toBe(1);
    expect(await stock(ctx, "galley")).toBe(5);
    expect((await voyages(ctx))[0]).toMatchObject({ returnedAt: back });
    expect((await settle(ctx, at(10))).shipsHome).toEqual([]);
    expect(await stock(ctx, "trade-ship")).toBe(1);
    expect(await stock(ctx, "galley")).toBe(5);
  });

  it("hulls at sea carry no second party until they are home", async () => {
    const { ctx } = await makePlayer();
    await give(ctx, "trade-ship", 1);
    await setWarband("R078", 10, at(9));
    // Two units, so the settle does not fold them into one row.
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 20 });
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 20 });
    expect(await act(ctx, "raid", "R078", [peltasts.id])).toMatchObject({ ok: true, report: { route: "sea", ships: { "trade-ship": 1 } } });
    // The first party has fought and its hull is still at sea: the port is empty, the reach
    // reads no hulls (range comes before hulls), and the men stay home.
    expect(await act(ctx, "raid", "R078", [hoplites.id], fought(at(9), 60))).toEqual({ ok: false, code: 409, error: "Beyond the fleet's range (2 seas, fleet reaches 0)." });
    expect((await rows(ctx)).find((x) => x.id === hoplites.id)).toMatchObject({ basedAt: "R060", movingTo: null, count: 20 });
    // Once the party is home the same hull sails again.
    const again = await act(ctx, "raid", "R078", [hoplites.id], home(at(9), 60));
    expect(again).toMatchObject({ ok: true });
    if (!again.ok) return;
    expect(again.report.ships).toEqual({ "trade-ship": 1 });
  });

  it("a party that falls to a man still brings its hulls home, on the party's clock", async () => {
    const { ctx } = await makePlayer();
    await give(ctx, "trade-ship", 1);
    await setWarband("R078", 6000, at(9)); // the floor sends 120: all 5 fall on every seed
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 5 });
    const r = await act(ctx, "raid", "R078", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ winner: "defender", attacker: { losses: 5 }, defender: { start: 6000, turnout: 120 } });
    expect(await rows(ctx)).toEqual([]);
    expect(await stock(ctx, "trade-ship")).toBe(0);
    const v = await voyages(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ ships: { "trade-ship": 1 }, returnsAt: home(at(9), 60), returnedAt: null });
    expect((await settle(ctx, home(at(9), 60))).shipsHome).toEqual([{ voyageId: v[0]!.id, ships: { "trade-ship": 1 } }]);
    expect(await stock(ctx, "trade-ship")).toBe(1);
  });

  it("a chosen fleet: used as given when it fits, refused beyond stock, short of space, out of range, or unknown", async () => {
    const { ctx } = await makePlayer();
    await give(ctx, "trade-ship", 2);
    await give(ctx, "galley", 2);
    await setWarband("R078", 10, at(9));
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 }); // 40 space; R078 is two seas out
    // Beyond stock, short of space, a hull that cannot make the crossing, a ship that is not one.
    expect(await actShips(ctx, "raid", { regionId: "R078" }, [peltasts.id], { "trade-ship": 3 })).toMatchObject({ ok: false, code: 409, error: "Only 2 pentekonters in port." });
    expect(await actShips(ctx, "raid", { regionId: "R078" }, [peltasts.id], { "trade-ship": 1 })).toMatchObject({ ok: false, code: 409, error: "Not enough hulls: 40 space needed, 20 aboard." });
    expect(await actShips(ctx, "raid", { regionId: "R078" }, [peltasts.id], { "trade-ship": 2, quinquereme: 1 })).toMatchObject({ ok: false, code: 400, error: "No such ship." });
    expect(await actShips(ctx, "raid", { regionId: "R078" }, [peltasts.id], { "trade-ship": -1 })).toMatchObject({ ok: false, code: 400 });
    // As given: two pentekonters and one trireme sail, the second trireme stays home (no automatic escort).
    const r = await actShips(ctx, "raid", { regionId: "R078" }, [peltasts.id], { "trade-ship": 2, galley: 1 });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ route: "sea", steps: 2, ships: { "trade-ship": 2, galley: 1 } });
    expect(await stock(ctx, "trade-ship")).toBe(0);
    expect(await stock(ctx, "galley")).toBe(1); // the second trireme stayed in port
    // A trireme chosen for a five-sea crossing is refused with the range reason
    // (the automatic assembly would have left it home). The settle at 10 has
    // brought the raid's hulls home.
    await settle(ctx, at(10));
    expect(await stock(ctx, "trade-ship")).toBe(2);
    expect(await stock(ctx, "galley")).toBe(2);
    await setGarrison("thapsus", 10, at(10));
    // Hoplites, so the settle does not fold this row into the peltasts back from the raid.
    const fresh = await insertRow(ctx, { unitId: "hoplite", count: 40, season: 6 });
    expect(await actShips(ctx, "attack", { townId: "thapsus" }, [fresh.id], { "trade-ship": 2, galley: 1 }, at(10))).toMatchObject({ ok: false, code: 409, error: "Beyond the fleet's range (5 seas, fleet reaches 4)." });
    const far = await actShips(ctx, "attack", { townId: "thapsus" }, [fresh.id], { "trade-ship": 2 }, at(10));
    expect(far).toMatchObject({ ok: true });
    if (!far.ok) return;
    expect(far.report.fleet).toMatchObject({ ships: { "trade-ship": 2 }, naval: 2 });
  });

  it("regrowth: 5 a day on a steady clock; the part of a day carries over, a fight below the full count leaves the clock running, and a full pool's first loss starts it", async () => {
    const read = (when: Date) => m.mapPools.readRegionWarband(db, worldId, "R046", when);
    await setWarband("R046", 50, at(9)); // content 100; a fresh row's clock starts at the write
    expect(await read(at(9.5))).toBe(50);
    expect(await read(at(11))).toBe(60);
    // The marker moves by whole days only: the half day carries over.
    expect(await read(at(12.5))).toBe(65);
    expect(await marker("R046")).toEqual(at(12));
    expect(await read(at(13))).toBe(70); // the old marker, 12.5, gave 65
    // A fight below the full count leaves the clock where it is.
    await setWarband("R046", 60, at(13.5));
    expect(await marker("R046")).toEqual(at(13));
    expect(await read(at(14))).toBe(65); // the old rule restarted at 13.5 and gave 60
    expect(await read(at(40))).toBe(100);
    // A full pool's first loss starts the clock at the fight.
    await setWarband("R046", 90, at(40.5));
    expect(await marker("R046")).toEqual(at(40.5));
    expect(await read(at(41))).toBe(90);
    expect(await read(at(41.5))).toBe(95);
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
    // Bad counts are refused before anything moves (tried once the 20 have fought and are on the road home).
    expect(await actRows(ctx, "raid", "R046", [{ rowId: home.id, count: 11 }], fought(at(9), 30))).toMatchObject({ ok: false, code: 400 });
    expect(await actRows(ctx, "raid", "R046", [{ rowId: home.id, count: 0 }], fought(at(9), 30))).toMatchObject({ ok: false, code: 400 });
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
    const { ctx, characterId, dynastyId } = await makePlayer({ drachmae: 100 });
    await setGarrison("reii", 10, at(9)); // 3 (a fourth of 10, rounded) meet the raid behind walls 1: 2 or 3 are slain on every seed
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const r = await actTown(ctx, "raid", "reii", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ type: "raid", townId: "reii", winner: "attacker", defender: { label: "Town garrison", start: 10, turnout: 3 }, conquest: null });
    const killed = r.report.defender!.losses;
    expect([2, 3]).toContain(killed);
    const good = r.report.plunder!.spoil!.good;
    expect(["oliveoil", "leather", "salt", "wool"]).toContain(good);
    expect(r.report.plunder).toEqual({ drachmae: killed * 50 * 2, grain: killed * 5 * 2, spoil: { good, label: good === "oliveoil" ? "olive oil" : good, amount: killed * 5 * 2 } });
    expect(await wallet(ctx)).toBe(100 + killed * 100);
    expect(await stock(ctx, good)).toBe((good === "oliveoil" ? 5000 - 3 * 40 : 0) + killed * 10);
    // Reii is the Saluvii's (start −45): one time in three the raid sours them by a point.
    if (r.report.opinion === null) expect(await relation("saluvii")).toBeUndefined();
    else {
      expect(r.report.opinion).toEqual({ factionId: "saluvii", name: "Saluvii", from: -45, to: -46, line: "The Saluvii will remember this." });
      expect(await relation("saluvii")).toMatchObject({ opinion: -46, stance: "unfriendly" });
    }
    expect(await garrison("reii")).toBe(10 - killed);
    // The fight wrote the garrison as it was left, and the town's ships, to the dynasty's intel.
    expect(r.report.intel).toEqual({ warband: 10 - killed, pentekonters: 0, triremes: 0, scoutedGameDate: expect.any(String) });
    expect(await townIntelOf(dynastyId, "reii")).toMatchObject({ garrison: 10 - killed, pentekonters: 0, triremes: 0 });
    expect(r.report.line).toMatch(/^Raided Reii with 40 peltasts: \d+ soldiers? slain/);
    await recordChronicle(characterId);
  });

  it("sea assault: a fleet weaker than the town's is repulsed with no battle, no losses and no garrison change; a stronger one lands", async () => {
    const { ctx, characterId, dynastyId } = await makePlayer();
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
    expect((await rows(ctx)).find((x) => x.id === peltasts.id)).toMatchObject({ count: 40, movingTo: "R060", arrivesAt: home(at(9), 60) });
    expect(r.report.line).toBe("Sailed against Aleria with 40 peltasts and were driven off by its fleet before landing.");
    // Turned back at sea, the men still saw the garrison and the ships: the intel reads them.
    expect(r.report.intel).toEqual({ warband: 10, pentekonters: 4, triremes: 4, scoutedGameDate: expect.any(String) });
    expect(await townIntelOf(dynastyId, "aleria")).toMatchObject({ garrison: 10, pentekonters: 4, triremes: 4, scoutedAt: fought(at(9), 60) });
    // Repulsed or not, the hulls are at sea until the party is home.
    expect(await stock(ctx, "trade-ship")).toBe(0);
    expect(await voyages(ctx)).toHaveLength(1);
    expect((await voyages(ctx))[0]).toMatchObject({ kind: "attack", townId: "aleria", ships: { "trade-ship": 2 }, returnsAt: home(at(9), 60) });
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
    expect(await townIntelOf(dynastyId, "aleria")).toMatchObject({ garrison: 0, pentekonters: 4, triremes: 4, scoutedAt: fought(at(10), 60) });
    // The escort sailed too: nothing in port until the survivors take the town up.
    expect(await stock(ctx, "trade-ship")).toBe(0);
    expect(await stock(ctx, "galley")).toBe(0);
    expect(await voyages(ctx)).toHaveLength(2);
    expect((await voyages(ctx))[1]).toMatchObject({ ships: { "trade-ship": 2, galley: 5 }, returnsAt: home(at(10), 60) });
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

  it("a raid turned back at sea does not roll: Carthage is not soured by a landing that never happened", async () => {
    const { ctx, characterId } = await makePlayer();
    // Thapsus (Carthage's, five seas, naval 8): 40 peltasts on 2 pentekonters (naval 2) are repulsed.
    await give(ctx, "trade-ship", 2);
    const peltasts = await insertRow(ctx, { unitId: "peltast", count: 40 });
    const r = await actTown(ctx, "raid", "thapsus", [peltasts.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ type: "raid", townId: "thapsus", route: "sea", steps: 5, winner: "repulsed", fleet: { ships: { "trade-ship": 2 }, naval: 2, defender: { naval: 8 }, held: false }, plunder: null, opinion: null });
    expect(await relation("carthage")).toBeUndefined();
    await recordChronicle(characterId);
  });

  it("taking a town: a town holding, the garrison at 0, survivors standing at the town at once, the region untouched", async () => {
    const { ctx, characterId } = await makePlayer();
    await setGarrison("reii", 10, at(9));
    const hoplites = await insertRow(ctx, { unitId: "hoplite", count: 60 });
    const r = await actTown(ctx, "attack", "reii", [hoplites.id]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.report).toMatchObject({ winner: "attacker", conquest: { regionId: "R047", townId: "reii", previousOwner: "saluvii" }, destination: "reii", town: { walls: 1, garrisonDef: 8 } });
    expect(await garrison("reii")).toBe(0);
    // An attack does not roll the grudge.
    expect(r.report.opinion).toBeNull();
    expect(await relation("saluvii")).toBeUndefined();
    const held = await holdingsOf(ctx);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ regionId: "R047", townId: "reii", kind: "conquest", previousOwner: "saluvii", lastGarrisonedAt: fought(at(9), 30), lastTributeAt: fought(at(9), 30) });
    expect((await rows(ctx)).find((x) => x.id === hoplites.id)).toMatchObject({ basedAt: "reii", movingTo: null, arrivesAt: null, mission: null });
    // The region has no warband of its own to touch, and no row was created for it.
    expect(await warband("R047")).toBeUndefined();
    expect(r.report.line).toMatch(/^Took Reii with 60 hoplites: \d+ soldiers? slain, .* The town is ours\.$/);
    // Once home, the town is a base: its region is no target, and the next town over is a step away.
    await settle(ctx, at(10));
    const view = await reach(ctx, at(10));
    // The garrison is what survived (the seed carries the march id, so the losses vary by run).
    const survivors = r.report.attacker.rows[0]!.end;
    expect(view.bases).toContainEqual({ id: "reii", regionId: "R047", townId: "reii", kind: "conquest", name: "Reii", holding: { garrison: survivors, minGarrison: 15, perDay: { drachmae: 120, grain: 0, timber: 0 }, levyPerYear: 0 } });
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
    expect(r.report).toMatchObject({ townId: "album", base: "genoa", route: "land", steps: 0, minutes: 10, destination: "genoa" });
  });

  it("town tribute: whole days only, only while the garrison meets the population minimum, and never after reversion", async () => {
    const { ctx, characterId } = await makePlayer({ drachmae: 1000 });
    await giveAll(ctx, { wine: 1000, herbal: 1000 }); // chicken is already stocked by makePlayer
    // Vienna (R032, population 3,000): 240 dr a day, 30 men needed.
    await m.holdings.insertTownConquest(db, ctx, "R032", "vienna", "cavares", at(9));
    const men = await insertRow(ctx, { unitId: "hoplite", count: 30, basedAt: "vienna", season: 8 });
    const before = await wallet(ctx);
    // Half a day: nothing yet.
    expect((await settle(ctx, at(9.5))).tribute.paid).toEqual([]);
    expect(await wallet(ctx)).toBe(before);
    // Two whole days: 480 dr, the marker at day 11 exactly.
    const two = await settle(ctx, at(11.25));
    expect(two.tribute.paid).toEqual([{ regionId: "R032", townId: "vienna", name: "Vienna", days: 2, drachmae: 480, grain: 0, timber: 0 }]);
    expect(await wallet(ctx)).toBe(before + 480);
    expect((await holdingsOf(ctx))[0]!.lastTributeAt).toEqual(at(11));
    expect(await logs(characterId, "holding_tribute")).toHaveLength(1);
    // Under the minimum: the day passes unpaid, the marker still advances.
    await db.update(m.dbPkg.playerUnits).set({ count: 29 }).where(eq(m.dbPkg.playerUnits.id, men.id));
    expect((await settle(ctx, at(12.5))).tribute.paid).toEqual([]);
    expect((await holdingsOf(ctx))[0]!.lastTributeAt).toEqual(at(12));
    expect(await wallet(ctx)).toBe(before + 480);
    // Back at 30: the next whole day pays 240.
    await db.update(m.dbPkg.playerUnits).set({ count: 30 }).where(eq(m.dbPkg.playerUnits.id, men.id));
    expect((await settle(ctx, at(13.5))).tribute.paid).toMatchObject([{ name: "Vienna", days: 1, drachmae: 240 }]);
    expect(await wallet(ctx)).toBe(before + 720);
    // The garrison marches away: a day later the town reverts and pays nothing more.
    await db.update(m.dbPkg.playerUnits).set({ basedAt: "R060" }).where(eq(m.dbPkg.playerUnits.id, men.id));
    const gone = await settle(ctx, at(15));
    expect(gone.holdings.reverted).toEqual([{ regionId: "R032", townId: "vienna", kind: "conquest", previousOwner: "cavares" }]);
    expect(gone.tribute.paid).toEqual([]);
    expect(await garrison("vienna")).toBe(120); // the content garrison is back
    expect(await wallet(ctx)).toBe(before + 720);
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

  it("garrison regrowth: 5 a day on a steady clock; the part of a day carries over and a fight below the full count leaves the clock running", async () => {
    const read = (when: Date) => m.mapPools.readTownGarrison(db, worldId, "reii", when);
    await setGarrison("reii", 100, at(9)); // content 160
    expect(await read(at(9.5))).toBe(100);
    expect(await read(at(11))).toBe(110);
    expect(await read(at(12.5))).toBe(115);
    expect(await read(at(13))).toBe(120);
    await setGarrison("reii", 110, at(13.5));
    expect(await read(at(14))).toBe(115);
    expect(await read(at(40))).toBe(160);
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
    // The hulls go there and back: twice the crossing.
    expect(await stock(ctx, "trade-ship")).toBe(0);
    expect(await voyages(ctx)).toHaveLength(1);
    expect((await voyages(ctx))[0]).toMatchObject({ kind: "move", regionId: "R065", townId: "emporion", ships: { "trade-ship": 2 }, sailedAt: at(9), returnsAt: new Date(at(9).getTime() + 60 * 60_000) });
    // The movers cannot be sent again while on the march.
    expect(await moveTo(ctx, "R060", [peltasts.id], at(9.01))).toMatchObject({ ok: false, code: 409, error: "Peltast are still on the march." });
    expect((await settle(ctx, new Date(at(9).getTime() + 59 * 60_000))).shipsHome).toEqual([]);
    expect(await stock(ctx, "trade-ship")).toBe(0);
    expect((await settle(ctx, new Date(at(9).getTime() + 60 * 60_000))).shipsHome).toHaveLength(1);
    expect(await stock(ctx, "trade-ship")).toBe(2);
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
