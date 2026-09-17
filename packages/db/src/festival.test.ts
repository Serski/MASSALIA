import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCalendarConfig } from "@massalia/shared";

// Festivals are per world. game_year restarts with every world, so an ended
// world's closed (festival, year) rows, donations, cards and choregos trait must
// never reach into the active world. Integration test against a REAL Postgres,
// guarded to a *_test database (mirrors pops.test.ts).

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg = parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));
const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2000, 0, 1);
const WINTER_Y0 = new Date(T0 + HOUR); // Dionysia's season
const SPRING_Y0 = new Date(T0 + DAY + HOUR); // Dionysia is past

suite("festival lifecycle is per world (integration)", () => {
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
  const cards = async (characterId: string) => db.select().from(dbPkg.festivalEvents).where(eq(dbPkg.festivalEvents.characterId, characterId));
  const guards = async (worldId: string) => db.select().from(dbPkg.festivalChoregos).where(eq(dbPkg.festivalChoregos.worldId, worldId));
  const holds = async (characterId: string, traitId: string) =>
    (await db.select().from(dbPkg.characterTraits).where(and(eq(dbPkg.characterTraits.characterId, characterId), eq(dbPkg.characterTraits.traitId, traitId)))).length > 0;
  const donate = (characterId: string, amount: number) => db.insert(dbPkg.festivalDonations).values({ characterId, festivalId: "fest-dionysia", gameYear: 0, amount });

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE festival_choregos, festival_donations, festival_events, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    oldWorld = (await db.insert(dbPkg.worlds).values({ name: "Old", seed: "fest-old", startedAt: new Date(T0 - 100 * DAY), endsAt: new Date(T0), status: "ended" }).returning())[0]!.id;
    liveWorld = (await db.insert(dbPkg.worlds).values({ name: "Live", seed: "fest-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
    // The ended world closed the same (festival, year) keys long ago.
    await db.insert(dbPkg.festivalChoregos).values([
      { worldId: oldWorld, festivalId: "fest-dionysia", gameYear: 0, winnerCharacterId: null },
      { worldId: oldWorld, festivalId: "fest-artemisia", gameYear: 0, winnerCharacterId: null },
    ]);
  });

  it("(a) an ended world's closed instance does not shadow the active world's festival", async () => {
    const a = await character(liveWorld, "A");
    const b = await character(liveWorld, "B");
    expect(await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0)).toBe(2);
    expect((await cards(a)).map((c) => c.festivalId)).toEqual(["fest-dionysia"]);
    expect((await cards(b)).map((c) => c.festivalId)).toEqual(["fest-dionysia"]);
  });

  it("(b) a living character of an ended world is dealt nothing, by the sweep or on its own", async () => {
    const ghost = await character(oldWorld, "Ghost");
    await character(liveWorld, "A");
    expect(await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0)).toBe(1);
    await dbPkg.fireFestivalsForCharacterId(ghost, cfg, WINTER_Y0);
    expect(await cards(ghost)).toHaveLength(0);
  });

  it("(c) the close counts only the active world's donations and writes that world's guard row", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const a = await character(liveWorld, "A");
    const b = await character(liveWorld, "B");
    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
    await donate(ghost, 500);
    await donate(a, 30);
    await donate(b, 50);
    expect(await dbPkg.closeDueFestivals(cfg, SPRING_Y0)).toBe(1);
    const live = await guards(liveWorld);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ festivalId: "fest-dionysia", gameYear: 0, winnerCharacterId: b });
    expect(await holds(b, "megas-choregos")).toBe(true);
    expect(await holds(ghost, "megas-choregos")).toBe(false);
    expect(await guards(oldWorld)).toHaveLength(2); // untouched
  });

  it("(d) the trait strip stays inside the world", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const former = await character(liveWorld, "Former");
    const a = await character(liveWorld, "A");
    await db.insert(dbPkg.characterTraits).values([{ characterId: ghost, traitId: "megas-choregos" }, { characterId: former, traitId: "megas-choregos" }]);
    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
    await donate(a, 10);
    await dbPkg.closeDueFestivals(cfg, SPRING_Y0);
    expect(await holds(a, "megas-choregos")).toBe(true);
    expect(await holds(former, "megas-choregos")).toBe(false);
    expect(await holds(ghost, "megas-choregos")).toBe(true);
  });

  it("(e) the auto-attend stays inside the world", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const a = await character(liveWorld, "A");
    await db.insert(dbPkg.festivalEvents).values({ characterId: ghost, festivalId: "fest-dionysia", eventId: "fest-dionysia", gameYear: 0, resolved: false });
    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
    await dbPkg.closeDueFestivals(cfg, SPRING_Y0);
    expect((await cards(a))[0]).toMatchObject({ resolved: true, resolvedChoiceId: "attend" });
    expect((await cards(ghost))[0]).toMatchObject({ resolved: false, resolvedChoiceId: null });
  });

  it("(f) the guard still guards inside its own world", async () => {
    const a = await character(liveWorld, "A");
    await db.insert(dbPkg.festivalChoregos).values({ worldId: liveWorld, festivalId: "fest-dionysia", gameYear: 0, winnerCharacterId: null });
    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
    expect(await cards(a)).toHaveLength(0);
  });

  it("(g) a second close is a no-op", async () => {
    const a = await character(liveWorld, "A");
    await dbPkg.fireFestivalsForAll(cfg, WINTER_Y0);
    await donate(a, 10);
    expect(await dbPkg.closeDueFestivals(cfg, SPRING_Y0)).toBe(1);
    expect(await dbPkg.closeDueFestivals(cfg, SPRING_Y0)).toBe(0);
    expect(await guards(liveWorld)).toHaveLength(1);
  });
});
