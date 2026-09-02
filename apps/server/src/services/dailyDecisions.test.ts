import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { EventDefinition } from "@massalia/shared";

// ---------------------------------------------------------------------------
// Lazy defaults for expired daily cards — against a REAL Postgres, guarded to a
// *_test database (the suite truncates it). Same recipe as oligarchy.test.ts:
//   createdb massalia_test && DATABASE_URL=postgres://postgres:postgres@localhost:5432/massalia_test pnpm db:migrate
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/massalia_test pnpm --filter @massalia/server test
// Without that env (CI, plain `pnpm -r test`) the suite is skipped.
//
// The event pool is INJECTED (fixtures below) so nothing here depends on the
// repo content carrying a defaultChoiceId.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

// Modules that call createDb() at import stay dynamic so the skipped suite
// never demands a DATABASE_URL.
async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const daily = await import("./dailyDecisions.js");
  const age = await import("./age.js");
  const shared = await import("@massalia/shared");
  return { dbPkg, daily, age, shared };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

const DAY = 86_400_000;
const PAY = -20;

// Two general-arena events: one falls back to "pay" when it expires, the other
// has no default and simply lapses.
const WITH_DEFAULT = {
  id: "fx-with-default",
  weight: 10,
  scene: "A creditor waits at the door.",
  defaultChoiceId: "pay",
  choices: [
    { id: "pay", label: "Pay him", effects: [{ type: "change_drachmae" as const, amount: PAY }], resultText: "Paid." },
    { id: "refuse", label: "Refuse", effects: [], resultText: "Refused." },
  ],
};
const NO_DEFAULT = {
  id: "fx-no-default",
  weight: 10,
  scene: "A rumour in the agora.",
  choices: [
    { id: "listen", label: "Listen", effects: [{ type: "change_drachmae" as const, amount: -5 }], resultText: "Heard." },
    { id: "ignore", label: "Ignore", effects: [], resultText: "Ignored." },
  ],
};

