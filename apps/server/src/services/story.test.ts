import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The story play service (Phase 4) against a REAL Postgres guarded to a *_test
// database. Covers start/resume, both reward layers, the completed-replay no-op,
// branch independence, the zero-event_history pollution guarantee, and the
// TraitRuleError swallow — all through the existing effect machinery.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const age = await import("./age.js");
  const composure = await import("./composure.js");
  const traits = await import("./traits.js");
  const story = await import("./story.js");
  const shared = await import("@massalia/shared");
  return { dbPkg, age, composure, traits, story, shared };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

// The fixture story (parsed through parseStoryTree at insert time to guarantee shape).
const STORY = {
  title: "The Assay",
  start: "S1",
  nodes: [
    {
      type: "scene",
      id: "S1",
      body: { paragraphs: ["A rumor of tampered silver reaches you."] },
      choices: [
        { id: "c1", text: "investigate", next: "S2", rewards: [{ type: "change_stat", stat: "intelligence", amount: 1 }] },
        { id: "c2", text: "walk away", next: "TEXIT" },
      ],
    },
    {
      type: "scene",
      id: "S2",
      body: { paragraphs: ["The assayer's ledger is damning."] },
      choices: [{ id: "finish", text: "expose him", next: "TEND", rewards: [{ type: "change_stat", stat: "devotion", amount: 1 }] }],
    },
    { type: "terminal", id: "TEXIT", body: { paragraphs: ["You pocket a quiet bribe."] }, rewards: [{ type: "change_drachmae", amount: 10 }] },
    {
      type: "terminal",
      id: "TEND",
      body: { paragraphs: ["The forger is undone; your name is spoken well."] },
      rewards: [
        { type: "change_drachmae", amount: 50 },
        { type: "change_trait", traitId: "brave", operation: "add" }, // real personality trait (content/traits/traits.json)
        { type: "change_composure", amount: -5 },
      ],
    },
  ],
};

// A variant whose terminal grants an UNKNOWN trait id — exercises the swallow.
const BAD_TRAIT_STORY = {
  title: "Bad Grant",
  start: "B1",
  nodes: [
    { type: "scene", id: "B1", body: { paragraphs: ["A dubious honor is offered."] }, choices: [{ id: "go", text: "accept", next: "BEND" }] },
    {
      type: "terminal",
      id: "BEND",
      body: { paragraphs: ["The honor is hollow."] },
      rewards: [
        { type: "change_drachmae", amount: 25 },
        { type: "change_trait", traitId: "definitely-not-a-real-trait", operation: "add" },
      ],
    },
  ],
};

// A reward-free path: a scene whose only choice grants nothing → a terminal that
// grants nothing. Exercises the empty rewardsGranted summary.
const PLAIN_STORY = {
  title: "Nothing Gained",
  start: "N1",
  nodes: [
    { type: "scene", id: "N1", body: { paragraphs: ["A quiet errand."] }, choices: [{ id: "step", text: "Move on", next: "NEND" }] },
    { type: "terminal", id: "NEND", body: { paragraphs: ["It comes to nothing."] }, rewards: [] },
  ],
};

