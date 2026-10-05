import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The koinon's Raid muster (koinon prompt 3) — integration tests against a REAL
// Postgres, guarded to a *_test database. Opening, pledging men and hulls, the
// lock on a pledged row, its release by the owner's own settle, withdrawing,
// the count on the Politics nav and the read-only view.
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

  async function freshPlayer(name: string, drachmae = 100_000) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", prestige: 20, militia: 50, drachmae, startAge: 30, deathAge: 90, avatarId: "avatar-30-1" });
    return player.id;
  }
  const ctx = async (playerId: string) => (await m.buildings.buildingContext(playerId, worldId))!;
  // A koinon written directly: the first player leads, the rest are members.
  async function koinonOf(name: string, playerIds: string[]) {
    const { koina, koinonMembers } = m.dbPkg;
    const k = (await db.insert(koina).values({ worldId, name, leaderPlayerId: playerIds[0]!, leaderSince: at(-DAY), foundedAt: at(-DAY) }).returning())[0]!;
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

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE koinon_muster_hulls, koinon_musters, koinon_posts, koinon_invites, koinon_members, koina, player_holdings, player_units, player_levy, region_military, town_military, world_treasury, resources, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Muster Test", seed: "mutest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  // The targets from Massalia, read through the service once a member exists.
  async function geography(memberId: string) {
    const view = await m.muster.musterTargets(await ctx(memberId), massalia);
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
});
