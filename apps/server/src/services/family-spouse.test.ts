import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";

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
  const succession = await import("./succession.js");
  return { dbPkg, age, traits, family, composure, succession };
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
        // The real marry() consumes the chosen candidate; mirror it so a post-divorce
        // redraw's delete-unconsumed doesn't hit the marriages FK.
        consumedAt: now,
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

  describe("gift + symposium actions (pack B)", () => {
    const gameYearMs = () => m.age.getAgeConfig().realMsPerGameYear;
    const setDrachmae = (id: string, amount: number) =>
      db.update(m.dbPkg.playerCharacters).set({ drachmae: amount }).where(eq(m.dbPkg.playerCharacters.id, id));
    const fresh = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
    const philiaOf = async (marriageId: string) => (await db.select({ p: m.dbPkg.marriages.philia }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.id, marriageId)).limit(1))[0]!.p;
    const drachmaeOf = async (id: string) => (await fresh(id)).drachmae;
    const logs = async (id: string, kind: string, source: string) =>
      (await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, kind)))).filter((r) => (r.detail as { source?: string }).source === source);

    async function setupMarried(name: string, opts: { personalityTraitId?: string | null; drachmae?: number; philia?: number } = {}) {
      const c = await createCharacter(name);
      await marryTo(c.id, { personalityTraitId: opts.personalityTraitId ?? null, spouseDeathAge: 70, candidateAge: 30, philia: opts.philia });
      await setDrachmae(c.id, opts.drachmae ?? 500);
      const mid = (await db.select({ id: m.dbPkg.marriages.id }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, c.id)).limit(1))[0]!.id;
      return { id: c.id, marriageId: mid };
    }

    it("gift: fresh year +5, same year +1 (diminished), next year +5 again", async () => {
      const s = await setupMarried("Gifter");
      const r1 = await m.family.giveGift(await fresh(s.id), now);
      expect(r1).toMatchObject({ ok: true, delta: 5, diminished: false });
      expect(await philiaOf(s.marriageId)).toBe(55);
      expect(await drachmaeOf(s.id)).toBe(475);

      const r2 = await m.family.giveGift(await fresh(s.id), now); // same game year
      expect(r2).toMatchObject({ ok: true, delta: 1, diminished: true });
      expect(await philiaOf(s.marriageId)).toBe(56);

      const nextYear = new Date(now.getTime() + gameYearMs());
      const r3 = await m.family.giveGift(await fresh(s.id), nextYear);
      expect(r3).toMatchObject({ ok: true, delta: 5, diminished: false });
      expect(await philiaOf(s.marriageId)).toBe(61);
      // two full-price + one diminished = three drachmae spends, three philia logs.
      expect((await logs(s.id, "change_philia", "action:gift")).length).toBe(3);
      expect((await logs(s.id, "change_drachmae", "action:gift")).length).toBe(3);
    });

    it("gift: insufficient drachmae → 409, philia + drachmae untouched (atomic)", async () => {
      const s = await setupMarried("Poor", { drachmae: 10 });
      const r = await m.family.giveGift(await fresh(s.id), now);
      expect(r).toMatchObject({ ok: false, code: 409 });
      expect(await philiaOf(s.marriageId)).toBe(50); // untouched
      expect(await drachmaeOf(s.id)).toBe(10); // untouched
      expect((await logs(s.id, "change_philia", "action:gift")).length).toBe(0);
    });

    it("gift: unmarried → 409", async () => {
      const c = await createCharacter("Single");
      const r = await m.family.giveGift(await fresh(c.id), now);
      expect(r).toMatchObject({ ok: false, code: 409 });
    });

    it("symposium: base +8, +1 prestige applied and logged", async () => {
      const s = await setupMarried("Host");
      const before = (await fresh(s.id)).prestige;
      const r = await m.family.holdSymposium(await fresh(s.id), now);
      expect(r).toMatchObject({ ok: true, delta: 8, prestige: 1 });
      expect(await philiaOf(s.marriageId)).toBe(58);
      expect(await drachmaeOf(s.id)).toBe(465);
      expect((await fresh(s.id)).prestige).toBe(before + 1);
      const stat = await logs(s.id, "change_stat", "action:symposium");
      expect(stat.length).toBe(1);
      expect(stat[0]!.detail).toMatchObject({ stat: "prestige", applied: 1 });
    });

    it("symposium: gregarious +10, reserved +5", async () => {
      const g = await setupMarried("Greg", { personalityTraitId: "gregarious" });
      expect(await m.family.holdSymposium(await fresh(g.id), now)).toMatchObject({ ok: true, delta: 10 });
      expect(await philiaOf(g.marriageId)).toBe(60);

      const r = await setupMarried("Res", { personalityTraitId: "reserved" });
      expect(await m.family.holdSymposium(await fresh(r.id), now)).toMatchObject({ ok: true, delta: 5 });
      expect(await philiaOf(r.marriageId)).toBe(55);
    });

    it("symposium: same game year → 409, no second spend", async () => {
      const s = await setupMarried("Twice");
      await m.family.holdSymposium(await fresh(s.id), now);
      const drachmaeAfterFirst = await drachmaeOf(s.id);
      const r = await m.family.holdSymposium(await fresh(s.id), now);
      expect(r).toMatchObject({ ok: false, code: 409 });
      expect(await drachmaeOf(s.id)).toBe(drachmaeAfterFirst); // no second deduct
    });
  });
  describe("divorce (pack B)", () => {
    const fresh = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
    const marriageRow = async (charId: string) => (await db.select().from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, charId)).limit(1))[0]!;
    const favorRow = async (id: string, party: string) => (await db.select().from(m.dbPkg.partyFavor).where(and(eq(m.dbPkg.partyFavor.characterId, id), eq(m.dbPkg.partyFavor.party, party))).limit(1))[0];
    const divorceLogs = async (id: string, kind: string) =>
      (await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, kind)))).filter((r) => (r.detail as { source?: string }).source === "divorce");

    type SetupOpts = { party?: string; prestige?: number; devotion?: number; composure?: number; drachmae?: number; dowried?: boolean; loverState?: string };
    async function setup(name: string, opts: SetupOpts = {}) {
      const c = await createCharacter(name);
      await db.update(m.dbPkg.playerCharacters).set({
        party: opts.party ?? "none", prestige: opts.prestige ?? 50, devotion: opts.devotion ?? 50,
        composure: opts.composure ?? 70, drachmae: opts.drachmae ?? 100, lastComposureUpdate: now,
      }).where(eq(m.dbPkg.playerCharacters.id, c.id));
      await marryTo(c.id, { personalityTraitId: null, traitId: opts.dowried ? "dowried" : null, spouseDeathAge: 70, candidateAge: 30 });
      const mr = await marriageRow(c.id);
      if (opts.loverState) await db.update(m.dbPkg.marriages).set({ loverState: opts.loverState }).where(eq(m.dbPkg.marriages.id, mr.id));
      return c.id;
    }

    it("full tier (partied, non-dowried): stats/composure/favor applied + logged, marriage ended, spouse null", async () => {
      const id = await setup("Full", { party: "palaioi" });
      const r = await m.family.divorce(await fresh(id), now);
      expect(r).toMatchObject({ ok: true, tier: "full" });
      const row = await fresh(id);
      expect(row.prestige).toBe(38); // 50 - 12
      expect(row.devotion).toBe(40); // 50 - 10
      expect(row.composure).toBe(20); // 70 - 50
      expect(row.spouseCandidateId).toBeNull();
      expect((await favorRow(id, "palaioi"))!.favor).toBe(-30);
      const mr = await marriageRow(id);
      expect(mr.endReason).toBe("divorced");
      expect(mr.endedAt).not.toBeNull();
      expect((await divorceLogs(id, "change_stat")).length).toBe(2); // prestige + devotion
      expect((await divorceLogs(id, "change_composure")).length).toBe(0); // composure lives in composureLog, not effectLog
      expect((await divorceLogs(id, "change_party_favor")).length).toBe(1);
      expect((await divorceLogs(id, "change_drachmae")).length).toBe(0); // not dowried
    });

    it("dowried full tier: -60 drachmae, and floors at 0 (never negative)", async () => {
      const id = await setup("Dowried", { party: "dynatoi", dowried: true, drachmae: 100 });
      await m.family.divorce(await fresh(id), now);
      expect((await fresh(id)).drachmae).toBe(40); // 100 - 60
      expect((await divorceLogs(id, "change_drachmae"))[0]!.detail).toMatchObject({ amount: -60 });

      const poor = await setup("DowriedPoor", { dowried: true, drachmae: 40 });
      await m.family.divorce(await fresh(poor), now);
      expect((await fresh(poor)).drachmae).toBe(0); // floored, not -20
      expect((await divorceLogs(poor, "change_drachmae"))[0]!.detail).toMatchObject({ amount: -40 }); // floored delta
    });

    it("fallen tier: quarter amounts, no dowry return even when dowried", async () => {
      const id = await setup("Fallen", { party: "palaioi", dowried: true, loverState: "fallen", drachmae: 100 });
      const r = await m.family.divorce(await fresh(id), now);
      expect(r).toMatchObject({ ok: true, tier: "fallen" });
      const row = await fresh(id);
      expect(row.prestige).toBe(47); // 50 - 3
      expect(row.devotion).toBe(48); // 50 - 2
      expect(row.composure).toBe(58); // 70 - 12
      expect(row.drachmae).toBe(100); // no dowry return
      expect((await favorRow(id, "palaioi"))!.favor).toBe(-8);
      expect((await divorceLogs(id, "change_drachmae")).length).toBe(0);
    });

    it("active-but-not-fallen plot → full tier", async () => {
      const id = await setup("Active", { loverState: "active" });
      const r = await m.family.divorce(await fresh(id), now);
      expect(r).toMatchObject({ ok: true, tier: "full" });
      expect((await fresh(id)).prestige).toBe(38);
    });

    it("unmarried → 409, nothing written", async () => {
      const c = await createCharacter("Nobody");
      await db.update(m.dbPkg.playerCharacters).set({ prestige: 50 }).where(eq(m.dbPkg.playerCharacters.id, c.id));
      const r = await m.family.divorce(await fresh(c.id), now);
      expect(r).toMatchObject({ ok: false, code: 409 });
      expect((await fresh(c.id)).prestige).toBe(50);
      expect((await divorceLogs(c.id, "change_stat")).length).toBe(0);
    });

    it("partyless: no favor row, everything else applies", async () => {
      const id = await setup("Loner", { party: "none" });
      await m.family.divorce(await fresh(id), now);
      expect(await favorRow(id, "palaioi")).toBeUndefined();
      expect(await favorRow(id, "dynatoi")).toBeUndefined();
      expect((await fresh(id)).prestige).toBe(38); // still applied
      expect((await divorceLogs(id, "change_party_favor")).length).toBe(0);
    });

    it("prospects redraw after divorce (a draw yields marriage-purpose candidates)", async () => {
      const id = await setup("Redraw");
      await m.family.divorce(await fresh(id), now);
      await m.dbPkg.drawFamilyCandidates(id, { familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now });
      const cands = await db.select().from(m.dbPkg.familyCandidates).where(and(eq(m.dbPkg.familyCandidates.forCharacterId, id), eq(m.dbPkg.familyCandidates.purpose, "marriage")));
      expect(cands.length).toBeGreaterThan(0);
    });
  });
  describe("lover plot (pack B)", () => {
    const gameYearMs = () => m.age.getAgeConfig().realMsPerGameYear;
    const rollArgs = (rng?: () => number) => ({ familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now, rng });
    const seqRng = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
    const marriageRow = async (charId: string) => (await db.select().from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, charId)).limit(1))[0]!;
    const fresh = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
    const loverLogs = async (id: string, action: string) =>
      (await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, "lover_plot")))).filter((r) => (r.detail as { action?: string }).action === action);
    const setAnchor = (id: string, yearsBack: number) =>
      db.update(m.dbPkg.playerCharacters).set({ lastChildRollAt: new Date(now.getTime() - yearsBack * gameYearMs()) }).where(eq(m.dbPkg.playerCharacters.id, id));

    // A married character; wife age 40 keeps her OUT of the fertility window so the
    // child roll never fires (no births/mother-death noise) — the lover rolls fire
    // above the fertility gate regardless. personalityTraitId picks the fall tier.
    async function setupPlot(name: string, opts: { loverState?: string; personalityTraitId?: string | null; candidateAge?: number } = {}) {
      const c = await createCharacter(name);
      await db.update(m.dbPkg.playerCharacters).set({ prestige: 50 }).where(eq(m.dbPkg.playerCharacters.id, c.id));
      await marryTo(c.id, { personalityTraitId: opts.personalityTraitId ?? null, spouseDeathAge: 999, candidateAge: opts.candidateAge ?? 40 });
      const mr = await marriageRow(c.id);
      if (opts.loverState) await db.update(m.dbPkg.marriages).set({ loverState: opts.loverState }).where(eq(m.dbPkg.marriages.id, mr.id));
      return c.id;
    }

    it("startLoverPlot: unmarried → 409; success → active + loverStartedAt; already active → 409", async () => {
      const single = await createCharacter("SinglePlot");
      expect(await m.family.startLoverPlot(await fresh(single.id), now)).toMatchObject({ ok: false, code: 409 });

      const id = await setupPlot("Starter");
      expect(await m.family.startLoverPlot(await fresh(id), now)).toMatchObject({ ok: true, loverState: "active" });
      const mr = await marriageRow(id);
      expect(mr.loverState).toBe("active");
      expect(mr.loverStartedAt).not.toBeNull();
      expect(await m.family.startLoverPlot(await fresh(id), now)).toMatchObject({ ok: false, code: 409 });
      expect((await loverLogs(id, "started")).length).toBe(1);
    });

    it("fall roll: succeeds below the chance (base 25%) → fallen + loverFellAt + log", async () => {
      const id = await setupPlot("Falls", { loverState: "active" });
      await setAnchor(id, 1);
      await m.dbPkg.rollChildrenDue(id, rollArgs(seqRng([0.0, 0.99]))); // fall wins, discovery misses
      const mr = await marriageRow(id);
      expect(mr.loverState).toBe("fallen");
      expect(mr.loverFellAt).not.toBeNull();
      expect(mr.loverDiscoveredAt).toBeNull();
      expect((await loverLogs(id, "fell")).length).toBe(1);
    });

    it("fall roll: misses above the chance → stays active", async () => {
      const id = await setupPlot("Holds", { loverState: "active", personalityTraitId: "pious" }); // 10%
      await setAnchor(id, 1);
      await m.dbPkg.rollChildrenDue(id, rollArgs(seqRng([0.5, 0.99]))); // 0.5 > 0.10 → no fall
      expect((await marriageRow(id)).loverState).toBe("active");
      expect((await loverLogs(id, "fell")).length).toBe(0);
    });

    it("fallen is terminal: a later winning fall roll does not re-fire; discovery still rolls", async () => {
      const id = await setupPlot("Terminal", { loverState: "active" });
      await setAnchor(id, 2); // two years
      // year1: fall 0.0 (falls), discovery 0.99 (miss). year2: fallen → no fall roll; discovery 0.0 (hits).
      await m.dbPkg.rollChildrenDue(id, rollArgs(seqRng([0.0, 0.99, 0.0])));
      const mr = await marriageRow(id);
      expect(mr.loverState).toBe("fallen");
      expect((await loverLogs(id, "fell")).length).toBe(1); // only once
      expect(mr.loverDiscoveredAt).not.toBeNull(); // discovery fired during the fallen year
      expect((await fresh(id)).prestige).toBe(47); // 50 - 3
    });

    it("discovery: 15% sets timestamp + prestige −3 + logs exactly once (second winning year is a no-op)", async () => {
      const id = await setupPlot("Caught", { loverState: "fallen" });
      await setAnchor(id, 2);
      // year1: fallen → no fall; discovery 0.0 (hits). year2: already discovered → guarded, rng not consumed.
      await m.dbPkg.rollChildrenDue(id, rollArgs(seqRng([0.0, 0.0, 0.0])));
      const mr = await marriageRow(id);
      expect(mr.loverDiscoveredAt).not.toBeNull();
      expect((await loverLogs(id, "discovered")).length).toBe(1);
      expect((await fresh(id)).prestige).toBe(47); // exactly one −3, not −6
      const stat = (await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, "change_stat")))).filter((r) => (r.detail as { source?: string }).source === "lover_plot:discovered");
      expect(stat.length).toBe(1);
    });

    it("discovery keeps rolling through fallen-undivorced years until it hits", async () => {
      const id = await setupPlot("Lingers", { loverState: "fallen" });
      await setAnchor(id, 3);
      // fallen every year → discovery-only rolls: miss, miss, hit.
      await m.dbPkg.rollChildrenDue(id, rollArgs(seqRng([0.99, 0.99, 0.0])));
      expect((await marriageRow(id)).loverDiscoveredAt).not.toBeNull();
      expect((await loverLogs(id, "discovered")).length).toBe(1);
    });

    it("plot state is fresh on remarriage after a fallen divorce", async () => {
      const id = await setupPlot("Rebound", { loverState: "fallen", candidateAge: 30 });
      await m.family.divorce(await fresh(id), now);
      await m.dbPkg.drawFamilyCandidates(id, { familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now });
      const cand = (await db.select().from(m.dbPkg.familyCandidates).where(and(eq(m.dbPkg.familyCandidates.forCharacterId, id), eq(m.dbPkg.familyCandidates.purpose, "marriage"), sql`consumed_at IS NULL`)).limit(1))[0]!;
      const r = await m.family.marry(await fresh(id), cand.id, now);
      expect(r.ok).toBe(true);
      const newMarriage = (await db.select().from(m.dbPkg.marriages).where(and(eq(m.dbPkg.marriages.characterId, id), sql`ended_at IS NULL`)).limit(1))[0]!;
      expect(newMarriage.loverState).toBe("none");
      expect(newMarriage.loverFellAt).toBeNull();
    });

    it("rumor: children born during an active plot carry rumor=true; without a plot, false", async () => {
      // A FERTILE wife (age 30). Loop with a no-op lover rng (never fall/discover)
      // until a birth lands — near-certain within a few rolls.
      const withPlot = await setupPlot("Rumored", { loverState: "active", candidateAge: 30 });
      let bornWith: { child: { rumor: boolean } } | null = null;
      for (let a = 0; a < 60 && !bornWith; a++) {
        await setAnchor(withPlot, 1);
        const births = await m.dbPkg.rollChildrenDue(withPlot, rollArgs(() => 0.99));
        if (births.length > 0) bornWith = births[0]!;
      }
      expect(bornWith).not.toBeNull();
      expect(bornWith!.child.rumor).toBe(true);

      const noPlot = await setupPlot("Faithful", { candidateAge: 30 }); // loverState default none
      let bornNo: { child: { rumor: boolean } } | null = null;
      for (let a = 0; a < 60 && !bornNo; a++) {
        await setAnchor(noPlot, 1);
        const births = await m.dbPkg.rollChildrenDue(noPlot, rollArgs(() => 0.99));
        if (births.length > 0) bornNo = births[0]!;
      }
      expect(bornNo).not.toBeNull();
      expect(bornNo!.child.rumor).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Pack C phase 1: the `children.diedAt` column + living-children filters.
  // Nothing sets diedAt yet (no tragedy code), so these tests seed diedAt
  // directly to prove every live-state read now ignores the dead — while the
  // Chronicle (history) keeps them, tested in chronicle.test where births live.
  // The succession assertions are the Medea shape, verified before Medea exists.
  // -------------------------------------------------------------------------
  describe("child mortality (pack C phase 1): living-children filters", () => {
    const y = () => m.age.getAgeConfig().realMsPerGameYear;
    const freshChar = async (id: string) =>
      (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
    const childRow = async (id: string) =>
      (await db.select().from(m.dbPkg.children).where(eq(m.dbPkg.children.id, id)).limit(1))[0]!;
    // Insert one child; `agoYears` back-dates bornAt, diedAt marks it dead.
    async function insertChild(
      parentId: string,
      opts: { name: string; sex: "male" | "female"; agoYears?: number; dead?: boolean; named?: boolean },
    ) {
      const bornAt = new Date(now.getTime() - (opts.agoYears ?? 0) * y());
      return (
        await db.insert(m.dbPkg.children).values({
          parentCharacterId: parentId, worldId, name: opts.name, sex: opts.sex, bornAt,
          named: opts.named ?? false, diedAt: opts.dead ? now : null,
        }).returning()
      )[0]!;
    }

    it("familyEligibilityContext: dead children are excluded from livingChildren", async () => {
      const c = await createCharacter("MortalParent");
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 70, candidateAge: 30 });
      await insertChild(c.id, { name: "Alive", sex: "female", agoYears: 0 });
      await insertChild(c.id, { name: "Dead", sex: "male", agoYears: 10, dead: true });
      const fam = await m.family.familyEligibilityContext(await freshChar(c.id), now);
      expect(fam.livingChildren.map((k) => `${k.sex}:${k.ageYears}`)).toEqual(["female:0"]);
    });

    it("familyState children: dead child hidden AND its come-of-age/named writes never fire", async () => {
      const c = await createCharacter("GriefHouse");
      // A dead child that is BOTH of-age (age 30 ≥ 15 → would stamp comeOfAgeAt) and
      // unnamed-past-its-season (would flip named) — proving the filtered read never
      // reaches either lazy write.
      const dead = await insertChild(c.id, { name: "Lost", sex: "male", agoYears: 30, dead: true, named: false });
      await insertChild(c.id, { name: "Living", sex: "female", agoYears: 0 });
      const state = await m.family.familyState(await freshChar(c.id), now);
      expect(state.children.map((k: { name: string }) => k.name)).toEqual(["Living"]);
      const deadRow = await childRow(dead.id);
      expect(deadRow.comeOfAgeAt).toBeNull();
      expect(deadRow.named).toBe(false);
    });

    it("nameChild: a dead child cannot be (re)named", async () => {
      const c = await createCharacter("NamerHouse");
      const dead = await insertChild(c.id, { name: "Ghost", sex: "male", agoYears: 0, dead: true, named: false });
      const res = await m.family.nameChild(await freshChar(c.id), dead.id, "NewName", now);
      expect(res.ok).toBe(false);
      const row = await childRow(dead.id);
      expect(row.name).toBe("Ghost");
      expect(row.named).toBe(false);
    });

    it("successionInfo: dead children don't count — a lone living young child → regency on that ward", async () => {
      const c = await createCharacter("DeceasedParent");
      await insertChild(c.id, { name: "Heir", sex: "male", agoYears: 5 }); // living, under coming-of-age (15)
      await insertChild(c.id, { name: "DeadKid", sex: "female", agoYears: 5, dead: true });
      await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, c.id));
      const info = await m.succession.successionInfo(await freshChar(c.id), now);
      expect(info?.plan.kind).toBe("regency");
      expect(info?.heir?.name).toBe("Heir");
    });

    it("successionInfo (Medea shape): all children dead + no adopted heir → forced_adoption, not regency", async () => {
      const c = await createCharacter("ChildlessByTragedy");
      await insertChild(c.id, { name: "GoneA", sex: "male", agoYears: 5, dead: true });
      await insertChild(c.id, { name: "GoneB", sex: "female", agoYears: 3, dead: true });
      await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, c.id));
      const info = await m.succession.successionInfo(await freshChar(c.id), now);
      expect(info?.plan.kind).toBe("forced_adoption");
    });

    it("rollChildrenDue: dead children don't count toward maxChildren (a dead child frees a slot)", async () => {
      const cfg = m.family.getFamilyConfig();
      const max = cfg.children.maxChildren;
      // Force deterministic births: chance ≥ 1 (rng() is always < 1 → always born),
      // and zero birth-death risk (the wife never dies mid-loop). The fertility
      // window is untouched, so a 30-year-old wife stays fertile every roll.
      const forced = { ...cfg, children: { ...cfg.children, yearlyChildChance: 1, thirdPlusChildChance: 1, birthDeathRisk: 0 } };
      const rollArgs = { familyCfg: forced, ageCfg: m.age.getAgeConfig(), now };
      const setAnchor = (id: string) =>
        db.update(m.dbPkg.playerCharacters).set({ lastChildRollAt: new Date(now.getTime() - 3 * y()) }).where(eq(m.dbPkg.playerCharacters.id, id));

      // (a) max LIVING children → the cap blocks every catch-up roll → 0 births.
      const atCap = await createCharacter("AtCap");
      await marryTo(atCap.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      for (let i = 0; i < max; i++) await insertChild(atCap.id, { name: `K${i}`, sex: "male", agoYears: 0 });
      await setAnchor(atCap.id);
      expect((await m.dbPkg.rollChildrenDue(atCap.id, rollArgs)).length).toBe(0);

      // (b) max rows but ONE dead → living = max-1 < cap → exactly one birth refills
      // the freed slot (and no more; the next roll is back at the cap).
      const freed = await createCharacter("SlotFreed");
      await marryTo(freed.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      for (let i = 0; i < max - 1; i++) await insertChild(freed.id, { name: `L${i}`, sex: "male", agoYears: 0 });
      await insertChild(freed.id, { name: "DeadSlot", sex: "female", agoYears: 0, dead: true });
      await setAnchor(freed.id);
      expect((await m.dbPkg.rollChildrenDue(freed.id, rollArgs)).length).toBe(1);
      const living = await db.select().from(m.dbPkg.children)
        .where(and(eq(m.dbPkg.children.parentCharacterId, freed.id), isNull(m.dbPkg.children.diedAt)));
      expect(living.length).toBe(max);
    });
  });
});
