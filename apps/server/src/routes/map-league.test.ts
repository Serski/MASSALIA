import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// The League's army on the map's routes (government prompt 5b): GET
// /api/map/league and POST /api/map/league/act answer a sitting Archon or
// Strategos and refuse an Ephor and a citizen with 403, the seat read at every
// call; GET /api/map/reach tells the map whether to offer the League's army;
// and GET /api/map/military counts a home town's garrison as the League's men
// standing there, with a League holding shown as the League's. Integration test
// against a REAL Postgres, guarded to a *_test database (it truncates). The
// routes read the real clock, so the world starts a day and a half ago: a Spring.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const REFUSAL = "Only a sitting Archon or Strategos commands the League's army.";

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const shared = await import("@massalia/shared");
  const map = await import("./map.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  const mapGraph = await import("../services/mapGraph.js");
  const traits = await import("../services/traits.js");
  const age = await import("../services/age.js");
  const { errorHandler } = await import("../errorHandler.js");
  return { dbPkg, shared, map, buildings, barracks, mapGraph, traits, age, errorHandler };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the League's army on the map routes (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  let leagueId: string;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    await m.traits.loadTraitDefs();
    await m.age.loadAgeConfig();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.map.mapRoutes, { prefix: "/api/map" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE league_orders, league_wars, faction_relations, player_marches, player_voyages, player_holdings, player_units, player_levy, band_offers, town_intel, region_intel, town_military, region_military, offices, resources, treasury_ledger, treasuries, effect_log, player_buildings, player_pops, sessions, player_characters, dynasties, players, worlds, users CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "Test House", initial: "T", alignment: "centrist", stance: "test", motto: "test", patron: "test", crest: "test" }).onConflictDoNothing();
    const started = new Date(Date.now() - 1.5 * DAY);
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "W", seed: "s", startedAt: started, endsAt: new Date(started.getTime() + 182 * DAY), status: "active" }).returning())[0]!.id;
    expect(m.shared.campaignSeason(Date.now(), started.getTime()).open).toBe(true);
    await m.dbPkg.ensureTownMilitary(db, worldId);
    await m.dbPkg.ensureRegionMilitary(db, worldId);
    await db.insert(m.dbPkg.treasuries).values({ worldId, owner: "league", balance: 5000 });
    expect(await m.dbPkg.ensureLeagueArmy(worldId, started)).toBe(true);
    leagueId = (await m.dbPkg.leaguePlayerId(db, worldId))!;
  });

  // A user, his player, house, character and session; `seat` sits him in an office.
  async function freshPlayer(seat?: { office: string; side: string | null }) {
    const user = (await db.insert(m.dbPkg.users).values({ email: `u-${crypto.randomUUID()}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(m.dbPkg.players).values({ worldId, userId: user.id, name: `P-${crypto.randomUUID().slice(0, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(m.dbPkg.dynasties).values({ worldId, name: "House Test" }).returning())[0]!;
    const character = (await db.insert(m.dbPkg.playerCharacters).values({ playerId: player.id, worldId, dynastyId: dynasty.id, houseSlug: "test-house", classId: "trader" }).returning())[0]!;
    if (seat) await db.insert(m.dbPkg.offices).values({ worldId, office: seat.office, side: seat.side, seatSlot: 0, holderCharacterId: character.id, acquiredVia: "elected" });
    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(m.dbPkg.sessions).values({ userId: user.id, tokenHash: crypto.createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + DAY) });
    return { playerId: player.id, name: player.name, characterId: character.id, cookie: `massalia_session=${app.signCookie(raw)}` };
  }
  const get = (url: string, cookieHeader?: string) => app.inject({ method: "GET", url: `/api/map${url}`, headers: cookieHeader ? { cookie: cookieHeader } : {} });
  const order = (cookieHeader: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/map/league/act", headers: { cookie: cookieHeader }, payload });
  const leagueRows = () => db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, leagueId));
  const leagueRow = async (basedAt: string, unitId: string) => (await leagueRows()).find((r) => r.basedAt === basedAt && r.unitId === unitId && r.movingTo === null)!;
  const orders = () => db.select().from(m.dbPkg.leagueOrders).where(eq(m.dbPkg.leagueOrders.worldId, worldId));

  it("GET /league: an Archon and a Strategos read the League's map; an Ephor and a citizen are refused, and so is no session", async () => {
    expect((await get("/league")).statusCode).toBe(401);
    for (const seat of [undefined, { office: "ephor", side: "palaioi" }, { office: "party_archon", side: "dynatoi" }]) {
      const res = await get("/league", (await freshPlayer(seat)).cookie);
      expect(res.statusCode, JSON.stringify(seat)).toBe(403);
      expect(res.json()).toEqual({ error: REFUSAL });
    }
    for (const seat of [{ office: "archon", side: "palaioi" }, { office: "strategos", side: null }]) {
      const res = await get("/league", (await freshPlayer(seat)).cookie);
      expect(res.statusCode, seat.office).toBe(200);
      const body = res.json() as { bases: { id: string; kind: string }[]; roster: { canDisband: boolean }[]; force: { men: number }; fleet: { ships: Record<string, number>; supplies: number }; treasury: { balance: number }; supplyPrice: number; gate: { towns: Record<string, string>; regions: Record<string, string> }; campaign: { open: boolean }; moveTargets: { id: string }[]; reach: Record<string, unknown> };
      expect(body.bases.map((b) => b.id)).toEqual(["massalia", "emporion", "nikaia", "olbia-provence", "rhoda", "agathe", "antipolis", "arelate", "athinopolis", "monoikos"]);
      expect(body.roster).toHaveLength(40);
      expect(body.force.men).toBe(2050);
      expect(body.fleet.ships).toEqual({ "trade-ship": 29, galley: 40 });
      expect(body.treasury).toEqual({ balance: 5000 });
      expect(body.supplyPrice).toBeGreaterThan(0);
      expect(body.fleet.supplies).toBe(Math.floor(5000 / body.supplyPrice));
      expect(body.campaign.open).toBe(true);
      expect(body.gate.towns.reii).toBe("The League is not at war with the Saluvii.");
      expect(body.gate.regions.R046).toBe("The League makes war on nations alone, and this land answers to none.");
      expect(Object.keys(body.reach).length).toBeGreaterThan(0);
    }
    // Reading wrote nothing.
    expect(await orders()).toEqual([]);
    expect(await db.select().from(m.dbPkg.effectLog)).toEqual([]);
  });

  it("GET /reach says who commands, and the house's own reach is as it was", async () => {
    const reach = async (seat?: { office: string; side: string | null }) => (await get("/reach", (await freshPlayer(seat)).cookie)).json() as { commander: boolean; bases: { id: string; kind: string }[] };
    const archon = await reach({ office: "archon", side: "dynatoi" });
    expect(archon.commander).toBe(true);
    expect(archon.bases).toMatchObject([{ id: "R060", kind: "massalia" }]);
    expect((await reach({ office: "strategos", side: null })).commander).toBe(true);
    expect((await reach({ office: "ephor", side: "dynatoi" })).commander).toBe(false);
    expect((await reach()).commander).toBe(false);
  });

  it("POST /league/act: an Ephor and a citizen are refused and nothing moves; an Archon's order is carried out and recorded as his; a seat lost is an order refused", async () => {
    const hoplites = await leagueRow("massalia", "hoplite");
    const move = { type: "move", baseId: "arelate", rows: [{ rowId: hoplites.id, count: 30 }] };
    for (const seat of [undefined, { office: "ephor", side: "palaioi" }]) {
      const res = await order((await freshPlayer(seat)).cookie, move);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: REFUSAL });
    }
    expect(await orders()).toEqual([]);
    expect(await leagueRows()).toHaveLength(40);
    expect((await leagueRow("massalia", "hoplite")).count).toBe(500);

    const archon = await freshPlayer({ office: "archon", side: "dynatoi" });
    // A malformed order, and one the war gate refuses, in the server's words.
    expect((await order(archon.cookie, { type: "raid" })).statusCode).toBe(400);
    const atPeace = await order(archon.cookie, { type: "raid", townId: "reii", rows: [{ rowId: hoplites.id, count: 30 }] });
    expect(atPeace.statusCode).toBe(409);
    expect(atPeace.json()).toEqual({ error: "The League is not at war with the Saluvii." });

    const res = await order(archon.cookie, move);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { report: { type: string; baseId: string; men: number }; roster: unknown[]; force: { men: number }; reach: { treasury: { balance: number }; bases: unknown[] } };
    expect(body.report).toMatchObject({ type: "move", baseId: "arelate", men: 30 });
    expect(body.roster).toHaveLength(41);
    expect(body.force.men).toBe(2020); // the men on the road are no one's to send
    expect(body.reach.treasury).toEqual({ balance: 5000 });
    expect(body.reach.bases).toHaveLength(10);
    expect(await orders()).toMatchObject([{ orderedByCharacterId: archon.characterId, orderedByName: archon.name, office: "archon", side: "dynatoi", kind: "move", baseId: "massalia", townId: "arelate", men: 30 }]);
    // His own men and his own log are untouched: the order was the League's.
    expect(await db.select().from(m.dbPkg.playerUnits).where(eq(m.dbPkg.playerUnits.ownerPlayerId, archon.playerId))).toEqual([]);
    expect(await db.select().from(m.dbPkg.effectLog)).toEqual([]);

    // He leaves the seat: the next order is refused.
    await db.delete(m.dbPkg.offices).where(eq(m.dbPkg.offices.holderCharacterId, archon.characterId));
    const after = await order(archon.cookie, move);
    expect(after.statusCode).toBe(403);
    expect(after.json()).toEqual({ error: REFUSAL });
    expect(await orders()).toHaveLength(1);
  });

  it("GET /military: a home town's garrison is the League's men standing in it, and a League holding is shown as the League's", async () => {
    const viewer = await freshPlayer();
    const archon = await freshPlayer({ office: "archon", side: "dynatoi" });
    const hoplites = await leagueRow("massalia", "hoplite");
    expect((await order(archon.cookie, { type: "move", baseId: "arelate", rows: [{ rowId: hoplites.id, count: 30 }] })).statusCode).toBe(200);
    // The League holds Reii, with men in it; a house holds R046.
    const now = new Date();
    await db.insert(m.dbPkg.playerHoldings).values([
      { worldId, regionId: "R047", townId: "reii", ownerPlayerId: leagueId, kind: "conquest", previousOwner: "saluvii", since: now, lastGarrisonedAt: now, lastTributeAt: now },
      { worldId, regionId: "R046", townId: "", ownerPlayerId: viewer.playerId, kind: "conquest", previousOwner: "unclaimed", since: now, lastGarrisonedAt: now, lastTributeAt: now },
    ]);
    await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: leagueId, source: "trained", unitId: "hoplite", count: 25, startCount: 25, recruitedSeason: 0, readyAt: now, basedAt: "reii" });

    const res = await get("/military", viewer.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { towns: Record<string, { garrison: number; source: string }>; holdings: { towns: Record<string, Record<string, unknown>>; regions: Record<string, Record<string, unknown>> } };
    // The thirty on the road are in no town: gone from Massalia, not yet at Arelate.
    expect(body.towns.massalia!.garrison).toBe(1000 - 30);
    expect(body.towns.arelate!.garrison).toBe(100);
    // A League holding is no home town: its men are not a garrison anyone reads here.
    expect(body.towns.reii).toBeUndefined();
    expect(body.holdings.towns.reii).toEqual({ playerId: leagueId, characterName: "The League", houseName: null, league: true });
    // A house's holding keeps its three fields.
    expect(Object.keys(body.holdings.regions.R046!).sort()).toEqual(["characterName", "houseName", "playerId"]);
    expect(await db.select().from(m.dbPkg.playerHoldings).where(and(eq(m.dbPkg.playerHoldings.worldId, worldId), eq(m.dbPkg.playerHoldings.ownerPlayerId, leagueId)))).toHaveLength(1);
  });
});
