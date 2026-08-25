import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The bride's package (family marry) — integration tests against a REAL Postgres,
// guarded to a *_test database. Every marriage through marry() grants servants +
// household goods, additive beside the dowry, atomic with the marriage insert, and
// with NO divorce interaction. Mirrors family-spouse.test.ts setup.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const family = await import("./family.js");
  const buildings = await import("./buildings.js");
  const composure = await import("./composure.js");
  return { dbPkg, age, traits, family, buildings, composure };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("the bride's package (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  async function createCharacter(name: string) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const c = (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "landowner", prestige: 50, devotion: 50, startAge: 30, deathAge: 90 }).returning())[0]!;
    return { charId: c.id, playerId: player.id };
  }
  // A marriage candidate the real marry() will accept (unconsumed, same ideology so
  // there is no cross-house penalty; no traitId so there is no dowry).
  async function candidateFor(charId: string) {
    const cand = (await db.insert(m.dbPkg.familyCandidates).values({
      worldId, forCharacterId: charId, purpose: "marriage", name: "Wife", sex: "female", houseSlug: "test-house", age: 30,
    }).returning())[0]!;
    return cand.id;
  }
  const fresh = async (charId: string) =>
    (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, charId)).limit(1))[0]!;
  const slaveCount = async (playerId: string) =>
    (await db.select().from(m.dbPkg.playerPops).where(and(eq(m.dbPkg.playerPops.ownerPlayerId, playerId), eq(m.dbPkg.playerPops.popType, "slave"))))[0]?.count ?? 0;
  const goodAmount = async (playerId: string, type: string) => {
    const row = (await db.select().from(m.dbPkg.resources).where(and(eq(m.dbPkg.resources.scope, "player"), eq(m.dbPkg.resources.scopeId, playerId), eq(m.dbPkg.resources.type, type))).limit(1))[0];
    return row ? Number(row.amount) : 0;
  };
  const seedGood = (playerId: string, type: string, amount: number) =>
    db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: playerId, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: now });
  const seedSlaves = (playerId: string, count: number) =>
    db.insert(m.dbPkg.playerPops).values({ worldId, ownerPlayerId: playerId, popType: "slave", count });

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.family.loadFamilyConfig();
    await m.composure.loadComposureConfig();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE resources, player_pops, player_buildings, effect_log, character_traits,
      children, successions, marriages, family_candidates, party_favor, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "centrist", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Bride Test", seed: "btest", startedAt: now, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("every marriage grants a package — rolls in range, pops added, prior goods preserved", async () => {
    const { charId, playerId } = await createCharacter("Groom");
    // Prior holdings: a slave already owned, and some banked goods that must survive.
    await seedSlaves(playerId, 1);
    await seedGood(playerId, "wool", 5);
    await seedGood(playerId, "oliveoil", 3);

    const result = await m.family.marry(await fresh(charId), await candidateFor(charId), now);
    expect(result.ok).toBe(true);

    // Slaves: prior 1 + rolled 2..3.
    const slaves = await slaveCount(playerId);
    expect(slaves - 1).toBeGreaterThanOrEqual(2);
    expect(slaves - 1).toBeLessThanOrEqual(3);
    // Goods: prior amount preserved, rolled amount added (checkpoint-consistent).
    const wool = await goodAmount(playerId, "wool");
    expect(wool - 5).toBeGreaterThanOrEqual(8);
    expect(wool - 5).toBeLessThanOrEqual(10);
    const oil = await goodAmount(playerId, "oliveoil");
    expect(oil - 3).toBeGreaterThanOrEqual(6);
    expect(oil - 3).toBeLessThanOrEqual(8);
  });

  it("a second marriage grants the package again (cumulative)", async () => {
    const { charId, playerId } = await createCharacter("Widower");
    await m.family.marry(await fresh(charId), await candidateFor(charId), now);
    const slavesAfterFirst = await slaveCount(playerId);
    const woolAfterFirst = await goodAmount(playerId, "wool");
    const oilAfterFirst = await goodAmount(playerId, "oliveoil");

    // Free the character (widowed/divorced) so marry() will run a second time.
    await db.update(m.dbPkg.playerCharacters).set({ spouseCandidateId: null }).where(eq(m.dbPkg.playerCharacters.id, charId));
    const second = await m.family.marry(await fresh(charId), await candidateFor(charId), now);
    expect(second.ok).toBe(true);

    expect((await slaveCount(playerId)) - slavesAfterFirst).toBeGreaterThanOrEqual(2);
    expect((await goodAmount(playerId, "wool")) - woolAfterFirst).toBeGreaterThanOrEqual(8);
    expect((await goodAmount(playerId, "oliveoil")) - oilAfterFirst).toBeGreaterThanOrEqual(6);
  });

  it("divorce does not claw back the package (no divorce interaction)", async () => {
    const { charId, playerId } = await createCharacter("Divorcer");
    await m.family.marry(await fresh(charId), await candidateFor(charId), now);
    const slavesAfterMarriage = await slaveCount(playerId);
    const woolAfterMarriage = await goodAmount(playerId, "wool");
    const oilAfterMarriage = await goodAmount(playerId, "oliveoil");

    // Age the marriage past the voluntary-divorce cooldown, then divorce.
    const mr = (await db.select().from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, charId)).limit(1))[0]!;
    await db.update(m.dbPkg.marriages).set({ marriedAt: new Date(now.getTime() - 2 * m.age.getAgeConfig().realMsPerGameYear) }).where(eq(m.dbPkg.marriages.id, mr.id));
    const divorced = await m.family.divorce(await fresh(charId), now);
    expect(divorced.ok).toBe(true);

    // The bride's package stays — divorce never touches it.
    expect(await slaveCount(playerId)).toBe(slavesAfterMarriage);
    expect(await goodAmount(playerId, "wool")).toBe(woolAfterMarriage);
    expect(await goodAmount(playerId, "oliveoil")).toBe(oilAfterMarriage);
  });

  it("familyState shows the exact package that marriage then grants (shown == granted)", async () => {
    const { charId, playerId } = await createCharacter("Betrothed");
    const candidateId = await candidateFor(charId);

    // What the selection card reports for this candidate.
    const state = await m.family.familyState(await fresh(charId), now);
    const offer = state.candidates.marriage.find((cand) => cand.id === candidateId)!;
    expect(offer.package).toBeDefined();

    const beforeSlaves = await slaveCount(playerId);
    const beforeWool = await goodAmount(playerId, "wool");
    const beforeOil = await goodAmount(playerId, "oliveoil");

    const result = await m.family.marry(await fresh(charId), candidateId, now);
    expect(result.ok).toBe(true);

    // The pop/inventory delta equals EXACTLY what was shown at selection.
    expect((await slaveCount(playerId)) - beforeSlaves).toBe(offer.package.slaves);
    expect((await goodAmount(playerId, "wool")) - beforeWool).toBe(offer.package.wool);
    expect((await goodAmount(playerId, "oliveoil")) - beforeOil).toBe(offer.package.oliveoil);
  });
});
