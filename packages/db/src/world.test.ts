import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// The active-world helper: a character belongs to the active world or it does not.
// Integration test against a REAL Postgres, guarded to a *_test database (mirrors
// festival.test.ts).

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

suite("the active-world helper (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let oldWorld: string;
  let liveWorld: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  async function character(worldId: string, name: string): Promise<string> {
    const user = (await db.insert(dbPkg.users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(dbPkg.players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    return (await db.insert(dbPkg.playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader" }).returning())[0]!.id;
  }

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    oldWorld = (await db.insert(dbPkg.worlds).values({ name: "Old", seed: "world-old", startedAt: new Date(T0 - 100 * DAY), endsAt: new Date(T0), status: "ended" }).returning())[0]!.id;
    liveWorld = (await db.insert(dbPkg.worlds).values({ name: "Live", seed: "world-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  it("activeWorld is the live world, with its start", async () => {
    expect(await dbPkg.activeWorld()).toEqual({ id: liveWorld, startedMs: T0 });
  });

  it("a character of the live world is in the active world; an ended world's is not; nor is an unknown id", async () => {
    const live = await character(liveWorld, "A");
    const ghost = await character(oldWorld, "Ghost");
    expect(await dbPkg.characterInActiveWorld(live)).toBe(true);
    expect(await dbPkg.characterInActiveWorld(ghost)).toBe(false);
    expect(await dbPkg.characterInActiveWorld(randomUUID())).toBe(false);
  });

  it("with no active world nobody is in it", async () => {
    const live = await character(liveWorld, "A");
    await db.execute(sql`UPDATE worlds SET status = 'ended'`);
    expect(await dbPkg.activeWorld()).toBeNull();
    expect(await dbPkg.characterInActiveWorld(live)).toBe(false);
  });
});
