import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Phase 3: the purchasable freedom routine. A slave may buy the freedman trait for
// 50 drachmae; the card is filtered out once freed and never routed to non-slaves.
// Integration tests against a REAL Postgres, guarded to a *_test database.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const BUY_FREEDOM = "routine-buy-freedom";

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const routines = await import("./routines.js");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const composure = await import("./composure.js");
  const buildings = await import("./buildings.js");
  return { dbPkg, routines, age, traits, composure, buildings };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("purchasable freedom routine (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  async function makeChar(classId: string, drachmae = 0) {
    const { users, players, playerCharacters, dynasties } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "P", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    return (await db
      .insert(playerCharacters)
      .values({ playerId: player.id, worldId, houseSlug: "test-house", classId, dynastyId: dynasty.id, drachmae, prestige: 0, startAge: 30, deathAge: 90 })
      .returning())[0]!;
  }
  const reload = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  const heldTraitIds = async (id: string) =>
    (await db.select({ traitId: m.dbPkg.characterTraits.traitId }).from(m.dbPkg.characterTraits).where(eq(m.dbPkg.characterTraits.characterId, id))).map((r) => r.traitId).sort();
  // The offered pool exactly as the route and resolveRoutine compute it.
  async function offeredIds(row: typeof import("@massalia/db").playerCharacters.$inferSelect) {
    const held = (await m.traits.getHeldTraits(row.id)).map((t) => t.id);
    return m.routines.withoutClaimedFreedom(m.routines.activePoolCards(row), held).map((c) => c.id);
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.routines.loadRoutineContent();
    await m.composure.loadComposureConfig();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE daily_routines, character_traits, resources, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "BF Test", seed: "bftest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  // 1 — a solvent slave is offered the card, buys freedom: debited exactly 50, holds freedman.
  it("a slave with >=50 dr sees the card, buys it, is debited 50 and holds freedman", async () => {
    const c = await makeChar("slave", 80);
    expect(await offeredIds(await reload(c.id))).toContain(BUY_FREEDOM);

    const res = await m.routines.resolveRoutine(await reload(c.id), BUY_FREEDOM, new Date(T0));
    expect(res.ok).toBe(true);
    const after = await reload(c.id);
    expect(after.drachmae).toBe(30); // exactly 50 debited
    expect(await heldTraitIds(c.id)).toContain("freedman");
    expect(after.prestige).toBeGreaterThanOrEqual(2); // +2 prestige effect applied
  });

  // 2 — a slave who cannot cover the fee is rejected with the existing copy; nothing changes.
  it("a slave with <50 dr is rejected 402 with the fee copy, not debited, no trait", async () => {
    const c = await makeChar("slave", 49);
    const res = await m.routines.resolveRoutine(await reload(c.id), BUY_FREEDOM, new Date(T0));
    expect(res).toMatchObject({ ok: false, code: 402, error: "You cannot spare the 50dr." });
    const after = await reload(c.id);
    expect(after.drachmae).toBe(49); // untouched
    expect(await heldTraitIds(c.id)).not.toContain("freedman");
  });

  // 3 — a freed slave is no longer offered the card, and a pick is refused.
  it("a slave already holding freedman is not offered the card", async () => {
    const c = await makeChar("slave", 80);
    await db.insert(m.dbPkg.characterTraits).values({ characterId: c.id, traitId: "freedman" });
    expect(await offeredIds(await reload(c.id))).not.toContain(BUY_FREEDOM);

    const res = await m.routines.resolveRoutine(await reload(c.id), BUY_FREEDOM, new Date(T0));
    expect(res).toMatchObject({ ok: false, code: 409 });
    expect((await reload(c.id)).drachmae).toBe(80); // untouched
  });

  // 4 — a non-slave class never sees the slave-pool card via routing.
  it("a non-slave class is never offered the card", async () => {
    const c = await makeChar("landowner", 80);
    expect(await offeredIds(await reload(c.id))).not.toContain(BUY_FREEDOM);
  });
});
