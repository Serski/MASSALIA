import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// change_philia executor integration tests — run against a REAL Postgres, guarded
// to a *_test database (they truncate it). See oligarchy.test.ts for the recipe.
// Covers: married apply + effectLog source, clamp at both ends, and the silent
// no-op for an unmarried / widowed actor (child events fire for widowers).
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
  const engine = await import("./eventEngine.js");
  return { dbPkg, age, traits, family, engine };
}

// A choice that carries a single change_philia effect.
function philiaChoice(amount: number) {
  return { id: "c", label: "c", resultText: "r", effects: [{ type: "change_philia" as const, amount }] };
}

suite("change_philia executor (integration)", () => {
  let m: Db;
  let db: ReturnType<Db["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  async function createCharacter(name: string) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@test`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456" }).returning())[0]!;
    return (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "landowner", startAge: 30, deathAge: 90 }).returning())[0]!;
  }

  async function marryTo(charId: string, opts: { philia: number; spouseDeathAge?: number | null; candidateAge?: number }) {
    const { familyCandidates, marriages, playerCharacters } = m.dbPkg;
    const cand = (await db.insert(familyCandidates).values({ worldId, forCharacterId: charId, purpose: "marriage", name: "Wife", sex: "female", houseSlug: "test-house", age: opts.candidateAge ?? 30 }).returning())[0]!;
    const marriage = (await db.insert(marriages).values({ characterId: charId, candidateId: cand.id, spouseDeathAge: opts.spouseDeathAge ?? 70, philia: opts.philia }).returning())[0]!;
    await db.update(playerCharacters).set({ spouseCandidateId: cand.id }).where(eq(playerCharacters.id, charId));
    return marriage;
  }

  const philiaOf = async (marriageId: string) =>
    (await db.select({ philia: m.dbPkg.marriages.philia }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.id, marriageId)).limit(1))[0]!.philia;
  const philiaLogCount = async (charId: string) =>
    (await db.select({ id: m.dbPkg.effectLog.id }).from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, charId), eq(m.dbPkg.effectLog.kind, "change_philia")))).length;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.family.loadFamilyConfig();
    await db.execute(sql`
      TRUNCATE TABLE event_history, effect_log, children, successions, marriages, family_candidates,
        player_characters, dynasties, players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "Test House", initial: "T", alignment: "centrist", stance: "test", motto: "test", patron: "test", crest: "test" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Philia Test", seed: "philia-test", startedAt: now, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("married: applies the delta and logs kind=change_philia with the source event id", async () => {
    const c = await createCharacter("Wedded");
    const marriage = await marryTo(c.id, { philia: 50 });
    await m.engine.applyChoiceEffects(c.id, "fam-symposium-hostess", philiaChoice(5));
    expect(await philiaOf(marriage.id)).toBe(55);
    const logs = await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, c.id), eq(m.dbPkg.effectLog.kind, "change_philia")));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.detail).toMatchObject({ amount: 5, source: "fam-symposium-hostess" });
  });

  it("clamps at the low end (2 + (-5) -> 0)", async () => {
    const c = await createCharacter("LowBond");
    const marriage = await marryTo(c.id, { philia: 2 });
    await m.engine.applyChoiceEffects(c.id, "fam-x", philiaChoice(-5));
    expect(await philiaOf(marriage.id)).toBe(0);
  });

  it("clamps at the high end (98 + 5 -> 100)", async () => {
    const c = await createCharacter("HighBond");
    const marriage = await marryTo(c.id, { philia: 98 });
    await m.engine.applyChoiceEffects(c.id, "fam-y", philiaChoice(5));
    expect(await philiaOf(marriage.id)).toBe(100);
  });

  it("unmarried: silent no-op — no throw, no effectLog change_philia row", async () => {
    const c = await createCharacter("Single");
    await m.engine.applyChoiceEffects(c.id, "fam-child-event", philiaChoice(9));
    expect(await philiaLogCount(c.id)).toBe(0);
  });

  it("widowed (wife past spouseDeathAge, not yet swept): silent no-op, philia untouched", async () => {
    const c = await createCharacter("Widower");
    const marriage = await marryTo(c.id, { philia: 50, spouseDeathAge: 60, candidateAge: 65 });
    await m.engine.applyChoiceEffects(c.id, "fam-child-event", philiaChoice(9));
    expect(await philiaOf(marriage.id)).toBe(50); // untouched
    expect(await philiaLogCount(c.id)).toBe(0);
  });
});