suite("daily decisions — lazy default for expired cards (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  let startedMs: number;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  // The parsed fixture pool, exactly as the content loader would hand it over.
  let pool: EventDefinition[];

  const ctx = {
    classId: "trader",
    party: "none",
    isCouncilor: false,
    stats: { prestige: 0, devotion: 0, militia: 0, intelligence: 0 },
    traitIds: [],
    married: false,
    spouseTraitIds: [],
    livingChildren: [],
  };

  async function createCharacter(name: string, drachmae = 500) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    return (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", drachmae, startAge: 30, deathAge: 90 })
        .returning()
    )[0]!;
  }

  // A card as the draw would have left it: unresolved, on the given UTC day.
  async function insertCard(characterId: string, utcDay: string, eventId: string, arena = "general") {
    return (await db.insert(m.dbPkg.dailyDecisions).values({ characterId, utcDay, arena, eventId }).returning())[0]!;
  }
  const card = async (id: string) => (await db.select().from(m.dbPkg.dailyDecisions).where(eq(m.dbPkg.dailyDecisions.id, id)).limit(1))[0]!;
  const drachmaeOf = async (id: string) =>
    (await db.select({ d: m.dbPkg.playerCharacters.drachmae }).from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!.d;
  const effectLogCount = async (characterId: string) =>
    (await db.select({ id: m.dbPkg.effectLog.id }).from(m.dbPkg.effectLog).where(eq(m.dbPkg.effectLog.characterId, characterId))).length;
  const historyRows = async (characterId: string, eventId: string) =>
    db
      .select()
      .from(m.dbPkg.eventHistory)
      .where(and(eq(m.dbPkg.eventHistory.characterId, characterId), eq(m.dbPkg.eventHistory.eventId, eventId)));

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig(); // applyChoiceEffects' stat path reads it
    pool = m.shared.parseEventFile([WITH_DEFAULT, NO_DEFAULT]);

    await db.execute(sql`
      TRUNCATE TABLE daily_decisions, event_history, effect_log, player_characters, dynasties,
        players, sessions, users, worlds CASCADE
    `);
    await db
      .insert(m.dbPkg.houses)
      .values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    // Ten minutes into the world clock: winter day, so the family arena is on the
    // table too — irrelevant here, the fixtures are all general-arena.
    const startedAt = new Date(now.getTime() - 10 * 60 * 1000);
    startedMs = startedAt.getTime();
    const world = (
      await db.insert(m.dbPkg.worlds).values({ name: "Daily Test", seed: "daily-test", startedAt, endsAt: new Date(now.getTime() + 182 * DAY), status: "active" }).returning()
    )[0]!;
    worldId = world.id;
  });

  it("(a) yesterday's unresolved card with a default is settled at the next day's first access", async () => {
    const c = await createCharacter("Opheiletes", 500);
    const stale = await insertCard(c.id, yesterday, WITH_DEFAULT.id);

    const set = await m.daily.ensureDailySet(c.id, ctx, now, startedMs, pool);

    const after = await card(stale.id);
    expect(after.resolved).toBe(true);
    expect(after.resolvedChoiceId).toBe("pay");
    expect(after.resolvedByDefault).toBe(true);
    expect(await drachmaeOf(c.id)).toBe(500 + PAY);
    // applyChoiceEffects wrote the resolution row — exactly one for this event.
    expect((await historyRows(c.id, WITH_DEFAULT.id)).length).toBe(1);

    // The default resolution counted as "recently seen": today's general card
    // is the OTHER fixture, never a re-draw of the one just settled.
    const general = set.find((row) => row.arena === "general");
    expect(general).toBeDefined();
    expect(general!.eventId).toBe(NO_DEFAULT.id);
    expect(general!.utcDay).toBe(today);
    expect(general!.resolvedByDefault).toBe(false);
  });

  it("(b) yesterday's unresolved card WITHOUT a default stays unresolved with no effects", async () => {
    const c = await createCharacter("Amelesteros", 500);
    const stale = await insertCard(c.id, yesterday, NO_DEFAULT.id);

    await m.daily.ensureDailySet(c.id, ctx, now, startedMs, pool);

    const after = await card(stale.id);
    expect(after.resolved).toBe(false);
    expect(after.resolvedChoiceId).toBeNull();
    expect(after.resolvedByDefault).toBe(false);
    expect(await drachmaeOf(c.id)).toBe(500);
    // No choice was applied: nothing in the effect log for this character.
    expect(await effectLogCount(c.id)).toBe(0);
  });

  it("(c) today's unresolved card is untouched — only PAST days are settled", async () => {
    const c = await createCharacter("Semeron", 500);
    const current = await insertCard(c.id, today, WITH_DEFAULT.id);

    // Direct call: today's set already exists, so this is the path that would
    // have to misfire for a live card to be settled early.
    expect(await m.daily.applyExpiredDefaults(c.id, now, pool)).toEqual([]);
    // And through the entry point (today's set exists → nothing is generated).
    await m.daily.ensureDailySet(c.id, ctx, now, startedMs, pool);

    const after = await card(current.id);
    expect(after.resolved).toBe(false);
    expect(after.resolvedByDefault).toBe(false);
    expect(await drachmaeOf(c.id)).toBe(500);
    expect(await effectLogCount(c.id)).toBe(0);
    expect((await historyRows(c.id, WITH_DEFAULT.id)).length).toBe(0);
  });

  it("(d) a second access the same day applies nothing (idempotent)", async () => {
    const c = await createCharacter("Deuteros", 500);
    const stale = await insertCard(c.id, yesterday, WITH_DEFAULT.id);

    const first = await m.daily.ensureDailySet(c.id, ctx, now, startedMs, pool);
    expect(await drachmaeOf(c.id)).toBe(500 + PAY);

    const second = await m.daily.ensureDailySet(c.id, ctx, now, startedMs, pool);
    expect(second.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
    expect(await m.daily.applyExpiredDefaults(c.id, now, pool)).toEqual([]);

    // Charged once, recorded once, still resolved to the same default.
    expect(await drachmaeOf(c.id)).toBe(500 + PAY);
    expect((await historyRows(c.id, WITH_DEFAULT.id)).length).toBe(1);
    const after = await card(stale.id);
    expect(after.resolved).toBe(true);
    expect(after.resolvedChoiceId).toBe("pay");
    expect(after.resolvedByDefault).toBe(true);
  });

  it("returns the applied list, and skips (with a warning) a card whose event no longer exists", async () => {
    const c = await createCharacter("Palaios", 500);
    const stale = await insertCard(c.id, yesterday, WITH_DEFAULT.id, "general");
    const orphan = await insertCard(c.id, yesterday, "fx-removed-from-content", "class");

    const applied = await m.daily.applyExpiredDefaults(c.id, now, pool);
    expect(applied).toEqual([{ cardId: stale.id, eventId: WITH_DEFAULT.id, choiceId: "pay" }]);

    const orphanAfter = await card(orphan.id);
    expect(orphanAfter.resolved).toBe(false);
    expect(orphanAfter.resolvedByDefault).toBe(false);
    expect(await drachmaeOf(c.id)).toBe(500 + PAY);
  });
});
