import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// /api/koinon through a minimal Fastify app (app.inject + a minted session
// cookie, the production error handler): a smoke pass over every endpoint, 401
// without a session, and the route-level 400s. The service's rules are covered
// by services/koinon.test.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const POSTS = ["found", "invite", "withdraw", "accept", "decline", "leave", "expel", "vice", "handover", "take-lead", "post", "post/delete", "read", "give", "lesche", "muster/open", "muster/pledge", "muster/withdraw", "muster/cancel"];

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const { koinonRoutes } = await import("./koinon.js");
  const { errorHandler } = await import("../errorHandler.js");
  const buildings = await import("../services/buildings.js");
  const barracks = await import("../services/barracks.js");
  const mapGraph = await import("../services/mapGraph.js");
  const koinon = await import("../services/koinon.js");
  const age = await import("../services/age.js");
  return { dbPkg, koinonRoutes, errorHandler, buildings, barracks, mapGraph, koinon, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("/api/koinon (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.age.loadAgeConfig();
    await m.barracks.loadBarracksContent();
    await m.mapGraph.loadMapGraph();
    await m.koinon.loadKoinonContent();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.koinonRoutes, { prefix: "/api/koinon" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE koinon_posts, koinon_invites, koinon_members, koina, world_treasury, resources, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Koinon Route Test", seed: "krt", startedAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  async function freshPlayer(name: string) {
    const { users, players, playerCharacters, sessions } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", prestige: 20, drachmae: 100, startAge: 30, deathAge: 90 });
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    return { token, playerId: player.id };
  }
  const cookieFor = (token: string) => `massalia_session=${app.signCookie(token)}`;
  const get = (token: string, path = ""): Promise<LightMyRequestResponse> => app.inject({ method: "GET", url: `/api/koinon${path}`, headers: { cookie: cookieFor(token) } });
  const post = (token: string, path: string, payload: unknown = {}): Promise<LightMyRequestResponse> =>
    app.inject({ method: "POST", url: `/api/koinon/${path}`, headers: { cookie: cookieFor(token) }, payload: payload as Record<string, unknown> });

  it("requires a session on every endpoint", async () => {
    expect((await app.inject({ method: "GET", url: "/api/koinon" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/koinon/armies" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/koinon/muster/targets" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/koinon/muster/mine" })).statusCode).toBe(401);
    for (const path of POSTS) {
      expect((await app.inject({ method: "POST", url: `/api/koinon/${path}`, payload: {} })).statusCode, path).toBe(401);
    }
  });

  it("refuses a malformed id with 400 before it reaches the database", async () => {
    const a = await freshPlayer("Kallias");
    for (const [path, field] of [["withdraw", "inviteId"], ["accept", "inviteId"], ["decline", "inviteId"], ["expel", "playerId"], ["handover", "playerId"], ["post/delete", "postId"]] as const) {
      const res = await post(a.token, path, { [field]: "not-a-uuid" });
      expect(res.statusCode, path).toBe(400);
      expect(res.json()).toEqual({ error: `${field === "inviteId" ? "An" : "A"} ${field} is required.` });
      expect((await post(a.token, path, {})).statusCode, path).toBe(400);
    }
    expect((await post(a.token, "vice", { playerId: "nope" })).statusCode).toBe(400);
    expect((await post(a.token, "vice", {})).statusCode).toBe(400);
    expect((await post(a.token, "found", {})).statusCode).toBe(400);
    expect((await post(a.token, "invite", {})).statusCode).toBe(400);
  });

  it("found → invite → accept → post → read → vice → handover → armies → expel → leave", async () => {
    const a = await freshPlayer("Kallias");
    const b = await freshPlayer("Deon");
    const c = await freshPlayer("Nikias");
    const d = await freshPlayer("Xenon");

    // Not in a koinon: the member routes answer 403, the leader's view of soldiers too.
    expect((await post(a.token, "leave")).statusCode).toBe(403);
    expect((await post(a.token, "read")).statusCode).toBe(403);
    expect((await post(a.token, "take-lead")).statusCode).toBe(403);
    expect((await get(a.token, "/armies")).statusCode).toBe(403);

    const founded = await post(a.token, "found", { name: "The Sacred Band" });
    expect(founded.statusCode).toBe(200);
    expect(founded.json()).toMatchObject({ ok: true, name: "The Sacred Band", wallet: 50 });
    expect((await post(b.token, "found", { name: "the sacred band" })).statusCode).toBe(409);
    expect((await post(a.token, "found", { name: "Another" })).statusCode).toBe(409);

    expect((await post(a.token, "invite", { name: "Nobody" })).statusCode).toBe(404);
    const toB = await post(a.token, "invite", { name: "Deon" });
    expect(toB.statusCode).toBe(200);
    const toC = await post(a.token, "invite", { name: "Nikias" });
    const toD = await post(a.token, "invite", { name: "Xenon" });
    const inviteB = toB.json<{ invite: { id: string } }>().invite.id;
    const inviteC = toC.json<{ invite: { id: string } }>().invite.id;
    const inviteD = toD.json<{ invite: { id: string } }>().invite.id;

    const asInvitee = await get(b.token);
    expect(asInvitee.statusCode).toBe(200);
    expect(asInvitee.json()).toMatchObject({ me: { role: null }, koinon: null, invites: [{ id: inviteB, koinonName: "The Sacred Band", inviterName: "Kallias" }], koina: [{ name: "The Sacred Band", leaderName: "Kallias", members: 1, cap: 8 }] });

    expect((await post(b.token, "accept", { inviteId: inviteB })).statusCode).toBe(200);
    expect((await post(c.token, "accept", { inviteId: inviteC })).statusCode).toBe(200);
    expect((await post(d.token, "decline", { inviteId: inviteD })).statusCode).toBe(200);
    expect((await post(d.token, "accept", { inviteId: inviteD })).statusCode).toBe(404);
    const again = await post(a.token, "invite", { name: "Xenon" });
    expect((await post(a.token, "withdraw", { inviteId: again.json<{ invite: { id: string } }>().invite.id })).statusCode).toBe(200);

    expect((await post(b.token, "post", { body: "Not mine to post." })).statusCode).toBe(403);
    const posted = await post(a.token, "post", { body: "Muster at dawn." });
    expect(posted.statusCode).toBe(200);
    expect((await post(a.token, "post", { body: "a".repeat(301) })).statusCode).toBe(400);
    expect((await get(b.token)).json<{ koinon: { unread: number } }>().koinon.unread).toBe(1);
    expect((await post(b.token, "read")).statusCode).toBe(200);
    expect((await get(b.token)).json<{ koinon: { unread: number } }>().koinon.unread).toBe(0);
    expect((await post(b.token, "post/delete", { postId: posted.json<{ postId: string }>().postId })).statusCode).toBe(403);
    expect((await post(a.token, "post/delete", { postId: posted.json<{ postId: string }>().postId })).statusCode).toBe(200);

    expect((await post(a.token, "vice", { playerId: b.playerId })).statusCode).toBe(200);
    expect((await post(a.token, "vice", { playerId: null })).statusCode).toBe(200);
    expect((await post(a.token, "vice", { playerId: b.playerId })).statusCode).toBe(200);
    expect((await post(b.token, "take-lead")).statusCode).toBe(409);

    expect((await get(b.token, "/armies")).statusCode).toBe(403);
    const armies = await get(a.token, "/armies");
    expect(armies.statusCode).toBe(200);
    expect(armies.json<{ members: { name: string }[] }>().members.map((x) => x.name)).toEqual(["Kallias", "Deon", "Nikias"]);

    expect((await post(a.token, "handover", { playerId: b.playerId })).statusCode).toBe(200);
    expect((await get(b.token)).json()).toMatchObject({ me: { role: "leader" }, koinon: { vicePlayerId: null } });
    expect((await post(a.token, "expel", { playerId: c.playerId })).statusCode).toBe(403);
    expect((await post(b.token, "expel", { playerId: c.playerId })).statusCode).toBe(200);
    expect((await post(a.token, "leave")).statusCode).toBe(200);

    const view = (await get(b.token)).json<{ koinon: { members: { name: string }[] } }>();
    expect(view.koinon.members.map((x) => x.name)).toEqual(["Deon"]);
    const cooldowns = await db.select({ id: m.dbPkg.players.id, until: m.dbPkg.players.koinonCooldownUntil }).from(m.dbPkg.players).where(eq(m.dbPkg.players.worldId, worldId));
    expect(cooldowns.filter((p) => p.until !== null).map((p) => p.id).sort()).toEqual([a.playerId, c.playerId].sort());
  });

  it("give → lesche: a gift into the treasury, then the leader orders the hall", async () => {
    const a = await freshPlayer("Kallias");
    const b = await freshPlayer("Deon");
    expect((await post(a.token, "give", { amount: 10 })).statusCode).toBe(403); // not in a koinon
    expect((await post(a.token, "found", { name: "The Sacred Band" })).statusCode).toBe(200);

    for (const amount of [0, 1.5, 10_001, "ten", undefined]) expect((await post(a.token, "give", { amount })).statusCode, String(amount)).toBe(400);
    const tooMuch = await post(a.token, "give", { amount: 51 });
    expect(tooMuch.statusCode).toBe(402);
    expect(tooMuch.json()).toEqual({ error: "You hold only 50 drachmae." });
    const given = await post(a.token, "give", { amount: 50 });
    expect(given.statusCode).toBe(200);
    expect(given.json()).toEqual({ ok: true, wallet: 0, treasury: 50 });

    const short = await post(a.token, "lesche");
    expect(short.statusCode).toBe(409);
    // The price is a balance number: read it from content, never pin it here.
    const cost = m.koinon.getKoinonContent().lesche.cost;
    expect(cost).toBeGreaterThan(50);
    expect(short.json()).toEqual({ error: `The treasury holds 50 drachmae. The Lesche costs ${cost}.` });
    expect((await post(b.token, "lesche")).statusCode).toBe(403);

    await db.update(m.dbPkg.koina).set({ treasury: cost + 100 });
    const built = await post(a.token, "lesche");
    expect(built.statusCode).toBe(200);
    expect(built.json()).toMatchObject({ ok: true, treasury: 100 });
    expect((await post(a.token, "lesche")).statusCode).toBe(409);

    const view = (await get(a.token)).json<{ rules: Record<string, number>; koinon: { treasury: number; cap: number; hall: { phase: string }; givers: { name: string; total: number }[]; gifts: { name: string; amount: number }[] } }>();
    expect(view.rules).toMatchObject({ depositMax: 10000, lescheCost: cost, lescheBuildDays: 2, lescheUpkeep: 5, lescheCap: 12 });
    expect(view.koinon).toMatchObject({ treasury: 100, cap: 8, hall: { phase: "building" }, givers: [{ name: "Kallias", total: 50 }], gifts: [{ name: "Kallias", amount: 50 }] });
  });

  it("muster: targets → open → mine → pledge → withdraw → cancel", async () => {
    const a = await freshPlayer("Kallias");
    const b = await freshPlayer("Deon");
    // Not in a koinon: every muster route answers 403.
    expect((await get(a.token, "/muster/targets")).statusCode).toBe(403);
    expect((await get(a.token, "/muster/mine")).statusCode).toBe(403);
    for (const path of ["muster/open", "muster/pledge", "muster/withdraw", "muster/cancel"]) expect((await post(a.token, path, { gatherId: "x", rows: [], ships: { "trade-ship": 1 } })).statusCode, path).not.toBe(200);

    expect((await post(a.token, "found", { name: "The Sacred Band" })).statusCode).toBe(200);
    const invited = await post(a.token, "invite", { name: "Deon" });
    expect((await post(b.token, "accept", { inviteId: invited.json<{ invite: { id: string } }>().invite.id })).statusCode).toBe(200);

    const targets = await get(a.token, "/muster/targets");
    expect(targets.statusCode).toBe(200);
    const list = targets.json<{ gathers: { id: string; name: string }[]; gatherId: string; targets: { regionId: string; townId: string | null; kind: string; route: string }[] }>();
    expect(list.gathers.length).toBeGreaterThan(1);
    expect(list.gatherId).toBe(list.gathers[0]!.id);
    expect((await get(a.token, "/muster/targets?gather=nowhere")).statusCode).toBe(400);
    const land = list.targets.find((t) => t.kind === "region" && t.route === "land")!;

    expect((await get(a.token, "/muster/mine")).statusCode).toBe(409);
    expect((await post(a.token, "muster/open", { regionId: land.regionId, gatherId: list.gatherId, leadMinutes: 10 })).statusCode).toBe(400);
    const opened = await post(b.token, "muster/open", { regionId: land.regionId, gatherId: list.gatherId, leadMinutes: 60 });
    // The world of this suite starts a day ago: day 1 is Spring, and an hour on is still Spring or Summer.
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ ok: true, musterId: expect.any(String), launchAt: expect.any(String) });
    expect((await post(a.token, "muster/open", { regionId: land.regionId, gatherId: list.gatherId, leadMinutes: 60 })).statusCode).toBe(409);

    const page = (await get(a.token)).json<{ rules: Record<string, number>; koinon: { muster: { openerName: string; canCancel: boolean; outlook: { route: string } }; unread: number } }>();
    expect(page.rules).toMatchObject({ musterMinLeadMinutes: 30, musterMaxLeadHours: 24 });
    expect(page.koinon.muster).toMatchObject({ openerName: "Deon", canCancel: true, outlook: { route: "land" } });
    expect(page.koinon.unread).toBe(1);

    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: a.playerId, type: "trade-ship", amount: "2", ratePerSecond: "0", lastUpdatedAt: now });
    const mine = await get(a.token, "/muster/mine");
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ rows: unknown[]; ships: { id: string; inStock: number; pledged: number }[] }>().ships.find((s) => s.id === "trade-ship")).toMatchObject({ inStock: 2, pledged: 0 });
    expect((await post(a.token, "muster/pledge", {})).statusCode).toBe(400);
    expect((await post(a.token, "muster/pledge", { ships: { "trade-ship": 3 } })).statusCode).toBe(409);
    expect((await post(a.token, "muster/pledge", { ships: { "trade-ship": 2 } })).statusCode).toBe(200);
    expect((await post(a.token, "muster/pledge", { rows: [{ rowId: "not-a-uuid", count: 1 }] })).statusCode).toBe(400);
    expect((await post(a.token, "muster/withdraw")).statusCode).toBe(200);
    expect(await db.select().from(m.dbPkg.koinonMusterHulls)).toEqual([]);

    expect((await post(a.token, "muster/cancel")).statusCode).toBe(200);
    expect((await post(a.token, "muster/cancel")).statusCode).toBe(409);
    expect((await get(a.token)).json<{ koinon: { muster: unknown; lastMuster: { status: string } } }>().koinon).toMatchObject({ muster: null, lastMuster: { status: "cancelled" } });
  });
});
