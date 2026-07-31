import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// applyEffectsInTx (the extracted effect loop) + applyChoiceEffects (the public
// wrapper), against a REAL Postgres guarded to a *_test database. See
// philia.test.ts / oligarchy.test.ts for the recipe. Acceptance bar for the
// Phase-3 extraction: the helper applies effects inside a CALLER-OWNED tx, writes
// NO event_history, reports ideologyTouched honestly; the wrapper is unchanged and
// still writes exactly one event_history row.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const age = await import("./age.js");
  const engine = await import("./eventEngine.js");
  const shared = await import("@massalia/shared");
  return { dbPkg, age, engine, shared };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

// A hand-built cityDef map (the executor's ensure-on-read default), so a
// change_city_stat effect can run without booting the cities-content loader.
const CITY_DEF = new Map([["test-city", { population: 1000, tax: 10, stability: 50, fortifications: 2, garrison: 20 }]]);

suite("applyEffectsInTx + applyChoiceEffects (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  async function createCharacter(name: string, opts: { prestige?: number; drachmae?: number; ideology?: number } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    return (
      await db
        .insert(playerCharacters)
        .values({
          playerId: player.id,
          worldId,
          houseSlug: "test-house",
          classId: "trader",
          prestige: opts.prestige ?? 0,
          drachmae: opts.drachmae ?? 100,
          ideology: opts.ideology ?? 0,
          startAge: 30,
          deathAge: 90,
        })
        .returning()
    )[0]!;
  }

  const charRow = async (id: string) =>
    (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  const effectLogRows = async (id: string, kind: string) =>
    db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, kind)));
  const eventHistoryCount = async (id: string) =>
    (await db.select({ id: m.dbPkg.eventHistory.id }).from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, id))).length;

  // The exact stat write the executor performs: growth-scaled then age-capped.
  const expectedStat = (base: number, amount: number, growthMultiplier: string) =>
    m.shared.capStat(base + m.shared.applyStatGrowth(amount, Number(growthMultiplier)), m.age.getAgeConfig());

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig(); // change_stat's cap reads getAgeConfig()
    await db.execute(sql`
      TRUNCATE TABLE event_history, effect_log, league_cities, player_characters, dynasties,
        players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Engine Test", seed: "engine-test", startedAt: now, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("applies effects inside a CALLER-OWNED transaction, with effect_log provenance", async () => {
    const before = await createCharacter("Helper", { prestige: 10, drachmae: 100 });
    const eventId = "story:silver:invest"; // synthetic, free-form provenance

    let result: { ideologyTouched: boolean } | null = null;
    await db.transaction(async (tx) => {
      result = await m.engine.applyEffectsInTx(tx, {
        characterId: before.id,
        eventId,
        effects: [
          { type: "change_stat", stat: "prestige", amount: 5 },
          { type: "change_drachmae", amount: -20 },
          // A kind whose effect_log detail records the eventId (stat/drachmae do not).
          { type: "change_city_stat", cityId: "test-city", stat: "stability", amount: 3 },
        ],
        cityDef: CITY_DEF,
        factionDef: null,
      });
    });

    // Deltas — asserted against the same growth+cap computation, not hardcoded.
    const after = await charRow(before.id);
    expect(after.prestige).toBe(expectedStat(before.prestige, 5, before.growthMultiplier));
    expect(after.drachmae).toBe(Math.max(0, before.drachmae - 20));

    // effect_log rows were written in the caller's committed tx.
    expect((await effectLogRows(before.id, "change_stat")).length).toBe(1);
    expect((await effectLogRows(before.id, "change_drachmae")).length).toBe(1);

    // The synthetic eventId flows into provenance (world-effect detail carries it).
    const cityRows = await effectLogRows(before.id, "change_city_stat");
    expect(cityRows.length).toBe(1);
    expect((cityRows[0]!.detail as { eventId?: string }).eventId).toBe(eventId);

    expect(result!.ideologyTouched).toBe(false);
  });

  it("writes NO event_history row (the point of the extraction)", async () => {
    const c = await createCharacter("NoHistory");
    await db.transaction(async (tx) => {
      await m.engine.applyEffectsInTx(tx, {
        characterId: c.id,
        eventId: "story:x:y",
        effects: [{ type: "change_stat", stat: "prestige", amount: 4 }],
        cityDef: null,
        factionDef: null,
      });
    });
    expect(await eventHistoryCount(c.id)).toBe(0);
  });

  it("reports ideologyTouched honestly (false without, true with an acting-character change_ideology)", async () => {
    const noIdeo = await createCharacter("NoIdeo");
    let r1: { ideologyTouched: boolean } | null = null;
    await db.transaction(async (tx) => {
      r1 = await m.engine.applyEffectsInTx(tx, {
        characterId: noIdeo.id,
        eventId: "story:a:b",
        effects: [{ type: "change_drachmae", amount: 5 }],
        cityDef: null,
        factionDef: null,
      });
    });
    expect(r1!.ideologyTouched).toBe(false);

    const ideo = await createCharacter("Ideo", { ideology: 0 });
    let r2: { ideologyTouched: boolean } | null = null;
    await db.transaction(async (tx) => {
      r2 = await m.engine.applyEffectsInTx(tx, {
        characterId: ideo.id,
        eventId: "story:a:c",
        effects: [{ type: "change_ideology", amount: 10 }], // targets the acting character
        cityDef: null,
        factionDef: null,
      });
    });
    expect(r2!.ideologyTouched).toBe(true);
  });

  it("applyChoiceEffects is unchanged: same deltas, and exactly one event_history row", async () => {
    const before = await createCharacter("Wrapper", { prestige: 10, drachmae: 100 });
    const choice = {
      id: "c1",
      label: "Invest",
      resultText: "Done.",
      effects: [
        { type: "change_stat" as const, stat: "prestige" as const, amount: 5 },
        { type: "change_drachmae" as const, amount: -20 },
      ],
    };
    // Free-form (synthetic) eventId — recon confirmed nothing validates it.
    await m.engine.applyChoiceEffects(before.id, "story:phase3:smoke", choice);

    const after = await charRow(before.id);
    expect(after.prestige).toBe(expectedStat(before.prestige, 5, before.growthMultiplier));
    expect(after.drachmae).toBe(Math.max(0, before.drachmae - 20));

    // The insert stayed in the wrapper — exactly one resolution row.
    expect(await eventHistoryCount(before.id)).toBe(1);
  });
});
