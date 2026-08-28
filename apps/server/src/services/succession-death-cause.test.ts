import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Death cause → the murder card payload + the successions.cause column + the
// chronicle death entries. Integration, guarded on a *_test database (truncates
// it), mirroring the Interaction / Succession suites:
//   createdb massalia_test && DATABASE_URL=postgres://…/massalia_test pnpm db:migrate
//   DATABASE_URL=postgres://…/massalia_test pnpm --filter @massalia/server test
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const runs = dbUrl.includes("_test");
const suite = describe.runIf(runs);

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
  const succession = await import("./succession.js");
  return { dbPkg, oligarchy, interactions, buildings, traits, age, family, composure, succession };
}

suite("death cause (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;
  const now = new Date();

  // A character in its own dynasty (so a death handoff writes a successions row).
  async function createCharacter(name: string, opts: { drachmae?: number; prestige?: number } = {}) {
    const { users, players, playerCharacters, dynasties } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@test`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: `${name} Household`, houseSlug: "test-house", foundingPlayerId: player.id }).returning())[0]!;
    return (
      await db
        .insert(playerCharacters)
        .values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", drachmae: opts.drachmae ?? 500, prestige: opts.prestige ?? 20, startAge: 30, deathAge: 90, dynastyId: dynasty.id })
        .returning()
    )[0]!;
  }

  // An of-age son, so the succession resolves down the simple "blood" path.
  async function addSon(parentId: string) {
    const { children } = m.dbPkg;
    const realMsPerGameYear = m.age.getAgeConfig().realMsPerGameYear;
    await db.insert(children).values({ parentCharacterId: parentId, worldId, name: "Heirophon", sex: "male", bornAt: new Date(now.getTime() - 20 * realMsPerGameYear) });
  }

  async function oligarch(name: string, drachmae: number) {
    const { playerCharacters } = m.dbPkg;
    const c = await createCharacter(name, { drachmae: 400 });
    expect((await m.oligarchy.buySeat(c, now)).ok).toBe(true);
    await db.update(playerCharacters).set({ drachmae }).where(eq(playerCharacters.id, c.id));
    return freshRow(c.id);
  }

  async function freshRow(id: string) {
    const { playerCharacters } = m.dbPkg;
    return (await db.select().from(playerCharacters).where(eq(playerCharacters.id, id)).limit(1))[0]!;
  }

  async function successionRow(dynastyId: string) {
    const { successions } = m.dbPkg;
    return (await db.select().from(successions).where(eq(successions.dynastyId, dynastyId)).limit(1))[0];
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();

    const politics = await m.oligarchy.loadPoliticsConfig();
    await m.interactions.loadInteractionsConfig();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.traits.loadTraitDefs();
    await m.age.loadAgeConfig();
    await m.family.loadFamilyConfig();
    await m.composure.loadComposureConfig();

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
      await db.insert(m.dbPkg.worlds).values({ name: "Death Cause World", seed: "death-cause-test", startedAt, endsAt: new Date(now.getTime() + 182 * 86_400_000), status: "active" }).returning()
    )[0]!;
    worldId = world.id;
    await m.dbPkg.ensureChamberSeats(worldId, politics.chamber);
  });

  it("a natural death leaves cause null in the payload and the succession row, and reads plain in the chronicle", async () => {
    const victim = await createCharacter("Graybeard");
    await addSon(victim.id);
    // Old age, not a blade: just mark deceased with no lethal interaction / merc note.
    await db.update(m.dbPkg.playerCharacters).set({ status: "deceased" }).where(eq(m.dbPkg.playerCharacters.id, victim.id));

    const info = await m.succession.successionInfo(await freshRow(victim.id), now);
    expect(info?.cause).toBeNull();

    const resolved = await m.succession.resolveSuccession(await freshRow(victim.id), undefined, now);
    expect(resolved.ok).toBe(true);
    const row = await successionRow(victim.dynastyId!);
    expect(row?.kind).toBe("blood");
    expect(row?.cause).toBeNull();

    const chronicle = await m.dbPkg.gatherChronicleForCharacter(victim.id);
    const death = chronicle.find((e) => e.type === "death");
    expect(death).toBeTruthy();
    expect(death!.payload.cause).toBeNull();
  });

  it("an assassination writes cause 'assassinated' — in the payload and the succession row — and the chronicle", async () => {
    const actor = await oligarch("Blade", 1000);
    const victim = await createCharacter("Marked");
    await addSon(victim.id);

    const result = await m.interactions.assassinateAttempt(actor, victim.id, now, () => 0); // roll 0 < p → dead
    expect(result).toMatchObject({ ok: true, outcome: "dead" });
    expect((await freshRow(victim.id)).status).toBe("deceased");

    // The card is right even though the victim was offline: cause read from the ledger.
    const info = await m.succession.successionInfo(await freshRow(victim.id), now);
    expect(info?.cause).toBe("assassinated");

    const resolved = await m.succession.resolveSuccession(await freshRow(victim.id), undefined, now);
    expect(resolved.ok).toBe(true);
    const row = await successionRow(victim.dynastyId!);
    expect(row?.cause).toBe("assassinated");

    const chronicle = await m.dbPkg.gatherChronicleForCharacter(victim.id);
    expect(chronicle.find((e) => e.type === "death")!.payload.cause).toBe("assassinated");
  });

  it("a lethal poisoning writes cause 'poison' in the payload", async () => {
    const actor = await oligarch("Poisoner", 0);
    await db.insert(m.dbPkg.resources).values({ scope: "player", scopeId: actor.playerId, type: "poison", amount: "1", ratePerSecond: "0", lastUpdatedAt: now });
    const victim = await createCharacter("Cupbearer");
    await addSon(victim.id);

    // seq: success roll 0 (< p) then severity roll ~1 (>= illnessChance) → dead.
    let i = 0;
    const seq = () => [0, 0.999999][Math.min(i++, 1)]!;
    const result = await m.interactions.poisonAttempt(actor, victim.id, now, seq);
    expect(result).toMatchObject({ ok: true, outcome: "dead" });

    const info = await m.succession.successionInfo(await freshRow(victim.id), now);
    expect(info?.cause).toBe("poison");
  });

  it("a mercenary death (pending_death_note) writes cause 'mercenary'", async () => {
    const victim = await createCharacter("Sellsword");
    await addSon(victim.id);
    // Mirror db/merc.ts: a glorious contract death stashes the note and marks deceased.
    await db.update(m.dbPkg.playerCharacters).set({ status: "deceased", pendingDeathNote: "Sellsword fell at the siege of Nikaia, season 3" }).where(eq(m.dbPkg.playerCharacters.id, victim.id));

    const info = await m.succession.successionInfo(await freshRow(victim.id), now);
    expect(info?.cause).toBe("mercenary");

    const resolved = await m.succession.resolveSuccession(await freshRow(victim.id), undefined, now);
    expect(resolved.ok).toBe(true);
    expect((await successionRow(victim.dynastyId!))?.cause).toBe("mercenary");
  });
});
