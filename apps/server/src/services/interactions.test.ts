import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Interaction Pipeline integration tests — run against a REAL Postgres. Guarded:
// they only run when DATABASE_URL points at a *_test database (they truncate it),
// mirroring the Oligarchy Chamber suite:
//   createdb massalia_test && DATABASE_URL=postgres://…/massalia_test pnpm db:migrate
//   DATABASE_URL=postgres://…/massalia_test pnpm --filter @massalia/server test
// Without that env (CI, plain `pnpm -r test`) the suite is skipped.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const runs = dbUrl.includes("_test");

const suite = describe.runIf(runs);

// Imports of modules that call createDb() at module scope must stay dynamic so
// the skipped suite never demands a DATABASE_URL.
type Mods = Awaited<ReturnType<typeof loadModules>>;
async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const oligarchy = await import("./oligarchy.js");
  const interactions = await import("./interactions.js");
  const buildings = await import("./buildings.js");
  const traits = await import("./traits.js");
  const age = await import("./age.js");
  const family = await import("./family.js");
  const composure = await import("./composure.js");
  return { dbPkg, oligarchy, interactions, buildings, traits, age, family, composure };
}

suite("the Interaction Pipeline (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  // One fresh character slot (user + player + player_characters row).
  async function createCharacter(name: string, opts: { drachmae?: number; classId?: string; party?: string; prestige?: number; intelligence?: number } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@test`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const character = (
      await db
        .insert(playerCharacters)
        .values({
          playerId: player.id,
          worldId,
          houseSlug: "test-house",
          classId: opts.classId ?? "trader",
          drachmae: opts.drachmae ?? 500,
          party: opts.party ?? "none",
          prestige: opts.prestige ?? 0,
          intelligence: opts.intelligence ?? 0,
          startAge: 30,
          deathAge: 90,
        })
        .returning()
    )[0]!;
    return character;
  }

  // Seed a player-scoped resource (poison / remedy) directly — the poison/treat
  // gates read resources by (scope='player', scopeId=playerId, type).
  async function seedResource(playerId: string, type: string, amount: number) {
    const { resources } = m.dbPkg;
    await db.insert(resources).values({ scope: "player", scopeId: playerId, type, amount: String(amount), ratePerSecond: "0", lastUpdatedAt: now });
  }
  async function resourceAmount(playerId: string, type: string) {
    const { resources } = m.dbPkg;
    const rows = await db.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId), eq(resources.type, type))).limit(1);
    return Number(rows[0]?.amount ?? 0);
  }
  // A physician the target retains (settledPopCount reads this after settling).
  async function seedPhysician(playerId: string) {
    const { playerPops } = m.dbPkg;
    await db.insert(playerPops).values({ worldId, ownerPlayerId: playerId, popType: "physician", count: 1 });
  }
  async function heldTraitIds(characterId: string) {
    return (await m.traits.getHeldTraits(characterId)).map((t) => t.id);
  }

  async function freshRow(id: string) {
    const { playerCharacters } = m.dbPkg;
    return (await db.select().from(playerCharacters).where(eq(playerCharacters.id, id)).limit(1))[0]!;
  }

  // A seat-holding oligarch with an exact wallet: buy a seat (which needs 300+),
  // then set the balance to the value the test wants.
  async function oligarch(name: string, drachmae: number) {
    const { playerCharacters } = m.dbPkg;
    const c = await createCharacter(name, { drachmae: 400 });
    expect((await m.oligarchy.buySeat(c, now)).ok).toBe(true);
    await db.update(playerCharacters).set({ drachmae }).where(eq(playerCharacters.id, c.id));
    return freshRow(c.id);
  }

  async function interactionRows(targetId: string) {
    const { interactions } = m.dbPkg;
    return db.select().from(interactions).where(eq(interactions.targetCharacterId, targetId));
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();

    const politics = await m.oligarchy.loadPoliticsConfig();
    await m.interactions.loadInteractionsConfig();
    // Poison resolution reaches the buildings/traits/age/family/composure services.
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.traits.loadTraitDefs();
    await m.age.loadAgeConfig();
    await m.family.loadFamilyConfig();
    await m.composure.loadComposureConfig();

    // A clean slate in the dedicated test database.
    await db.execute(sql`
      TRUNCATE TABLE interactions, resources, player_pops, player_buildings, chamber_ballots, chamber_votes,
        oligarch_seats, daily_decisions, daily_routines, event_history, effect_log, composure_log,
        character_traits, censures, children, successions, marriages, family_candidates, festival_events,
        festival_donations, festival_choregos, olympic_votes, olympic_candidates, olympiads,
        player_characters, dynasties, players, sessions, users, worlds CASCADE
    `);
    await db.insert(m.dbPkg.houses).values({
      slug: "test-house", name: "Test House", initial: "T", alignment: "centrist",
      stance: "test", motto: "test", patron: "test", crest: "test",
    }).onConflictDoNothing();

    const startedAt = new Date(now.getTime() - 10 * 60 * 1000);
    const world = (
      await db.insert(m.dbPkg.worlds).values({
        name: "Interaction Test World", seed: `interaction-test`, startedAt,
        endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active",
      }).returning()
    )[0]!;
    worldId = world.id;
    await m.dbPkg.ensureChamberSeats(worldId, politics.chamber);
  });

  it("a non-oligarch cannot give — 403 with the seat reason, and writes no row", async () => {
    const commoner = await createCharacter("Idiotes", { drachmae: 1000 });
    const target = await createCharacter("Doron", { drachmae: 0 });
    const result = await m.interactions.giveDrachmae(commoner, target.id, 50);
    expect(result).toMatchObject({ ok: false, code: 403, error: "Requires a seat in the chamber." });
    expect(await interactionRows(target.id)).toHaveLength(0);
  });

  it("giving to yourself is refused — 409, no row", async () => {
    const self = await oligarch("Narcissus", 500);
    const result = await m.interactions.giveDrachmae(self, self.id, 10);
    expect(result).toMatchObject({ ok: false, code: 409 });
    expect(await interactionRows(self.id)).toHaveLength(0);
  });

  it("insufficient funds is refused — 409, and NO interaction row is written", async () => {
    const poor = await oligarch("Penes", 40);
    const target = await createCharacter("Ploutos", { drachmae: 0 });
    const result = await m.interactions.giveDrachmae(poor, target.id, 50);
    expect(result).toMatchObject({ ok: false, code: 409 });
    expect(await interactionRows(target.id)).toHaveLength(0);
    // Neither wallet moved.
    expect((await freshRow(poor.id)).drachmae).toBe(40);
    expect((await freshRow(target.id)).drachmae).toBe(0);
  });

  it("a dead target is refused — 409, no row", async () => {
    const { playerCharacters } = m.dbPkg;
    const donor = await oligarch("Euergetes", 500);
    const corpse = await createCharacter("Nekros", { drachmae: 0 });
    await db.update(playerCharacters).set({ status: "deceased" }).where(eq(playerCharacters.id, corpse.id));
    const result = await m.interactions.giveDrachmae(donor, corpse.id, 50);
    expect(result).toMatchObject({ ok: false, code: 409, error: "The dead make no dealings." });
    expect(await interactionRows(corpse.id)).toHaveLength(0);
  });

  it("a successful give moves both wallets, writes exactly one row, and lands in the chronicle", async () => {
    const donor = await oligarch("Timon", 500);
    const target = await createCharacter("Kleon", { drachmae: 100 });
    const result = await m.interactions.giveDrachmae(donor, target.id, 150);
    expect(result).toMatchObject({ ok: true, amount: 150, wallet: 350 });

    expect((await freshRow(donor.id)).drachmae).toBe(350);
    expect((await freshRow(target.id)).drachmae).toBe(250);

    const rows = await interactionRows(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("give");
    expect(rows[0]!.payload).toMatchObject({ amount: 150 });
    expect(rows[0]!.actorCharacterId).toBe(donor.id);
    expect(rows[0]!.worldId).toBe(worldId);

    // The gift lands in the target's chronicle as a gift_received entry.
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(target.id);
    const gift = chronicle.find((e) => e.type === "gift_received");
    expect(gift).toBeDefined();
    // actorName + amount are deterministic; the house display name comes from the
    // shared houses table (seeded once across test files), so only assert it resolved.
    expect(gift!.payload).toMatchObject({ actorName: "Timon", amount: 150 });
    expect(typeof (gift!.payload as { houseName?: unknown }).houseName).toBe("string");
    expect((gift!.payload as { houseName: string }).houseName.length).toBeGreaterThan(0);
  });

  it("daily inbound cap: a citizen can receive at most dailyInboundCap drachmae in gifts per day", async () => {
    const cap = m.interactions.getInteractionsConfig().actions.give.dailyInboundCap;
    expect(cap).toBe(2000);
    const donor = await oligarch("Patron", 100_000);
    const target = await createCharacter("Favourite");
    const spare = await createCharacter("Bystander");
    expect(await m.interactions.giveDrachmae(donor, target.id, cap)).toMatchObject({ ok: true });
    const over = await m.interactions.giveDrachmae(donor, target.id, 1);
    expect(over).toMatchObject({ ok: false, code: 409 });
    expect(over.ok ? "" : over.error).toMatch(/already received all the gifts the city allows today \(2000 drachmae\)/);
    expect((await freshRow(target.id)).drachmae).toBe(500 + cap); // the refused gift moved nothing
    expect((await freshRow(donor.id)).drachmae).toBe(100_000 - cap);
    expect(await interactionRows(target.id)).toHaveLength(1);
    // Another citizen's day is their own.
    expect(await m.interactions.giveDrachmae(donor, spare.id, 10)).toMatchObject({ ok: true });
  });

  it("concurrent gives cannot overdraw the actor — the guarded decrement holds the floor", async () => {
    const donor = await oligarch("Kroisos", 100);
    const a = await createCharacter("AlphaHeir", { drachmae: 0 });
    const b = await createCharacter("BetaHeir", { drachmae: 0 });
    // Both start from the SAME stale row (drachmae 100) and each try to give 100.
    const [r1, r2] = await Promise.all([
      m.interactions.giveDrachmae(donor, a.id, 100),
      m.interactions.giveDrachmae(donor, b.id, 100),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    const fails = [r1, r2].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({ code: 409 });

    // The wallet never went negative — exactly one 100-gift left it at 0.
    expect((await freshRow(donor.id)).drachmae).toBe(0);
    // Exactly one of the two recipients was credited; exactly one row exists.
    const credited = (await freshRow(a.id)).drachmae + (await freshRow(b.id)).drachmae;
    expect(credited).toBe(100);
    const total = (await interactionRows(a.id)).length + (await interactionRows(b.id)).length;
    expect(total).toBe(1);
  });

  it("publicProfile exposes public facts and the exact lock reasons", async () => {
    const viewer = await oligarch("Boularchos", 500);
    const seatIndex = (await m.oligarchy.seatOf(viewer.id))!.seatIndex;

    // An oligarch viewing another living citizen may interact (no lock).
    const target = await createCharacter("Politician", { drachmae: 0, party: "dynatoi" });
    const p1 = (await m.interactions.publicProfile(viewer, target.id))!;
    expect(p1).toMatchObject({ characterId: target.id, name: "Politician", houseSlug: "test-house", classId: "trader", party: "dynatoi", prestige: 0, isAlive: true, seatIndex: null });
    expect(p1.viewer).toMatchObject({ isOligarch: true, canInteract: true, lockReason: null });

    // Viewing a dead citizen: "The dead make no dealings."
    const { playerCharacters } = m.dbPkg;
    const corpse = await createCharacter("Nekros2", { drachmae: 0 });
    await db.update(playerCharacters).set({ status: "deceased" }).where(eq(playerCharacters.id, corpse.id));
    const p2 = (await m.interactions.publicProfile(viewer, corpse.id))!;
    expect(p2.isAlive).toBe(false);
    expect(p2.viewer).toMatchObject({ canInteract: false, lockReason: "The dead make no dealings." });

    // A non-oligarch viewer: "Requires a seat in the chamber."
    const commoner = await createCharacter("Idiotes2", { drachmae: 0 });
    const p3 = (await m.interactions.publicProfile(commoner, target.id))!;
    expect(p3.viewer).toMatchObject({ isOligarch: false, canInteract: false, lockReason: "Requires a seat in the chamber." });

    // Self-profile: no lock reason, canInteract false. Seat shows on the holder's own profile.
    const pSelf = (await m.interactions.publicProfile(viewer, viewer.id))!;
    expect(pSelf.seatIndex).toBe(seatIndex);
    expect(pSelf.isSelf).toBe(true);
    expect(pSelf.viewer).toMatchObject({ canInteract: false, lockReason: null });
    expect(p1.isSelf).toBe(false);
  });

  // --- Poison channel (Prompt 2) --------------------------------------------

  // A standing, poisonable target: prestige at/above the floor (10).
  async function standingTarget(name: string, opts: { intelligence?: number } = {}) {
    return createCharacter(name, { drachmae: 0, prestige: 20, intelligence: opts.intelligence ?? 0 });
  }
  // Force the two poison rolls (success roll, then severity roll). See forcedPoisonRng.
  const seq = (...vals: number[]) => {
    let i = 0;
    return () => vals[Math.min(i++, vals.length - 1)]!;
  };
  // Both rolls read 0 → success (0 < p) then illness (0 < illnessChance).
  const forceIll = () => 0;
  // The success roll reads ~1 → never below p → failure.
  const forceFail = () => 0.999999;

  it("poison gates: a non-oligarch is refused 403 and consumes nothing", async () => {
    const commoner = await createCharacter("Pleb", { drachmae: 0 });
    await seedResource(commoner.playerId, "poison", 1);
    const target = await standingTarget("Victim1");
    const result = await m.interactions.poisonAttempt(commoner, target.id, now, forceFail);
    expect(result).toMatchObject({ ok: false, code: 403, error: "Requires a seat in the chamber." });
    expect(await resourceAmount(commoner.playerId, "poison")).toBe(1);
    expect(await interactionRows(target.id)).toHaveLength(0);
  });

  it("poison gates: an under-floor target is shielded 403, consumes nothing", async () => {
    const actor = await oligarch("Assassin1", 0);
    await seedResource(actor.playerId, "poison", 1);
    const lowly = await createCharacter("Nobody", { drachmae: 0, prestige: 5 }); // below floor 10
    const result = await m.interactions.poisonAttempt(actor, lowly.id, now, forceFail);
    expect(result).toMatchObject({ ok: false, code: 403, error: "Target lacks standing." });
    expect(await resourceAmount(actor.playerId, "poison")).toBe(1);
    expect(await interactionRows(lowly.id)).toHaveLength(0);
  });

  it("poison gates: no poison → 409 and nothing is consumed", async () => {
    const actor = await oligarch("Assassin2", 0);
    const target = await standingTarget("Victim2");
    const result = await m.interactions.poisonAttempt(actor, target.id, now, forceFail);
    expect(result).toMatchObject({ ok: false, code: 409, error: "You hold no poison." });
    expect(await interactionRows(target.id)).toHaveLength(0);
  });

  it("a failed attempt still consumes the poison and writes exactly one interaction row", async () => {
    const actor = await oligarch("Assassin3", 0);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("Victim3");
    const result = await m.interactions.poisonAttempt(actor, target.id, now, forceFail);
    expect(result).toMatchObject({ ok: true, outcome: "failed" });
    expect(await resourceAmount(actor.playerId, "poison")).toBe(0);
    const rows = await interactionRows(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("poison");
    expect(rows[0]!.payload).toMatchObject({ outcome: "failed" });
    // A failure leaves no target-visible chronicle record.
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(target.id);
    expect(chronicle.some((e) => e.type === "poison_illness")).toBe(false);
  });

  it("the illness path adds the poisoned trait + a chronicle entry", async () => {
    const actor = await oligarch("Assassin4", 0);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("Victim4");
    const result = await m.interactions.poisonAttempt(actor, target.id, now, forceIll);
    expect(result).toMatchObject({ ok: true, outcome: "ill" });
    expect(await heldTraitIds(target.id)).toContain("poisoned");
    expect((await freshRow(target.id)).status).toBe("alive");
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(target.id);
    expect(chronicle.some((e) => e.type === "poison_illness")).toBe(true);
    expect(await interactionRows(target.id)).toHaveLength(1);
  });

  it("the death path sets death_age and flips status to deceased (succession reuse)", async () => {
    const { playerCharacters } = m.dbPkg;
    const actor = await oligarch("Assassin5", 0);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("Victim5");
    const before = await freshRow(target.id);
    const result = await m.interactions.poisonAttempt(actor, target.id, now, seq(0, 0.999999));
    expect(result).toMatchObject({ ok: true, outcome: "dead" });
    const after = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, target.id)).limit(1))[0]!;
    expect(after.status).toBe("deceased");
    expect(after.deathAge).not.toBeNull();
    expect(after.deathAge!).toBeLessThan(before.deathAge!); // pulled down to the current age
    // Poison death produces no chronicle line (the succession flow is the announcement).
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(target.id);
    expect(chronicle.some((e) => e.type === "poison_illness")).toBe(false);
  });

  it("a physician the target retains lowers the odds (settled read) — attempt still resolves", async () => {
    const actor = await oligarch("Assassin6", 0);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("Guarded");
    await seedPhysician(target.playerId);
    // Forced success is independent of the odds; the point is the settled physician
    // read runs without error and the attempt still resolves + consumes.
    const result = await m.interactions.poisonAttempt(actor, target.id, now, forceIll);
    expect(result).toMatchObject({ ok: true, outcome: "ill" });
    expect(await resourceAmount(actor.playerId, "poison")).toBe(0);
  });

  it("treat: happy path purges the poison and records the cure", async () => {
    const patient = await createCharacter("Patient1", { drachmae: 0 });
    // Afflict + attend + supply the remedy.
    const { characterTraits } = m.dbPkg;
    await db.insert(characterTraits).values({ characterId: patient.id, traitId: "poisoned" });
    await seedPhysician(patient.playerId);
    await seedResource(patient.playerId, "remedy", 1);

    const result = await m.interactions.treat(await freshRow(patient.id), now);
    expect(result).toMatchObject({ ok: true });
    expect(await heldTraitIds(patient.id)).not.toContain("poisoned");
    expect(await resourceAmount(patient.playerId, "remedy")).toBe(0);
    const treatRows = (await interactionRows(patient.id)).filter((r) => r.type === "treat");
    expect(treatRows).toHaveLength(1);
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(patient.id);
    expect(chronicle.some((e) => e.type === "venom_purged")).toBe(true);
  });

  it("treat gates: not afflicted / no physician / no remedy", async () => {
    const { characterTraits } = m.dbPkg;
    // Not afflicted.
    const healthy = await createCharacter("Healthy", { drachmae: 0 });
    expect(await m.interactions.treat(healthy, now)).toMatchObject({ ok: false, code: 409, error: "You are not afflicted." });

    // Afflicted but no physician.
    const noDoc = await createCharacter("NoDoc", { drachmae: 0 });
    await db.insert(characterTraits).values({ characterId: noDoc.id, traitId: "poisoned" });
    await seedResource(noDoc.playerId, "remedy", 1);
    expect(await m.interactions.treat(noDoc, now)).toMatchObject({ ok: false, code: 409, error: "No physician attends you." });

    // Afflicted, physician, but no remedy.
    const noRemedy = await createCharacter("NoRemedy", { drachmae: 0 });
    await db.insert(characterTraits).values({ characterId: noRemedy.id, traitId: "poisoned" });
    await seedPhysician(noRemedy.playerId);
    expect(await m.interactions.treat(noRemedy, now)).toMatchObject({ ok: false, code: 409, error: "You hold no remedy." });
  });

  it("physician retention cap (max 1) is enforced at the second hire", async () => {
    const doctor = await createCharacter("Retainer", { drachmae: 500 });
    const ctx = (await m.buildings.buildingContext(doctor.playerId, worldId))!;
    expect((await m.buildings.hirePops(ctx, "physician", 1, now)).ok).toBe(true);
    const second = await m.buildings.hirePops(ctx, "physician", 1, now);
    expect(second).toMatchObject({ ok: false, code: 409, error: "You already retain a physician." });
    // Still exactly one, and the blocked hire cost nothing (wallet only paid once).
    const after = await freshRow(doctor.id);
    expect(after.drachmae).toBe(400);
  });

  // --- R1: idempotent poison trait ------------------------------------------

  it("(R1) a second forced-illness poison is a no-op on the trait but still consumes + logs", async () => {
    const { characterTraits } = m.dbPkg;
    const actor = await oligarch("DoublePoisoner", 0);
    await seedResource(actor.playerId, "poison", 2);
    const target = await standingTarget("TwicePoisoned");

    expect(await m.interactions.poisonAttempt(actor, target.id, now, forceIll)).toMatchObject({ ok: true, outcome: "ill" });
    // The two channels share a per-target cooldown now, so the SECOND illness poison
    // must fall past the window (49h) to land — this test is about the trait/ledger,
    // not the cooldown.
    expect(await m.interactions.poisonAttempt(actor, target.id, new Date(now.getTime() + 49 * 3_600_000), forceIll)).toMatchObject({ ok: true, outcome: "ill" });

    // Exactly one trait row (ON CONFLICT DO NOTHING against the unique index)…
    const traitRows = await db.select().from(characterTraits).where(and(eq(characterTraits.characterId, target.id), eq(characterTraits.traitId, "poisoned")));
    expect(traitRows).toHaveLength(1);
    // …but two interaction rows, and both poisons consumed.
    expect((await interactionRows(target.id)).filter((r) => r.type === "poison")).toHaveLength(2);
    expect(await resourceAmount(actor.playerId, "poison")).toBe(0);
  });

  // --- Assassinate channel (Prompt 3) ---------------------------------------

  async function seedBodyguards(playerId: string, n: number) {
    const { playerPops } = m.dbPkg;
    await db.insert(playerPops).values({ worldId, ownerPlayerId: playerId, popType: "bodyguard", count: n });
  }
  const forceDead = () => 0; // roll 0 < p → success (death)

  it("assassinate gates: non-oligarch 403 / under-floor 403 / can't afford 409 — nothing charged", async () => {
    // Non-oligarch.
    const commoner = await createCharacter("Cutpurse", { drachmae: 1000 });
    const t1 = await standingTarget("Mark1");
    expect(await m.interactions.assassinateAttempt(commoner, t1.id, now, forceFail)).toMatchObject({ ok: false, code: 403, error: "Requires a seat in the chamber." });
    expect((await freshRow(commoner.id)).drachmae).toBe(1000);
    expect(await interactionRows(t1.id)).toHaveLength(0);

    // Under-floor target.
    const actor = await oligarch("Blademaster", 1000);
    const lowly = await createCharacter("Nobody2", { drachmae: 0, prestige: 5 });
    expect(await m.interactions.assassinateAttempt(actor, lowly.id, now, forceFail)).toMatchObject({ ok: false, code: 403, error: "Target lacks standing." });
    expect((await freshRow(actor.id)).drachmae).toBe(1000);
    expect(await interactionRows(lowly.id)).toHaveLength(0);

    // Can't afford (cost is 200).
    const pauper = await oligarch("Pauper", 150);
    const t3 = await standingTarget("Mark3");
    expect(await m.interactions.assassinateAttempt(pauper, t3.id, now, forceFail)).toMatchObject({ ok: false, code: 409, error: "A blade costs 200 drachmae — you cannot afford it." });
    expect((await freshRow(pauper.id)).drachmae).toBe(150);
    expect(await interactionRows(t3.id)).toHaveLength(0);
  });

  it("assassinate cannot mark yourself — 409", async () => {
    const actor = await oligarch("SelfBlade", 500);
    // prestige floor is checked before self, but the actor has 0 prestige (< floor),
    // so give them standing first to reach the self gate.
    await db.update(m.dbPkg.playerCharacters).set({ prestige: 20 }).where(eq(m.dbPkg.playerCharacters.id, actor.id));
    const fresh = await freshRow(actor.id);
    expect(await m.interactions.assassinateAttempt(fresh, fresh.id, now, forceFail)).toMatchObject({ ok: false, code: 409, error: "You cannot mark yourself." });
  });

  it("a failed blade still costs the full price and writes exactly one row", async () => {
    const actor = await oligarch("Failer", 500);
    const target = await standingTarget("Survivor");
    const result = await m.interactions.assassinateAttempt(actor, target.id, now, forceFail);
    expect(result).toMatchObject({ ok: true, outcome: "failed" });
    expect((await freshRow(actor.id)).drachmae).toBe(300); // 500 − 200
    const rows = await interactionRows(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("assassinate");
    expect(rows[0]!.payload).toMatchObject({ outcome: "failed" });
  });

  it("a failed blade is target-visible in the chronicle, and anonymous", async () => {
    const actor = await oligarch("Shadow", 500);
    const target = await standingTarget("Watched");
    expect(await m.interactions.assassinateAttempt(actor, target.id, now, forceFail)).toMatchObject({ ok: true, outcome: "failed" });
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(target.id);
    const survived = chronicle.find((e) => e.type === "assassination_survived");
    expect(survived).toBeDefined();
    // Anonymous — the payload carries no actor identity.
    expect(survived!.payload).toEqual({});
  });

  it("the death path sets death_age and flips status to deceased (succession reuse)", async () => {
    const { playerCharacters } = m.dbPkg;
    const actor = await oligarch("Killer", 500);
    const target = await standingTarget("Doomed");
    const before = await freshRow(target.id);
    const result = await m.interactions.assassinateAttempt(actor, target.id, now, forceDead);
    expect(result).toMatchObject({ ok: true, outcome: "dead" });
    expect((await freshRow(actor.id)).drachmae).toBe(300);
    const after = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, target.id)).limit(1))[0]!;
    expect(after.status).toBe("deceased");
    expect(after.deathAge).not.toBeNull();
    expect(after.deathAge!).toBeLessThan(before.deathAge!);
    // A successful assassination produces no chronicle line (succession announces it).
    const chronicle = await m.dbPkg.gatherChronicleForCharacter(target.id);
    expect(chronicle.some((e) => e.type === "assassination_survived")).toBe(false);
  });

  it("bodyguards are read through the settled path — the attempt resolves with them present", async () => {
    const actor = await oligarch("Intruder", 500);
    const target = await standingTarget("Guarded2");
    await seedBodyguards(target.playerId, 3);
    // Forced success is independent of the odds; the point is the settled bodyguard
    // read runs cleanly and the attempt still resolves + charges.
    const result = await m.interactions.assassinateAttempt(actor, target.id, now, forceDead);
    expect(result).toMatchObject({ ok: true, outcome: "dead" });
    expect((await freshRow(actor.id)).drachmae).toBe(300);
  });

  // --- Spymaster (Prompt 4) -------------------------------------------------

  async function seedSpymaster(playerId: string) {
    const { playerPops } = m.dbPkg;
    await db.insert(playerPops).values({ worldId, ownerPlayerId: playerId, popType: "spymaster", count: 1 });
  }
  // A seat-holding actor with an exact wallet, intelligence, and (optionally) posture.
  async function seatedActor(name: string, opts: { drachmae: number; intelligence?: number; posture?: string }) {
    const { playerCharacters } = m.dbPkg;
    const c = await createCharacter(name, { drachmae: 400, intelligence: opts.intelligence ?? 0 });
    expect((await m.oligarchy.buySeat(c, now)).ok).toBe(true);
    const set: Record<string, unknown> = { drachmae: opts.drachmae };
    if (opts.posture) set.spymasterPosture = opts.posture;
    await db.update(playerCharacters).set(set).where(eq(playerCharacters.id, c.id));
    return freshRow(c.id);
  }

  it("posture gate: no spymaster retained → 409", async () => {
    const actor = await seatedActor("Postureless", { drachmae: 0 });
    expect(await m.interactions.setSpymasterPosture(actor, "hunt", now)).toMatchObject({ ok: false, code: 409, error: "You retain no spymaster." });
  });

  it("posture gate: same posture → 409, and the happy switch updates BOTH columns + starts the cooldown", async () => {
    const { playerCharacters } = m.dbPkg;
    const actor = await seatedActor("Spider", { drachmae: 0 }); // default posture 'guard', changed_at NULL
    await seedSpymaster(actor.playerId);

    // Same posture (guard → guard): rejected (changed_at is NULL, so cooldown passes).
    expect(await m.interactions.setSpymasterPosture(actor, "guard", now)).toMatchObject({ ok: false, code: 409, error: "Your spymaster already keeps this posture." });

    // Happy switch guard → hunt: both columns written.
    expect(await m.interactions.setSpymasterPosture(actor, "hunt", now)).toMatchObject({ ok: true, posture: "hunt" });
    const after = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, actor.id)).limit(1))[0]!;
    expect(after.spymasterPosture).toBe("hunt");
    expect(after.spymasterPostureChangedAt).not.toBeNull();
    // The status helper now reports a live cooldown.
    expect(m.interactions.spymasterStatus(after, now).cooldownRemainingMs).toBeGreaterThan(0);

    // Cooldown: a second switch (hunt → guard) at the same instant is blocked.
    expect(await m.interactions.setSpymasterPosture(after, "guard", now)).toMatchObject({ ok: false, code: 409, error: "Your spymaster needs a season to redirect his web." });

    // Once the cooldown has elapsed, the switch is allowed again.
    const later = new Date(now.getTime() + 25 * 3_600_000);
    expect(await m.interactions.setSpymasterPosture(after, "guard", later)).toMatchObject({ ok: true, posture: "guard" });
  });

  it("hunt posture RAISES the attacker's odds — a roll that fails without it succeeds with it", async () => {
    // assassinate p = clamp(0.45 + (A − D)/40). A/D intel both 50, no bodyguards.
    // No hunt: p = 0.45; with hunt (+10 to A): p = 0.70. A roll of 0.6 flips outcome.
    const target1 = await standingTarget("HuntMark", { intelligence: 50 });
    const plain = await seatedActor("Plain", { drachmae: 500, intelligence: 50 }); // no spymaster
    expect(await m.interactions.assassinateAttempt(plain, target1.id, now, () => 0.6)).toMatchObject({ ok: true, outcome: "failed" });

    const target2 = await standingTarget("HuntMark2", { intelligence: 50 });
    const hunter = await seatedActor("Hunter", { drachmae: 500, intelligence: 50, posture: "hunt" });
    await seedSpymaster(hunter.playerId);
    expect(await m.interactions.assassinateAttempt(hunter, target2.id, now, () => 0.6)).toMatchObject({ ok: true, outcome: "dead" });
  });

  it("a target's GUARD posture lowers the odds in the ASSASSINATE channel", async () => {
    // No guard: p = 0.45; with guard (+10 to D): p = 0.20. A roll of 0.3 flips outcome.
    const actor = await seatedActor("Striker", { drachmae: 1000, intelligence: 50 });
    const open = await standingTarget("Open", { intelligence: 50 }); // no spymaster
    expect(await m.interactions.assassinateAttempt(actor, open.id, now, () => 0.3)).toMatchObject({ ok: true, outcome: "dead" });

    const warded = await standingTarget("Warded", { intelligence: 50 }); // default posture 'guard'
    await seedSpymaster(warded.playerId);
    expect(await m.interactions.assassinateAttempt(await freshRow(actor.id), warded.id, now, () => 0.3)).toMatchObject({ ok: true, outcome: "failed" });
  });

  it("a target's GUARD posture lowers the odds in the POISON channel too", async () => {
    // No guard: p = 0.50; with guard (+10 to D): p = 0.25. A roll of 0.35 flips outcome.
    const actor = await seatedActor("Toxin", { drachmae: 0, intelligence: 50 });
    await seedResource(actor.playerId, "poison", 2);
    const open = await standingTarget("OpenP", { intelligence: 50 });
    expect(await m.interactions.poisonAttempt(actor, open.id, now, () => 0.35)).toMatchObject({ ok: true, outcome: "ill" });

    const warded = await standingTarget("WardedP", { intelligence: 50 });
    await seedSpymaster(warded.playerId);
    expect(await m.interactions.poisonAttempt(await freshRow(actor.id), warded.id, now, () => 0.35)).toMatchObject({ ok: true, outcome: "failed" });
  });

  it("a dismissed spymaster contributes NOTHING despite a persisted 'hunt' posture", async () => {
    // Posture is 'hunt' but no spymaster is retained → no hunt bonus → p stays 0.45.
    const ghost = await seatedActor("Ghost", { drachmae: 500, intelligence: 50, posture: "hunt" });
    const target = await standingTarget("Untouched", { intelligence: 50 });
    // With a retained spy the 0.6 roll would succeed (p 0.70); without one it fails (p 0.45).
    expect(await m.interactions.assassinateAttempt(ghost, target.id, now, () => 0.6)).toMatchObject({ ok: true, outcome: "failed" });
  });

  it("spymaster retention cap (max 1) is enforced at the second hire", async () => {
    const spy = await createCharacter("Handler", { drachmae: 500 });
    const ctx = (await m.buildings.buildingContext(spy.playerId, worldId))!;
    expect((await m.buildings.hirePops(ctx, "spymaster", 1, now)).ok).toBe(true);
    const second = await m.buildings.hirePops(ctx, "spymaster", 1, now);
    expect(second).toMatchObject({ ok: false, code: 409, error: "You already retain a spymaster." });
    expect((await freshRow(spy.id)).drachmae).toBe(350); // only the first 150 charged
  });

  // --- Hostile attempt cooldown: one poison-OR-assassinate per pair per window ----
  // The clock starts from any attempt (failures included, since they hit the ledger),
  // and the two channels share it. Second attempts use `new Date()` (just after the
  // first ledger write) for "inside window"; +49h for "after window".
  const AFTER_WINDOW = () => new Date(Date.now() + 49 * 3_600_000);

  it("(cooldown) a second poison inside the window is refused with the lock copy — no vial spent", async () => {
    const actor = await oligarch("SerialP", 0);
    await seedResource(actor.playerId, "poison", 2);
    const target = await standingTarget("RepeatP");
    expect(await m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail)).toMatchObject({ ok: true, outcome: "failed" });
    expect(await resourceAmount(actor.playerId, "poison")).toBe(1); // the first vial was spent
    const second = await m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail);
    expect(second).toMatchObject({ ok: false, code: 429 });
    expect(second.ok ? "" : second.error).toMatch(/two seasons/);
    expect(await resourceAmount(actor.playerId, "poison")).toBe(1); // the refusal consumed nothing
  });

  it("(cooldown) a second assassination inside the window is refused — no drachmae spent", async () => {
    const actor = await oligarch("SerialB", 500);
    const target = await standingTarget("RepeatB");
    expect(await m.interactions.assassinateAttempt(actor, target.id, new Date(), forceFail)).toMatchObject({ ok: true, outcome: "failed" });
    expect((await freshRow(actor.id)).drachmae).toBe(300); // 500 − 200 blade
    const second = await m.interactions.assassinateAttempt(actor, target.id, new Date(), forceFail);
    expect(second).toMatchObject({ ok: false, code: 429 });
    expect((await freshRow(actor.id)).drachmae).toBe(300); // the refusal charged nothing
  });

  it("(cooldown) the window is CROSS-channel: a failed poison blocks an assassination on the same target", async () => {
    const actor = await oligarch("Mixer", 500);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("CrossMark");
    expect(await m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail)).toMatchObject({ ok: true, outcome: "failed" });
    const blade = await m.interactions.assassinateAttempt(actor, target.id, new Date(), forceDead);
    expect(blade).toMatchObject({ ok: false, code: 429 });
    expect(blade.ok ? "" : blade.error).toMatch(/two seasons/);
    expect((await freshRow(actor.id)).drachmae).toBe(500); // the blade was never paid
    expect((await freshRow(target.id)).status).toBe("alive"); // and the target still lives
  });

  it("(cooldown) a DIFFERENT target is unaffected by a move against another", async () => {
    const actor = await oligarch("Busy", 0);
    await seedResource(actor.playerId, "poison", 2);
    const a = await standingTarget("PairA");
    const b = await standingTarget("PairB");
    expect(await m.interactions.poisonAttempt(actor, a.id, new Date(), forceFail)).toMatchObject({ ok: true });
    // b was never targeted → its own clock is clear.
    expect(await m.interactions.poisonAttempt(actor, b.id, new Date(), forceFail)).toMatchObject({ ok: true, outcome: "failed" });
  });

  it("(cooldown) after the window the attempt proceeds again", async () => {
    const actor = await oligarch("Patient", 0);
    await seedResource(actor.playerId, "poison", 2);
    const target = await standingTarget("Later");
    expect(await m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail)).toMatchObject({ ok: true });
    // 49h later — past the 48h window → allowed, and the second vial is spent.
    expect(await m.interactions.poisonAttempt(actor, target.id, AFTER_WINDOW(), forceFail)).toMatchObject({ ok: true, outcome: "failed" });
    expect(await resourceAmount(actor.playerId, "poison")).toBe(0); // both vials spent
  });

  it("(cooldown) the profile lock reason names the cooldown inside the window on both channels", async () => {
    const actor = await oligarch("Watcher", 500);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("Observed");
    expect(await m.interactions.assassinateAttempt(actor, target.id, new Date(), forceFail)).toMatchObject({ ok: true, outcome: "failed" });
    const profile = await m.interactions.publicProfile(await freshRow(actor.id), target.id, new Date());
    expect(profile!.viewer.canPoison).toBe(false);
    expect(profile!.viewer.canAssassinate).toBe(false);
    expect(profile!.viewer.poisonLockReason).toMatch(/two seasons/);
    expect(profile!.viewer.assassinateLockReason).toMatch(/two seasons/);
  });

  // --- Concurrency: the hostile gate + spend are ONE step under the actor's lock ---
  // Two attempts fired together both pass the early (unlocked) cooldown read; inside
  // the transaction the second re-reads the cooldown after the first committed its
  // ledger row and is refused — and a refusal spends nothing.
  type HostileResult = { ok: true; outcome: string } | { ok: false; code: number; error: string };
  function expectOneAttemptOneCooldown(results: HostileResult[]) {
    const accepted = results.filter((r) => r.ok);
    const refused = results.filter((r): r is { ok: false; code: number; error: string } => !r.ok);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: 429 });
    expect(refused[0]!.error).toMatch(/two seasons/);
  }

  it("(race) two parallel assassinations: one commits, the other is the 429 cooldown, one blade paid, one row", async () => {
    const actor = await oligarch("TwinBlades", 500);
    const target = await standingTarget("MarkedTwice");
    const results = await Promise.all([
      m.interactions.assassinateAttempt(actor, target.id, new Date(), forceFail),
      m.interactions.assassinateAttempt(actor, target.id, new Date(), forceFail),
    ]);
    expectOneAttemptOneCooldown(results);
    expect((await freshRow(actor.id)).drachmae).toBe(300); // 500 − ONE 200 blade
    expect(await interactionRows(target.id)).toHaveLength(1);
  });

  it("(race) two parallel poisons: one commits, the other is the 429 cooldown, one vial spent, one row", async () => {
    const actor = await oligarch("TwinVials", 0);
    await seedResource(actor.playerId, "poison", 2);
    const target = await standingTarget("DosedTwice");
    const results = await Promise.all([
      m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail),
      m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail),
    ]);
    expectOneAttemptOneCooldown(results);
    expect(await resourceAmount(actor.playerId, "poison")).toBe(1); // ONE vial spent
    expect(await interactionRows(target.id)).toHaveLength(1);
  });

  it("(race) a poison and an assassination in parallel on the same target: exactly one commits and only its price is paid", async () => {
    const actor = await oligarch("Mixed", 500);
    await seedResource(actor.playerId, "poison", 1);
    const target = await standingTarget("MixedMark");
    const [poison, blade] = await Promise.all([
      m.interactions.poisonAttempt(actor, target.id, new Date(), forceFail),
      m.interactions.assassinateAttempt(actor, target.id, new Date(), forceFail),
    ]);
    expectOneAttemptOneCooldown([poison, blade]);
    const rows = await interactionRows(target.id);
    expect(rows).toHaveLength(1);
    const wallet = (await freshRow(actor.id)).drachmae;
    const vials = await resourceAmount(actor.playerId, "poison");
    if (poison.ok) {
      expect(rows[0]!.type).toBe("poison");
      expect(vials).toBe(0); // the vial went...
      expect(wallet).toBe(500); // ...and the blade was never paid
    } else {
      expect(rows[0]!.type).toBe("assassinate");
      expect(wallet).toBe(300); // the blade was paid...
      expect(vials).toBe(1); // ...and the vial stayed
    }
  });

  it("(race) two parallel posture switches: one commits, the other hits the cooldown, one changed_at written", async () => {
    const { playerCharacters } = m.dbPkg;
    const actor = await seatedActor("TwoWebs", { drachmae: 0 }); // posture 'guard', changed_at NULL
    await seedSpymaster(actor.playerId);
    const at = new Date();
    const results = await Promise.all([m.interactions.setSpymasterPosture(actor, "hunt", at), m.interactions.setSpymasterPosture(actor, "hunt", at)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused).toMatchObject({ ok: false, code: 409 });
    expect(refused && !refused.ok ? refused.error : "").toMatch(/needs a season|already keeps/);
    const after = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, actor.id)).limit(1))[0]!;
    expect(after.spymasterPosture).toBe("hunt");
    expect(after.spymasterPostureChangedAt?.getTime()).toBe(at.getTime());
  });
});
