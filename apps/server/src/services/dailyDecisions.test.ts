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
  const composure = await import("./composure.js");
  const traits = await import("./traits.js");
  const engine = await import("./eventEngine.js");
  const shared = await import("@massalia/shared");
  return { dbPkg, daily, age, composure, traits, engine, shared };
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

// Composure fixtures. A default must charge composure exactly as a live resolve:
// the explicit change_composure layer, the held-trait tag layer, and a break.
const TOLL = -8;
const TOLL_DEFAULT = {
  id: "fx-toll-default",
  weight: 10,
  scene: "A hard errand nobody else will run.",
  defaultChoiceId: "endure",
  choices: [
    { id: "endure", label: "Endure it", effects: [{ type: "change_composure" as const, amount: TOLL }], resultText: "Endured." },
    { id: "shirk", label: "Shirk", effects: [], resultText: "Shirked." },
  ],
};
// "feast" is opposed by the temperate personality trait (content/traits/traits.json).
const FEAST_DEFAULT = {
  id: "fx-feast-default",
  weight: 10,
  scene: "The symposium runs late.",
  defaultChoiceId: "feast",
  choices: [
    { id: "feast", label: "Stay and feast", effects: [], resultText: "Feasted.", tags: ["feast"] },
    { id: "leave", label: "Leave early", effects: [], resultText: "Left." },
  ],
};
const RUIN_DEFAULT = {
  id: "fx-ruin-default",
  weight: 10,
  scene: "The news arrives all at once.",
  defaultChoiceId: "collapse",
  choices: [
    { id: "collapse", label: "Take it all in", effects: [{ type: "change_composure" as const, amount: -100 }], resultText: "Undone." },
    { id: "deny", label: "Deny it", effects: [], resultText: "Denied." },
  ],
};

