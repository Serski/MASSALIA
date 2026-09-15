import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// world:launch (World 2 launch, prompt 1). Integration test against a REAL
// Postgres, guarded to a *_test database (mirrors pops.test.ts). One active
// world with three users — two with players, one without — then the script's
// core: the old world ended, the new one active with its seats and pools, two
// users stamped and the third not; a second run of the same command refused,
// two active worlds refused, and --dry-run writing nothing.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

suite("world:launch (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let launch: Awaited<ReturnType<typeof load>>["launch"];
  let oldWorldId: string;
  let userIds: string[];

  async function load() {
    const dbPkg = await import("./index.js");
    const launch = await import("./worldLaunch.js");
    return { dbPkg, launch, db: dbPkg.createDb() };
  }

  beforeAll(async () => {
    ({ db, dbPkg, launch } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE oligarch_seats, town_military, region_military, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db
      .insert(dbPkg.houses)
      .values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    oldWorldId = (await db.insert(dbPkg.worlds).values({ name: "Massalia Season One", seed: "s1", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
    userIds = [];
    for (const [i, name] of ["Kallias", "Deon", null].entries()) {
      const user = (await db.insert(dbPkg.users).values({ email: `u${i}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
      userIds.push(user.id);
      // The second player left the world (isActive false): still a World 1 citizen.
      if (name) await db.insert(dbPkg.players).values({ worldId: oldWorldId, userId: user.id, name, color: "#123456", houseSlug: "test-house", isActive: i === 0 });
    }
  });

  const opts = (over: Partial<Awaited<ReturnType<typeof load>>["launch"]["parseArgs"]> & Record<string, unknown> = {}) => ({
    name: "Massalia Season Two",
    tagline: "The walls rise",
    start: new Date(T0 + 200 * DAY),
    days: 182,
    dryRun: false,
    ...over,
  });
  const betaAtOf = async () => (await db.select({ id: dbPkg.users.id, betaAt: dbPkg.users.betaAt }).from(dbPkg.users)).sort((a, b) => userIds.indexOf(a.id) - userIds.indexOf(b.id)).map((u) => u.betaAt);
  const worldRows = () => db.select().from(dbPkg.worlds).orderBy(dbPkg.worlds.startedAt);
  const quiet = () => {};

  it("flips the active world, seeds the new one with seats and pools, stamps the World 1 users only", async () => {
    const now = new Date(T0 + 190 * DAY);
    const lines: string[] = [];
    const report = await launch.launchWorld(db, opts(), (l) => lines.push(l), now);

    expect(report.before).toMatchObject({ id: oldWorldId, name: "Massalia Season One", players: 2, toStamp: 2 });
    const rows = await worldRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: oldWorldId, status: "ended", endsAt: now });
    expect(rows[1]).toMatchObject({ name: "Massalia Season Two", tagline: "The walls rise", seed: "massalia-season-two", status: "active", startedAt: new Date(T0 + 200 * DAY), endsAt: new Date(T0 + 382 * DAY) });
    const fresh = rows[1]!;
    expect(report.after).toMatchObject({ fresh: { id: fresh.id }, seats: 300, stamped: 2 });
    expect(report.after!.towns).toBeGreaterThan(0);
    expect(report.after!.regions).toBeGreaterThan(0);
    expect((await db.select().from(dbPkg.oligarchSeats).where(eq(dbPkg.oligarchSeats.worldId, fresh.id))).length).toBe(300);
    expect((await db.select().from(dbPkg.townMilitary).where(eq(dbPkg.townMilitary.worldId, fresh.id))).length).toBe(report.after!.towns);
    expect((await db.select().from(dbPkg.regionMilitary).where(eq(dbPkg.regionMilitary.worldId, fresh.id))).length).toBe(report.after!.regions);
    // The two World 1 citizens (active or not) are stamped with the run's instant; the third user is not.
    expect(await betaAtOf()).toEqual([now, now, null]);
    // World 1's rows are untouched beyond the status flip.
    expect((await db.select().from(dbPkg.players).where(eq(dbPkg.players.worldId, oldWorldId))).length).toBe(2);
    expect(lines.some((l) => l.startsWith("BEFORE"))).toBe(true);
    expect(lines.filter((l) => l.startsWith("AFTER"))).toHaveLength(3);
  });

  it("a second run of the same command is refused, and so are two active worlds; nothing written either time", async () => {
    await launch.launchWorld(db, opts(), quiet, new Date(T0 + 190 * DAY));
    await expect(launch.launchWorld(db, opts(), quiet)).rejects.toThrow(/already exists/);
    expect((await worldRows()).length).toBe(2);

    await db.insert(dbPkg.worlds).values({ name: "Stray", seed: "stray", startedAt: new Date(T0), endsAt: new Date(T0 + DAY), status: "active" });
    await expect(launch.launchWorld(db, opts({ name: "Massalia Season Three" }), quiet)).rejects.toThrow(/2 active worlds/);
    expect((await worldRows()).length).toBe(3);
    expect((await worldRows()).filter((w) => w.name === "Massalia Season Three")).toHaveLength(0);
  });

  it("--dry-run prints BEFORE and the plan and writes nothing", async () => {
    const lines: string[] = [];
    const report = await launch.launchWorld(db, opts({ dryRun: true }), (l) => lines.push(l));
    expect(report.after).toBeNull();
    expect(report.before).toMatchObject({ players: 2, toStamp: 2 });
    expect(lines.map((l) => l.split(" ")[0])).toEqual(["BEFORE", "PLAN", "DRY"]);
    expect(await worldRows()).toHaveLength(1);
    expect((await worldRows())[0]!.status).toBe("active");
    expect(await betaAtOf()).toEqual([null, null, null]);
    expect((await db.select().from(dbPkg.oligarchSeats)).length).toBe(0);
  });

  it("parses the command line and derives the seed", () => {
    expect(launch.parseArgs(["--name", "Massalia Season Two", "--tagline", "The walls rise", "--start", "2026-09-16T04:00:00Z", "--days", "90", "--dry-run"])).toEqual({
      name: "Massalia Season Two",
      tagline: "The walls rise",
      start: new Date("2026-09-16T04:00:00Z"),
      days: 90,
      dryRun: true,
    });
    expect(() => launch.parseArgs(["--tagline", "x"])).toThrow(/--name/);
    expect(() => launch.parseArgs(["--name", "x", "--tagline", "y", "--days", "0"])).toThrow(/--days/);
    expect(() => launch.parseArgs(["--name", "x", "--tagline", "y", "--bogus"])).toThrow(/unknown/);
    expect(launch.seedFor("Massalia Season Two")).toBe("massalia-season-two");
  });
});
