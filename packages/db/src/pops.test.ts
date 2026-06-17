import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parsePopsContent } from "@massalia/shared";

// ---------------------------------------------------------------------------
// Pops persistence (Phase 1 economy rebalance — STORAGE ONLY). Integration test
// against a REAL Postgres, guarded to a *_test database (mirrors the apps/server
// integration tests). Proves a player's pop counts round-trip through the new
// player_pops table. No hiring/upkeep/food/staffing logic — that's a later phase.
//
// Pop TYPES are content-driven: read from content/people/pops.json via the shared
// parsePopsContent — nothing about the catalog is hardcoded here.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pops = parsePopsContent(JSON.parse(readFileSync(resolve(root, "content/people/pops.json"), "utf8")));
const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

suite("player_pops persistence (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let worldId: string;
  let playerId: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  async function setPop(type: string, count: number) {
    await db
      .insert(dbPkg.playerPops)
      .values({ worldId, ownerPlayerId: playerId, popType: type, count })
      .onConflictDoUpdate({ target: [dbPkg.playerPops.worldId, dbPkg.playerPops.ownerPlayerId, dbPkg.playerPops.popType], set: { count } });
  }

  async function popCounts(): Promise<Record<string, number>> {
    const rows = await db
      .select()
      .from(dbPkg.playerPops)
      .where(and(eq(dbPkg.playerPops.worldId, worldId), eq(dbPkg.playerPops.ownerPlayerId, playerId)));
    return Object.fromEntries(rows.map((r) => [r.popType, r.count]));
  }

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE player_pops, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db
      .insert(dbPkg.houses)
      .values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" })
      .onConflictDoNothing();
    const world = (await db.insert(dbPkg.worlds).values({ name: "Pops Test", seed: "ptest", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!;
    worldId = world.id;
    const user = (await db.insert(dbPkg.users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(dbPkg.players).values({ worldId, userId: user.id, name: "P", color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    playerId = player.id;
  });

  it("round-trips a player's pop counts (2 slaves, 1 citizen) — content-driven pop types", async () => {
    // The valid pop types come from content, not a hardcoded list.
    const types = Object.keys(pops.pops);
    expect(types).toEqual(expect.arrayContaining(["slave", "freeman", "citizen"]));

    await setPop("slave", 2);
    await setPop("citizen", 1);

    const counts = await popCounts();
    expect(counts).toEqual({ slave: 2, citizen: 1 });
    // A pop the player owns none of has no row (storage is sparse, not zero-filled).
    expect(counts.freeman).toBeUndefined();
  });

  it("the UNIQUE (world, owner, pop_type) key keeps ONE row per type — adjusts count in place", async () => {
    await setPop("slave", 2);
    await setPop("slave", 5); // same key → upsert, not a duplicate row

    const rows = await db
      .select()
      .from(dbPkg.playerPops)
      .where(and(eq(dbPkg.playerPops.worldId, worldId), eq(dbPkg.playerPops.ownerPlayerId, playerId), eq(dbPkg.playerPops.popType, "slave")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(5);
  });
});
