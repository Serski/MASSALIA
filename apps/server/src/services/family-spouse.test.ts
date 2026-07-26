import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { REAL_MS_PER_SEASON, effectiveStats } from "@massalia/shared";

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
      // Age the marriage past the one-game-year voluntary-divorce cooldown (pack: divorce limits).
      await db.update(m.dbPkg.marriages).set({ marriedAt: new Date(now.getTime() - 2 * m.age.getAgeConfig().realMsPerGameYear) }).where(eq(m.dbPkg.marriages.id, mr.id));
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
      // Age the marriage past the divorce cooldown before dissolving it voluntarily.
      await db.update(m.dbPkg.marriages).set({ marriedAt: new Date(now.getTime() - 2 * m.age.getAgeConfig().realMsPerGameYear) }).where(and(eq(m.dbPkg.marriages.characterId, id), sql`ended_at IS NULL`));
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

  // -------------------------------------------------------------------------
  // Patrilineal succession: heirEligible (via childrenSection/familyState) is
  // sons-only. Daughters still come of age but are never heir-eligible.
  // -------------------------------------------------------------------------
  describe("patrilineal succession (heir eligibility)", () => {
    const y = () => m.age.getAgeConfig().realMsPerGameYear;
    const freshChar = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;

    it("an of-age daughter is NOT heir-eligible; an of-age son is", async () => {
      const c = await createCharacter("PatriHouse");
      // Both are of age (>= comingOfAge, 15).
      await db.insert(m.dbPkg.children).values({ parentCharacterId: c.id, worldId, name: "Daughter", sex: "female", bornAt: new Date(now.getTime() - 20 * y()) });
      await db.insert(m.dbPkg.children).values({ parentCharacterId: c.id, worldId, name: "Son", sex: "male", bornAt: new Date(now.getTime() - 16 * y()) });
      const state = await m.family.familyState(await freshChar(c.id), now);
      const byName = (name: string) => state.children.find((k: { name: string }) => k.name === name)!;
      expect(byName("Daughter").heirEligible).toBe(false); // came of age, but never inherits
      expect(byName("Son").heirEligible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pack C phase 2: the tragedy roll and its three resolutions, fired through
  // rollChildrenDue with an injected tragedyRng. The wife-death shape, child
  // death (Medea), the merc-style player-death flip (Clytemnestra success), and
  // the clamped composure / floored prestige penalties all live in packages/db.
  // -------------------------------------------------------------------------
  describe("the tragedies (pack C phase 2)", () => {
    const y = () => m.age.getAgeConfig().realMsPerGameYear;
    const seqRng = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
    const pcs = () => m.dbPkg.playerCharacters;
    const fresh = async (id: string) => (await db.select().from(pcs()).where(eq(pcs().id, id)).limit(1))[0]!;
    const marr = async (mid: string) => (await db.select().from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.id, mid)).limit(1))[0]!;
    const childRows = async (id: string) => await db.select().from(m.dbPkg.children).where(eq(m.dbPkg.children.parentCharacterId, id));
    const logsOfKind = async (id: string, kind: string) =>
      await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, id), eq(m.dbPkg.effectLog.kind, kind)));
    const args = (tragedyRng?: () => number, rng?: () => number, familyCfg?: ReturnType<typeof m.family.getFamilyConfig>) =>
      ({ familyCfg: familyCfg ?? m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now, rng, tragedyRng });

    // A married character parked at an estranged philia, anchor one year back so the
    // loop takes exactly one roll (unless yearsBack overrides it).
    async function setup(
      name: string,
      opts: {
        personalityId?: string | null; philia?: number; militia?: number; composure?: number; prestige?: number;
        loverState?: string; loverStartedAt?: boolean; children?: number; candidateAge?: number; yearsBack?: number;
      },
    ) {
      const c = await createCharacter(name);
      const patch: Record<string, unknown> = {};
      if (opts.militia !== undefined) patch.militia = opts.militia;
      if (opts.composure !== undefined) patch.composure = opts.composure;
      if (opts.prestige !== undefined) patch.prestige = opts.prestige;
      if (Object.keys(patch).length) await db.update(pcs()).set(patch).where(eq(pcs().id, c.id));
      await marryTo(c.id, { personalityTraitId: opts.personalityId ?? null, spouseDeathAge: 999, candidateAge: opts.candidateAge ?? 40, philia: opts.philia ?? 5 });
      const mid = (await db.select({ id: m.dbPkg.marriages.id }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, c.id)).limit(1))[0]!.id;
      const mPatch: Record<string, unknown> = {};
      if (opts.loverState) mPatch.loverState = opts.loverState;
      if (opts.loverStartedAt) mPatch.loverStartedAt = now;
      if (Object.keys(mPatch).length) await db.update(m.dbPkg.marriages).set(mPatch).where(eq(m.dbPkg.marriages.id, mid));
      for (let i = 0; i < (opts.children ?? 0); i++) {
        await db.insert(m.dbPkg.children).values({ parentCharacterId: c.id, worldId, name: `C${i}`, sex: "male", bornAt: new Date(now.getTime() - 5 * y()) });
      }
      await db.update(pcs()).set({ lastChildRollAt: new Date(now.getTime() - (opts.yearsBack ?? 1) * y()) }).where(eq(pcs().id, c.id));
      return { id: c.id, marriageId: mid };
    }

    it("no tragedy roll above the threshold (philia 6, rng rigged to fire)", async () => {
      const s = await setup("AbovePhilia", { personalityId: "ruthless", philia: 6 });
      expect(await m.dbPkg.rollChildrenDue(s.id, args(() => 0))).toEqual([]);
      expect((await logsOfKind(s.id, "tragedy")).length).toBe(0);
      expect((await marr(s.marriageId)).endedAt).toBeNull();
      expect((await fresh(s.id)).status).toBe("alive");
    });

    it("Phaedra: fires at philia 5 → she alone dies; composure −40, prestige −2, widowed; prospects redraw", async () => {
      const s = await setup("PhaedraHouse", { personalityId: "pious", philia: 5, composure: 70, prestige: 50 });
      expect(await m.dbPkg.rollChildrenDue(s.id, args(() => 0))).toEqual([]);
      const mrow = await marr(s.marriageId);
      expect(mrow.endReason).toBe("tragedy_phaedra");
      expect(mrow.endedAt).not.toBeNull();
      const f = await fresh(s.id);
      expect(f.status).toBe("alive");
      expect(f.spouseCandidateId).toBeNull(); // widower shape
      expect(f.composure).toBe(30); // 70 − 40
      expect(f.prestige).toBe(48); // 50 − 2
      expect((await logsOfKind(s.id, "tragedy"))[0]!.detail).toMatchObject({ archetype: "phaedra" });
      // Widowed → the yearly draw re-opens marriage prospects.
      await m.dbPkg.drawFamilyCandidates(s.id, { familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now });
      const cands = await db.select().from(m.dbPkg.familyCandidates)
        .where(and(eq(m.dbPkg.familyCandidates.forCharacterId, s.id), eq(m.dbPkg.familyCandidates.purpose, "marriage")));
      expect(cands.length).toBeGreaterThan(0);
    });

    it("Clytemnestra failure: rigged to miss → she suicides; player alive, composure −30, prestige −2", async () => {
      // ruthless + no plot + no children → clytemnestra (fails Medea's gate).
      const s = await setup("ClytMiss", { personalityId: "ruthless", philia: 5, militia: 0, composure: 70, prestige: 50 });
      // [trigger 0.0 fires, success 0.99 ≥ 0.30 → miss]
      expect(await m.dbPkg.rollChildrenDue(s.id, args(seqRng([0.0, 0.99])))).toEqual([]);
      expect((await marr(s.marriageId)).endReason).toBe("tragedy_clytemnestra");
      const f = await fresh(s.id);
      expect(f.status).toBe("alive");
      expect(f.spouseCandidateId).toBeNull();
      expect(f.composure).toBe(40); // 70 − 30
      expect(f.prestige).toBe(48); // 50 − 2
    });

    it("Clytemnestra success: rigged to land → player deceased, no penalty, succession reachable, no child that year", async () => {
      const cfg = m.family.getFamilyConfig();
      // Force a birth if the loop were to continue past the tragedy (fertile wife + chance ≥ 1).
      const forced = { ...cfg, children: { ...cfg.children, yearlyChildChance: 1, thirdPlusChildChance: 1, birthDeathRisk: 0 } };
      const s = await setup("ClytKill", { personalityId: "ruthless", philia: 5, militia: 0, composure: 70, prestige: 50, candidateAge: 30 });
      // [trigger 0.0 fires, success 0.0 < 0.30 → lands]
      expect(await m.dbPkg.rollChildrenDue(s.id, args(seqRng([0.0, 0.0]), undefined, forced))).toEqual([]);
      expect((await childRows(s.id)).length).toBe(0); // aborted before any child insert
      expect((await marr(s.marriageId)).endReason).toBe("tragedy_clytemnestra");
      const f = await fresh(s.id);
      expect(f.status).toBe("deceased");
      expect(f.composure).toBe(70); // untouched — the dead take no penalty
      expect(f.prestige).toBe(50);
      // The status-keyed succession flow picks it up unmodified: childless → forced_adoption.
      const info = await m.succession.successionInfo(f, now);
      expect(info?.plan.kind).toBe("forced_adoption");
    });

    it("Medea: ruthless + plot + living children → children die, composure −70, prestige −5; heirless → forced_adoption", async () => {
      const s = await setup("MedeaHouse", { personalityId: "ruthless", philia: 5, composure: 90, prestige: 50, loverStartedAt: true, children: 2 });
      expect(await m.dbPkg.rollChildrenDue(s.id, args(() => 0))).toEqual([]);
      const kids = await childRows(s.id);
      expect(kids.length).toBe(2);
      expect(kids.every((k) => k.diedAt !== null)).toBe(true); // every living child taken
      expect((await marr(s.marriageId)).endReason).toBe("tragedy_medea");
      const f = await fresh(s.id);
      expect(f.status).toBe("alive"); // Medea kills the children, not the player
      expect(f.composure).toBe(20); // 90 − 70
      expect(f.prestige).toBe(45); // 50 − 5
      // Later the childless player dies of old age → no blood heir, no regency.
      await db.update(pcs()).set({ status: "deceased" }).where(eq(pcs().id, s.id));
      const info = await m.succession.successionInfo(await fresh(s.id), now);
      expect(info?.plan.kind).toBe("forced_adoption");
    });

    it("the tragedy aborts before the lover rolls (both rigged to fire → only the tragedy lands)", async () => {
      const s = await setup("AbortLover", { personalityId: "pious", philia: 5, loverState: "active", loverStartedAt: true });
      // tragedyRng=0 fires the tragedy; loverRng=0 WOULD fire fall + discovery if reached.
      expect(await m.dbPkg.rollChildrenDue(s.id, args(() => 0, () => 0))).toEqual([]);
      const mrow = await marr(s.marriageId);
      expect(mrow.endReason).toBe("tragedy_phaedra");
      expect(mrow.loverFellAt).toBeNull(); // the fall roll never ran
      expect(mrow.loverDiscoveredAt).toBeNull(); // nor discovery
      expect((await logsOfKind(s.id, "lover_plot")).length).toBe(0);
    });

    it("catch-up: a tragedy in year 1 of a 3-year catch-up ends the loop (one tragedy, not three)", async () => {
      const s = await setup("CatchUp", { personalityId: "pious", philia: 5, yearsBack: 3 });
      expect(await m.dbPkg.rollChildrenDue(s.id, args(() => 0))).toEqual([]);
      expect((await logsOfKind(s.id, "tragedy")).length).toBe(1); // years 2–3 never processed
    });

    it("status guard: a deceased player with a live spouse link rolls nothing (loop exits at the top)", async () => {
      const s = await setup("DeadAlready", { personalityId: "ruthless", philia: 5 });
      await db.update(pcs()).set({ status: "deceased", lastChildRollAt: new Date(now.getTime() - 3 * y()) }).where(eq(pcs().id, s.id));
      expect(await m.dbPkg.rollChildrenDue(s.id, args(() => 0))).toEqual([]);
      expect((await logsOfKind(s.id, "tragedy")).length).toBe(0); // the guard exits before any roll
    });
  });

  // -------------------------------------------------------------------------
  // Pack C phase 3: the derived tragedy notices (familyState), the estranged
  // banner's gating data (spouse.philiaBand), and the slot-keyed chronicle
  // lineage (a murdered predecessor's entry is visible to the heir).
  // -------------------------------------------------------------------------
  describe("tragedy notices, banner data, chronicle lineage (pack C phase 3)", () => {
    const pcs = () => m.dbPkg.playerCharacters;
    const fresh = async (id: string) => (await db.select().from(pcs()).where(eq(pcs().id, id)).limit(1))[0]!;
    async function marryAt(name: string, philia: number, personality: string | null = null) {
      const c = await createCharacter(name);
      await marryTo(c.id, { personalityTraitId: personality, spouseDeathAge: 999, candidateAge: 40, philia });
      return c.id;
    }
    // End the character's marriage in a tragedy (the phase-2 wife-death shape).
    async function endInTragedy(charId: string, endReason: string, endedAt: Date) {
      const mid = (await db.select({ id: m.dbPkg.marriages.id }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, charId)).limit(1))[0]!.id;
      await db.update(m.dbPkg.marriages).set({ endedAt, endReason }).where(eq(m.dbPkg.marriages.id, mid));
      await db.update(pcs()).set({ spouseCandidateId: null }).where(eq(pcs().id, charId));
      return mid;
    }

    for (const arche of ["phaedra", "clytemnestra", "medea"]) {
      it(`notice: ${arche} surfaces within the season window`, async () => {
        const id = await marryAt(`Notice_${arche}`, 5);
        await endInTragedy(id, `tragedy_${arche}`, now);
        const state = await m.family.familyState(await fresh(id), now);
        expect(state.tragedyNotice).toMatchObject({ archetype: arche });
      });
    }

    it("notice: absent once the season has passed", async () => {
      const id = await marryAt("NoticeGone", 5);
      await endInTragedy(id, "tragedy_phaedra", new Date(now.getTime() - 2 * REAL_MS_PER_SEASON));
      const state = await m.family.familyState(await fresh(id), now);
      expect(state.tragedyNotice).toBeNull();
    });

    it("banner data: estranged + active marriage → spouse.philiaBand 'estranged'", async () => {
      const id = await marryAt("BannerEstranged", 5);
      const state = await m.family.familyState(await fresh(id), now);
      expect(state.spouse?.philiaBand).toBe("estranged");
    });

    it("banner data: a dutiful marriage → not estranged (no banner)", async () => {
      const id = await marryAt("BannerDutiful", 50);
      const state = await m.family.familyState(await fresh(id), now);
      expect(state.spouse?.philiaBand).toBe("dutiful");
    });

    it("banner data: an ended marriage → no spouse (no banner)", async () => {
      const id = await marryAt("BannerEnded", 5);
      await endInTragedy(id, "tragedy_phaedra", now);
      const state = await m.family.familyState(await fresh(id), now);
      expect(state.spouse).toBeNull();
    });

    it("chronicle lineage: a tragedy_clytemnestra marriage surfaces in the slot's chronicle (visible to the heir)", async () => {
      const id = await marryAt("Murdered", 5, "ruthless");
      await endInTragedy(id, "tragedy_clytemnestra", now);
      const entries = await m.dbPkg.gatherChronicleForCharacter(id);
      expect(entries.some((e) => e.type === "tragedy_clytemnestra")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Divorce limits + scandal: the one-game-year cooldown, the Notorious Divorcer
  // brand (per-life count bounded on marriedAt >= createdAt), and the city-wide
  // scandal headline. Voluntary action only — spouse death is unaffected.
  // -------------------------------------------------------------------------
  describe("divorce cooldown, notorious divorcer, and the scandal", () => {
    const gy = () => m.age.getAgeConfig().realMsPerGameYear;
    const pcs = () => m.dbPkg.playerCharacters;
    const freshChar = async (id: string) => (await db.select().from(pcs()).where(eq(pcs().id, id)).limit(1))[0]!;
    // Back-date the active (un-ended) marriage's marriedAt to age it on demand.
    const setActiveMarriedAt = (charId: string, at: Date) =>
      db.update(m.dbPkg.marriages).set({ marriedAt: at }).where(and(eq(m.dbPkg.marriages.characterId, charId), isNull(m.dbPkg.marriages.endedAt)));
    const setCreatedAt = (charId: string, at: Date) => db.update(pcs()).set({ createdAt: at }).where(eq(pcs().id, charId));
    const holdsBrand = async (charId: string) =>
      (await db.select().from(m.dbPkg.characterTraits).where(and(eq(m.dbPkg.characterTraits.characterId, charId), eq(m.dbPkg.characterTraits.traitId, "notorious-divorcer")))).length > 0;
    const repLogs = async (charId: string) =>
      await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, charId), eq(m.dbPkg.effectLog.kind, "reputation")));

    it("cooldown: divorce inside the first game year → 409, nothing written", async () => {
      const c = await createCharacter("TooSoon");
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      await db.update(pcs()).set({ prestige: 50 }).where(eq(pcs().id, c.id));
      await setActiveMarriedAt(c.id, new Date(now.getTime() - gy() / 2)); // half a game year old
      const res = await m.family.divorce(await freshChar(c.id), now);
      expect(res).toMatchObject({ ok: false, code: 409 });
      const marr = (await db.select().from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, c.id)).limit(1))[0]!;
      expect(marr.endedAt).toBeNull(); // untouched
      const f = await freshChar(c.id);
      expect(f.spouseCandidateId).not.toBeNull();
      expect(f.prestige).toBe(50); // no penalty applied
    });

    it("cooldown: a marriage at least a game year old divorces cleanly", async () => {
      const c = await createCharacter("OldEnough");
      await setCreatedAt(c.id, new Date(now.getTime() - 5 * gy()));
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      await setActiveMarriedAt(c.id, new Date(now.getTime() - 2 * gy())); // two game years
      const res = await m.family.divorce(await freshChar(c.id), now);
      expect(res).toMatchObject({ ok: true, branded: false });
    });

    it("the brand: no trait on the first divorce, granted on the second, idempotent on the third", async () => {
      const c = await createCharacter("Serial");
      await setCreatedAt(c.id, new Date(now.getTime() - 5 * gy())); // this life began 5 game years ago
      const divorceOnce = async () => {
        await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
        await setActiveMarriedAt(c.id, new Date(now.getTime() - 2 * gy())); // 2 yrs old, after createdAt
        return m.family.divorce(await freshChar(c.id), now);
      };
      const r1 = await divorceOnce();
      expect(r1).toMatchObject({ ok: true, branded: false });
      expect(await holdsBrand(c.id)).toBe(false);

      const r2 = await divorceOnce();
      expect(r2).toMatchObject({ ok: true, branded: true });
      expect(await holdsBrand(c.id)).toBe(true);
      expect((await repLogs(c.id)).length).toBe(1);
      // The -2 prestige is live-computed from the held trait, never written to base.
      // Isolate the brand's contribution (the character may also hold other statMod
      // traits, e.g. a composure-break recluse) by comparing effective with vs. without it.
      const row = await freshChar(c.id);
      const base = { prestige: row.prestige, devotion: row.devotion, militia: row.militia, intelligence: row.intelligence };
      const held = await m.traits.getHeldTraits(c.id);
      const withoutBrand = held.filter((t) => t.id !== "notorious-divorcer");
      expect(effectiveStats(base, held).prestige).toBe(effectiveStats(base, withoutBrand).prestige - 2);

      const r3 = await divorceOnce();
      expect(r3).toMatchObject({ ok: true, branded: true }); // still holds it
      expect((await repLogs(c.id)).length).toBe(1); // no duplicate audit row
      expect((await db.select().from(m.dbPkg.characterTraits).where(and(eq(m.dbPkg.characterTraits.characterId, c.id), eq(m.dbPkg.characterTraits.traitId, "notorious-divorcer")))).length).toBe(1);
    });

    it("R1 bound: a predecessor-life divorce (marriedAt < createdAt) does not count", async () => {
      const c = await createCharacter("Heir");
      // Seed a predecessor-life divorce via a normal marriage, then end it and push
      // its marriedAt before this life's createdAt.
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      const predMid = (await db.select({ id: m.dbPkg.marriages.id }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, c.id)).limit(1))[0]!.id;
      await db.update(m.dbPkg.marriages).set({ marriedAt: new Date(now.getTime() - 5 * gy()), endedAt: new Date(now.getTime() - 4 * gy()), endReason: "divorced" }).where(eq(m.dbPkg.marriages.id, predMid));
      await db.update(pcs()).set({ spouseCandidateId: null }).where(eq(pcs().id, c.id));
      await setCreatedAt(c.id, new Date(now.getTime() - 3 * gy())); // this life begins AFTER the predecessor's marriage
      // One current-life divorce.
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      await setActiveMarriedAt(c.id, new Date(now.getTime() - 2 * gy())); // after createdAt, ≥ 1 yr
      const res = await m.family.divorce(await freshChar(c.id), now);
      expect(res).toMatchObject({ ok: true, branded: false }); // count is 1 (predecessor excluded)
      expect(await holdsBrand(c.id)).toBe(false);
    });

    it("SpouseView: divorceAvailable tracks the cooldown and agrees with the guard at the boundary", async () => {
      const c = await createCharacter("ViewCheck");
      await setCreatedAt(c.id, new Date(now.getTime() - 5 * gy()));
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });

      await setActiveMarriedAt(c.id, new Date(now.getTime() - gy() / 2)); // inside the year
      const inside = await m.family.familyState(await freshChar(c.id), now);
      expect(inside.spouse?.divorceAvailable).toBe(false);
      expect(inside.spouse?.divorceBlockedReason).toMatch(/at least a year/);

      await setActiveMarriedAt(c.id, new Date(now.getTime() - 2 * gy())); // well past
      const after = await m.family.familyState(await freshChar(c.id), now);
      expect(after.spouse?.divorceAvailable).toBe(true);
      expect(after.spouse?.divorceBlockedReason).toBeNull();

      // Boundary: exactly one game year old → view says available AND the guard lets it through.
      await setActiveMarriedAt(c.id, new Date(now.getTime() - gy()));
      const boundary = await m.family.familyState(await freshChar(c.id), now);
      expect(boundary.spouse?.divorceAvailable).toBe(true);
      expect((await m.family.divorce(await freshChar(c.id), now)).ok).toBe(true);
    });

    it("spouse death ends a young marriage regardless of the divorce cooldown", async () => {
      const c = await createCharacter("Widowed");
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 60, candidateAge: 65 }); // wife already past her death age
      await setActiveMarriedAt(c.id, now); // married this instant — age 0
      await m.family.advanceSpouseDeath(c.id, now);
      const marr = (await db.select().from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, c.id)).limit(1))[0]!;
      expect(marr.endReason).toBe("spouse_died"); // ended despite the young marriage
      expect((await freshChar(c.id)).spouseCandidateId).toBeNull();
    });

    it("scandal headline: a fresh grant surfaces city-wide; stale or absent → null", async () => {
      await db.delete(m.dbPkg.characterTraits).where(eq(m.dbPkg.characterTraits.traitId, "notorious-divorcer")); // clean slate for the city-wide query
      expect(await m.family.scandalHeadline(now)).toBeNull(); // absent

      const c = await createCharacter("Scandalous");
      await db.insert(m.dbPkg.characterTraits).values({ characterId: c.id, traitId: "notorious-divorcer", gainedAt: now });
      expect(await m.family.scandalHeadline(now)).toEqual({ name: "Scandalous" }); // fresh

      await db.update(m.dbPkg.characterTraits).set({ gainedAt: new Date(now.getTime() - 2 * REAL_MS_PER_SEASON) })
        .where(and(eq(m.dbPkg.characterTraits.characterId, c.id), eq(m.dbPkg.characterTraits.traitId, "notorious-divorcer")));
      expect(await m.family.scandalHeadline(now)).toBeNull(); // older than a day
    });
  });

  // -------------------------------------------------------------------------
  // Phase 2: adoption candidates for all family-unlocked houses (ruling A) — the
  // draw extension, per-purpose redraw independence, and the forced-adoption belt.
  // -------------------------------------------------------------------------
  describe("adoption candidates for all houses (phase 2)", () => {
    const pcs = () => m.dbPkg.playerCharacters;
    const fc = () => m.dbPkg.familyCandidates;
    const freshChar = async (id: string) => (await db.select().from(pcs()).where(eq(pcs().id, id)).limit(1))[0]!;
    const drawArgs = () => ({ familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now });
    const perDraw = () => m.family.getFamilyConfig().adoption.perDraw;
    const marriagePerDraw = () => m.family.getFamilyConfig().candidates.perDraw;
    const unconsumed = async (id: string, purpose: "marriage" | "adoption") =>
      await db.select().from(fc()).where(and(eq(fc().forCharacterId, id), eq(fc().purpose, purpose), isNull(fc().consumedAt)));
    const consumeAll = (id: string, purpose: "marriage" | "adoption") =>
      db.update(fc()).set({ consumedAt: now }).where(and(eq(fc().forCharacterId, id), eq(fc().purpose, purpose), isNull(fc().consumedAt)));

    it("every family-unlocked class draws adoption candidates; the hetaira's are women-only; the slave draws none", async () => {
      const land = await createCharacter("AdoptLandowner", "landowner");
      await m.dbPkg.drawFamilyCandidates(land.id, drawArgs());
      expect((await unconsumed(land.id, "adoption")).length).toBe(perDraw());

      const het = await createCharacter("AdoptHetaira", "hetaira");
      await m.dbPkg.drawFamilyCandidates(het.id, drawArgs());
      const hetCands = await unconsumed(het.id, "adoption");
      expect(hetCands.length).toBe(perDraw());
      expect(hetCands.every((c) => c.sex === "female")).toBe(true); // adoptionWomenOnly(hetaira) === true

      const slave = await createCharacter("AdoptSlave", "slave");
      await m.dbPkg.drawFamilyCandidates(slave.id, drawArgs());
      expect((await unconsumed(slave.id, "adoption")).length).toBe(0); // fully locked, no draws of any purpose
    });

    it("per-purpose redraw independence: consuming one purpose never redraws the other", async () => {
      const c = await createCharacter("PerPurpose", "landowner"); // unmarried citizen → draws BOTH purposes
      await m.dbPkg.drawFamilyCandidates(c.id, drawArgs());
      const adoptBefore = (await unconsumed(c.id, "adoption")).map((x) => x.id).sort();
      expect(adoptBefore.length).toBe(perDraw());
      expect((await unconsumed(c.id, "marriage")).length).toBe(marriagePerDraw());

      // Consume all marriage offers → onlyMissing refills marriage, leaves adoption alone.
      await consumeAll(c.id, "marriage");
      await m.dbPkg.drawFamilyCandidates(c.id, { ...drawArgs(), onlyMissing: true });
      expect((await unconsumed(c.id, "marriage")).length).toBe(marriagePerDraw()); // refilled
      expect((await unconsumed(c.id, "adoption")).map((x) => x.id).sort()).toEqual(adoptBefore); // NOT redrawn

      // Inverse: consume adoption → marriage offers stay put.
      const marriageIds = (await unconsumed(c.id, "marriage")).map((x) => x.id).sort();
      await consumeAll(c.id, "adoption");
      await m.dbPkg.drawFamilyCandidates(c.id, { ...drawArgs(), onlyMissing: true });
      expect((await unconsumed(c.id, "adoption")).length).toBe(perDraw()); // refilled
      expect((await unconsumed(c.id, "marriage")).map((x) => x.id).sort()).toEqual(marriageIds); // NOT redrawn
    });

    it("the forced-adoption belt: a legacy character with zero rows gets a fresh draw; a second read reuses it (no double-draw)", async () => {
      const c = await createCharacter("LegacyDead", "landowner");
      await db.delete(fc()).where(eq(fc().forCharacterId, c.id)); // legacy shape: no candidates at all
      await db.update(pcs()).set({ status: "deceased" }).where(eq(pcs().id, c.id)); // childless → forced_adoption

      const info1 = await m.succession.successionInfo(await freshChar(c.id), now);
      expect(info1?.plan.kind).toBe("forced_adoption");
      expect(info1?.candidates.length).toBe(perDraw()); // the belt drew them
      expect((await unconsumed(c.id, "marriage")).length).toBe(0); // belt drew ONLY the adoption purpose

      const ids1 = info1!.candidates.map((x) => x.id).sort();
      const info2 = await m.succession.successionInfo(await freshChar(c.id), now);
      expect(info2?.candidates.map((x) => x.id).sort()).toEqual(ids1); // exactly those rows — no double-draw
    });
  });

  // -------------------------------------------------------------------------
  // Phase 3: the adoption rite — the three guards, the outlook, showAdoption,
  // pendingCount, the adoption notice, and the Chronicle entry.
  // -------------------------------------------------------------------------
  describe("the adoption rite (phase 3)", () => {
    const y = () => m.age.getAgeConfig().realMsPerGameYear;
    const pcs = () => m.dbPkg.playerCharacters;
    const fc = () => m.dbPkg.familyCandidates;
    const freshChar = async (id: string) => (await db.select().from(pcs()).where(eq(pcs().id, id)).limit(1))[0]!;
    const drawAdoption = async (id: string) => {
      await m.dbPkg.drawFamilyCandidates(id, { familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now });
      return (await db.select().from(fc()).where(and(eq(fc().forCharacterId, id), eq(fc().purpose, "adoption"), isNull(fc().consumedAt))))[0]!;
    };
    const insertSon = (id: string, name: string, agoYears: number) =>
      db.insert(m.dbPkg.children).values({ parentCharacterId: id, worldId, name, sex: "male", bornAt: new Date(now.getTime() - agoYears * y()) });
    // A childless citizen aged `age` (createdAt=now → age===startAge) with funds + a drawn ward.
    async function setup(name: string, opts: { age?: number; drachmae?: number; classId?: string } = {}) {
      const c = await createCharacter(name, opts.classId ?? "landowner");
      await db.update(pcs()).set({ startAge: opts.age ?? 35, createdAt: now, drachmae: opts.drachmae ?? 100 }).where(eq(pcs().id, c.id));
      const cand = await drawAdoption(c.id);
      return { id: c.id, candId: cand.id, cand };
    }

    it("the rite: −40 dr atomic, adoptedCandidateId set, candidate consumed, both effectLogs", async () => {
      const s = await setup("RiteHouse", { age: 35, drachmae: 100 });
      const r = await m.succession.adopt(await freshChar(s.id), s.candId, now);
      expect(r).toMatchObject({ ok: true, heirName: s.cand.name, endedRegency: false });
      const f = await freshChar(s.id);
      expect(f.drachmae).toBe(60); // 100 − 40
      expect(f.adoptedCandidateId).toBe(s.candId);
      expect((await db.select().from(fc()).where(eq(fc().id, s.candId)).limit(1))[0]!.consumedAt).not.toBeNull();
      const logs = await db.select().from(m.dbPkg.effectLog).where(eq(m.dbPkg.effectLog.characterId, s.id));
      expect(logs.some((l) => l.kind === "change_drachmae" && (l.detail as { source?: string }).source === "adoption")).toBe(true);
      expect(logs.some((l) => l.kind === "adoption")).toBe(true);
    });

    it("guard 1 — re-adoption is blocked (409 'You have named an heir.'), nothing touched", async () => {
      const s = await setup("Twice", { age: 35, drachmae: 100 });
      await m.succession.adopt(await freshChar(s.id), s.candId, now);
      const before = await freshChar(s.id);
      const cand2 = await drawAdoption(s.id);
      const r = await m.succession.adopt(await freshChar(s.id), cand2.id, now);
      expect(r).toMatchObject({ ok: false, code: 409, error: "You have named an heir." });
      const after = await freshChar(s.id);
      expect(after.drachmae).toBe(before.drachmae); // untouched
      expect(after.adoptedCandidateId).toBe(s.candId); // still the first heir
      expect((await db.select().from(fc()).where(eq(fc().id, cand2.id)).limit(1))[0]!.consumedAt).toBeNull();
    });

    it("guard 2 — age gate: under 30 → 409 (class-correct copy); at 30 → proceeds", async () => {
      const man = await setup("YoungMan", { age: 29, drachmae: 100 });
      expect(await m.succession.adopt(await freshChar(man.id), man.candId, now)).toMatchObject({ ok: false, code: 409, error: "A man under thirty takes a wife, not an heir." });
      const het = await setup("YoungHetaira", { age: 29, drachmae: 100, classId: "hetaira" });
      expect(await m.succession.adopt(await freshChar(het.id), het.candId, now)).toMatchObject({ ok: false, code: 409, error: "A mistress under thirty builds her house before naming its heir." });
      const thirty = await setup("ExactlyThirty", { age: 30, drachmae: 100 });
      expect((await m.succession.adopt(await freshChar(thirty.id), thirty.candId, now)).ok).toBe(true);
    });

    it("guard 3 — insufficient funds → 409, nothing written", async () => {
      const s = await setup("Broke", { age: 35, drachmae: 39 });
      expect(await m.succession.adopt(await freshChar(s.id), s.candId, now)).toMatchObject({ ok: false, code: 409 });
      const f = await freshChar(s.id);
      expect(f.drachmae).toBe(39); // untouched
      expect(f.adoptedCandidateId).toBeNull();
      expect((await db.select().from(fc()).where(eq(fc().id, s.candId)).limit(1))[0]!.consumedAt).toBeNull();
    });

    it("the death-flow is not age-gated: an under-30 heirless death completes a forced adoption", async () => {
      const s = await setup("YoungHeirlessDead", { age: 26, drachmae: 0 });
      await db.delete(fc()).where(eq(fc().forCharacterId, s.id)); // legacy shape too
      await db.update(pcs()).set({ status: "deceased" }).where(eq(pcs().id, s.id));
      const info = await m.succession.successionInfo(await freshChar(s.id), now);
      expect(info?.plan.kind).toBe("forced_adoption");
      expect(info!.candidates.length).toBeGreaterThan(0); // belt drew them
      const r = await m.succession.resolveSuccession(await freshChar(s.id), info!.candidates[0]!.id, now);
      expect(r.ok).toBe(true); // completes despite age 26 + no funds — no gate, no cost
    });

    it("outlook matrix: blood son / minor son → regency / adopted / childless → forced_adoption", async () => {
      const blood = await setup("BloodDad", { age: 40 });
      await insertSon(blood.id, "Kleon", 16);
      expect((await m.family.familyState(await freshChar(blood.id), now)).successionOutlook).toMatchObject({ kind: "blood", heirName: "Kleon" });

      const reg = await setup("RegDad", { age: 40 });
      await insertSon(reg.id, "Boy", 8);
      expect((await m.family.familyState(await freshChar(reg.id), now)).successionOutlook).toMatchObject({ kind: "regency", heirName: "Boy" });

      const adp = await setup("AdpDad", { age: 40, drachmae: 100 });
      await m.succession.adopt(await freshChar(adp.id), adp.candId, now);
      expect((await m.family.familyState(await freshChar(adp.id), now)).successionOutlook).toMatchObject({ kind: "adopted", heirName: adp.cand.name });

      const none = await setup("NoneDad", { age: 40 });
      expect((await m.family.familyState(await freshChar(none.id), now)).successionOutlook).toMatchObject({ kind: "forced_adoption", heirName: null });
    });

    it("showAdoption matrix: childless 35 → true; hasAdopted → false; under-30 → false; blood → false", async () => {
      const show = await setup("ShowA", { age: 35, drachmae: 100 });
      expect((await m.family.familyState(await freshChar(show.id), now)).showAdoption).toBe(true);
      await m.succession.adopt(await freshChar(show.id), show.candId, now);
      expect((await m.family.familyState(await freshChar(show.id), now)).showAdoption).toBe(false); // hasAdopted hides

      const young = await setup("ShowYoung", { age: 29 });
      expect((await m.family.familyState(await freshChar(young.id), now)).showAdoption).toBe(false); // under 30 hides

      const blood = await setup("ShowBlood", { age: 40 });
      await insertSon(blood.id, "Heir", 16);
      expect((await m.family.familyState(await freshChar(blood.id), now)).showAdoption).toBe(false); // blood-secure hides
    });

    it("pendingCount: 2 unnamed newborns + 1 notice → 3; naming one → 2; windows expire → 0", async () => {
      const c = await createCharacter("PendHouse", "landowner");
      await db.update(pcs()).set({ startAge: 35, createdAt: now }).where(eq(pcs().id, c.id));
      await db.insert(m.dbPkg.children).values({ parentCharacterId: c.id, worldId, name: "A", sex: "male", bornAt: now, named: false });
      const childB = (await db.insert(m.dbPkg.children).values({ parentCharacterId: c.id, worldId, name: "B", sex: "female", bornAt: now, named: false }).returning())[0]!;
      // One in-window notice: a divorce that just landed.
      await marryTo(c.id, { personalityTraitId: null, spouseDeathAge: 999, candidateAge: 30 });
      const mid = (await db.select({ id: m.dbPkg.marriages.id }).from(m.dbPkg.marriages).where(eq(m.dbPkg.marriages.characterId, c.id)).limit(1))[0]!.id;
      await db.update(m.dbPkg.marriages).set({ endedAt: now, endReason: "divorced" }).where(eq(m.dbPkg.marriages.id, mid));
      await db.update(pcs()).set({ spouseCandidateId: null }).where(eq(pcs().id, c.id));
      expect((await m.family.familyState(await freshChar(c.id), now)).pendingCount).toBe(3);

      await db.update(m.dbPkg.children).set({ named: true }).where(eq(m.dbPkg.children.id, childB.id));
      expect((await m.family.familyState(await freshChar(c.id), now)).pendingCount).toBe(2);

      // Expire everything: name the last child + age the divorce out of the window.
      await db.update(m.dbPkg.children).set({ named: true }).where(and(eq(m.dbPkg.children.parentCharacterId, c.id)));
      await db.update(m.dbPkg.marriages).set({ endedAt: new Date(now.getTime() - 2 * REAL_MS_PER_SEASON) }).where(eq(m.dbPkg.marriages.id, mid));
      expect((await m.family.familyState(await freshChar(c.id), now)).pendingCount).toBe(0);
    });

    it("chronicle: an adopted heir yields an adoption entry (heir + house); absent without one", async () => {
      const s = await setup("ChronHouse", { age: 40, drachmae: 100 });
      expect((await m.dbPkg.gatherChronicleForCharacter(s.id)).some((e) => e.type === "adoption")).toBe(false);
      await m.succession.adopt(await freshChar(s.id), s.candId, now);
      const entry = (await m.dbPkg.gatherChronicleForCharacter(s.id)).find((e) => e.type === "adoption");
      expect(entry).toBeTruthy();
      expect(entry!.payload.heirName).toBe(s.cand.name);
      expect(typeof entry!.payload.houseName).toBe("string"); // the ward's house, resolved from its slug
      expect(entry!.payload.houseName).toBeTruthy();
    });

    it("adoption notice: present within the season after adopting, gone after", async () => {
      const s = await setup("NoticeHouse", { age: 40, drachmae: 100 });
      await m.succession.adopt(await freshChar(s.id), s.candId, now);
      expect((await m.family.familyState(await freshChar(s.id), now)).adoptionNotice).toMatchObject({ name: s.cand.name });
      const later = new Date(now.getTime() + 2 * REAL_MS_PER_SEASON);
      expect((await m.family.familyState(await freshChar(s.id), later)).adoptionNotice).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Male adoption for citizen houses: the generator draws men for citizens
  // (women for the hetaira), the view filter hides stale wrong-sex rows, and
  // adopt() guards the class rule. Death-flow inherits male-only via the generator.
  // -------------------------------------------------------------------------
  describe("citizen adoption draws men (patrilineal)", () => {
    const pcs = () => m.dbPkg.playerCharacters;
    const fc = () => m.dbPkg.familyCandidates;
    const freshChar = async (id: string) => (await db.select().from(pcs()).where(eq(pcs().id, id)).limit(1))[0]!;
    const drawArgs = () => ({ familyCfg: m.family.getFamilyConfig(), ageCfg: m.age.getAgeConfig(), now });
    const adoptionCands = async (id: string) => await db.select().from(fc()).where(and(eq(fc().forCharacterId, id), eq(fc().purpose, "adoption"), isNull(fc().consumedAt)));
    const poolOf = (avatarId: string | null) => m.age.getAgeConfig().avatars.find((a) => a.id === avatarId)?.pool;
    const seedFemaleWard = (id: string) =>
      db.insert(fc()).values({ worldId, forCharacterId: id, purpose: "adoption", name: "StaleWard", sex: "female", houseSlug: "test-house", age: 30 }).returning();

    it("a citizen's adoption draw is all male; the hetaira's stays all female", async () => {
      const cit = await createCharacter("CitAdopt", "landowner");
      await m.dbPkg.drawFamilyCandidates(cit.id, drawArgs());
      const cc = await adoptionCands(cit.id);
      expect(cc.length).toBeGreaterThan(0);
      expect(cc.every((c) => c.sex === "male")).toBe(true);

      const het = await createCharacter("HetAdopt", "hetaira");
      await m.dbPkg.drawFamilyCandidates(het.id, drawArgs());
      const hc = await adoptionCands(het.id);
      expect(hc.length).toBeGreaterThan(0);
      expect(hc.every((c) => c.sex === "female")).toBe(true);
    });

    it("male adoption candidates carry a player-pool portrait, never a wife-pool one", async () => {
      const cit = await createCharacter("PortraitCit", "landowner");
      await m.dbPkg.drawFamilyCandidates(cit.id, drawArgs());
      for (const c of await adoptionCands(cit.id)) {
        if (c.avatarId) expect(poolOf(c.avatarId)).not.toBe("wife"); // male → player pool
      }
    });

    it("adopt() rejects a stale wrong-sex ward (class copy), accepts the right-sex one", async () => {
      const cit = await createCharacter("GuardCit", "landowner");
      await db.update(pcs()).set({ startAge: 40, createdAt: now, drachmae: 100 }).where(eq(pcs().id, cit.id));
      const female = (await seedFemaleWard(cit.id))[0]!;
      expect(await m.succession.adopt(await freshChar(cit.id), female.id, now)).toMatchObject({ ok: false, code: 409, error: "The house takes a son." });
      // The yearly replace retires the stale row and draws men; a son is accepted.
      await m.dbPkg.drawFamilyCandidates(cit.id, drawArgs());
      const son = (await adoptionCands(cit.id)).find((c) => c.sex === "male")!;
      expect((await m.succession.adopt(await freshChar(cit.id), son.id, now)).ok).toBe(true);
    });

    it("view filter: a seeded stale female is hidden from a citizen's familyState offers", async () => {
      const cit = await createCharacter("ViewCit", "landowner");
      await db.update(pcs()).set({ startAge: 40, createdAt: now }).where(eq(pcs().id, cit.id));
      await m.dbPkg.drawFamilyCandidates(cit.id, drawArgs()); // 3 men
      await seedFemaleWard(cit.id); // a stale woman alongside them
      const offers = (await m.family.familyState(await freshChar(cit.id), now)).candidates.adoption;
      expect(offers.length).toBe(3); // only the men
      expect(offers.every((c: { sex: string }) => c.sex === "male")).toBe(true);
      expect(offers.some((c: { name: string }) => c.name === "StaleWard")).toBe(false);
    });

    it("the death-flow forced-adoption list is male-only (a fresh belt draw)", async () => {
      const cit = await createCharacter("DeathCit", "landowner");
      await db.update(pcs()).set({ status: "deceased" }).where(eq(pcs().id, cit.id)); // childless → forced_adoption
      const info = await m.succession.successionInfo(await freshChar(cit.id), now);
      expect(info?.plan.kind).toBe("forced_adoption");
      expect(info!.candidates.length).toBeGreaterThan(0);
      expect(info!.candidates.every((c) => c.sex === "male")).toBe(true); // belt drew men via the generator
    });
  });
});