suite("story play service (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  async function createCharacter(name: string) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    return (await db.insert(playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", startAge: 30, deathAge: 90 }).returning())[0]!;
  }

  const charRow = async (id: string) =>
    (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  const progRow = async (charId: string, storyId: string) =>
    (await db.select().from(m.dbPkg.storyProgress).where(and(eq(m.dbPkg.storyProgress.characterId, charId), eq(m.dbPkg.storyProgress.storyId, storyId))).limit(1))[0]!;
  const progressCount = async (charId: string, storyId: string) =>
    (await db.select({ id: m.dbPkg.storyProgress.id }).from(m.dbPkg.storyProgress).where(and(eq(m.dbPkg.storyProgress.characterId, charId), eq(m.dbPkg.storyProgress.storyId, storyId)))).length;
  const effectLogCount = async (id: string) =>
    (await db.select({ id: m.dbPkg.effectLog.id }).from(m.dbPkg.effectLog).where(eq(m.dbPkg.effectLog.characterId, id))).length;
  const effectLogCountByKind = async (id: string, kind: string) =>
    (await db.select({ id: m.dbPkg.effectLog.id }).from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, kind)))).length;
  const composureLogCount = async (id: string) =>
    (await db.select({ id: m.dbPkg.composureLog.id }).from(m.dbPkg.composureLog).where(eq(m.dbPkg.composureLog.characterId, id))).length;
  const traitCount = async (id: string) =>
    (await db.select({ id: m.dbPkg.characterTraits.id }).from(m.dbPkg.characterTraits).where(eq(m.dbPkg.characterTraits.characterId, id))).length;
  const hasTrait = async (id: string, traitId: string) =>
    (await db.select({ id: m.dbPkg.characterTraits.id }).from(m.dbPkg.characterTraits).where(and(eq(m.dbPkg.characterTraits.characterId, id), eq(m.dbPkg.characterTraits.traitId, traitId)))).length > 0;
  const eventHistoryCount = async (id: string) =>
    (await db.select({ id: m.dbPkg.eventHistory.id }).from(m.dbPkg.eventHistory).where(eq(m.dbPkg.eventHistory.characterId, id))).length;

  // --- availableStories fixtures (festival eligibility) ---------------------
  // Registry keyed to the already-seeded "test-story"; a second variant points at
  // an UNSEEDED id so the "no stories row" case has a trigger with no content.
  const REG = { "test-story": { kind: "festival" as const, festivalId: "fest-test" } };
  const REG_UNSEEDED = { "no-such-story": { kind: "festival" as const, festivalId: "fest-test" } };

  const attend = async (charId: string, festivalId: string, gameYear: number, opts: { resolved?: boolean; resolvedChoiceId?: string } = {}) =>
    db.insert(m.dbPkg.festivalEvents).values({
      characterId: charId,
      festivalId,
      eventId: festivalId,
      gameYear,
      resolved: opts.resolved ?? false,
      resolvedChoiceId: opts.resolvedChoiceId ?? null,
    });
  // The once-per-instance close guard (winner may be null — a winnerless close).
  const closeInstance = async (festivalId: string, gameYear: number, winner: string | null = null) =>
    db.insert(m.dbPkg.festivalChoregos).values({ festivalId, gameYear, winnerCharacterId: winner });

  const expectedStat = (base: number, amount: number, growthMultiplier: string) =>
    m.shared.capStat(base + m.shared.applyStatGrowth(amount, Number(growthMultiplier)), m.age.getAgeConfig());

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.age.loadAgeConfig(); // change_stat cap
    await m.composure.loadComposureConfig(); // applyComposureDelta
    await m.traits.loadTraitDefs(); // applyChangeTrait
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE event_history, effect_log, composure_log, character_traits, story_progress, stories,
        festival_choregos, festival_events,
        player_characters, dynasties, players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Story Test", seed: "story-test", startedAt: now, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active" }).returning())[0]!;
    worldId = world.id;
    await db.insert(m.dbPkg.stories).values({ id: "test-story", tree: m.shared.parseStoryTree(STORY) as unknown as Record<string, unknown> });
    await db.insert(m.dbPkg.stories).values({ id: "bad-trait-story", tree: m.shared.parseStoryTree(BAD_TRAIT_STORY) as unknown as Record<string, unknown> });
    await db.insert(m.dbPkg.stories).values({ id: "plain-story", tree: m.shared.parseStoryTree(PLAIN_STORY) as unknown as Record<string, unknown> });
  });

  it("1. start + resume: creates exactly one active row at S1; re-calling resumes it", async () => {
    const c = await createCharacter("Starter");
    const first = await m.story.getOrStartStory(c.id, "test-story");
    expect(first.status).toBe("active");
    expect(first.node.id).toBe("S1");
    expect(await progressCount(c.id, "test-story")).toBe(1);

    const again = await m.story.getOrStartStory(c.id, "test-story");
    expect(again.node.id).toBe("S1");
    expect(again.status).toBe("active");
    expect(await progressCount(c.id, "test-story")).toBe(1); // no duplicate
  });

  it("2. pass-through grant: S1→c1 applies the choice reward and advances to S2 (still active)", async () => {
    const c = await createCharacter("Investigator");
    await m.story.getOrStartStory(c.id, "test-story");
    const before = await charRow(c.id);

    const res = await m.story.advanceStory(c.id, "test-story", "c1");

    const after = await charRow(c.id);
    expect(after.intelligence).toBe(expectedStat(before.intelligence, 1, before.growthMultiplier));
    expect(await effectLogCountByKind(c.id, "change_stat")).toBe(1);
    const prog = await progRow(c.id, "test-story");
    expect(prog.currentNode).toBe("S2");
    expect(prog.status).toBe("active");
    expect(res.completed).toBe(false);
    expect(res.node.id).toBe("S2");
    expect(res.resultText).toBeNull(); // c1 declares no `result`
  });

  it("3. terminal completion: both reward layers, trait, composure, and status flip", async () => {
    const c = await createCharacter("Finisher");
    await m.story.getOrStartStory(c.id, "test-story");
    await m.story.advanceStory(c.id, "test-story", "c1"); // → S2, intelligence +1
    const before = await charRow(c.id);

    const res = await m.story.advanceStory(c.id, "test-story", "finish");

    const after = await charRow(c.id);
    expect(after.devotion).toBe(expectedStat(before.devotion, 1, before.growthMultiplier)); // choice layer
    expect(after.drachmae).toBe(before.drachmae + 50); // terminal layer
    expect(await hasTrait(c.id, "brave")).toBe(true); // terminal trait
    expect(after.composure).toBe(before.composure - 5); // terminal composure
    expect(await composureLogCount(c.id)).toBe(1);

    const prog = await progRow(c.id, "test-story");
    expect(prog.status).toBe("completed");
    expect(prog.completedAt).not.toBeNull();
    expect(prog.currentNode).toBe("TEND");
    expect(res.completed).toBe(true);
    expect(res.node.id).toBe("TEND");
  });

  it("4. money test: advancing after completion is a total no-op", async () => {
    const c = await createCharacter("Replayer");
    await m.story.getOrStartStory(c.id, "test-story");
    await m.story.advanceStory(c.id, "test-story", "c1");
    await m.story.advanceStory(c.id, "test-story", "finish"); // completed at TEND

    const b = await charRow(c.id);
    const before = {
      intelligence: b.intelligence,
      devotion: b.devotion,
      drachmae: b.drachmae,
      composure: b.composure,
      traits: await traitCount(c.id),
      effectLog: await effectLogCount(c.id),
      composureLog: await composureLogCount(c.id),
    };

    const res = await m.story.advanceStory(c.id, "test-story", "finish"); // valid-looking choiceId
    expect(res.completed).toBe(true);
    expect(res.rewardsGranted).toEqual([]); // completed-replay no-op summarizes nothing

    const a = await charRow(c.id);
    const after = {
      intelligence: a.intelligence,
      devotion: a.devotion,
      drachmae: a.drachmae,
      composure: a.composure,
      traits: await traitCount(c.id),
      effectLog: await effectLogCount(c.id),
      composureLog: await composureLogCount(c.id),
    };

    console.log("MONEY_TEST before=" + JSON.stringify(before) + " after=" + JSON.stringify(after));
    expect(after).toEqual(before);
  });

  it("5. unknown choice on an active story throws, mutating nothing", async () => {
    const c = await createCharacter("Confused");
    await m.story.getOrStartStory(c.id, "test-story");
    const beforeEffects = await effectLogCount(c.id);

    let caught: unknown;
    try {
      await m.story.advanceStory(c.id, "test-story", "no-such-choice");
    } catch (e) {
      caught = e;
    }
    expect((caught as { reason?: string }).reason).toBe("unknown_choice");

    const prog = await progRow(c.id, "test-story");
    expect(prog.currentNode).toBe("S1");
    expect(prog.status).toBe("active");
    expect(await effectLogCount(c.id)).toBe(beforeEffects); // zero new rows
  });

  it("6. early-exit branch: S1→c2 completes at TEXIT with +10 drachmae, no intelligence change", async () => {
    const c = await createCharacter("Exiter");
    await m.story.getOrStartStory(c.id, "test-story");
    const before = await charRow(c.id);

    const res = await m.story.advanceStory(c.id, "test-story", "c2");

    const after = await charRow(c.id);
    expect(after.drachmae).toBe(before.drachmae + 10);
    expect(after.intelligence).toBe(before.intelligence); // branch independence
    const prog = await progRow(c.id, "test-story");
    expect(prog.status).toBe("completed");
    expect(prog.currentNode).toBe("TEXIT");
    expect(res.completed).toBe(true);
    expect(res.node.id).toBe("TEXIT");
  });

  it("7. zero event_history end-to-end (the pollution guarantee)", async () => {
    const a = await createCharacter("FullPath");
    await m.story.getOrStartStory(a.id, "test-story");
    await m.story.advanceStory(a.id, "test-story", "c1");
    await m.story.advanceStory(a.id, "test-story", "finish");

    const b = await createCharacter("ExitPath");
    await m.story.getOrStartStory(b.id, "test-story");
    await m.story.advanceStory(b.id, "test-story", "c2");

    expect(await eventHistoryCount(a.id)).toBe(0);
    expect(await eventHistoryCount(b.id)).toBe(0);
  });

  it("8. trait swallow: an unknown terminal trait id still completes, grants drachmae, no trait row", async () => {
    const c = await createCharacter("Swallow");
    await m.story.getOrStartStory(c.id, "bad-trait-story");
    const before = await charRow(c.id);

    const res = await m.story.advanceStory(c.id, "bad-trait-story", "go");

    expect(res.completed).toBe(true);
    expect(await traitCount(c.id)).toBe(0); // TraitRuleError swallowed
    const after = await charRow(c.id);
    expect(after.drachmae).toBe(before.drachmae + 25); // drachmae still granted
  });

  it("9. never-started: advanceStory with no progress row throws not_started", async () => {
    const c = await createCharacter("Ghost");
    let caught: unknown;
    try {
      await m.story.advanceStory(c.id, "test-story", "c1");
    } catch (e) {
      caught = e;
    }
    expect((caught as { reason?: string }).reason).toBe("not_started");
  });

  // --- availableStories (festival-gated eligibility) ------------------------

  it("10. attended + instance closed + seeded + no progress → offered", async () => {
    const c = await createCharacter("Eligible");
    await attend(c.id, "fest-test", 1);
    await closeInstance("fest-test", 1);
    expect(await m.story.availableStories(c.id, REG)).toEqual([{ storyId: "test-story", status: "offered" }]);
  });

  it("11. newcomer (no festival_events row) → [], even with the instance closed and story seeded", async () => {
    const c = await createCharacter("Newcomer");
    await closeInstance("fest-test", 1); // instance closed globally, but this char never attended
    expect(await m.story.availableStories(c.id, REG)).toEqual([]);
  });

  it("12. attended but instance still open (no festival_choregos) → []", async () => {
    const c = await createCharacter("Waiting");
    await attend(c.id, "fest-test", 1); // no close row
    expect(await m.story.availableStories(c.id, REG)).toEqual([]);
  });

  it("13. auto-resolved attendance (resolved 'attend') still qualifies", async () => {
    const c = await createCharacter("Offline");
    await attend(c.id, "fest-test", 1, { resolved: true, resolvedChoiceId: "attend" });
    await closeInstance("fest-test", 1, null); // winnerless close
    expect(await m.story.availableStories(c.id, REG)).toEqual([{ storyId: "test-story", status: "offered" }]);
  });

  it("14. active progress row → active (short-circuits, needs no festival rows)", async () => {
    const c = await createCharacter("InFlight");
    await m.story.getOrStartStory(c.id, "test-story"); // active progress, no attendance
    expect(await m.story.availableStories(c.id, REG)).toEqual([{ storyId: "test-story", status: "active" }]);
  });

  it("15. completed progress row → [] (omitted even when otherwise eligible)", async () => {
    const c = await createCharacter("Done");
    await attend(c.id, "fest-test", 1);
    await closeInstance("fest-test", 1);
    await db.insert(m.dbPkg.storyProgress).values({ characterId: c.id, storyId: "test-story", status: "completed", currentNode: "TEND", completedAt: now });
    expect(await m.story.availableStories(c.id, REG)).toEqual([]);
  });

  it("16. trigger satisfied but no stories row → [] (the pre-seed prod situation)", async () => {
    const c = await createCharacter("PreSeed");
    await attend(c.id, "fest-test", 1);
    await closeInstance("fest-test", 1);
    expect(await m.story.availableStories(c.id, REG_UNSEEDED)).toEqual([]);
  });

  it("17. prior-year attendance still qualifies (offer persists across years)", async () => {
    const c = await createCharacter("Veteran");
    await attend(c.id, "fest-test", 5); // a past game year; the check has no current-year filter
    await closeInstance("fest-test", 5);
    expect(await m.story.availableStories(c.id, REG)).toEqual([{ storyId: "test-story", status: "offered" }]);
  });

  // --- startStory (gated start) ---------------------------------------------

  it("18. eligible character starts: a row is created at tree.start", async () => {
    const c = await createCharacter("Eligible2");
    await attend(c.id, "fest-test", 1);
    await closeInstance("fest-test", 1);
    const state = await m.story.startStory(c.id, "test-story", REG);
    expect(state.status).toBe("active");
    expect(state.node.id).toBe("S1");
    expect(await progressCount(c.id, "test-story")).toBe(1);
  });

  it("19. ineligible character (no attendance) throws not_eligible and writes nothing", async () => {
    const c = await createCharacter("Ineligible");
    let caught: unknown;
    try {
      await m.story.startStory(c.id, "test-story", REG);
    } catch (e) {
      caught = e;
    }
    expect((caught as { reason?: string }).reason).toBe("not_eligible");
    expect((caught as { statusCode?: number }).statusCode).toBe(403);
    expect(await progressCount(c.id, "test-story")).toBe(0); // nothing written
  });

  it("20. active row resumes via startStory (same row, same node)", async () => {
    const c = await createCharacter("Resumer");
    await attend(c.id, "fest-test", 1);
    await closeInstance("fest-test", 1);
    const first = await m.story.startStory(c.id, "test-story", REG);
    await m.story.advanceStory(c.id, "test-story", "c1"); // move to S2
    const again = await m.story.startStory(c.id, "test-story", REG); // resume, not restart
    expect(again.status).toBe("active");
    expect(again.node.id).toBe("S2");
    expect(first.node.id).toBe("S1");
    expect(await progressCount(c.id, "test-story")).toBe(1); // no duplicate
  });

  it("21. completed row returns the completed projection via startStory (no error, no grant)", async () => {
    const c = await createCharacter("Completer");
    await attend(c.id, "fest-test", 1);
    await closeInstance("fest-test", 1);
    await m.story.startStory(c.id, "test-story", REG);
    await m.story.advanceStory(c.id, "test-story", "c1");
    await m.story.advanceStory(c.id, "test-story", "finish"); // completes at TEND

    const before = { drachmae: (await charRow(c.id)).drachmae, traits: await traitCount(c.id), effectLog: await effectLogCount(c.id) };
    const state = await m.story.startStory(c.id, "test-story", REG); // no error, no re-grant
    expect(state.status).toBe("completed");
    expect(state.node.id).toBe("TEND");
    const after = { drachmae: (await charRow(c.id)).drachmae, traits: await traitCount(c.id), effectLog: await effectLogCount(c.id) };
    expect(after).toEqual(before);
  });

  // --- rewardsGranted (post-grant reward summary) ---------------------------

  it("22. terminal advance summarizes choice-layer then terminal-layer rewards, in order, nominal", async () => {
    const c = await createCharacter("Rewarded");
    await m.story.getOrStartStory(c.id, "test-story");
    await m.story.advanceStory(c.id, "test-story", "c1"); // → S2 (pass-through)
    const res = await m.story.advanceStory(c.id, "test-story", "finish"); // → TEND (terminal)
    expect(res.completed).toBe(true);
    expect(res.rewardsGranted).toEqual([
      { kind: "stat", stat: "devotion", amount: 1 }, // choice layer
      { kind: "drachmae", amount: 50 }, // terminal layer, nominal
      { kind: "trait", traitId: "brave", name: "Brave" }, // resolved display name
      { kind: "composure", amount: -5 }, // negative preserved
    ]);
  });

  it("23. pass-through advance summarizes exactly its choice-layer rewards", async () => {
    const c = await createCharacter("PassThrough");
    await m.story.getOrStartStory(c.id, "test-story");
    const res = await m.story.advanceStory(c.id, "test-story", "c1"); // → S2, choice reward only
    expect(res.completed).toBe(false);
    expect(res.rewardsGranted).toEqual([{ kind: "stat", stat: "intelligence", amount: 1 }]);
  });

  it("24. a reward-free path summarizes []", async () => {
    const c = await createCharacter("Empty");
    await m.story.getOrStartStory(c.id, "plain-story");
    const res = await m.story.advanceStory(c.id, "plain-story", "step"); // choice + terminal both reward-free
    expect(res.completed).toBe(true);
    expect(res.rewardsGranted).toEqual([]);
  });

  it("25. unknown-trait terminal: drachmae summarized, trait entry omitted (the swallow)", async () => {
    const c = await createCharacter("Swallow2");
    await m.story.getOrStartStory(c.id, "bad-trait-story");
    const res = await m.story.advanceStory(c.id, "bad-trait-story", "go"); // BEND: +25 drachmae + unknown trait
    expect(res.completed).toBe(true);
    expect(res.rewardsGranted).toEqual([{ kind: "drachmae", amount: 25 }]);
    expect(res.rewardsGranted.some((r) => r.kind === "trait")).toBe(false);
  });

  it("26. spoiler discipline: state projection and advance node carry no `rewards` key", async () => {
    const c = await createCharacter("NoSpoiler");
    await m.story.getOrStartStory(c.id, "test-story");
    const state = await m.story.getStoryState(c.id, "test-story");
    expect(JSON.stringify(state)).not.toMatch(/"rewards"/); // state projection never leaks rewards
    const res = await m.story.advanceStory(c.id, "test-story", "c1");
    expect(JSON.stringify(res.node)).not.toMatch(/"rewards"/); // the node-now-current never leaks rewards
    expect("rewardsGranted" in res).toBe(true); // but the post-grant summary IS present on advance
  });
});
