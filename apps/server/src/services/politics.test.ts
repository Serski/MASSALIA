import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Party membership guard (integration) — the unfree may not join a party.
// Real Postgres, guarded to a *_test database. Mirrors agenda.test.ts setup.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const T0 = Date.UTC(2000, 0, 1);
const SEASON = 86_400_000;

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const politics = await import("./politics.js");
  return { dbPkg, politics };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("party membership guard (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  // A character of the given class, ideology high enough to qualify for the Dynatoi.
  async function character(name: string, classId: string) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const c = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, ideology: 50, startAge: 30, deathAge: 90 }).returning())[0]!;
    return c.id;
  }
  const partyOf = async (characterId: string) =>
    (await db.select({ party: m.dbPkg.playerCharacters.party }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, characterId)).limit(1))[0]!.party;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE censures, party_favor, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`,
    );
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Politics Test", seed: "ptest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("a slave is refused (403) and their party is left unchanged", async () => {
    const slave = await character("Doulos", "slave");
    await expect(m.politics.joinParty(slave, "dynatoi")).rejects.toMatchObject({
      statusCode: 403,
      message: "The unfree may not join a party.",
    });
    expect(await partyOf(slave)).toBe("none");
  });

  it("a free citizen who qualifies still joins", async () => {
    const trader = await character("Trader", "trader");
    const result = await m.politics.joinParty(trader, "dynatoi");
    expect(result).toEqual({ party: "dynatoi" });
    expect(await partyOf(trader)).toBe("dynatoi");
  });
});
