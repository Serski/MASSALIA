import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { REACH_REASON, splitByShares } from "@massalia/shared";

// ---------------------------------------------------------------------------
// The koinon's Raid muster (koinon prompt 3) — integration tests against a REAL
// Postgres, guarded to a *_test database. Opening, pledging men and hulls, the
// lock on a pledged row, its release by the owner's own settle, withdrawing,
// the count on the Politics nav, the read-only view, the resolve at the launch
// instant and the hook that runs it before a request.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2000, 0, 1);
// Day 10 of the world: Summer (a world opens in Winter and a season is a day).
const NOW = new Date(T0 + 10 * DAY + HOUR);
const at = (ms: number) => new Date(NOW.getTime() + ms);
// The launch instant of a muster written directly by a resolve test.
const LAUNCH = at(2 * HOUR);
// Fixed ids, so a battle's seed (world, muster, target, instant) and its rolls
// (per row id) are the same on every run.
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const buildings = await import("./buildings.js");
  const barracks = await import("./barracks.js");
  const mapGraph = await import("./mapGraph.js");
  const mapActions = await import("./mapActions.js");
  const mapReach = await import("./mapReach.js");
  const koinon = await import("./koinon.js");
  const muster = await import("./koinonMuster.js");
  const age = await import("./age.js");
  return { dbPkg, buildings, barracks, mapGraph, mapActions, mapReach, koinon, muster, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Koinon muster (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  // Geography, read once from the real topology: Massalia as the gathering
  // place, a townless region one land step away, a town across the sea, a home
  // region, a region with towns, and a place out of reach in principle.
  let massalia: string;
  let landRegion: string;
  let seaTown: { townId: string; regionId: string; steps: number };
  let homeRegion: string;
  let regionWithTowns: string;
  let farRegion: string;
  let otherHomePlace: string;

  // `n` pins the player's and the character's ids (resolve tests).
  async function freshPlayer(name: string, drachmae = 100_000, n?: number) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ ...(n ? { id: uid(200 + n) } : {}), worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ ...(n ? { id: uid(300 + n) } : {}), playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", prestige: 20, militia: 50, drachmae, startAge: 30, deathAge: 90, avatarId: "avatar-30-1" });
    return player.id;
  }
  const ctx = async (playerId: string) => (await m.buildings.buildingContext(playerId, worldId))!;
  // A koinon written directly: the first player leads, the rest are members.
  async function koinonOf(name: string, playerIds: string[], id?: string) {
    const { koina, koinonMembers } = m.dbPkg;
    const k = (await db.insert(koina).values({ ...(id ? { id } : {}), worldId, name, leaderPlayerId: playerIds[0]!, leaderSince: at(-DAY), foundedAt: at(-DAY) }).returning())[0]!;
    for (const [i, playerId] of playerIds.entries()) await db.insert(koinonMembers).values({ worldId, playerId, koinonId: k.id, joinedAt: at(-DAY + i * 1000), lastReadAt: at(-HOUR) });
    return k.id;
  }
  // A ready row of trained men (or a band) standing at a base.
  async function men(playerId: string, unitId: string, count: number, basedAt = massalia, over: Record<string, unknown> = {}) {
    return (
      await db
        .insert(m.dbPkg.playerUnits)
        .values({ worldId, ownerPlayerId: playerId, source: "trained", unitId, count, startCount: count, recruitedSeason: 0, readyAt: at(-DAY), basedAt, createdAt: at(-2 * HOUR), ...over })
        .returning()
    )[0]!.id;
  }
  const ships = (playerId: string, type: "trade-ship" | "galley", amount: number) =>
    db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: playerId, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: NOW });
  const unitRow = async (id: string) => (await db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.id, id)).limit(1))[0];
  const rowsOf = (playerId: string) => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, playerId)).orderBy(asc(m.dbPkg.playerUnits.createdAt), asc(m.dbPkg.playerUnits.id));
  const musters = () => db.select().from(m.dbPkg.koinonMusters).orderBy(asc(m.dbPkg.koinonMusters.openedAt));
  const hullsOf = async (playerId: string) =>
    Object.fromEntries((await db.select().from(m.dbPkg.koinonMusterHulls).where(eq(m.dbPkg.koinonMusterHulls.ownerPlayerId, playerId))).map((h) => [h.shipId, h.count]));
  // The player's own settle, under his lock, as any settling route runs it.
  const settle = async (playerId: string, now: Date) => {
    const c = await ctx(playerId);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${playerId}::text))`);
      await m.buildings.settleAll(tx, c, now);
    });
  };
  const open = async (playerId: string, over: Record<string, unknown> = {}, now = NOW) => m.muster.openMuster(await ctx(playerId), { regionId: landRegion, gatherId: massalia, leadMinutes: 120, ...over }, now);
  async function opened(playerId: string, over: Record<string, unknown> = {}, now = NOW) {
    const res = await open(playerId, over, now);
    if (!res.ok) throw new Error(`open failed: ${res.error}`);
    return res.musterId;
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.age.loadAgeConfig();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    await m.koinon.loadKoinonContent();

    const topology = m.mapGraph.getTopology();
    massalia = topology.massaliaRegion;
    const home = await m.mapReach.homeRegions(topology);
    const withTowns = new Set(topology.townRegion.values());
    landRegion = [...(topology.land.get(massalia) ?? [])].find((r) => !home.has(r) && !withTowns.has(r))!;
    homeRegion = [...home].find((r) => r !== massalia)!;
    regionWithTowns = [...withTowns].find((r) => r !== massalia && !home.has(r))!;
    otherHomePlace = (await m.mapReach.homePlaces(topology))[0]!.id;
    expect(landRegion, "a townless region one land step from Massalia").toBeTruthy();
  });

  async function reset() {
    await db.execute(sql`TRUNCATE TABLE koinon_muster_hulls, koinon_musters, koinon_posts, koinon_invites, koinon_members, koina, player_holdings, player_units, player_levy, region_military, town_military, world_treasury, resources, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ id: uid(1), name: "Muster Test", seed: "mutest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  }
  beforeEach(reset);

  // The targets from Massalia, read through the service once a member exists.
  async function geography(memberId: string) {
    const view = await m.muster.musterTargets(await ctx(memberId), massalia, NOW);
    if ("error" in view) throw new Error(view.error);
    const town = view.targets.find((t) => t.kind === "town" && t.route === "sea")!;
    seaTown = { townId: town.townId!, regionId: town.regionId, steps: town.steps };
    const listed = new Set(view.targets.map((t) => t.townId ?? t.regionId));
    const topology = m.mapGraph.getTopology();
    const home = await m.mapReach.homeRegions(topology);
    const withTowns = new Set(topology.townRegion.values());
    farRegion = [...topology.land.keys()].find((r) => r !== massalia && !home.has(r) && !withTowns.has(r) && !listed.has(r))!;
    return view;
  }

  // --- open -------------------------------------------------------------------

  it("any member opens a muster; a non-member gets 403; a second open muster is 409", async () => {
    const [leader, member, outsider] = [await freshPlayer("Kallias"), await freshPlayer("Nikias"), await freshPlayer("Xenon")];
    const k = await koinonOf("The Sacred Band", [leader, member]);

    expect(await open(outsider)).toEqual({ ok: false, code: 403, error: "You are not in a koinon." });
    const res = await open(member);
    expect(res).toMatchObject({ ok: true, launchAt: at(2 * HOUR).toISOString() });
    const row = (await musters())[0]!;
    expect(row).toMatchObject({ koinonId: k, openerPlayerId: member, kind: "raid", regionId: landRegion, townId: null, gatherId: massalia, gatherRegionId: massalia, status: "open" });
    expect(row.launchAt.getTime()).toBe(at(2 * HOUR).getTime());
    expect(await open(leader)).toEqual({ ok: false, code: 409, error: "The koinon already has a muster open." });
    expect((await musters()).length).toBe(1);
  });

  it("two members opening at once leave exactly one muster, 10 runs", async () => {
    for (let run = 0; run < 10; run++) {
      const [a, b] = [await freshPlayer(`A${run}`), await freshPlayer(`B${run}`)];
      const k = await koinonOf(`Band ${run}`, [a, b]);
      const results = await Promise.all([open(a), open(b)]);
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, code: 409, error: "The koinon already has a muster open." });
      expect((await db.select().from(m.dbPkg.koinonMusters).where(eq(m.dbPkg.koinonMusters.koinonId, k))).length).toBe(1);
    }
  });

  it("open refuses Massalia's own ground, a region with towns, an unknown place, a foreign gathering place, a bad lead, Winter, and a place out of reach", async () => {
    const leader = await freshPlayer("Kallias");
    await koinonOf("The Sacred Band", [leader]);
    const view = await geography(leader);
    expect(view.gathers[0]).toMatchObject({ id: massalia });
    // Summer, and the next day is Autumn: no Winter within the longest lead. In Autumn the next Winter is named.
    expect(view).toMatchObject({ now: NOW.toISOString(), winter: null });
    expect(await m.muster.musterTargets(await ctx(leader), massalia, at(DAY))).toMatchObject({ winter: { from: new Date(T0 + 12 * DAY).toISOString(), until: new Date(T0 + 13 * DAY).toISOString() } });
    expect(view.targets.find((t) => t.regionId === landRegion && t.townId === null)).toMatchObject({ kind: "region", route: "land", steps: 1 });
    // Only where it is and how far: no garrison, warband or fleet numbers.
    expect(Object.keys(view.targets[0]!).sort()).toEqual(["kind", "name", "regionId", "route", "steps", "townId"]);

    expect(await open(leader, { regionId: homeRegion })).toEqual({ ok: false, code: 409, error: "Massalia does not act against her own." });
    expect(await open(leader, { regionId: massalia })).toMatchObject({ ok: false, code: 409 });
    expect(await open(leader, { regionId: regionWithTowns })).toEqual({ ok: false, code: 409, error: "This land answers to its towns: choose one." });
    expect(await open(leader, { regionId: "R999" })).toEqual({ ok: false, code: 404, error: "No such region." });
    expect(await open(leader, { regionId: undefined, townId: "no-such-town" })).toEqual({ ok: false, code: 404, error: "No such town." });
    expect(await open(leader, { gatherId: landRegion })).toEqual({ ok: false, code: 400, error: "Choose a gathering place on Massalia's own ground." });
    for (const lead of [29, 24 * 60 + 1, 45.5, "120", undefined]) {
      expect(await open(leader, { leadMinutes: lead })).toEqual({ ok: false, code: 400, error: "Set the launch from 30 minutes to 24 hours ahead." });
    }
    // Day 11 is Autumn; 13 hours on from its noon is Winter.
    expect(await open(leader, { leadMinutes: 13 * 60 }, new Date(T0 + 11 * DAY + 12 * HOUR))).toEqual({ ok: false, code: 409, error: "The passes are closed in winter: choose a launch in another season." });
    expect(farRegion, "a townless region out of reach in principle").toBeTruthy();
    expect(await open(leader, { regionId: farRegion })).toEqual({ ok: false, code: 409, error: "That place cannot be reached from the gathering place." });
    expect(await musters()).toEqual([]);

    // A town across the sea, and another of Massalia's own places as the gathering place, are fine.
    expect(await open(leader, { regionId: undefined, townId: seaTown.townId, gatherId: otherHomePlace, leadMinutes: 30 })).toMatchObject({ ok: true });
  });

  // --- pledge -----------------------------------------------------------------

  it("men at the gathering place are pledged and carry the mission; part of a row splits; a band goes whole", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    await koinonOf("The Sacred Band", [leader, member]);
    const musterId = await opened(leader);
    const hoplites = await men(member, "hoplite", 30);
    const peltasts = await men(member, "peltast", 20);
    const elsewhere = await men(member, "peltast", 10, otherHomePlace);
    const bandId = Object.keys(m.barracks.getBandsContent().bands).sort()[0]!;
    const band = await men(member, bandId, 40, massalia, { source: "band", readyAt: null, contractEndAt: at(3 * DAY) });
    const c = await ctx(member);

    // Men standing elsewhere are refused, and so is a mix of two bases.
    expect(await m.muster.pledge(c, { rows: [{ rowId: elsewhere, count: 10 }] }, NOW)).toMatchObject({ ok: false, code: 409, error: expect.stringContaining("Only men standing at") });
    expect(await m.muster.pledge(c, { rows: [{ rowId: hoplites, count: 30 }, { rowId: elsewhere, count: 10 }] }, NOW)).toEqual({ ok: false, code: 409, error: "A force marches from one base." });
    expect(await m.muster.pledge(c, { rows: [{ rowId: band, count: 10 }] }, NOW)).toEqual({ ok: false, code: 409, error: "A band marches as one." });
    expect(await m.muster.pledge(c, { rows: [{ rowId: hoplites, count: 31 }] }, NOW)).toMatchObject({ ok: false, code: 400 });
    expect(await m.muster.pledge(c, {}, NOW)).toEqual({ ok: false, code: 400, error: "Pledge men, hulls, or both." });
    expect((await rowsOf(member)).every((r) => r.mission === null)).toBe(true);

    // A whole row, part of a row, and a band.
    expect(await m.muster.pledge(c, { rows: [{ rowId: hoplites, count: 30 }, { rowId: peltasts, count: 12 }, { rowId: band, count: 40 }] }, NOW)).toEqual({ ok: true });
    const mission = { kind: "muster", musterId, regionId: landRegion, departedAt: NOW.toISOString() };
    expect((await unitRow(hoplites))!.mission).toEqual(mission);
    expect((await unitRow(band))!.mission).toEqual(mission);
    // The 12 pledged peltasts are a new row; the 8 left behind stay free.
    expect(await unitRow(peltasts)).toMatchObject({ count: 8, mission: null });
    const split = (await rowsOf(member)).find((r) => r.unitId === "peltast" && r.basedAt === massalia && r.id !== peltasts)!;
    expect(split).toMatchObject({ count: 12, mission, movingTo: null, basedAt: massalia });
    // A pledged row cannot be pledged twice.
    expect(await m.muster.pledge(c, { rows: [{ rowId: hoplites, count: 30 }] }, NOW)).toEqual({ ok: false, code: 409, error: "These men are pledged to the koinon's muster." });
  });

  it("hulls: beyond stock is refused, a second pledge replaces the first, 0 removes one", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    await koinonOf("The Sacred Band", [leader, member]);
    await opened(leader);
    await ships(member, "trade-ship", 3);
    await ships(member, "galley", 1);
    const c = await ctx(member);

    expect(await m.muster.pledge(c, { ships: { "trade-ship": 4 } }, NOW)).toEqual({ ok: false, code: 409, error: "Only 3 pentekonters in port." });
    expect(await m.muster.pledge(c, { ships: { galley: 2 } }, NOW)).toEqual({ ok: false, code: 409, error: "Only 1 trireme in port." });
    expect(await m.muster.pledge(c, { ships: { "trade-ship": 1.5 } }, NOW)).toEqual({ ok: false, code: 400, error: "Send a whole number of ships." });
    expect(await m.muster.pledge(c, { ships: { raft: 1 } }, NOW)).toEqual({ ok: false, code: 400, error: "No such ship." });
    expect(await hullsOf(member)).toEqual({});

    // A member with ships and no men pledges hulls alone.
    expect(await m.muster.pledge(c, { ships: { "trade-ship": 3, galley: 1 } }, NOW)).toEqual({ ok: true });
    expect(await hullsOf(member)).toEqual({ "trade-ship": 3, galley: 1 });
    expect(await m.muster.pledge(c, { ships: { "trade-ship": 2, galley: 0 } }, at(MIN))).toEqual({ ok: true });
    expect(await hullsOf(member)).toEqual({ "trade-ship": 2 });
    // Ships are counted, never moved: the stock is as it was.
    const stock = await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, member), eq(m.dbPkg.resources.type, "trade-ship")));
    expect(Number(stock[0]!.amount)).toBe(3);
  });

  it("a holder of the target cannot pledge; nobody pledges after launch time or without an open muster", async () => {
    const [leader, holder, member] = [await freshPlayer("Kallias"), await freshPlayer("Deon"), await freshPlayer("Nikias")];
    await koinonOf("The Sacred Band", [leader, holder, member]);
    const row = await men(member, "hoplite", 10);
    expect(await m.muster.pledge(await ctx(member), { rows: [{ rowId: row, count: 10 }] }, NOW)).toEqual({ ok: false, code: 409, error: "The koinon has no muster open." });

    await opened(leader);
    await db.insert(m.dbPkg.playerHoldings).values({ worldId, regionId: landRegion, townId: "", ownerPlayerId: holder, kind: "conquest", since: at(-DAY), lastGarrisonedAt: NOW, lastTributeAt: NOW });
    const his = await men(holder, "hoplite", 10);
    expect(await m.muster.pledge(await ctx(holder), { rows: [{ rowId: his, count: 10 }] }, NOW)).toEqual({ ok: false, code: 409, error: "You hold this land." });

    expect(await m.muster.pledge(await ctx(member), { rows: [{ rowId: row, count: 10 }] }, at(2 * HOUR))).toEqual({ ok: false, code: 409, error: "The muster has already marched." });
    expect(await m.muster.withdrawPledge(await ctx(member), at(2 * HOUR))).toEqual({ ok: false, code: 409, error: "The muster has already marched." });
    expect((await unitRow(row))!.mission).toBeNull();
  });

  // --- locked -----------------------------------------------------------------

  it("a pledged row is refused by act, by move and by disband, is not merged by the settle, and is left out of the reach force", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    await koinonOf("The Sacred Band", [leader, member]);
    await opened(leader);
    const pledged = await men(member, "hoplite", 30);
    const c = await ctx(member);
    expect(await m.muster.pledge(c, { rows: [{ rowId: pledged, count: 30 }] }, NOW)).toEqual({ ok: true });
    // A second row of the same unit, raised after the pledge, stands beside it.
    const free = await men(member, "hoplite", 12);

    const refusal = { ok: false, code: 409, error: "These men are pledged to the koinon's muster." };
    expect(await m.mapActions.act(c, { type: "raid", regionId: landRegion, rows: [{ rowId: pledged, count: 30 }] }, NOW)).toEqual(refusal);
    expect(await m.mapActions.move(c, { baseId: otherHomePlace, rows: [{ rowId: pledged, count: 30 }] }, NOW)).toEqual(refusal);
    expect(await m.barracks.disbandRow(c, pledged, at(30 * DAY))).toEqual(refusal);

    // Two ready rows of one unit at one base would fold into one: the pledged row is skipped.
    await settle(member, at(10 * MIN));
    expect(await unitRow(pledged)).toMatchObject({ count: 30, mission: expect.objectContaining({ kind: "muster" }) });
    expect(await unitRow(free)).toMatchObject({ count: 12, mission: null });

    // The reach payload's force is the free men only.
    const reach = await db.transaction(async (tx) => m.mapReach.reachView(tx, c, at(10 * MIN)));
    expect(reach.force.men).toBe(12);
    // The roster carries the mission, so the client can mark the row.
    const roster = (await m.barracks.barracksView(c, at(11 * MIN))).roster;
    expect(roster.find((r) => r.id === pledged)!.mission).toMatchObject({ kind: "muster" });
  });

  // --- released ---------------------------------------------------------------

  it("after the muster is called off, the owner's next settle clears the mission and the row merges again", async () => {
    const [leader, member, other] = [await freshPlayer("Kallias"), await freshPlayer("Nikias"), await freshPlayer("Deon")];
    await koinonOf("The Sacred Band", [leader, member, other]);
    await opened(member);
    const pledged = await men(member, "hoplite", 30);
    await ships(member, "trade-ship", 2);
    expect(await m.muster.pledge(await ctx(member), { rows: [{ rowId: pledged, count: 30 }], ships: { "trade-ship": 2 } }, NOW)).toEqual({ ok: true });
    // A second row of the same unit, raised after the pledge, stands beside it.
    await men(member, "hoplite", 12);

    // Only the opener or the leader calls it off, and it writes no one's rows.
    expect(await m.muster.cancelMuster(await ctx(other), at(MIN))).toEqual({ ok: false, code: 403, error: "Only the one who called the muster, or the leader, may call it off." });
    expect(await m.muster.cancelMuster(await ctx(leader), at(MIN))).toEqual({ ok: true });
    expect((await musters())[0]).toMatchObject({ status: "cancelled" });
    expect(await hullsOf(member)).toEqual({});
    expect((await unitRow(pledged))!.mission).toMatchObject({ kind: "muster" });

    await settle(member, at(2 * MIN));
    const rows = await rowsOf(member);
    expect(rows.map((r) => [r.unitId, r.count, r.mission])).toEqual([["hoplite", 42, null]]);
    // The row is his to use again.
    expect(await m.barracks.disbandRow(await ctx(member), rows[0]!.id, at(30 * DAY))).toMatchObject({ ok: true });
    // A muster can be opened again once the last one is closed.
    expect(await open(other, {}, at(3 * MIN))).toMatchObject({ ok: true });
  });

  it("leaving, being expelled and an admin dissolve each release the pledge at the owner's next settle", async () => {
    const [leader, leaver, expelled, stayer] = [await freshPlayer("Kallias"), await freshPlayer("Nikias"), await freshPlayer("Deon"), await freshPlayer("Lykos")];
    const k = await koinonOf("The Sacred Band", [leader, leaver, expelled, stayer]);
    await opened(leader);
    const rows: Record<string, string> = {};
    for (const p of [leaver, expelled, stayer]) {
      rows[p] = await men(p, "hoplite", 10);
      await ships(p, "trade-ship", 1);
      expect(await m.muster.pledge(await ctx(p), { rows: [{ rowId: rows[p]!, count: 10 }], ships: { "trade-ship": 1 } }, NOW)).toEqual({ ok: true });
    }

    expect(await m.koinon.leave(await ctx(leaver), at(MIN))).toMatchObject({ ok: true });
    expect(await m.koinon.expel(await ctx(leader), expelled, at(MIN))).toEqual({ ok: true });
    // Their hull pledges go at once; their rows wait for their own settle.
    expect(await hullsOf(leaver)).toEqual({});
    expect(await hullsOf(expelled)).toEqual({});
    expect(await hullsOf(stayer)).toEqual({ "trade-ship": 1 });
    expect((await unitRow(rows[leaver]!))!.mission).toMatchObject({ kind: "muster" });
    for (const p of [leaver, expelled, stayer]) await settle(p, at(2 * MIN));
    expect((await unitRow(rows[leaver]!))!.mission).toBeNull();
    expect((await unitRow(rows[expelled]!))!.mission).toBeNull();
    // The muster stands for those who stayed.
    expect((await unitRow(rows[stayer]!))!.mission).toMatchObject({ kind: "muster" });
    expect((await musters())[0]).toMatchObject({ status: "open" });

    // An admin dissolve calls the muster off; the stayer's own settle frees his men.
    expect(await m.koinon.adminDissolveKoinon(k, at(3 * MIN), async () => {})).toMatchObject({ ok: true });
    expect((await musters())[0]).toMatchObject({ status: "cancelled" });
    expect(await hullsOf(stayer)).toEqual({});
    await settle(stayer, at(4 * MIN));
    expect((await unitRow(rows[stayer]!))!.mission).toBeNull();
  });

  // --- withdraw ---------------------------------------------------------------

  it("withdraw clears the caller's rows and hull pledges and nobody else's", async () => {
    const [leader, a, b] = [await freshPlayer("Kallias"), await freshPlayer("Nikias"), await freshPlayer("Deon")];
    await koinonOf("The Sacred Band", [leader, a, b]);
    await opened(leader);
    const rowA = await men(a, "hoplite", 10);
    const rowB = await men(b, "hoplite", 10);
    await ships(a, "trade-ship", 1);
    await ships(b, "trade-ship", 1);
    for (const [p, row] of [[a, rowA], [b, rowB]] as const) expect(await m.muster.pledge(await ctx(p), { rows: [{ rowId: row, count: 10 }], ships: { "trade-ship": 1 } }, NOW)).toEqual({ ok: true });

    expect(await m.muster.withdrawPledge(await ctx(a), at(MIN))).toEqual({ ok: true });
    expect((await unitRow(rowA))!.mission).toBeNull();
    expect(await hullsOf(a)).toEqual({});
    expect((await unitRow(rowB))!.mission).toMatchObject({ kind: "muster" });
    expect(await hullsOf(b)).toEqual({ "trade-ship": 1 });
    // He may pledge again.
    expect(await m.muster.pledge(await ctx(a), { rows: [{ rowId: rowA, count: 10 }] }, at(2 * MIN))).toEqual({ ok: true });
  });

  it("my pledge: the caller's rows at the gathering place, marked, and his hulls beside his pledge", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    await koinonOf("The Sacred Band", [leader, member]);
    expect(await m.muster.myMusterPledge(await ctx(member), NOW)).toEqual({ ok: false, code: 409, error: "The koinon has no muster open." });
    await opened(leader);
    const hoplites = await men(member, "hoplite", 30);
    // Raised an hour later, so the two rows list in a fixed order.
    const peltasts = await men(member, "peltast", 20, massalia, { createdAt: at(-HOUR) });
    await men(member, "peltast", 5, otherHomePlace);
    await ships(member, "trade-ship", 2);
    expect(await m.muster.pledge(await ctx(member), { rows: [{ rowId: hoplites, count: 30 }], ships: { "trade-ship": 1 } }, NOW)).toEqual({ ok: true });

    const view = await m.muster.myMusterPledge(await ctx(member), at(MIN));
    if ("error" in view) throw new Error(view.error);
    expect(view.gather.id).toBe(massalia);
    expect(view.rows.map((r) => [r.rowId, r.label, r.count, r.pledged])).toEqual([[hoplites, "Hoplite", 30, true], [peltasts, "Peltast", 20, false]]);
    expect(view.ships.find((s) => s.id === "trade-ship")).toMatchObject({ label: "Pentekonter", inStock: 2, pledged: 1 });
    expect(view.ships.find((s) => s.id === "galley")).toMatchObject({ inStock: 0, pledged: 0 });
  });

  // --- the Politics count -------------------------------------------------------

  it("an open muster adds one to every member's count but the opener's; markRead clears it; a closed one adds nothing", async () => {
    const [leader, member, late] = [await freshPlayer("Kallias"), await freshPlayer("Nikias"), await freshPlayer("Deon")];
    await koinonOf("The Sacred Band", [leader, member, late]);
    const count = (p: string, now = at(MIN)) => m.koinon.koinonPendingCount(p, worldId, now);
    expect(await count(member)).toBe(0);

    await opened(leader);
    expect(await count(leader)).toBe(0);
    expect(await count(member)).toBe(1);
    expect(await count(late)).toBe(1);
    // The page counts it as unread, so opening the tab stamps it read.
    expect((await m.koinon.koinonView(await ctx(member), at(MIN))).koinon!.unread).toBe(1);
    expect((await m.koinon.koinonView(await ctx(leader), at(MIN))).koinon!.unread).toBe(0);
    expect(await m.koinon.markRead(await ctx(member), at(MIN))).toEqual({ ok: true });
    expect(await count(member)).toBe(0);
    expect(await count(late)).toBe(1);

    // Closed: nothing. And a muster opened before a member's last read adds nothing.
    expect(await m.muster.cancelMuster(await ctx(leader), at(2 * MIN))).toEqual({ ok: true });
    expect(await count(late)).toBe(0);
    await db.update(m.dbPkg.koinonMembers).set({ lastReadAt: at(HOUR) }).where(eq(m.dbPkg.koinonMembers.playerId, late));
    await opened(leader, {}, at(3 * MIN));
    expect(await count(late)).toBe(0);
    expect(await count(member, at(4 * MIN))).toBe(1);
  });

  // --- the view -------------------------------------------------------------------

  it("a member sees the pledges and an outlook that turns from a hull shortfall to ok; a non-member sees no muster; the read writes nothing", async () => {
    const [leader, soldier, shipowner, outsider] = [await freshPlayer("Kallias"), await freshPlayer("Nikias"), await freshPlayer("Deon"), await freshPlayer("Xenon")];
    await koinonOf("The Sacred Band", [leader, soldier, shipowner]);
    await geography(leader);
    const musterId = await opened(leader, { regionId: undefined, townId: seaTown.townId });
    const hoplites = await men(soldier, "hoplite", 30);
    await ships(shipowner, "trade-ship", 2);
    expect(await m.muster.pledge(await ctx(soldier), { rows: [{ rowId: hoplites, count: 30 }] }, NOW)).toEqual({ ok: true });
    expect(await m.muster.pledge(await ctx(shipowner), { ships: { "trade-ship": 1 } }, at(MIN))).toEqual({ ok: true });

    const snapshot = async () => JSON.stringify({ koina: await db.select().from(m.dbPkg.koina), units: await db.select().from(m.dbPkg.playerUnits).orderBy(asc(m.dbPkg.playerUnits.id)), musters: await musters(), hulls: await db.select().from(m.dbPkg.koinonMusterHulls) });
    const before = await snapshot();

    const view = (await m.koinon.koinonView(await ctx(soldier), at(2 * MIN))).koinon!;
    expect(view.muster).toMatchObject({
      id: musterId,
      kind: "raid",
      openerName: "Kallias",
      canCancel: false,
      target: { regionId: seaTown.regionId, townId: seaTown.townId, name: expect.any(String) },
      gather: { id: massalia, name: expect.any(String) },
      launchAt: at(2 * HOUR).toISOString(),
    });
    expect(view.muster!.pledges).toEqual([
      { playerId: soldier, name: "Nikias", men: 30, space: 30, pentekonters: 0, triremes: 0 },
      { playerId: shipowner, name: "Deon", men: 0, space: 0, pentekonters: 1, triremes: 0 },
    ]);
    // 30 men, one pentekonter: 20 seats.
    expect(view.muster!.outlook).toEqual({ route: "sea", steps: seaTown.steps, ok: false, reason: "Not enough hulls: 30 space needed, 20 aboard.", space: 30, hullSpace: 20 });
    expect(view.lastMuster).toBeNull();
    // The leader may call it off; the opener too.
    expect((await m.koinon.koinonView(await ctx(leader), at(2 * MIN))).koinon!.muster!.canCancel).toBe(true);
    // Others see nothing of it.
    expect((await m.koinon.koinonView(await ctx(outsider), at(2 * MIN))).koinon).toBeNull();
    expect(await snapshot()).toBe(before);

    // A second pentekonter: the outlook turns to ok.
    expect(await m.muster.pledge(await ctx(shipowner), { ships: { "trade-ship": 2 } }, at(3 * MIN))).toEqual({ ok: true });
    const after = (await m.koinon.koinonView(await ctx(soldier), at(4 * MIN))).koinon!.muster!;
    expect(after.outlook).toEqual({ route: "sea", steps: seaTown.steps, ok: true, reason: null, space: 30, hullSpace: 40 });
    expect(after.pledges[1]).toMatchObject({ pentekonters: 2 });

    // A pledge counts as the smaller of the pledge and the stock: one hull sold, one counts.
    await db.update(m.dbPkg.resources).set({ amount: "1" }).where(and(eq(m.dbPkg.resources.scopeId, shipowner), eq(m.dbPkg.resources.type, "trade-ship")));
    expect((await m.koinon.koinonView(await ctx(soldier), at(5 * MIN))).koinon!.muster!.outlook).toMatchObject({ ok: false, hullSpace: 20 });

    // Called off: it becomes the last muster.
    expect(await m.muster.cancelMuster(await ctx(leader), at(6 * MIN))).toEqual({ ok: true });
    const closed = (await m.koinon.koinonView(await ctx(soldier), at(7 * MIN))).koinon!;
    expect(closed.muster).toBeNull();
    expect(closed.lastMuster).toMatchObject({ id: musterId, status: "cancelled", reason: null, report: null });
  });

  it("by land the outlook needs men and no hulls", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    await koinonOf("The Sacred Band", [leader, member]);
    await opened(leader);
    const outlook = async () => (await m.koinon.koinonView(await ctx(member), at(MIN))).koinon!.muster!.outlook;
    expect(await outlook()).toEqual({ route: "land", steps: 1, ok: false, reason: "No men under arms.", space: 0, hullSpace: 0 });
    const row = await men(member, "hoplite", 10);
    expect(await m.muster.pledge(await ctx(member), { rows: [{ rowId: row, count: 10 }] }, NOW)).toEqual({ ok: true });
    expect(await outlook()).toEqual({ route: "land", steps: 1, ok: true, reason: null, space: 10, hullSpace: 0 });
  });

  // --- the resolve ------------------------------------------------------------------

  // A muster written directly, due at LAUNCH, with a fixed id.
  async function musterRow(koinonId: string, opener: string, over: Record<string, unknown> = {}) {
    return (await db.insert(m.dbPkg.koinonMusters).values({ id: uid(900), worldId, koinonId, openerPlayerId: opener, kind: "raid", regionId: landRegion, townId: null, gatherId: massalia, gatherRegionId: massalia, openedAt: NOW, launchAt: LAUNCH, ...over }).returning())[0]!.id;
  }
  // A row already pledged to the muster, standing at Massalia, with a fixed id.
  const pledgedMen = (playerId: string, unitId: string, count: number, musterId: string, n: number, over: Record<string, unknown> = {}) =>
    men(playerId, unitId, count, massalia, { id: uid(n), mission: { kind: "muster", musterId, regionId: landRegion, departedAt: NOW.toISOString() }, ...over });
  // A hull pledge backed by the same number of hulls in stock.
  async function pledgedHulls(playerId: string, musterId: string, shipId: "trade-ship" | "galley", count: number, pledgedAt = NOW, inStock = count) {
    await ships(playerId, shipId, inStock);
    await db.insert(m.dbPkg.koinonMusterHulls).values({ musterId, ownerPlayerId: playerId, shipId, count, pledgedAt });
  }
  const setWarband = (regionId: string, warband: number) =>
    db.insert(m.dbPkg.regionMilitary).values({ worldId, regionId, warband, updatedAt: at(-HOUR) }).onConflictDoUpdate({ target: [m.dbPkg.regionMilitary.worldId, m.dbPkg.regionMilitary.regionId], set: { warband, updatedAt: at(-HOUR) } });
  const setTown = (townId: string, garrison: number, pentekonters = 0, triremes = 0) => db.insert(m.dbPkg.townMilitary).values({ worldId, townId, garrison, pentekonters, triremes, updatedAt: at(-HOUR) });
  const warbandOf = async (regionId: string) => (await db.select().from(m.dbPkg.regionMilitary).where(and(eq(m.dbPkg.regionMilitary.worldId, worldId), eq(m.dbPkg.regionMilitary.regionId, regionId))))[0]!.warband;
  const garrisonOf = async (townId: string) => (await db.select().from(m.dbPkg.townMilitary).where(and(eq(m.dbPkg.townMilitary.worldId, worldId), eq(m.dbPkg.townMilitary.townId, townId))))[0]!.garrison;
  const wallet = async (playerId: string) => (await db.select({ d: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)))[0]!.d;
  const stockOf = async (playerId: string, type: string) =>
    Number((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, type))))[0]?.amount ?? 0);
  const grain = (playerId: string) => stockOf(playerId, "grain");
  // The player's voyages (hulls at sea, home or not), by sailing then id.
  const voyagesOf = (playerId: string) => db.select().from(m.dbPkg.playerVoyages).where(eq(m.dbPkg.playerVoyages.ownerPlayerId, playerId)).orderBy(asc(m.dbPkg.playerVoyages.sailedAt), asc(m.dbPkg.playerVoyages.id));
  const logs = async (playerId: string, kind: string) => {
    const character = (await db.select({ id: m.dbPkg.playerCharacters.id }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, playerId)))[0]!;
    return db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, character.id), eq(m.dbPkg.effectLog.kind, kind))).orderBy(asc(m.dbPkg.effectLog.createdAt));
  };
  type Report = NonNullable<Awaited<ReturnType<Mods["koinon"]["koinonView"]>>["koinon"]>["lastMuster"] extends infer L ? (L extends { report: infer R } ? NonNullable<R> : never) : never;
  const reportOf = async () => (await musters())[0]!.report as unknown as Report;
  const battle = () => m.barracks.getBattleContent();
  const recovered = (steps: number) => new Date(LAUNCH.getTime() + Math.max(1, steps) * battle().recovery.hoursPerStep * HOUR);

  // Three members against a warband by land: 40 hoplites; 30 peltasts; 30
  // hoplites and 20 peltasts in two rows.
  async function landRaid() {
    const [a, b, c] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 100_000, 2), await freshPlayer("Deon", 100_000, 3)];
    const k = await koinonOf("The Sacred Band", [a, b, c], uid(800));
    const musterId = await musterRow(k, a);
    await setWarband(landRegion, 30);
    await pledgedMen(a, "hoplite", 40, musterId, 501);
    await pledgedMen(b, "peltast", 30, musterId, 502);
    await pledgedMen(c, "hoplite", 30, musterId, 503);
    await pledgedMen(c, "peltast", 20, musterId, 504);
    return { a, b, c, musterId };
  }

  it("a land raid of three members: each owner's losses on his own rows, the pool down by the kills, the plunder split, every survivor bound for the gathering place", async () => {
    // Against 30, 120 men meet 8 (a fourth of 30, rounded) and all 8 are slain on every seed; the army loses 0 to 4.
    const { a, b, c, musterId } = await landRaid();
    const sent: Record<string, number> = { [a]: 40, [b]: 30, [c]: 50 };
    // Not due before its launch instant.
    expect(await m.muster.resolveMuster(musterId, at(HOUR))).toEqual({ outcome: "not_due" });
    expect((await musters())[0]!.status).toBe("open");

    expect(await m.muster.resolveMuster(musterId, at(2 * HOUR + 30 * MIN))).toEqual({ outcome: "resolved" });
    const muster = (await musters())[0]!;
    expect(muster).toMatchObject({ status: "resolved" });
    expect(muster.closedAt!.getTime()).toBe(LAUNCH.getTime());
    const report = await reportOf();
    expect(report).toMatchObject({ outcome: "won", reason: null, regionId: landRegion, townId: null, gatherId: massalia, route: "land", steps: 1, launchAt: LAUNCH.toISOString(), arrivesAt: recovered(1).toISOString(), men: 120, fleet: null });
    expect(report.parts.map((p) => [p.playerId, p.men, p.hulls, p.seats, p.shares])).toEqual([[a, 40, 0, 0, 40], [b, 30, 0, 0, 30], [c, 50, 0, 0, 50]]);
    expect(report.killed).toBeGreaterThan(0);

    // Losses: on each owner's own rows, one battle_loss per row that lost men.
    for (const p of report.parts) {
      const rows = await rowsOf(p.playerId);
      expect(rows.reduce((n, r) => n + r.count, 0), p.name).toBe(sent[p.playerId]! - p.lost);
      const losses = await logs(p.playerId, "battle_loss");
      expect(losses.reduce((n, l) => n + (l.detail as { lost: number }).lost, 0)).toBe(p.lost);
      for (const l of losses) {
        expect(l.detail).toMatchObject({ action: "raid", regionId: landRegion, musterId });
        expect(l.createdAt.getTime()).toBe(LAUNCH.getTime());
      }
      // Every survivor is bound for the gathering place, counted from the launch.
      for (const r of rows) expect(r).toMatchObject({ basedAt: massalia, movingTo: massalia, mission: { kind: "raid", regionId: landRegion, departedAt: LAUNCH.toISOString() } });
      for (const r of rows) expect(r.arrivesAt!.getTime()).toBe(recovered(1).getTime());
    }
    expect(report.lost).toBe(report.parts.reduce((n, p) => n + p.lost, 0));

    // The pool drops by the kills.
    expect(report.defender).toEqual({ label: battle().npc.warband.label, start: 30, end: 30 - report.killed, turnout: 8 });
    expect(report.killed).toBe(8);
    expect(await warbandOf(landRegion)).toBe(30 - report.killed);

    // The plunder is act's total for those kills, the third good included, and the parts add up to it.
    const { good, label } = report.plunder!.spoil!;
    expect(battle().raid.spoilGoods).toContain(good);
    const total = { drachmae: Math.round(report.killed * battle().raid.plunderPerKill), grain: Math.round(report.killed * battle().raid.grainPerKill), spoil: { good, label, amount: report.killed * battle().raid.spoilPerKill } };
    expect(report.plunder).toEqual(total);
    expect(report.parts.reduce((n, p) => n + p.drachmae, 0)).toBe(total.drachmae);
    expect(report.parts.reduce((n, p) => n + p.grain, 0)).toBe(total.grain);
    expect(report.parts.reduce((n, p) => n + p.spoil, 0)).toBe(total.spoil.amount);
    expect(Object.fromEntries(report.parts.map((p) => [p.playerId, p.drachmae]))).toEqual(splitByShares(total.drachmae, sent));
    expect(Object.fromEntries(report.parts.map((p) => [p.playerId, p.spoil]))).toEqual(splitByShares(total.spoil.amount, sent));
    for (const p of report.parts) {
      expect(await wallet(p.playerId), p.name).toBe(100_000 + p.drachmae);
      expect(await grain(p.playerId), p.name).toBe(p.grain);
      expect(await stockOf(p.playerId, good), p.name).toBe(p.spoil);
    }

    // One Chronicle line each, with his own part.
    for (const p of report.parts) {
      const lines = await logs(p.playerId, "koinon_muster");
      expect(lines.length, p.name).toBe(1);
      expect(lines[0]!.createdAt.getTime()).toBe(LAUNCH.getTime());
      expect(lines[0]!.detail).toMatchObject({ musterId, source: "koinon", chronicle: { koinonName: "The Sacred Band", regionId: landRegion, hulls: 0, winner: "attacker", killed: report.killed, lost: p.lost, share: { drachmae: p.drachmae, grain: p.grain, spoil: { good, label, amount: p.spoil } } } });
    }
    expect(((await logs(c, "koinon_muster"))[0]!.detail as { chronicle: { force: unknown } }).chronicle.force).toEqual([
      { count: 30, label: "Hoplite", plural: "Hoplites", source: "trained" },
      { count: 20, label: "Peltast", plural: "Peltasts", source: "trained" },
    ]);
    expect(report.line).toBe(`Raided ${report.regionName}: 120 men sent, ${report.killed} tribesmen slain, ${report.lost === 0 ? "none lost" : `${report.lost} lost`}, ${total.drachmae} drachmae, ${total.grain} grain and ${total.spoil.amount} ${total.spoil.label} taken.`);

    // Closed: the hull pledges are gone, the koinon may muster again, and the page shows the report.
    expect(await m.muster.resolveMuster(musterId, at(3 * HOUR))).toEqual({ outcome: "not_due" });
    const page = (await m.koinon.koinonView(await ctx(b), at(3 * HOUR))).koinon!;
    expect(page.muster).toBeNull();
    expect(page.lastMuster).toMatchObject({ id: musterId, status: "resolved", reason: null, report: { outcome: "won", line: report.line } });
    // His own settle after the recovery brings the men home.
    await settle(a, new Date(recovered(1).getTime() + MIN));
    expect((await rowsOf(a)).map((r) => [r.movingTo, r.mission])).toEqual([[null, null]]);
  });

  it("the fight writes the intel of every member who fought and has a dynasty, dated the launch", async () => {
    const { a, musterId } = await landRaid();
    // Kallias founds a house; Nikias and Deon have none and write nothing.
    const { dynasties, playerCharacters, regionIntel } = m.dbPkg;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: a, generation: 1 }).returning())[0]!;
    await db.update(playerCharacters).set({ dynastyId: dynasty.id }).where(eq(playerCharacters.playerId, a));
    expect(await m.muster.resolveMuster(musterId, LAUNCH)).toEqual({ outcome: "resolved" });
    const report = await reportOf();
    expect(report.killed).toBe(8);
    const intel = await db.select().from(regionIntel);
    expect(intel).toHaveLength(1);
    expect(intel[0]).toMatchObject({ dynastyId: dynasty.id, regionId: landRegion, warband: 30 - report.killed, scoutedAt: LAUNCH });
  });

  it("the altar: a member's bull lit before the launch steadies his own rows and nobody else's; a blessing cold at the launch or lit after it counts for nothing", async () => {
    // Two members, 60 hoplites each, against a warband of 33000, of which the
    // floor (660, one in fifty) turns out: on every seed the cold owner loses
    // 27 to 30 men and the blessed one 24 to 26.
    const [a, b] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 100_000, 2)];
    const k = await koinonOf("The Sacred Band", [a, b], uid(800));
    const musterId = await musterRow(k, a);
    await setWarband(landRegion, 33000);
    await pledgedMen(a, "hoplite", 60, musterId, 501);
    await pledgedMen(b, "hoplite", 60, musterId, 502);
    // Kallias burns a bull an hour before the launch: lit until two days on.
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: a, type: "bull", amount: "1", ratePerSecond: "0", lastUpdatedAt: NOW });
    expect(await m.barracks.sacrifice(await ctx(a), "bull", at(HOUR))).toEqual({ ok: true, good: "bull", mor: 3, until: at(HOUR + 2 * DAY) });

    expect(await m.muster.resolveMuster(musterId, at(2 * HOUR + 30 * MIN))).toEqual({ outcome: "resolved" });
    const report = await reportOf();
    const part = (id: string) => report.parts.find((p) => p.playerId === id)!;
    expect(part(a).men).toBe(60);
    expect(part(b).men).toBe(60);
    expect(part(b).lost).toBeGreaterThanOrEqual(27);
    expect(part(a).lost).toBeLessThanOrEqual(26);
    expect(part(a).lost).toBeGreaterThan(0);

    // Through altarBonusFor at the launch instant: Kallias's bull counts; a bull
    // that went cold at the launch, and one lit a minute after it, give nothing.
    const { players } = m.dbPkg;
    expect(await m.barracks.altarBonusFor(db, [a, b], LAUNCH)).toEqual(new Map([[a, 3], [b, 0]]));
    await db.update(players).set({ altarUntil: LAUNCH, altarGood: "bull" }).where(eq(players.id, b));
    expect(await m.barracks.altarBonusFor(db, [a, b], LAUNCH)).toEqual(new Map([[a, 3], [b, 0]]));
    await db.update(players).set({ altarUntil: at(2 * HOUR + MIN + 2 * DAY), altarGood: "bull" }).where(eq(players.id, b));
    expect(await m.barracks.altarBonusFor(db, [a, b], LAUNCH)).toEqual(new Map([[a, 3], [b, 0]]));
    expect(await m.barracks.altarBonusFor(db, [b], at(2 * HOUR + MIN))).toEqual(new Map([[b, 3]]));
    expect(await m.barracks.altarBonusFor(db, [], LAUNCH)).toEqual(new Map());
  });

  it("deterministic: resolved 30 minutes after launch and 3 days after, the reports, rows, wallets and pool are identical", async () => {
    const { regionMilitary, townMilitary, playerUnits, playerCharacters, resources, effectLog, koinonMusterHulls } = m.dbPkg;
    const snapshot = async () =>
      JSON.stringify({
        musters: await musters(),
        units: await db.select().from(playerUnits).orderBy(asc(playerUnits.id)),
        wallets: await db.select({ playerId: playerCharacters.playerId, drachmae: playerCharacters.drachmae, prestige: playerCharacters.prestige, militia: playerCharacters.militia }).from(playerCharacters).orderBy(asc(playerCharacters.playerId)),
        stock: await db.select({ scopeId: resources.scopeId, type: resources.type, amount: resources.amount, lastUpdatedAt: resources.lastUpdatedAt }).from(resources).orderBy(asc(resources.scopeId), asc(resources.type)),
        regions: await db.select().from(regionMilitary).orderBy(asc(regionMilitary.regionId)),
        towns: await db.select().from(townMilitary).orderBy(asc(townMilitary.townId)),
        hulls: await db.select().from(koinonMusterHulls),
        logs: (await db.select({ characterId: effectLog.characterId, kind: effectLog.kind, detail: effectLog.detail, createdAt: effectLog.createdAt }).from(effectLog)).map((l) => JSON.stringify(l)).sort(),
      });

    const first = await landRaid();
    expect(await m.muster.resolveMuster(first.musterId, at(2 * HOUR + 30 * MIN))).toEqual({ outcome: "resolved" });
    const soon = await snapshot();

    await reset();
    const second = await landRaid();
    expect(second).toEqual(first);
    expect(await m.muster.resolveMuster(second.musterId, at(2 * HOUR + 3 * DAY))).toEqual({ outcome: "resolved" });
    const late = await snapshot();

    // Compared parsed first, so a difference reads as a diff; then byte for byte.
    expect(JSON.parse(late)).toEqual(JSON.parse(soon));
    expect(late).toBe(soon);
    // arrivesAt is counted from the launch instant in both.
    const units = (JSON.parse(late) as { units: { arrivesAt: string }[] }).units;
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) expect(u.arrivesAt).toBe(recovered(1).toISOString());
  });

  it("shares: 40 men carried on another member's two pentekonters are 40 shares each; by land the ship owner gets nothing", async () => {
    // Against a garrison of 10, 3 (a fourth of 10, rounded) turn out at any
    // walls, and 40 peltasts slay 2 or 3 of them on every seed.
    const [soldier, shipowner] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 100_000, 2)];
    const k = await koinonOf("The Sacred Band", [soldier, shipowner]);
    await geography(soldier);
    await setTown(seaTown.townId, 10);
    const bySea = await musterRow(k, soldier, { regionId: seaTown.regionId, townId: seaTown.townId });
    await pledgedMen(soldier, "peltast", 40, bySea, 501);
    await pledgedHulls(shipowner, bySea, "trade-ship", 2);

    expect(await m.muster.resolveMuster(bySea, LAUNCH)).toEqual({ outcome: "resolved" });
    const report = await reportOf();
    expect(report).toMatchObject({ outcome: "won", route: "sea", steps: seaTown.steps, townId: seaTown.townId, arrivesAt: recovered(seaTown.steps).toISOString() });
    expect(report.defender).toMatchObject({ start: 10, turnout: 3 });
    expect([2, 3]).toContain(report.killed);
    expect(report.fleet).toEqual({ hulls: { "trade-ship": 2 }, naval: 2, space: 40, filled: 40, defender: null, held: true });
    const { good, label } = report.plunder!.spoil!;
    const mult = battle().raid.townPlunderMultiplier;
    const total = { drachmae: Math.round(report.killed * battle().raid.plunderPerKill * mult), grain: Math.round(report.killed * battle().raid.grainPerKill * mult), spoil: { good, label, amount: Math.round(report.killed * battle().raid.spoilPerKill * mult) } };
    expect(report.plunder).toEqual(total);
    const drachmae = splitByShares(total.drachmae, { [soldier]: 40, [shipowner]: 40 });
    const grains = splitByShares(total.grain, { [soldier]: 40, [shipowner]: 40 });
    const spoils = splitByShares(total.spoil.amount, { [soldier]: 40, [shipowner]: 40 });
    expect(report.parts).toEqual([
      { playerId: soldier, name: "Kallias", men: 40, lost: report.lost, hulls: 0, seats: 0, shares: 40, drachmae: drachmae[soldier], grain: grains[soldier], spoil: spoils[soldier] },
      { playerId: shipowner, name: "Nikias", men: 0, lost: 0, hulls: 2, seats: 40, shares: 40, drachmae: drachmae[shipowner], grain: grains[shipowner], spoil: spoils[shipowner] },
    ]);
    expect(drachmae[soldier]! + drachmae[shipowner]!).toBe(total.drachmae);
    expect(await wallet(soldier)).toBe(100_000 + drachmae[soldier]!);
    expect(await wallet(shipowner)).toBe(100_000 + drachmae[shipowner]!);
    expect(await grain(shipowner)).toBe(grains[shipowner]);
    expect(await stockOf(shipowner, good)).toBe(spoils[shipowner]);
    // The ship owner's line: no men, two hulls. His two hulls sailed and are at sea until the army is home.
    expect((await logs(shipowner, "koinon_muster"))[0]!.detail).toMatchObject({ chronicle: { force: [], hulls: 2, winner: "attacker", lost: 0, townId: seaTown.townId, share: { drachmae: drachmae[shipowner], grain: grains[shipowner], spoil: { good, label, amount: spoils[shipowner] } } } });
    expect((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, shipowner), eq(m.dbPkg.resources.type, "trade-ship"))))[0]!.amount).toBe("0");
    expect(await voyagesOf(shipowner)).toHaveLength(1);
    expect((await voyagesOf(shipowner))[0]).toMatchObject({ ships: { "trade-ship": 2 }, kind: "raid", musterId: bySea, regionId: seaTown.regionId, townId: seaTown.townId, sailedAt: LAUNCH, returnsAt: recovered(seaTown.steps), returnedAt: null });
    expect(await voyagesOf(soldier)).toEqual([]);
    expect(recovered(seaTown.steps).getTime()).toBeLessThanOrEqual(at(DAY).getTime()); // seven seas at most: home by at(23 hours)
    expect(await garrisonOf(seaTown.townId)).toBe(10 - report.killed);
    expect(await db.select().from(m.dbPkg.koinonMusterHulls)).toEqual([]);

    // By land no hull carries anyone: the ship owner has no part and no line.
    // The warband of 10 has regenerated to 15 by the launch a day on; 4 (a
    // fourth of 15, rounded) turn out and 20 peltasts win on every seed, slaying 2 to 4.
    await setWarband(landRegion, 10);
    const byLand = await musterRow(k, soldier, { id: uid(901), launchAt: at(DAY) });
    await db.delete(m.dbPkg.playerUnits);
    await pledgedMen(soldier, "peltast", 20, byLand, 505);
    await db.insert(m.dbPkg.koinonMusterHulls).values({ musterId: byLand, ownerPlayerId: shipowner, shipId: "trade-ship", count: 1, pledgedAt: NOW });
    const before = await wallet(shipowner);
    expect(await m.muster.resolveMuster(byLand, at(DAY))).toEqual({ outcome: "resolved" });
    const land = (await musters())[1]!.report as unknown as Report;
    expect(land).toMatchObject({ outcome: "won", route: "land", fleet: null, defender: { start: 15, turnout: 4 } });
    expect([2, 3, 4]).toContain(land.killed);
    expect(land.parts.map((p) => [p.playerId, p.shares, p.drachmae])).toEqual([[soldier, 20, land.plunder!.drachmae]]);
    expect(await wallet(shipowner)).toBe(before);
    expect((await logs(shipowner, "koinon_muster")).length).toBe(1);
    // The land resolve settled the ship owner at its launch: his hulls from the sea raid are home.
    expect((await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, shipowner), eq(m.dbPkg.resources.type, "trade-ship"))))[0]!.amount).toBe("2");
    expect((await voyagesOf(shipowner))[0]).toMatchObject({ returnedAt: at(DAY) });
  });

  it("by sea: a trireme that cannot make the crossing neither sails nor counts; three pentekonters pledged with one in stock is one hull", async () => {
    const [soldier, transporter, escort] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 100_000, 2), await freshPlayer("Deon", 100_000, 3)];
    const k = await koinonOf("The Sacred Band", [soldier, transporter, escort]);
    const view = await geography(soldier);
    // A crossing longer than a trireme's range and within a pentekonter's.
    const far = view.targets.find((t) => t.route === "sea" && t.steps > 4)!;
    expect(far, "a sea target beyond a trireme's range").toBeTruthy();
    if (far.townId) await setTown(far.townId, 2);
    else await setWarband(far.regionId, 2);
    const musterId = await musterRow(k, soldier, { regionId: far.regionId, townId: far.townId });
    await pledgedMen(soldier, "hoplite", 20, musterId, 501);
    // The trireme was pledged first; three pentekonters are pledged, two since sold.
    await pledgedHulls(escort, musterId, "galley", 1, at(-MIN));
    await pledgedHulls(transporter, musterId, "trade-ship", 3, NOW, 1);

    expect(await m.muster.resolveMuster(musterId, LAUNCH)).toEqual({ outcome: "resolved" });
    const report = await reportOf();
    expect(report).toMatchObject({ route: "sea", steps: far.steps });
    expect(report.fleet).toMatchObject({ hulls: { "trade-ship": 1 }, naval: 1, space: 20, filled: 20 });
    expect(report.parts.map((p) => [p.playerId, p.men, p.hulls, p.seats])).toEqual([[soldier, 20, 0, 0], [transporter, 0, 1, 20]]);
    expect((await logs(escort, "koinon_muster")).length).toBe(0);
    expect(await wallet(escort)).toBe(100_000);
    // The pentekonter that sailed is at sea; the trireme that could not never left port.
    expect(await stockOf(transporter, "trade-ship")).toBe(0);
    expect(await voyagesOf(transporter)).toHaveLength(1);
    expect((await voyagesOf(transporter))[0]).toMatchObject({ ships: { "trade-ship": 1 }, musterId });
    expect(await stockOf(escort, "galley")).toBe(1);
    expect(await voyagesOf(escort)).toEqual([]);
  });

  it("by sea: space short of the force stands the muster down with the hulls reason; a stronger town fleet repulses it with no losses and recovery", async () => {
    const [soldier, shipowner] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 100_000, 2)];
    const k = await koinonOf("The Sacred Band", [soldier, shipowner]);
    await geography(soldier);
    await setTown(seaTown.townId, 50, 3, 2);
    const short = await musterRow(k, soldier, { regionId: seaTown.regionId, townId: seaTown.townId });
    const row = await pledgedMen(soldier, "hoplite", 30, short, 501);
    await pledgedHulls(shipowner, short, "trade-ship", 1);

    expect(await m.muster.resolveMuster(short, LAUNCH)).toEqual({ outcome: "stood_down" });
    expect((await musters())[0]).toMatchObject({ status: "stood_down", report: { outcome: "stood_down", reason: REACH_REASON.hulls(30, 20), line: null, parts: [] } });
    // The men are free at once, with no recovery.
    expect(await unitRow(row)).toMatchObject({ count: 30, mission: null, movingTo: null, arrivesAt: null });
    expect((await logs(soldier, "koinon_muster")).length).toBe(0);
    expect((await m.koinon.koinonView(await ctx(soldier), at(3 * HOUR))).koinon!.lastMuster).toMatchObject({ status: "stood_down", reason: REACH_REASON.hulls(30, 20) });
    // A stand-down sails nothing.
    expect(await stockOf(shipowner, "trade-ship")).toBe(1);
    expect(await voyagesOf(shipowner)).toEqual([]);

    // Two pentekonters carry the 30, but the town's fleet (3 × 1 + 2 × 5) outweighs them.
    const repulsed = await musterRow(k, soldier, { id: uid(901), regionId: seaTown.regionId, townId: seaTown.townId, launchAt: at(4 * HOUR) });
    await db.update(m.dbPkg.playerUnits).set({ mission: { kind: "muster", musterId: repulsed, regionId: seaTown.regionId, departedAt: NOW.toISOString() } }).where(eq(m.dbPkg.playerUnits.id, row));
    await db.update(m.dbPkg.resources).set({ amount: "2" }).where(and(eq(m.dbPkg.resources.scopeId, shipowner), eq(m.dbPkg.resources.type, "trade-ship")));
    await db.insert(m.dbPkg.koinonMusterHulls).values({ musterId: repulsed, ownerPlayerId: shipowner, shipId: "trade-ship", count: 2, pledgedAt: NOW });
    const wallets = [await wallet(soldier), await wallet(shipowner)];
    expect(await m.muster.resolveMuster(repulsed, at(4 * HOUR))).toEqual({ outcome: "resolved" });
    const report = (await musters())[1]!.report as unknown as Report;
    expect(report).toMatchObject({ outcome: "repulsed", route: "sea", men: 30, lost: 0, killed: 0, rounds: 0, defender: null, plunder: null });
    expect(report.fleet).toEqual({ hulls: { "trade-ship": 2 }, naval: 2, space: 40, filled: 30, defender: { pentekonters: 3, triremes: 2, naval: 13 }, held: false });
    expect(report.line).toBe(`Sailed against ${report.townName} and were driven off by its fleet before landing.`);
    // No battle: the men are whole and bound home, the garrison untouched, nothing paid.
    const home = new Date(at(4 * HOUR).getTime() + Math.max(1, seaTown.steps) * battle().recovery.hoursPerStep * HOUR);
    expect(await unitRow(row)).toMatchObject({ count: 30, movingTo: massalia, arrivesAt: home, mission: { kind: "raid", townId: seaTown.townId } });
    expect(await garrisonOf(seaTown.townId)).toBe(50);
    expect([await wallet(soldier), await wallet(shipowner)]).toEqual(wallets);
    expect((await logs(soldier, "battle_loss")).length).toBe(0);
    expect((await logs(soldier, "koinon_muster"))[0]!.detail).toMatchObject({ chronicle: { winner: "repulsed", killed: 0, lost: 0, share: null, hulls: 0 } });
    expect((await logs(shipowner, "koinon_muster"))[0]!.detail).toMatchObject({ chronicle: { winner: "repulsed", force: [], hulls: 2, share: null } });
    // Repulsed, the hulls are still at sea until the army is home.
    expect(await stockOf(shipowner, "trade-ship")).toBe(0);
    expect(await voyagesOf(shipowner)).toHaveLength(1);
    expect((await voyagesOf(shipowner))[0]).toMatchObject({ ships: { "trade-ship": 2 }, returnsAt: home });
  });

  it("stands down with no men pledged, and when the force cannot reach the target; the rows are free at once", async () => {
    const [leader, member] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 100_000, 2)];
    const k = await koinonOf("The Sacred Band", [leader, member]);
    await geography(leader);
    // Hulls and no men.
    const empty = await musterRow(k, leader);
    await pledgedHulls(member, empty, "trade-ship", 1);
    expect(await m.muster.resolveMuster(empty, LAUNCH)).toEqual({ outcome: "stood_down" });
    expect((await musters())[0]).toMatchObject({ status: "stood_down", closedAt: LAUNCH, report: { outcome: "stood_down", reason: REACH_REASON.noMen } });
    expect(await db.select().from(m.dbPkg.koinonMusterHulls)).toEqual([]);
    expect(await stockOf(member, "trade-ship")).toBe(1);
    expect(await db.select().from(m.dbPkg.playerVoyages)).toEqual([]);

    // Men and no hulls for a crossing: the page says why before the launch, and the resolve gives the same reason.
    const stranded = await musterRow(k, leader, { id: uid(901), regionId: seaTown.regionId, townId: seaTown.townId, launchAt: at(DAY) });
    const row = await pledgedMen(member, "hoplite", 20, stranded, 501);
    const outlook = (await m.koinon.koinonView(await ctx(leader), at(3 * HOUR))).koinon!.muster!.outlook;
    expect(outlook).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(await m.muster.resolveMuster(stranded, at(DAY))).toEqual({ outcome: "stood_down" });
    expect((await musters())[1]).toMatchObject({ status: "stood_down", report: { outcome: "stood_down", reason: outlook.reason } });
    expect(await unitRow(row)).toMatchObject({ count: 20, mission: null, movingTo: null, arrivesAt: null });
    expect((await logs(member, "koinon_muster")).length).toBe(0);
    expect(await db.select().from(m.dbPkg.townMilitary)).toEqual([]);
  });

  it("men gone before launch do not fight: a row disbanded for unpaid upkeep by the settle at the launch instant, and a member expelled before it", async () => {
    const [leader, broke, expelled] = [await freshPlayer("Kallias", 100_000, 1), await freshPlayer("Nikias", 0, 2), await freshPlayer("Deon", 100_000, 3)];
    const k = await koinonOf("The Sacred Band", [leader, broke, expelled]);
    const musterId = await musterRow(k, leader);
    await setWarband(landRegion, 5);
    await pledgedMen(leader, "hoplite", 40, musterId, 501);
    // Raised 23 hours before the pledge: a whole day of upkeep falls due by the launch, and he cannot pay it.
    const unpaid = await pledgedMen(broke, "hoplite", 20, musterId, 502, { createdAt: at(-23 * HOUR) });
    const outside = await pledgedMen(expelled, "hoplite", 20, musterId, 503);
    expect(await m.koinon.expel(await ctx(leader), expelled, at(MIN))).toEqual({ ok: true });
    const untouched = JSON.stringify(await unitRow(outside));

    expect(await m.muster.resolveMuster(musterId, LAUNCH)).toEqual({ outcome: "resolved" });
    const report = await reportOf();
    expect(report.men).toBe(40);
    expect(report.parts.map((p) => p.playerId)).toEqual([leader]);
    // The unpaid men walked at the launch settle; the expelled member's row is exactly as it was.
    expect(await unitRow(unpaid)).toBeUndefined();
    const walked = await logs(broke, "barracks_disband");
    expect(walked.length).toBe(1);
    expect(walked[0]!.createdAt.getTime()).toBe(LAUNCH.getTime());
    expect(JSON.stringify(await unitRow(outside))).toBe(untouched);
    for (const p of [broke, expelled]) {
      expect((await logs(p, "koinon_muster")).length).toBe(0);
      expect((await logs(p, "battle_loss")).length).toBe(0);
    }
    expect(await wallet(expelled)).toBe(100_000);
    expect(await wallet(broke)).toBe(0);
    // His own settle frees the expelled member's men.
    await settle(expelled, at(3 * HOUR));
    expect(await unitRow(outside)).toMatchObject({ mission: null, movingTo: null });
  });

  // The grudge (raids prompt 2): a raid on a nation's land rolls once on the
  // battle's seed. The seed is sha256(world | muster | reii | launch), so the
  // muster's id decides it: uid(900) hits (0.1013), uid(903) misses (0.5372).
  const relation = async (factionId: string) => (await db.select().from(m.dbPkg.factionRelations).where(and(eq(m.dbPkg.factionRelations.worldId, worldId), eq(m.dbPkg.factionRelations.factionId, factionId))))[0];
  async function raidOnReii(id: string) {
    const a = await freshPlayer("Kallias", 100_000, 1);
    const k = await koinonOf("The Sacred Band", [a], uid(800));
    const musterId = await musterRow(k, a, { id, regionId: "R047", townId: "reii" });
    await pledgedMen(a, "peltast", 40, musterId, 501);
    expect(await m.muster.resolveMuster(musterId, LAUNCH)).toEqual({ outcome: "resolved" });
    const report = await reportOf();
    expect(report).toMatchObject({ outcome: "won", townId: "reii", defender: { start: 160 } });
    return report;
  }

  it("the grudge: a raid on Reii that rolls under the chance lowers the Saluvii by a point, for the whole world", async () => {
    const report = await raidOnReii(uid(900));
    expect(report.opinion).toEqual({ factionId: "saluvii", name: "Saluvii", from: -45, to: -46, line: "The Saluvii will remember this." });
    expect(await relation("saluvii")).toMatchObject({ opinion: -46, stance: "unfriendly" });
  });

  it("the grudge: a raid on Reii that rolls over the chance leaves the Saluvii as they were", async () => {
    const report = await raidOnReii(uid(903));
    expect(report.opinion).toBeNull();
    expect(await relation("saluvii")).toBeUndefined();
  });

  it("claim first: two resolves at once leave one report and credit the wallets once, 10 runs", async () => {
    for (let run = 0; run < 10; run++) {
      const [a, b] = [await freshPlayer(`A${run}`), await freshPlayer(`B${run}`)];
      const k = await koinonOf(`Band ${run}`, [a, b]);
      await setWarband(landRegion, 4);
      const musterId = await musterRow(k, a, { id: uid(950 + run) });
      await pledgedMen(a, "hoplite", 30, musterId, 600 + run * 2);
      await pledgedMen(b, "hoplite", 30, musterId, 601 + run * 2);

      const outcomes = (await Promise.all([m.muster.resolveMuster(musterId, LAUNCH), m.muster.resolveMuster(musterId, at(3 * HOUR))])).map((r) => r.outcome);
      expect(outcomes.filter((o) => o === "resolved").length, `run ${run}: ${outcomes.join(", ")}`).toBe(1);
      expect(outcomes.filter((o) => o === "busy" || o === "not_due").length).toBe(1);
      const muster = (await db.select().from(m.dbPkg.koinonMusters).where(eq(m.dbPkg.koinonMusters.id, musterId)))[0]!;
      const report = muster.report as unknown as Report;
      expect(muster.status).toBe("resolved");
      expect(report.parts.length).toBe(2);
      for (const p of report.parts) {
        expect(await wallet(p.playerId), `run ${run}`).toBe(100_000 + p.drachmae);
        expect(await grain(p.playerId)).toBe(p.grain);
        expect((await logs(p.playerId, "koinon_muster")).length).toBe(1);
      }
      expect(await warbandOf(landRegion)).toBe(4 - report.killed);
    }
  });

  it("a resolve while another holds the muster's advisory lock returns at once and applies nothing", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    const k = await koinonOf("The Sacred Band", [leader, member]);
    const musterId = await musterRow(k, leader);
    const row = await pledgedMen(member, "hoplite", 20, musterId, 501);
    const before = JSON.stringify([await musters(), await unitRow(row)]);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('koinon_muster'), hashtext(${musterId}::text))`);
      expect(await m.muster.resolveMuster(musterId, at(3 * HOUR))).toEqual({ outcome: "busy" });
      expect(JSON.stringify([await musters(), await unitRow(row)])).toBe(before);
    });
    expect(await m.muster.resolveMuster(musterId, at(3 * HOUR))).toEqual({ outcome: "resolved" });
  });

  // --- the hook -----------------------------------------------------------------------

  it("the hook: a request under /api, /me or /admin resolves a due muster before its handler; /health never does; a throw is reported once, does not fail the request, and is not retried for 60 seconds", async () => {
    const leader = await freshPlayer("Kallias");
    const k = await koinonOf("The Sacred Band", [leader]);
    const musterId = await musterRow(k, leader);
    const status = async () => (await musters())[0]!.status;

    let clock = at(HOUR);
    let failing = false;
    const calls: string[] = [];
    const errors: [string, unknown][] = [];
    const app = Fastify();
    m.muster.registerCampaignResolver(app, {
      now: () => clock,
      resolve: async (id, now) => {
        calls.push(id);
        if (failing) throw new Error("boom");
        return m.muster.resolveMuster(id, now);
      },
      onError: (id, err) => errors.push([id, err]),
    });
    // Each handler answers with the muster's status as it finds it.
    for (const url of ["/api/ping", "/me/ping", "/admin/ping", "/health", "/auth/me"]) app.get(url, async () => ({ status: await status() }));
    await app.ready();
    const hit = async (url: string) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      return res.json<{ status: string }>().status;
    };

    try {
      // Before the launch instant nothing is due.
      expect(await hit("/api/ping")).toBe("open");
      expect(calls).toEqual([]);

      // Due, but /health (and anything outside the three prefixes) never runs it.
      clock = at(3 * HOUR);
      expect(await hit("/health")).toBe("open");
      expect(await hit("/auth/me")).toBe("open");
      expect(calls).toEqual([]);

      // A resolve that throws: reported once with the muster id, and the request still answers.
      failing = true;
      expect(await hit("/api/ping?x=1")).toBe("open");
      expect(calls).toEqual([musterId]);
      expect(errors.map(([id, err]) => [id, (err as Error).message])).toEqual([[musterId, "boom"]]);
      // Within 60 seconds of the failure it is not tried again.
      clock = at(3 * HOUR + 59_000);
      expect(await hit("/api/ping")).toBe("open");
      expect(await hit("/me/ping")).toBe("open");
      expect(calls.length).toBe(1);
      expect(errors.length).toBe(1);
      // After 60 seconds it is.
      clock = at(3 * HOUR + 60_000);
      expect(await hit("/me/ping")).toBe("open");
      expect(calls.length).toBe(2);
      expect(errors.length).toBe(2);

      // Healthy again, a minute later: the muster marches before the handler reads it.
      failing = false;
      clock = at(3 * HOUR + 121_000);
      expect(await hit("/admin/ping")).toBe("stood_down");
      expect(calls.length).toBe(3);
      // A second request finds nothing due and does not resolve it again.
      expect(await hit("/api/ping")).toBe("stood_down");
      expect(await hit("/me/ping")).toBe("stood_down");
      expect(calls.length).toBe(3);
      expect(errors.length).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("the hook with its own resolver: /api and /me each resolve a due muster before the handler", async () => {
    const [leader, member] = [await freshPlayer("Kallias"), await freshPlayer("Nikias")];
    const k = await koinonOf("The Sacred Band", [leader, member]);
    await setWarband(landRegion, 3);
    const app = Fastify();
    let clock = at(3 * HOUR);
    m.muster.registerCampaignResolver(app, { now: () => clock });
    for (const url of ["/api/ping", "/me"]) app.get(url, async () => ({ statuses: (await musters()).map((r) => r.status) }));
    await app.ready();
    try {
      const first = await musterRow(k, leader);
      const row = await pledgedMen(member, "hoplite", 30, first, 501);
      expect((await app.inject({ method: "GET", url: "/api/ping" })).json()).toEqual({ statuses: ["resolved"] });
      expect(await unitRow(row)).toMatchObject({ movingTo: massalia, mission: { kind: "raid" } });
      await musterRow(k, leader, { id: uid(901), openedAt: at(4 * HOUR), launchAt: at(6 * HOUR) });
      expect((await app.inject({ method: "GET", url: "/me" })).json()).toEqual({ statuses: ["resolved", "open"] });
      clock = at(6 * HOUR);
      expect((await app.inject({ method: "GET", url: "/me" })).json()).toEqual({ statuses: ["resolved", "stood_down"] });
    } finally {
      await app.close();
    }
  });

  it("resolveDueCampaigns: marches and musters in the order their battles fall", async () => {
    const leader = await freshPlayer("Kallias");
    const k = await koinonOf("The Sacred Band", [leader]);
    const musterId = await musterRow(k, leader); // due at LAUNCH
    // Three parties on the march (rows written directly): arriving an hour before the launch, an hour after, and after `now`.
    const march = async (id: string, arrivesAt: Date) =>
      (await db.insert(m.dbPkg.playerMarches).values({ id, worldId, ownerPlayerId: leader, kind: "raid", regionId: landRegion, townId: null, baseId: massalia, route: "land", steps: 1, minutes: 30, party: [], ships: {}, sailing: {}, departedAt: at(-HOUR), arrivesAt }).returning())[0]!.id;
    const early = await march(uid(910), at(HOUR));
    const late = await march(uid(911), at(3 * HOUR));
    await march(uid(912), at(6 * HOUR));
    const calls: string[] = [];
    const record = async (id: string) => {
      calls.push(id);
      return { outcome: "resolved" };
    };
    await m.muster.resolveDueCampaigns(at(5 * HOUR), { resolve: record, resolveMarch: record });
    expect(calls).toEqual([early, musterId, late]);
    // One being resolved elsewhere stops the loop: nothing later is fought ahead of it.
    calls.length = 0;
    await m.muster.resolveDueCampaigns(at(5 * HOUR), { resolve: record, resolveMarch: async (id) => (id === early ? { outcome: "busy" } : record(id)) });
    expect(calls).toEqual([]);
  });
});
