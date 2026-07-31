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
        player_characters, dynasties, players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "Test House", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Story Test", seed: "story-test", startedAt: now, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active" }).returning())[0]!;
    worldId = world.id;
    await db.insert(m.dbPkg.stories).values({ id: "test-story", tree: m.shared.parseStoryTree(STORY) as unknown as Record<string, unknown> });
    await db.insert(m.dbPkg.stories).values({ id: "bad-trait-story", tree: m.shared.parseStoryTree(BAD_TRAIT_STORY) as unknown as Record<string, unknown> });
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
});
