import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

// ---------------------------------------------------------------------------
// World 2 launch (prompt 1): the Beta trait. A user stamped users.beta_at gets
// the trait on every character row createCharacterRow makes — through
// ensureCharacterRow, POST /api/character and POST /characters — and a user
// without the stamp does not. The trait survives a second ensureCharacterRow,
// and GET /api/lobby carries `beta`. DB-gated (mirrors lobby.test.ts).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const HOUSE = "xanthippos"; // a real HOUSE_ID: startingCharacter needs one
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const character = await import("./character.js");
  const traits = await import("./traits.js");
  const composure = await import("./composure.js");
  const age = await import("./age.js");
  const { characterSheetRoutes } = await import("../routes/character.js");
  const { characterRoutes } = await import("../routes/characters.js");
  const { lobbyRoutes } = await import("../routes/lobby.js");
  const { errorHandler } = await import("../errorHandler.js");
  return { dbPkg, character, traits, composure, age, characterSheetRoutes, characterRoutes, lobbyRoutes, errorHandler };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the Beta trait (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let app: FastifyInstance;
  let worldId: string;
  const now = new Date();

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.traits.loadTraitDefs();
    await m.composure.loadComposureConfig();
    await m.age.loadAgeConfig();
    app = Fastify();
    app.setErrorHandler(m.errorHandler);
    await app.register(cookie, { secret: "test-session-secret-at-least-32-chars-long" });
    await app.register(m.characterSheetRoutes, { prefix: "/api/character" });
    await app.register(m.characterRoutes, { prefix: "/characters" });
    await app.register(m.lobbyRoutes, { prefix: "/api/lobby" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE character_traits, resources, player_pops, characters, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: HOUSE, name: "Xanthippos", initial: "X", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    await db.insert(m.dbPkg.professions).values({ slug: "trader", name: "Trader", initial: "T", rank: "r", income: "i" }).onConflictDoNothing();
    worldId = (await db.insert(m.dbPkg.worlds).values({ name: "Beta Test", seed: "beta", startedAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  // A verified user with a session; `beta` stamps beta_at. Optionally a player row
  // in the active world (no character row yet).
  async function freshUser(opts: { beta: boolean; player?: string }) {
    const { users, players, sessions } = m.dbPkg;
    const user = (
      await db
        .insert(users)
        .values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x", emailVerifiedAt: now, betaAt: opts.beta ? new Date(now.getTime() - 30 * DAY) : null })
        .returning()
    )[0]!;
    const token = crypto.randomBytes(16).toString("base64url");
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY) });
    const player = opts.player
      ? (await db.insert(players).values({ worldId, userId: user.id, name: opts.player, color: "#123456", houseSlug: HOUSE, professionSlug: "trader" }).returning())[0]!
      : null;
    return { user, token, player, headers: { cookie: `massalia_session=${app.signCookie(token)}` } };
  }
  const traitsOf = async (characterId: string) =>
    (await db.select({ traitId: m.dbPkg.characterTraits.traitId }).from(m.dbPkg.characterTraits).where(eq(m.dbPkg.characterTraits.characterId, characterId))).map((r) => r.traitId);
  const characterOfPlayer = async (playerId: string) =>
    (await db.select().from(m.dbPkg.playerCharacters).where(and(eq(m.dbPkg.playerCharacters.playerId, playerId), eq(m.dbPkg.playerCharacters.worldId, worldId))).limit(1))[0]!;

  it("ensureCharacterRow grants Beta to a stamped user, not to an unstamped one, and a second ensure keeps one row and one trait", async () => {
    const stamped = await freshUser({ beta: true, player: "Kallias" });
    const plain = await freshUser({ beta: false, player: "Deon" });

    const row = await m.character.ensureCharacterRow(stamped.player!, worldId);
    expect(await traitsOf(row.id)).toEqual([m.character.BETA_TRAIT_ID]);
    const again = await m.character.ensureCharacterRow(stamped.player!, worldId);
    expect(again.id).toBe(row.id);
    expect(await traitsOf(row.id)).toEqual(["beta"]);
    expect(await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.playerId, stamped.player!.id))).toHaveLength(1);

    const other = await m.character.ensureCharacterRow(plain.player!, worldId);
    expect(await traitsOf(other.id)).toEqual([]);
  });

  it("POST /api/character (house + class) grants Beta and the sheet shows it with +1 prestige", async () => {
    const stamped = await freshUser({ beta: true, player: "Kallias" });
    const res = await app.inject({ method: "POST", url: "/api/character", headers: stamped.headers, payload: { houseId: HOUSE, classId: "trader" } });
    expect(res.statusCode).toBe(201);
    const sheet = res.json().character as { base: { prestige: number }; effective: { prestige: number }; traits: { id: string }[] };
    expect(sheet.traits.map((t) => t.id)).toEqual(["beta"]);
    expect(sheet.effective.prestige).toBe(sheet.base.prestige + 1);
    expect(await traitsOf((await characterOfPlayer(stamped.player!.id)).id)).toEqual(["beta"]);

    const plain = await freshUser({ beta: false, player: "Deon" });
    const other = await app.inject({ method: "POST", url: "/api/character", headers: plain.headers, payload: { houseId: HOUSE, classId: "trader" } });
    expect(other.statusCode).toBe(201);
    expect((other.json().character as { traits: unknown[] }).traits).toEqual([]);
  });

  it("POST /characters (the full create flow) grants Beta to a stamped user only", async () => {
    const stamped = await freshUser({ beta: true });
    const create = await app.inject({ method: "POST", url: "/characters", headers: stamped.headers, payload: { name: "Kallias", avatarId: "avatar-30-1", classSlug: "trader", houseSlug: HOUSE } });
    expect(create.statusCode).toBe(201);
    const playerId = create.json().player.id as string;
    expect(await traitsOf((await characterOfPlayer(playerId)).id)).toEqual(["beta"]);

    const plain = await freshUser({ beta: false });
    const other = await app.inject({ method: "POST", url: "/characters", headers: plain.headers, payload: { name: "Deon", avatarId: "avatar-30-1", classSlug: "trader", houseSlug: HOUSE } });
    expect(other.statusCode).toBe(201);
    expect(await traitsOf((await characterOfPlayer(other.json().player.id as string)).id)).toEqual([]);
  });
});