// A dated card (content `date`): dealt into a councilor's set during Summer
// 300 BC, once per character, never drawn. The take pays DATED_PAY.
const DATED_PAY = 50;
const DATED = {
  id: "dated-test",
  weight: 0,
  trigger: "calendar",
  date: { yearBC: 300, season: 3 },
  requires: { office: "councilor" as const },
  scene: "The convoy is in.",
  defaultChoiceId: "take",
  choices: [{ id: "take", label: "Take your share", effects: [{ type: "change_drachmae" as const, amount: DATED_PAY }], resultText: "Taken." }],
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
  const historyCount = async (characterId: string) =>
    (await db.select({ id: m.dbPkg.eventHistory.id }).from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, characterId))).length;
  const charRow = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  const composureLogRows = async (characterId: string) =>
    db.select().from(m.dbPkg.composureLog).where(eq(m.dbPkg.composureLog.characterId, characterId));
  const heldTraitIds = async (characterId: string) => (await m.traits.getHeldTraits(characterId)).map((t) => t.id).sort();
  const historyRows = async (characterId: string, eventId: string) =>
    db
      .select()
      .from(m.dbPkg.eventHistory)
      .where(and(eq(m.dbPkg.eventHistory.characterId, characterId), eq(m.dbPkg.eventHistory.eventId, eventId)));

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig(); // applyChoiceEffects' stat path reads it
    await m.traits.loadTraitDefs(); // held-trait tag reactions + coping grants
    await m.composure.loadComposureConfig();
    pool = m.shared.parseEventFile([WITH_DEFAULT, NO_DEFAULT, TOLL_DEFAULT, FEAST_DEFAULT, RUIN_DEFAULT, DATED]);

    await db.execute(sql`
      TRUNCATE TABLE daily_decisions, event_history, effect_log, composure_log, character_traits,
        player_characters, dynasties, players, sessions, users, worlds CASCADE
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
    // is drawn from the OTHER fixtures, never a re-draw of the one just settled.
    const general = set.find((row) => row.arena === "general");
    expect(general).toBeDefined();
    expect(general!.eventId).not.toBe(WITH_DEFAULT.id);
    expect(pool.map((e) => e.id)).toContain(general!.eventId);
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
    // And drawing today's set wrote no history — an event is "seen" only when
    // resolved, so neither the lapsed card nor today's fresh card counts yet.
    expect(await historyCount(c.id)).toBe(0);
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
    // "pay" carries no tags and no change_composure: composure is untouched (0).
    expect(applied).toEqual([{ cardId: stale.id, eventId: WITH_DEFAULT.id, choiceId: "pay", composureDelta: 0 }]);

    const orphanAfter = await card(orphan.id);
    expect(orphanAfter.resolved).toBe(false);
    expect(orphanAfter.resolvedByDefault).toBe(false);
    expect(await drachmaeOf(c.id)).toBe(500 + PAY);
  });

  it("(e) an explicit change_composure default moves composure by exactly that amount, with the preview's reason", async () => {
    const c = await createCharacter("Karteros", 500);
    const stale = await insertCard(c.id, yesterday, TOLL_DEFAULT.id);
    // Recovery is idempotent, so reading it here fixes the pre-default baseline
    // without changing what the service is about to do.
    const recovered = await m.composure.recoverComposure(c.id, now);

    const applied = await m.daily.applyExpiredDefaults(c.id, now, pool);
    expect(applied).toEqual([{ cardId: stale.id, eventId: TOLL_DEFAULT.id, choiceId: "endure", composureDelta: TOLL }]);

    const after = await charRow(c.id);
    expect(after.composure).toBe(recovered + TOLL);
    expect(after.breakUntil).toBeNull();
    const log = await composureLogRows(c.id);
    expect(log.map((row) => ({ delta: row.delta, reason: row.reason }))).toEqual([{ delta: TOLL, reason: "the toll of the act itself" }]);
    expect((await card(stale.id)).resolvedByDefault).toBe(true);
  });

  it("(f) a default whose tags conflict with a held trait pays the trait layer — the same numbers a live resolve pays", async () => {
    const cfg = m.composure.getComposureConfig();
    const choice = pool.find((e) => e.id === FEAST_DEFAULT.id)!.choices.find((ch) => ch.id === "feast")!;

    // Two identical temperate characters: one lets the card lapse, one resolves it.
    const lapsed = await createCharacter("Sophron", 500);
    const live = await createCharacter("Sophron-live", 500);
    for (const id of [lapsed.id, live.id]) await db.insert(m.dbPkg.characterTraits).values({ characterId: id, traitId: "temperate" });

    // The route's own numbers for this choice against these traits (no spouse).
    const held = await m.traits.getHeldTraits(lapsed.id);
    const preview = m.composure.composurePreview(choice, held, cfg, []);
    expect(preview.delta).toBe(-cfg.costPerConflict); // the conflict really engaged
    expect(preview.reason).toMatch(/troubles your .*Temperate/i);

    // Lazy default.
    const stale = await insertCard(lapsed.id, yesterday, FEAST_DEFAULT.id);
    const lapsedBefore = await m.composure.recoverComposure(lapsed.id, now);
    const applied = await m.daily.applyExpiredDefaults(lapsed.id, now, pool);
    expect(applied[0]!.composureDelta).toBe(preview.delta);

    // Live resolve: the resolve route's sequence for the same choice.
    const liveCard = await insertCard(live.id, today, FEAST_DEFAULT.id);
    const liveBefore = await m.composure.recoverComposure(live.id, now);
    const livePreview = m.composure.composurePreview(choice, await m.traits.getHeldTraits(live.id), cfg, []);
    await m.composure.applyComposureDelta(live.id, livePreview.delta, livePreview.reason, now);
    await m.engine.applyChoiceEffects(live.id, FEAST_DEFAULT.id, choice);
    await m.daily.markCardResolved(liveCard.id, "feast");

    expect(lapsedBefore).toBe(liveBefore);
    const lapsedAfter = await charRow(lapsed.id);
    const liveAfter = await charRow(live.id);
    expect(lapsedAfter.composure).toBe(lapsedBefore + preview.delta);
    expect(lapsedAfter.composure).toBe(liveAfter.composure);
    const strip = (rows: { delta: number; reason: string }[]) => rows.map((r) => ({ delta: r.delta, reason: r.reason }));
    expect(strip(await composureLogRows(lapsed.id))).toEqual(strip(await composureLogRows(live.id)));
    expect((await card(stale.id))).toMatchObject({ resolved: true, resolvedChoiceId: "feast", resolvedByDefault: true });
    expect((await card(liveCard.id))).toMatchObject({ resolved: true, resolvedChoiceId: "feast", resolvedByDefault: false });
  });

  it("(g) a default that drives composure to 0 breaks the character like a live resolve; the card is still resolved by default", async () => {
    const cfg = m.composure.getComposureConfig();
    const c = await createCharacter("Rhegnymenos", 500);
    const stale = await insertCard(c.id, yesterday, RUIN_DEFAULT.id);
    expect(await heldTraitIds(c.id)).toEqual([]);

    const applied = await m.daily.applyExpiredDefaults(c.id, now, pool);
    expect(applied).toEqual([{ cardId: stale.id, eventId: RUIN_DEFAULT.id, choiceId: "collapse", composureDelta: -100 }]);

    const after = await charRow(c.id);
    expect(after.composure).toBe(cfg.breakResetValue);
    expect(after.breaksCount).toBe(1);
    expect(after.breakUntil).not.toBeNull();
    expect(after.breakUntil!.getTime()).toBeGreaterThan(now.getTime());
    expect(m.shared.isWithdrawn(after.breakUntil, now)).toBe(true);
    // One coping trait from the configured pool was granted by the break.
    const held = await heldTraitIds(c.id);
    expect(held.length).toBe(1);
    expect(cfg.copingPool).toContain(held[0]);
    // Two log rows, exactly as a live break: the clamped hit, then the break reset.
    const log = await composureLogRows(c.id);
    expect(log.length).toBe(2);
    expect(log.some((row) => row.reason.startsWith("break"))).toBe(true);

    expect(await card(stale.id)).toMatchObject({ resolved: true, resolvedChoiceId: "collapse", resolvedByDefault: true });
    expect((await historyRows(c.id, RUIN_DEFAULT.id)).length).toBe(1);
  });

  // --- Dated cards ---------------------------------------------------------
  // The season is picked through startedMs: the world clock, not the fixture,
  // decides whether DATED (Summer 300 BC, season index 2) is due.
  const councilor = { ...ctx, isCouncilor: true };
  const HOUR = 3_600_000;
  const summer300 = now.getTime() - 2 * DAY - 10 * 60 * 1000;
  const spring300 = now.getTime() - DAY - 10 * 60 * 1000;
  const datedRows = <T extends { arena: string }>(rows: T[]) => rows.filter((row) => row.arena === "dated");

  it("(h) a councilor's set in Summer 300 holds the dated card beside the arena cards; a non-councilor's and a Spring set do not", async () => {
    expect(m.shared.gameDate(now.getTime(), summer300).seasonIndex).toBe(2);
    expect(m.shared.gameDate(now.getTime(), spring300).seasonIndex).toBe(1);

    const seated = await createCharacter("Bouleutes", 500);
    const set = await m.daily.ensureDailySet(seated.id, councilor, now, summer300, pool);
    expect(datedRows(set).map((row) => row.eventId)).toEqual([DATED.id]);
    expect(datedRows(set)[0]).toMatchObject({ utcDay: today, resolved: false, resolvedByDefault: false });
    // Beside, not instead of, the arena draws.
    expect(set.some((row) => row.arena === "general")).toBe(true);
    // Dealing pays nothing and writes no history: the card is paid at resolve.
    expect(await drachmaeOf(seated.id)).toBe(500);
    expect(await historyCount(seated.id)).toBe(0);

    const unseated = await createCharacter("Idiotes", 500);
    const plain = await m.daily.ensureDailySet(unseated.id, ctx, now, summer300, pool);
    expect(datedRows(plain)).toEqual([]);
    expect(plain.some((row) => row.arena === "general")).toBe(true);

    const early = await createCharacter("Earinos", 500);
    const spring = await m.daily.ensureDailySet(early.id, councilor, now, spring300, pool);
    expect(datedRows(spring)).toEqual([]);
  });

  it("(i) a second load the same day deals nothing new; a set generated before the seat gains the card at the next load", async () => {
    const seated = await createCharacter("Deuteros-bouleutes", 500);
    const first = await m.daily.ensureDailySet(seated.id, councilor, now, summer300, pool);
    const second = await m.daily.ensureDailySet(seated.id, councilor, now, summer300, pool);
    expect(second.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
    expect(datedRows(second)).toHaveLength(1);
    expect(await m.daily.dealDatedCards(seated.id, councilor, now, summer300, pool)).toBe(0);

    // The noon seat / mid-day deploy: today's set already exists from a load
    // that was not eligible; the next eligible load adds the dated card only.
    const late = await createCharacter("Mesembrinos", 500);
    const before = await m.daily.ensureDailySet(late.id, ctx, now, summer300, pool);
    expect(datedRows(before)).toEqual([]);
    const after = await m.daily.ensureDailySet(late.id, councilor, now, summer300, pool);
    expect(datedRows(after).map((row) => row.eventId)).toEqual([DATED.id]);
    expect(after.length).toBe(before.length + 1);
    for (const row of before) expect(after.map((r) => r.id)).toContain(row.id);
  });

  it("(j) straddling season: a dated card dealt on the season's first UTC day is not dealt again on its second", async () => {
    // Summer 300 began six hours ago — before midnight on an early-morning run,
    // i.e. yesterday's UTC day; the once-ever guard must look past today.
    const straddle = now.getTime() - 2 * DAY - 6 * HOUR;
    expect(m.shared.gameDate(now.getTime(), straddle).seasonIndex).toBe(2);

    const seated = await createCharacter("Amphiemeros", 500);
    const dealtYesterday = await insertCard(seated.id, yesterday, DATED.id, "dated");
    const set = await m.daily.ensureDailySet(seated.id, councilor, now, straddle, pool);
    expect(datedRows(set)).toEqual([]);
    expect(await m.daily.dealDatedCards(seated.id, councilor, now, straddle, pool)).toBe(0);
    // Yesterday's card was settled to its default at today's first access, as
    // any other lapsed card — paid once, and never re-dealt.
    expect(await card(dealtYesterday.id)).toMatchObject({ resolved: true, resolvedChoiceId: "take", resolvedByDefault: true });
    expect(await drachmaeOf(seated.id)).toBe(500 + DATED_PAY);
    expect((await historyRows(seated.id, DATED.id)).length).toBe(1);

    // Control: the same clock deals to a councilor without a prior row.
    const fresh = await createCharacter("Neos-bouleutes", 500);
    expect(datedRows(await m.daily.ensureDailySet(fresh.id, councilor, now, straddle, pool))).toHaveLength(1);
  });

  it("(k) resolving the dated card pays once, a second resolve loses the claim, and a lapsed one pays by default", async () => {
    const choice = pool.find((e) => e.id === DATED.id)!.choices.find((ch) => ch.id === "take")!;

    const seated = await createCharacter("Misthotos", 500);
    const set = await m.daily.ensureDailySet(seated.id, councilor, now, summer300, pool);
    const dated = datedRows(set)[0]!;
    const first = await m.daily.resolveDailyCard(dated, choice);
    expect(first).toEqual({ claimed: true, resultText: "Taken." });
    expect(await drachmaeOf(seated.id)).toBe(500 + DATED_PAY);
    expect(await card(dated.id)).toMatchObject({ resolved: true, resolvedChoiceId: "take", resolvedByDefault: false });

    const second = await m.daily.resolveDailyCard(dated, choice);
    expect(second).toEqual({ claimed: false });
    expect(await drachmaeOf(seated.id)).toBe(500 + DATED_PAY);
    expect((await historyRows(seated.id, DATED.id)).length).toBe(1);

    // Left unresolved: the next day's first access settles it to "take".
    const lapsed = await createCharacter("Ameles-bouleutes", 500);
    const stale = await insertCard(lapsed.id, yesterday, DATED.id, "dated");
    const applied = await m.daily.applyExpiredDefaults(lapsed.id, now, pool);
    expect(applied).toEqual([{ cardId: stale.id, eventId: DATED.id, choiceId: "take", composureDelta: 0 }]);
    expect(await drachmaeOf(lapsed.id)).toBe(500 + DATED_PAY);
    expect(await card(stale.id)).toMatchObject({ resolved: true, resolvedChoiceId: "take", resolvedByDefault: true });
  });
});
