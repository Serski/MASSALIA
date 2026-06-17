import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The hoplite capstone (Step 5): one-way re-class. Integration tests against a
// REAL Postgres, guarded to a *_test database. Eligibility (wounded OR aged-out),
// the post-re-class invariants (wealth/seat/prestige/dynasty/army_rank/was_hoplite
// kept; commons kept; military disabled), and irreversibility.
// (The veteran-Strategos gate is exercised in elections.test.ts.)
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const NOW = Date.UTC(2000, 0, 1);
const NOW_D = new Date(NOW);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const service = await import("./service.js");
  const merc = await import("./merc.js");
  const age = await import("./age.js");
  const buildings = await import("./buildings.js");
  return { dbPkg, service, merc, age, buildings };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Hoplite re-class (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  async function makeChar(opts: { classId?: string; wasHoplite?: boolean; wounded?: boolean; startAge?: number; drachmae?: number; isCouncilor?: boolean; prestige?: number; militia?: number; armyRank?: string; status?: string; contractId?: string } = {}) {
    const { users, players, playerCharacters, dynasties, characterTraits } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "Agis", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const dynasty = (await db.insert(dynasties).values({ worldId, name: "House Test", prestige: 0, houseSlug: "test-house", foundingPlayerId: player.id, generation: 1 }).returning())[0]!;
    const c = (await db
      .insert(playerCharacters)
      .values({
        playerId: player.id,
        worldId,
        houseSlug: "test-house",
        classId: opts.classId ?? "hoplite",
        wasHoplite: opts.wasHoplite ?? (opts.classId ?? "hoplite") === "hoplite",
        dynastyId: dynasty.id,
        militia: opts.militia ?? 0,
        prestige: opts.prestige ?? 0,
        drachmae: opts.drachmae ?? 0,
        isCouncilor: opts.isCouncilor ?? false,
        armyRank: opts.armyRank ?? "none",
        status: opts.status ?? "alive",
        contractId: opts.contractId,
        startAge: opts.startAge ?? 40,
        deathAge: 90,
        createdAt: NOW_D, // pin age = startAge at NOW
      })
      .returning())[0]!;
    if (opts.wounded) await db.insert(characterTraits).values({ characterId: c.id, traitId: "one-eyed" });
    return c;
  }
  const reload = async (id: string) => (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  const professionOf = async (playerId: string) => (await db.select({ p: m.dbPkg.players.professionSlug }).from(m.dbPkg.players).where(eq(m.dbPkg.players.id, playerId)).limit(1))[0]?.p;
  const heldTraitIds = async (id: string) => (await db.select({ t: m.dbPkg.characterTraits.traitId }).from(m.dbPkg.characterTraits).where(eq(m.dbPkg.characterTraits.characterId, id))).map((r) => r.t);

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.service.loadRanksContent();
    await m.age.loadAgeConfig();
    await m.buildings.loadBuildingsContent();
    await m.buildings.loadPopsContent();
    await m.merc.loadContractsContent();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE player_buildings, character_traits, offices, oligarch_seats, effect_log, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    // players.profession_slug FKs professions — seed the slugs re-class touches.
    await db
      .insert(m.dbPkg.professions)
      .values(["hoplite", "landowner", "trader", "philosopher", "priest"].map((slug) => ({ slug, name: slug, initial: slug[0]!.toUpperCase(), rank: "@x", income: "0" })))
      .onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Reclass Test", seed: "rtest", startedAt: new Date(NOW), endsAt: new Date(NOW + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("a wounded hoplite can re-class to each of the four curated trades", async () => {
    for (const target of ["landowner", "trader", "philosopher", "priest"]) {
      const c = await makeChar({ wounded: true, startAge: 40 });
      const res = await m.service.performReclass(c, target, NOW_D);
      expect(res.ok).toBe(true);
      const row = await reload(c.id);
      expect(row.classId).toBe(target);
      expect(await professionOf(c.playerId)).toBe(target);
    }
  });

  it("an aged-out (50) unwounded hoplite can re-class; an unwounded 40 cannot", async () => {
    const old = await makeChar({ startAge: 50 });
    expect((await m.service.performReclass(old, "trader", NOW_D)).ok).toBe(true);

    const young = await makeChar({ startAge: 40 });
    const no = await m.service.performReclass(young, "trader", NOW_D);
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.code).toBe(403);
  });

  it("rejects a non-hoplite, and a target outside the curated subset", async () => {
    const trader = await makeChar({ classId: "trader", wasHoplite: true, startAge: 60 });
    const notHoplite = await m.service.performReclass(trader, "priest", NOW_D);
    expect(notHoplite.ok).toBe(false);
    if (!notHoplite.ok) expect(notHoplite.code).toBe(403);

    const wounded = await makeChar({ wounded: true });
    const badTarget = await m.service.performReclass(wounded, "hetaira", NOW_D);
    expect(badTarget.ok).toBe(false);
    if (!badTarget.ok) expect(badTarget.code).toBe(409);
  });

  it("cannot re-class while dead or sworn to a contract", async () => {
    const dead = await makeChar({ wounded: true, status: "deceased" });
    expect((await m.service.performReclass(dead, "trader", NOW_D)).ok).toBe(false);
    const abroad = await makeChar({ wounded: true, contractId: "syracuse" });
    expect((await m.service.performReclass(abroad, "trader", NOW_D)).ok).toBe(false);
  });

  it("re-class keeps the whole life, KEEPS commons, DISABLES the military, and is irreversible", async () => {
    const c = await makeChar({ wounded: true, startAge: 40, drachmae: 500, isCouncilor: true, prestige: 30, militia: 40, armyRank: "veteran" });
    // A common building (KEPT) and a military trait (KEPT as history).
    await db.insert(m.dbPkg.playerBuildings).values({ worldId, ownerPlayerId: c.playerId, buildingId: "poultry-yard", tier: 1, status: "active", completesAt: NOW_D });
    await db.insert(m.dbPkg.characterTraits).values({ characterId: c.id, traitId: "sellsword" });

    const res = await m.service.performReclass(c, "landowner", NOW_D);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.reason).toBe("wound");
    const row = await reload(c.id);

    // Class + profession changed; everything else carried.
    expect(row.classId).toBe("landowner");
    expect(await professionOf(c.playerId)).toBe("landowner");
    expect(row.drachmae).toBe(500);
    expect(row.isCouncilor).toBe(true);
    expect(row.prestige).toBe(30);
    expect(row.militia).toBe(40); // frozen value, kept
    expect(row.dynastyId).toBe(c.dynastyId);
    expect(row.armyRank).toBe("veteran"); // historical record, NOT reset
    expect(row.wasHoplite).toBe(true); // the veteran signal, preserved

    // Commons kept and still owned; military trait kept.
    const builds = await db.select().from(m.dbPkg.playerBuildings).where(eq(m.dbPkg.playerBuildings.ownerPlayerId, c.playerId));
    expect(builds.map((b) => b.buildingId)).toContain("poultry-yard");
    expect(await heldTraitIds(c.id)).toContain("sellsword");

    // The re-class is logged (manumission-style effect log).
    const logs = await db.select().from(m.dbPkg.effectLog).where(and(eq(m.dbPkg.effectLog.characterId, c.id), eq(m.dbPkg.effectLog.kind, "reclass")));
    expect(logs.length).toBe(1);

    // Military is DISABLED going forward — army_rank staying set does not re-enable.
    expect((await m.service.enlist(row, NOW_D)).ok).toBe(false);
    expect((await m.service.promote(row, NOW_D)).ok).toBe(false);
    expect((await m.merc.takeContract(row, "trade-ship", NOW_D)).ok).toBe(false);

    // IRREVERSIBLE: no path back to hoplite, and no second re-class.
    expect((await m.service.performReclass(row, "hoplite", NOW_D)).ok).toBe(false); // hoplite not a target
    expect((await m.service.performReclass(row, "trader", NOW_D)).ok).toBe(false); // no longer a hoplite
    const st = await m.service.serviceStatus(row, NOW_D);
    expect(st.reclass.eligible).toBe(false);
  });
});
