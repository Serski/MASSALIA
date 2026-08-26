import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { parseRoutineFile, type RoutineCard } from "@massalia/shared";

// ---------------------------------------------------------------------------
// Phase 2: routine effects may grant traits. The change_trait routine effect is
// shaped like the event engine's and applied via the same trait service, post-tx.
// Integration tests against a REAL Postgres, guarded to a *_test database.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (days: number) => new Date(T0 + days * DAY);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const routines = await import("./routines.js");
  const age = await import("./age.js");
  const traits = await import("./traits.js");
  const composure = await import("./composure.js");
  return { dbPkg, routines, age, traits, composure };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("routine effects may grant traits (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  const injected: string[] = [];

  // Push a synthetic card into the loaded pool; tracked for teardown so the module's
  // memoized card list is left exactly as loadRoutineContent produced it.
  function injectCard(card: RoutineCard) {
    m.routines.getRoutineCards().push(card);
    injected.push(card.id);
  }

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

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig();
    await m.traits.loadTraitDefs();
    await m.routines.loadRoutineContent();
    await m.composure.loadComposureConfig();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE daily_routines, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "RT Test", seed: "rttest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  afterEach(() => {
    // Remove any synthetic cards so other suites see the real pool.
    const cards = m.routines.getRoutineCards();
    for (const id of injected.splice(0)) {
      const i = cards.findIndex((c) => c.id === id);
      if (i >= 0) cards.splice(i, 1);
    }
  });

  it("a card carrying change_trait parses under the routine schema", () => {
    const parsed = parseRoutineFile([
      { id: "t-parse", pool: "slave", label: "L", scene: "S", tags: ["labor"], effects: [{ type: "change_trait", traitId: "freedman", operation: "add" }] },
    ]);
    expect(parsed[0]!.effects[0]).toEqual({ type: "change_trait", traitId: "freedman", operation: "add" });
  });

  it("resolving a change_trait card grants the trait; resolving again is a safe no-op", async () => {
    injectCard({ id: "t-grant", pool: "slave", label: "Manumit", scene: "S", tags: ["labor"], effects: [{ type: "change_trait", traitId: "freedman", operation: "add" }, { type: "change_stat", stat: "prestige", amount: 1 }] });
    const c = await makeChar("slave");

    const first = await m.routines.resolveRoutine(await reload(c.id), "t-grant", at(0));
    expect(first.ok).toBe(true);
    expect(await heldTraitIds(c.id)).toContain("freedman");
    expect((await reload(c.id)).prestige).toBe(1);

    // A different UTC day so the one-pick-per-day guard doesn't 409; addTrait is idempotent.
    const second = await m.routines.resolveRoutine(await reload(c.id), "t-grant", at(1));
    expect(second.ok).toBe(true);
    expect((await heldTraitIds(c.id)).filter((t) => t === "freedman")).toHaveLength(1);
  });

  it("existing effect types are unaffected (change_stat still applies)", async () => {
    injectCard({ id: "t-stat", pool: "slave", label: "Study", scene: "S", tags: ["study"], effects: [{ type: "change_stat", stat: "intelligence", amount: 2 }] });
    const c = await makeChar("slave");
    const res = await m.routines.resolveRoutine(await reload(c.id), "t-stat", at(0));
    expect(res.ok).toBe(true);
    expect((await reload(c.id)).intelligence).toBe(2);
    expect(await heldTraitIds(c.id)).not.toContain("freedman");
  });
});
