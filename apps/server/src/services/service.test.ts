import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The hoplite's home army — RANKS + SALARY (Hoplite Step 1). Integration tests
// against a REAL Postgres, guarded to a *_test database (mirrors buildings.test.ts).
// Covers: enlist, lazy salary accrual + collect into the integer wallet, gate-
// blocked promote, gate-met promote (no skipping), and the non-hoplite 403.
//
// Salary uses the same in-game clock as age/elections: shared
// military.MS_PER_GAME_DAY = calendar.REAL_MS_PER_SEASON (1 real day = 1 season).
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000; // REAL_MS_PER_SEASON — one in-game day
const T0 = Date.UTC(2000, 0, 1);

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const service = await import("./service.js");
  const age = await import("./age.js");
  return { dbPkg, service, age };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("Hoplite home army (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;
  let worldId: string;

  async function makeHoplite(opts: { militia?: number; prestige?: number; drachmae?: number; classId?: string } = {}) {
    const { users, players, playerCharacters } = m.dbPkg;
    const user = (await db.insert(users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(players).values({ worldId, userId: user.id, name: "H", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    const c = (await db
      .insert(playerCharacters)
      .values({
        playerId: player.id,
        worldId,
        houseSlug: "test-house",
        classId: opts.classId ?? "hoplite",
        militia: opts.militia ?? 0,
        prestige: opts.prestige ?? 0,
        drachmae: opts.drachmae ?? 0,
        startAge: 30,
        deathAge: 90,
      })
      .returning())[0]!;
    return c;
  }
  async function reload(id: string) {
    return (await db.select().from(m.dbPkg.playerCharacters).where(eq(m.dbPkg.playerCharacters.id, id)).limit(1))[0]!;
  }

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
    await m.service.loadRanksContent();
    await m.age.loadAgeConfig();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(m.dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    const world = (await db.insert(m.dbPkg.worlds).values({ name: "Service Test", seed: "stest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
  });

  it("enlists a hoplite (none → recruit) and sets the salary anchor", async () => {
    const c = await makeHoplite();
    const res = await m.service.enlist(c, new Date(T0));
    expect(res.ok).toBe(true);
    const row = await reload(c.id);
    expect(row.armyRank).toBe("recruit");
    expect(row.lastSalaryAt?.getTime()).toBe(T0);
  });

  it("accrues salary lazily over in-game days and collects it into the integer wallet", async () => {
    const c = await makeHoplite({ drachmae: 0 });
    await m.service.enlist(c, new Date(T0));
    const enlisted = await reload(c.id);

    // Status after 3 in-game days: recruit pays 8/day → 24dr accrued (militia trickle 0).
    const status = m.service.serviceStatus(enlisted, new Date(T0 + 3 * DAY));
    expect(status.rankId).toBe("recruit");
    expect(status.accrued.drachmae).toBe(24);
    expect(status.accrued.militia).toBe(0);

    const collected = await m.service.collectSalary(enlisted, new Date(T0 + 3 * DAY));
    expect(collected.ok).toBe(true);
    if (collected.ok) expect(collected.collected).toEqual({ drachmae: 24, militia: 0 });
    const row = await reload(c.id);
    expect(row.drachmae).toBe(24); // banked, integer, never negative
    expect(row.lastSalaryAt?.getTime()).toBe(T0 + 3 * DAY); // anchor advanced by consumed time

    // Collecting again immediately yields nothing (anchor is current).
    const again = await m.service.collectSalary(row, new Date(T0 + 3 * DAY));
    if (again.ok) expect(again.collected).toEqual({ drachmae: 0, militia: 0 });
    expect((await reload(c.id)).drachmae).toBe(24);
  });

  it("blocks promotion when the militia/prestige gate is not met, and cannot skip ranks", async () => {
    // Recruit with 11 militia / 5 prestige — short of veteran's 15/10 gate.
    const c = await makeHoplite({ militia: 11, prestige: 5 });
    await m.service.enlist(c, new Date(T0));
    const recruit = await reload(c.id);

    const status = m.service.serviceStatus(recruit, new Date(T0));
    expect(status.next?.id).toBe("veteran"); // next is exactly one rank up — no skipping
    expect(status.qualifies).toBe(false);
    expect(status.shortfall).toEqual({ militia: 4, prestige: 5 });

    const blocked = await m.service.promote(recruit, new Date(T0));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe(403);
    expect((await reload(c.id)).armyRank).toBe("recruit"); // unchanged
  });

  it("promotes one rank when the gate is met, settling old-rank pay and resetting the anchor", async () => {
    const c = await makeHoplite({ militia: 20, prestige: 12, drachmae: 0 });
    await m.service.enlist(c, new Date(T0));
    const recruit = await reload(c.id);

    // One day as recruit (8dr), then promote to veteran (gate 15/10 met).
    const res = await m.service.promote(recruit, new Date(T0 + 1 * DAY));
    expect(res.ok).toBe(true);
    const row = await reload(c.id);
    expect(row.armyRank).toBe("veteran");
    expect(row.drachmae).toBe(8); // recruit's day of pay banked on promotion
    expect(row.lastSalaryAt?.getTime()).toBe(T0 + 1 * DAY); // anchor reset to promotion time

    // Veteran pays 16/day + 1 militia/day. After 2 days: 32dr, +2 militia.
    const collected = await m.service.collectSalary(row, new Date(T0 + 3 * DAY));
    if (collected.ok) expect(collected.collected).toEqual({ drachmae: 32, militia: 2 });
    const after = await reload(c.id);
    expect(after.drachmae).toBe(40); // 8 + 32
    expect(after.militia).toBe(22); // 20 + 2
  });

  it("rejects every action for a non-hoplite with 403", async () => {
    const trader = await makeHoplite({ classId: "trader" });
    for (const res of [
      await m.service.enlist(trader, new Date(T0)),
      await m.service.promote(trader, new Date(T0)),
      await m.service.collectSalary(trader, new Date(T0)),
    ]) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe(403);
    }
    expect(m.service.isHoplite(trader)).toBe(false);
  });
});
