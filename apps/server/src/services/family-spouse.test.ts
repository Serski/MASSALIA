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
  const composure = await import("./composure.js");
  return { dbPkg, age, traits, family, composure };
}

suite("livingSpousePersonalityTraits (integration)", () => {
  let m: Db;
  let db: ReturnType<Db["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  async function createCharacter(name: string, classId = "landowner") {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@test`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456" }).returning())[0]!;
    return (
      await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId, startAge: 30, deathAge: 90 }).returning()
    )[0]!;
  }

  // Marry a character to a generated wife with the given personality + mechanical
  // trait + death age.
  async function marryTo(
    charId: string,
    opts: { personalityTraitId: string | null; traitId?: string | null; spouseDeathAge: number | null; candidateAge?: number; philia?: number },
  ) {
    const { familyCandidates, marriages, playerCharacters } = m.dbPkg;
    const cand = (
      await db.insert(familyCandidates).values({
        worldId, forCharacterId: charId, purpose: "marriage", name: "Wife", sex: "female",
        houseSlug: "test-house", age: opts.candidateAge ?? 30, personalityTraitId: opts.personalityTraitId, traitId: opts.traitId ?? null,
      }).returning()
    )[0]!;
    const marriageValues = { characterId: charId, candidateId: cand.id, spouseDeathAge: opts.spouseDeathAge, ...(opts.philia !== undefined ? { philia: opts.philia } : {}) };
    await db.insert(marriages).values(marriageValues);
    await db.update(playerCharacters).set({ spouseCandidateId: cand.id }).where(eq(playerCharacters.id, charId));
    return cand;
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.family.loadFamilyConfig();
    await m.composure.loadComposureConfig();

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
    expect(await m.family.livingSpouseState(c, now)).toBeNull();
  });

  it("married to a living wife -> full state (personality traits, philia, ids)", async () => {
    const c = await createCharacter("Wedded");
    await marryTo(c.id, { personalityTraitId: "brave", traitId: "fertile", spouseDeathAge: 70, candidateAge: 30 });
    const fresh = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, c.id)).limit(1))[0]!;
    const state = await m.family.livingSpouseState(fresh, now);
    expect(state).not.toBeNull();
    expect(state!.personalityTraits.map((t) => t.id)).toEqual(["brave"]);
    expect(state!.spouseTraitId).toBe("fertile"); // mechanical
    expect(state!.spouseTraitIds.sort()).toEqual(["brave", "fertile"]); // personality + mechanical
    expect(state!.philia).toBe(50); // the default from Phase 1
    expect(state!.marriageId).not.toBeNull();
  });

  it("widowed (wife past her spouseDeathAge, not yet swept) -> null", async () => {
    const c = await createCharacter("Widower");
    // candidateAge 65 >= spouseDeathAge 60 -> isSpouseDeceased true, even though
    // spouseCandidateId is still set (the lazy sweep hasn't run).
    await marryTo(c.id, { personalityTraitId: "brave", spouseDeathAge: 60, candidateAge: 65 });
    const fresh = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, c.id)).limit(1))[0]!;
    expect(fresh.spouseCandidateId).not.toBeNull(); // still married on paper
    expect(await m.family.livingSpouseState(fresh, now)).toBeNull();
  });

  it("married to a wife with NULL personality (legacy) -> living state, empty personality", async () => {
    const c = await createCharacter("LegacyWife");
    await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 70, candidateAge: 30 });
    const fresh = (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, c.id)).limit(1))[0]!;
    const state = await m.family.livingSpouseState(fresh, now);
    expect(state).not.toBeNull(); // still married
    expect(state!.personalityTraits).toEqual([]);
    expect(state!.spouseTraitIds).toEqual([]);
  });

  it("familyEligibilityContext: married reads spouse ids; children age via childAge; slave short-circuits", async () => {
    const { children, playerCharacters } = m.dbPkg;
    const c = await createCharacter("Householder");
    await marryTo(c.id, { personalityTraitId: "brave", traitId: "fertile", spouseDeathAge: 70, candidateAge: 30 });
    // Two children: an infant and a youth. bornAt now → age 0; bornAt 12 game-years
    // ago → age 12 (childAge = floor((now-bornAt)/realMsPerGameYear)).
    const realMsPerGameYear = m.age.getAgeConfig().realMsPerGameYear;
    await db.insert(children).values({ parentCharacterId: c.id, worldId, name: "Baby", sex: "female", bornAt: now });
    await db.insert(children).values({ parentCharacterId: c.id, worldId, name: "Teen", sex: "male", bornAt: new Date(now.getTime() - 12 * realMsPerGameYear) });
    const fresh = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, c.id)).limit(1))[0]!;

    const fam = await m.family.familyEligibilityContext(fresh, now);
    expect(fam.married).toBe(true);
    expect(fam.spouseTraitIds.sort()).toEqual(["brave", "fertile"]);
    expect(fam.livingChildren.map((k) => `${k.sex}:${k.ageYears}`).sort()).toEqual(["female:0", "male:12"]);

    // A slave (family locked) short-circuits with no spouse/children read.
    const slave = await createCharacter("Enslaved", "slave");
    await db.insert(children).values({ parentCharacterId: slave.id, worldId, name: "X", sex: "male", bornAt: now });
    const slaveFresh = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, slave.id)).limit(1))[0]!;
    const slaveFam = await m.family.familyEligibilityContext(slaveFresh, now);
    expect(slaveFam).toEqual({ married: false, spouseTraitIds: [], livingChildren: [] });
  });

  describe("recoverComposure — devoted-band philia recovery bonus (base 5)", () => {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const setComposure = (charId: string, composure: number, lastUpdate: Date) =>
      db.update(m.dbPkg.playerCharacters).set({ composure, lastComposureUpdate: lastUpdate }).where(eq(m.dbPkg.playerCharacters.id, charId));

    it("devoted + living spouse → +2/day (50 + (5+2) over one day = 57)", async () => {
      const c = await createCharacter("Devoted");
      await marryTo(c.id, { personalityTraitId: null, philia: 90, spouseDeathAge: 70, candidateAge: 30 });
      await setComposure(c.id, 50, dayAgo);
      expect(await m.composure.recoverComposure(c.id, now)).toBe(57);
    });
    it("devoted but spouse dead (past spouseDeathAge) → no bonus (55)", async () => {
      const c = await createCharacter("DeadDevoted");
      await marryTo(c.id, { personalityTraitId: null, philia: 90, spouseDeathAge: 60, candidateAge: 65 });
      await setComposure(c.id, 50, dayAgo);
      expect(await m.composure.recoverComposure(c.id, now)).toBe(55);
    });
    it("warm band (philia 75) → no bonus (55)", async () => {
      const c = await createCharacter("Warm");
      await marryTo(c.id, { personalityTraitId: null, philia: 75, spouseDeathAge: 70, candidateAge: 30 });
      await setComposure(c.id, 50, dayAgo);
      expect(await m.composure.recoverComposure(c.id, now)).toBe(55);
    });
    it("unmarried → no bonus (55)", async () => {
      const c = await createCharacter("Lonely");
      await setComposure(c.id, 50, dayAgo);
      expect(await m.composure.recoverComposure(c.id, now)).toBe(55);
    });
  });
});
