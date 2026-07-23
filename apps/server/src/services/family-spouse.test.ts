import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// livingSpousePersonalityTraits integration tests — run against a REAL Postgres,
// guarded to a *_test database (they truncate it). See oligarchy.test.ts for the
// setup recipe. Without DATABASE_URL pointing at *_test the suite is skipped.
// Covers the four helper branches: unmarried, married+alive, widowed (dead by
// spouseDeathAge but not yet swept), and married with a NULL personality.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const runs = dbUrl.includes("_test");
const suite = describe.runIf(runs);

type Db = Awaited<ReturnType<typeof loadModules>>;
async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const family = await import("./family.js");
  return { dbPkg, age, traits, family };
}

suite("livingSpousePersonalityTraits (integration)", () => {
  let m: Db;
  let db: ReturnType<Db["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  async function createCharacter(name: string) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@test`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456" }).returning())[0]!;
    return (
      await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "landowner", startAge: 30, deathAge: 90 }).returning()
    )[0]!;
  }

  // Marry a character to a generated wife with the given personality + death age.
  async function marryTo(charId: string, opts: { personalityTraitId: string | null; spouseDeathAge: number | null; candidateAge?: number }) {
    const { familyCandidates, marriages, playerCharacters } = m.dbPkg;
    const cand = (
      await db.insert(familyCandidates).values({
        worldId, forCharacterId: charId, purpose: "marriage", name: "Wife", sex: "female",
        houseSlug: "test-house", age: opts.candidateAge ?? 30, personalityTraitId: opts.personalityTraitId,
      }).returning()
    )[0]!;
    await db.insert(marriages).values({ characterId: charId, candidateId: cand.id, spouseDeathAge: opts.spouseDeathAge });
    await db.update(playerCharacters).set({ spouseCandidateId: cand.id }).where(eq(playerCharacters.id, charId));
    return cand;
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.family.loadFamilyConfig();

    await db.execute(sql`
      TRUNCATE TABLE daily_routines, effect_log, character_traits, children, successions,
        marriages, family_candidates, player_characters, dynasties, players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({
      slug: "test-house", name: "Test House", initial: "T", alignment: "centrist",
      stance: "test", motto: "test", patron: "test", crest: "test",
    }).onConflictDoNothing();
    const world = (
      await db.insert(m.dbPkg.worlds).values({
        name: "Spouse Test World", seed: "spouse-test", startedAt: now,
        endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active",
      }).returning()
    )[0]!;
    worldId = world.id;
  });

  it("unmarried -> [] (and takes the no-DB-read gate)", async () => {
    const c = await createCharacter("Single");
    expect(c.spouseCandidateId).toBeNull();
    const traits = await m.family.livingSpousePersonalityTraits(c, now);
    expect(traits).toEqual([]);
  });

  it("married to a living wife with a personality -> [that trait]", async () => {
    const c = await createCharacter("Wedded");
    await marryTo(c.id, { personalityTraitId: "brave", spouseDeathAge: 70, candidateAge: 30 });
    const fresh = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, c.id)).limit(1))[0]!;
    const traits = await m.family.livingSpousePersonalityTraits(fresh, now);
    expect(traits.map((t) => t.id)).toEqual(["brave"]);
  });

  it("widowed (wife past her spouseDeathAge, not yet swept) -> []", async () => {
    const c = await createCharacter("Widower");
    // candidateAge 65 >= spouseDeathAge 60 -> isSpouseDeceased true, even though
    // spouseCandidateId is still set (the lazy sweep hasn't run).
    await marryTo(c.id, { personalityTraitId: "brave", spouseDeathAge: 60, candidateAge: 65 });
    const fresh = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, c.id)).limit(1))[0]!;
    expect(fresh.spouseCandidateId).not.toBeNull(); // still married on paper
    const traits = await m.family.livingSpousePersonalityTraits(fresh, now);
    expect(traits).toEqual([]);
  });

  it("married to a wife with NULL personality (legacy) -> []", async () => {
    const c = await createCharacter("LegacyWife");
    await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 70, candidateAge: 30 });
    const fresh = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, c.id)).limit(1))[0]!;
    const traits = await m.family.livingSpousePersonalityTraits(fresh, now);
    expect(traits).toEqual([]);
  });
});
