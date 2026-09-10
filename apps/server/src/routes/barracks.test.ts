import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// /api/barracks through a minimal Fastify app (app.inject + a minted session
// cookie, the production error handler). GET below and above the militia gate;
// recruit / hire / disband happy paths and one refusal each; the timestamp
// timers (readyAt / contractEndAt / now) in the payload. The routes run on the
// real clock, so the world starts 9.5 days ago → season 9.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { barracksRoutes } = await import("./barracks.js");
  const { errorHandler } = await import("../errorHandler.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  const mapGraph = await import("../services/mapGraph.js");
  return { dbPkg, barracksRoutes, errorHandler, buildings, barracks, mapGraph };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

type View = {
  gate: { stat: string; required: number; current: number; met: boolean };
  season: number;
  now: string;
  levy: { men: number };
  config: { minServiceSeasons: number; maxActiveBands: number; termSeasons: number };
  units: { id: string; gear: Record<string, number>; stats: Record<string, number> }[];
  roster: { id: string; source: string; unitId: string; count: number; readyAt: string | null; contractEndAt: string | null; basedAt: string; movingTo: string | null; arrivesAt: string | null; active: boolean; canDisband: boolean }[];
  offers: { id: string; men: number; hired: boolean; upkeepPerDay: Record<string, number> }[];
  activeBands: number;
};

suite("/api/barracks (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();
  const startedAt = new Date(now.getTime() - 9.5 * DAY); // season 9

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.barracksRoutes, { prefix: "/api/barracks" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE player_units, player_levy, band_offers, effect_log, resources, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Barracks Route Test", seed: "brt", startedAt, endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  async function freshPlayer(opts: { militia?: number; drachmae?: number; goods?: Record<string, number> } = {}) {
    const { users, players, playerCharacters, dynasties, resources, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: `Kleon-${Math.random().toString(36).slice(2, 8)}`, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", dynastyId: dynasty.id, militia: opts.militia ?? 20, drachmae: opts.drachmae ?? 1000, startAge: 30, deathAge: 90 });
    for (const [type, amount] of Object.entries(opts.goods ?? {})) {
      await db.insert(resources).values({ scope: "player", scopeId: player.id, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: startedAt });
    }
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    return { token, playerId: player.id };
  }
  const cookieFor = (token: string) => `massalia_session=${app.signCookie(token)}`;
  const get = (token: string): Promise<LightMyRequestResponse> => app.inject({ method: "GET", url: "/api/barracks", headers: { cookie: cookieFor(token) } });
  const post = (token: string, path: string, payload: unknown): Promise<LightMyRequestResponse> =>
    app.inject({ method: "POST", url: `/api/barracks/${path}`, headers: { cookie: cookieFor(token) }, payload: payload as Record<string, unknown> });

  it("requires a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/barracks" });
    expect(res.statusCode).toBe(401);
  });

  it("GET below the gate still serves the catalogue, offers and levy, with gate.met false", async () => {
    const p = await freshPlayer({ militia: 5 });
    const res = await get(p.token);
    expect(res.statusCode).toBe(200);
    const v = res.json<View>();
    expect(v.gate).toEqual({ stat: "militia", required: 20, current: 5, met: false });
    expect(v.season).toBe(9);
    // Server time, ISO, within a few seconds of the request.
    expect(Math.abs(Date.parse(v.now) - Date.now())).toBeLessThan(10_000);
    expect(v.levy).toEqual({ men: 120 });
    expect(v.config).toEqual({ minServiceSeasons: 2, maxActiveBands: 2, termSeasons: 2 });
    expect(v.units.map((u) => u.id)).toEqual(["peltast", "ekdromos", "hoplite", "hippeis"]);
    expect(v.units.find((u) => u.id === "hoplite")!.gear).toEqual({ timber: 1, iron: 1, tin: 2 });
    expect(v.offers).toHaveLength(3);
    expect(v.offers.every((o) => !o.hired && o.men >= 10 && typeof o.upkeepPerDay.drachmae === "number")).toBe(true);
    expect(v.roster).toEqual([]);
    expect(v.activeBands).toBe(0);
    // Below the gate every POST refuses with 403.
    expect((await post(p.token, "recruit", { unitId: "peltast", count: 1 })).statusCode).toBe(403);
    expect((await post(p.token, "hire", { bandId: v.offers[0]!.id })).statusCode).toBe(403);
  });

  it("GET above the gate: gate.met true, and a second GET returns the same offers", async () => {
    const p = await freshPlayer({ militia: 20 });
    const a = (await get(p.token)).json<View>();
    expect(a.gate.met).toBe(true);
    const b = (await get(p.token)).json<View>();
    expect(b.offers.map((o) => o.id)).toEqual(a.offers.map((o) => o.id));
  });

  it("POST /recruit: happy path returns the refreshed view; a short order is 409; a bad body is 400", async () => {
    const p = await freshPlayer({ goods: { timber: 20, leather: 20 } });
    const ok = await post(p.token, "recruit", { unitId: "peltast", count: 5 }); // 2 timber + 1 leather per man
    expect(ok.statusCode).toBe(200);
    const v = ok.json<View>();
    expect(v.roster).toHaveLength(1);
    expect(v.roster[0]).toMatchObject({ source: "trained", unitId: "peltast", count: 5, active: false, canDisband: false, contractEndAt: null, basedAt: "R060", movingTo: null, arrivesAt: null });
    // A peltast trains for one season = one day from the recruit instant.
    expect(Math.abs(Date.parse(v.roster[0]!.readyAt!) - (Date.parse(v.now) + DAY))).toBeLessThan(1_000);
    expect(v.levy.men).toBe(115);
    const short = await post(p.token, "recruit", { unitId: "peltast", count: 6 }); // 12 timber needed, 10 left
    expect(short.statusCode).toBe(409);
    expect(short.json<{ error: string }>().error).toMatch(/timber/);
    expect((await post(p.token, "recruit", { unitId: "peltast" })).statusCode).toBe(400);
    expect((await post(p.token, "recruit", { unitId: "peltast", count: "5" })).statusCode).toBe(400);
  });

  it("POST /hire: happy path marks the offer hired and counts the band; a band not on offer is 404", async () => {
    const p = await freshPlayer();
    const offers = (await get(p.token)).json<View>().offers;
    const notOffered = Object.keys(m.barracks.getBandsContent().bands).find((id) => !offers.some((o) => o.id === id))!;
    expect((await post(p.token, "hire", { bandId: notOffered })).statusCode).toBe(404);
    const ok = await post(p.token, "hire", { bandId: offers[0]!.id });
    expect(ok.statusCode).toBe(200);
    const v = ok.json<View>();
    expect(v.activeBands).toBe(1);
    expect(v.roster[0]).toMatchObject({ source: "band", unitId: offers[0]!.id, count: offers[0]!.men, active: true, canDisband: false, readyAt: null });
    // The contract runs termSeasons = two days from the hire instant.
    expect(Math.abs(Date.parse(v.roster[0]!.contractEndAt!) - (Date.parse(v.now) + 2 * DAY))).toBeLessThan(1_000);
    expect(v.offers.find((o) => o.id === offers[0]!.id)!.hired).toBe(true);
    expect((await post(p.token, "hire", {})).statusCode).toBe(400);
  });

  it("POST /cancel: a batch in training is stood down with its men and gear returned; a trained row is 409; a bad body is 400", async () => {
    const p = await freshPlayer({ goods: { timber: 20, leather: 20 } });
    const recruited = await post(p.token, "recruit", { unitId: "peltast", count: 5 }); // 2 timber + 1 leather per man
    expect(recruited.statusCode).toBe(200);
    const row = recruited.json<View>().roster[0]!;
    const cancelled = await post(p.token, "cancel", { rowId: row.id });
    expect(cancelled.statusCode).toBe(200);
    const v = cancelled.json<View>();
    expect(v.roster).toEqual([]);
    expect(v.levy.men).toBe(120);
    const timber = (await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scopeId, p.playerId), eq(m.dbPkg.resources.type, "timber"))))[0]!;
    expect(Number(timber.amount)).toBe(20);
    expect((await post(p.token, "cancel", { rowId: row.id })).statusCode).toBe(404);
    expect((await post(p.token, "cancel", {})).statusCode).toBe(400);
    // A row that finished training cannot be stood down.
    const recruitedAt = new Date(now.getTime() - 2 * DAY);
    const ready = (await db.insert(m.dbPkg.playerUnits).values({ worldId, ownerPlayerId: p.playerId, source: "trained", unitId: "peltast", count: 3, startCount: 3, recruitedSeason: 7, readyAt: new Date(recruitedAt.getTime() + DAY), createdAt: recruitedAt }).returning())[0]!;
    const refused = await post(p.token, "cancel", { rowId: ready.id });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: string }>().error).toBe("Those men are already trained.");
  });

  it("POST /disband: a served row is released and men return; a fresh row is 409; an unknown row is 404", async () => {
    const p = await freshPlayer({ goods: { timber: 20, leather: 20 } });
    // A batch recruited 4.5 days ago, ready 3.5 days ago — past minServiceSeasons (2 days) by now.
    const recruitedAt = new Date(startedAt.getTime() + 5 * DAY);
    const served = (
      await db
        .insert(m.dbPkg.playerUnits)
        .values({ worldId, ownerPlayerId: p.playerId, source: "trained", unitId: "peltast", count: 7, startCount: 7, recruitedSeason: 5, readyAt: new Date(recruitedAt.getTime() + DAY), contractEndAt: null, createdAt: recruitedAt })
        .returning()
    )[0]!;
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: p.playerId, type: "grain", amount: "1000", ratePerSecond: "0", lastUpdatedAt: startedAt });
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: p.playerId, type: "oliveoil", amount: "1000", ratePerSecond: "0", lastUpdatedAt: startedAt });
    const before = (await get(p.token)).json<View>();
    expect(before.roster.find((r) => r.id === served.id)).toMatchObject({ active: true, canDisband: true, readyAt: new Date(recruitedAt.getTime() + DAY).toISOString() });
    const recruited = await post(p.token, "recruit", { unitId: "peltast", count: 2 });
    expect(recruited.statusCode).toBe(200);
    const fresh = recruited.json<View>().roster.find((r) => r.unitId === "peltast" && r.count === 2)!;
    expect((await post(p.token, "disband", { rowId: fresh.id })).statusCode).toBe(409);
    expect((await post(p.token, "disband", { rowId: crypto.randomUUID() })).statusCode).toBe(404);
    const ok = await post(p.token, "disband", { rowId: served.id });
    expect(ok.statusCode).toBe(200);
    const v = ok.json<View>();
    expect(v.roster.map((r) => r.id)).toEqual([fresh.id]);
    expect(v.levy.men).toBe(120 - 2 + 7);
    const levy = (await db.select().from(m.dbPkg.playerLevy).where(eq(m.dbPkg.playerLevy.ownerPlayerId, p.playerId)))[0]!;
    expect(levy.men).toBe(125);
  });
});
