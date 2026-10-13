import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEAGUE_UNIT_IDS, parseLeagueArmy } from "@massalia/shared";

// ---------------------------------------------------------------------------
// The League's army (government prompt 5a): raised once per world by the insert
// of the League's own players row, paid once a season from the League treasury,
// and thinned by desertion when the treasury cannot pay. Integration test
// against a REAL Postgres, guarded to a *_test database (it truncates), as
// leagueRevenue.test.ts.
// ---------------------------------------------------------------------------

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content = parseLeagueArmy(JSON.parse(readFileSync(resolve(root, "content/military/league-army.json"), "utf8")));
const SEASON = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const at = (season: number) => new Date(T0 + Math.round((season + 0.5) * SEASON));

suite("the League's army (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let worldId: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  const leagueRows = () => db.select().from(dbPkg.players).where(and(eq(dbPkg.players.worldId, worldId), eq(dbPkg.players.kind, "league")));
  const units = () => dbPkg.leagueArmyRows(db, worldId);
  const men = async () => (await units()).reduce((n, r) => n + r.count, 0);
  const byTown = async () => {
    const rows = await units();
    return Object.fromEntries(content.towns.map((t) => [t.townId, rows.filter((r) => r.basedAt === t.townId).reduce((n, r) => n + r.count, 0)]));
  };
  const byType = async () => {
    const rows = await units();
    return Object.fromEntries(LEAGUE_UNIT_IDS.map((id) => [id, rows.filter((r) => r.unitId === id).reduce((n, r) => n + r.count, 0)]));
  };
  const countOf = async (townId: string, unitId: string) => (await units()).find((r) => r.basedAt === townId && r.unitId === unitId)?.count ?? 0;
  const ledger = async () =>
    (
      await db
        .select({ reason: dbPkg.treasuryLedger.reason, delta: dbPkg.treasuryLedger.delta })
        .from(dbPkg.treasuryLedger)
        .where(and(eq(dbPkg.treasuryLedger.worldId, worldId), eq(dbPkg.treasuryLedger.owner, "league")))
        .orderBy(dbPkg.treasuryLedger.createdAt, dbPkg.treasuryLedger.reason)
    ).map((l) => [l.reason, l.delta]);
  const balance = () => dbPkg.treasuryBalance(worldId, "league");
  const treasury = (amount: number) => db.insert(dbPkg.treasuries).values({ worldId, owner: "league", balance: amount });

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE resources, player_units, treasury_ledger, treasuries, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    worldId = (await db.insert(dbPkg.worlds).values({ name: "Army", seed: "army-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * SEASON), status: "active" }).returning())[0]!.id;
  });

  it("the army is raised once: the League's row, forty rows of trained men ready in their towns, and the fleet", async () => {
    expect(await dbPkg.leaguePlayerId(db, worldId)).toBeNull();
    expect(await dbPkg.ensureLeagueArmy(worldId, at(3))).toBe(true);
    expect(await dbPkg.ensureLeagueArmy(worldId, at(3))).toBe(false);
    expect(await dbPkg.ensureLeagueArmy(worldId, at(9))).toBe(false);

    const league = await leagueRows();
    expect(league).toHaveLength(1);
    expect(league[0]).toMatchObject({ kind: "league", userId: null, name: "The League", isActive: true, houseSlug: null });
    expect(await dbPkg.leaguePlayerId(db, worldId)).toBe(league[0]!.id);

    const rows = await db.select().from(dbPkg.playerUnits).where(eq(dbPkg.playerUnits.worldId, worldId));
    expect(rows).toHaveLength(40);
    for (const row of rows) {
      expect(row).toMatchObject({ ownerPlayerId: league[0]!.id, source: "trained", recruitedSeason: 3, movingTo: null, mission: null, contractEndAt: null });
      expect(row.startCount).toBe(row.count);
      expect(row.readyAt!.getTime()).toBe(at(3).getTime());
      const town = content.towns.find((t) => t.townId === row.basedAt)!;
      expect(row.count, `${row.basedAt} ${row.unitId}`).toBe(town.units[row.unitId as (typeof LEAGUE_UNIT_IDS)[number]]);
    }
    expect(await men()).toBe(2050);
    expect(await byType()).toEqual({ hoplite: 1030, peltast: 510, ekdromos: 305, hippeis: 205 });
    expect(await byTown()).toEqual({ massalia: 1000, emporion: 250, nikaia: 150, "olbia-provence": 150, rhoda: 120, agathe: 100, antipolis: 100, arelate: 100, athinopolis: 50, monoikos: 30 });
    // The home towns' ships are the League's stock.
    expect(await dbPkg.leagueFleet(db, worldId)).toEqual({ pentekonters: 29, triremes: 40 });
  });

  it("one League row per world, with no user; a player's row keeps its user", async () => {
    await dbPkg.ensureLeagueArmy(worldId, at(0));
    const user = (await db.insert(dbPkg.users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    await expect(db.insert(dbPkg.players).values({ worldId, kind: "league", userId: null, name: "A second League", color: "#000000" })).rejects.toThrow();
    await expect(db.insert(dbPkg.players).values({ worldId, kind: "league", userId: user.id, name: "A League with a user", color: "#000000" })).rejects.toThrow();
    await expect(db.insert(dbPkg.players).values({ worldId, kind: "player", userId: null, name: "A player with no user", color: "#000000" })).rejects.toThrow();
    await db.insert(dbPkg.players).values({ worldId, userId: user.id, name: "Kallias", color: "#000000" });
    expect((await db.select({ kind: dbPkg.players.kind }).from(dbPkg.players).where(eq(dbPkg.players.name, "Kallias")))[0]!.kind).toBe("player");
  });

  it("a player who already bears the name does not stop the army: the League's row takes the longer one", async () => {
    const user = (await db.insert(dbPkg.users).values({ email: `u-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    await db.insert(dbPkg.players).values({ worldId, userId: user.id, name: "the league", color: "#000000" });
    expect(await dbPkg.ensureLeagueArmy(worldId, at(0))).toBe(true);
    expect((await leagueRows())[0]!.name).toBe("The League of Massalia");
    expect(await men()).toBe(2050);
  });

  it("a season's upkeep is charged once: 513 for 2,050 men, and nobody deserts", async () => {
    await treasury(5000);
    expect(await dbPkg.settleLeagueArmy(at(3))).toEqual({ raised: true, charged: true, paid: 513, deserted: 0 });
    expect(await balance()).toBe(4487);
    expect(await ledger()).toEqual([["army:s3", -513]]);
    expect(await men()).toBe(2050);

    // A second call in the season writes nothing; the next season is charged again.
    expect(await dbPkg.settleLeagueArmy(at(3))).toEqual({ raised: false, charged: false, paid: 0, deserted: 0 });
    expect(await dbPkg.settleLeagueArmy(new Date(at(3).getTime() + 3_600_000))).toEqual({ raised: false, charged: false, paid: 0, deserted: 0 });
    expect(await balance()).toBe(4487);
    expect(await ledger()).toHaveLength(1);
    expect(await dbPkg.settleLeagueArmy(at(4))).toEqual({ raised: false, charged: true, paid: 513, deserted: 0 });
    expect(await ledger()).toEqual([["army:s3", -513], ["army:s4", -513]]);
    expect(await balance()).toBe(3974);
  });

  it("two calls at once charge the season once", async () => {
    await treasury(5000);
    await dbPkg.ensureLeagueArmy(worldId, at(3));
    const results = await Promise.all([dbPkg.settleLeagueArmy(at(3)), dbPkg.settleLeagueArmy(at(3)), dbPkg.settleLeagueArmy(at(3))]);
    expect(results.filter((r) => r.charged)).toHaveLength(1);
    expect(await balance()).toBe(4487);
    expect(await ledger()).toEqual([["army:s3", -513]]);
  });

  it("before the treasury is opened the army is raised but not charged", async () => {
    expect(await dbPkg.settleLeagueArmy(at(0))).toEqual({ raised: true, charged: false, paid: 0, deserted: 0 });
    expect(await men()).toBe(2050);
    expect(await ledger()).toEqual([]);
  });

  it("a treasury of 100 pays 100 and keeps 400 men: every town and every type is thinned, and the balance ends at 0", async () => {
    await treasury(100);
    expect(await dbPkg.settleLeagueArmy(at(3))).toEqual({ raised: true, charged: true, paid: 100, deserted: 1650 });
    expect(await balance()).toBe(0);
    expect(await men()).toBe(400);
    expect(await byTown()).toEqual({ massalia: 193, emporion: 48, nikaia: 29, "olbia-provence": 29, rhoda: 24, agathe: 19, antipolis: 19, arelate: 19, athinopolis: 12, monoikos: 8 });
    expect(await byType()).toEqual({ hoplite: 197, peltast: 100, ekdromos: 62, hippeis: 41 });
    expect(await ledger()).toEqual([["army:s3", -100], ["desertion:s3:1650", 0]]);
    // The ships cost nothing and stay.
    expect(await dbPkg.leagueFleet(db, worldId)).toEqual({ pentekonters: 29, triremes: 40 });
  });

  it("an army the treasury cannot pay at all deserts to the last man, its rows are gone, and it is never raised again", async () => {
    await treasury(100);
    await dbPkg.settleLeagueArmy(at(3)); // 400 men left, the treasury empty
    expect(await dbPkg.settleLeagueArmy(at(4))).toEqual({ raised: false, charged: true, paid: 0, deserted: 400 });
    expect(await men()).toBe(0);
    expect(await db.select().from(dbPkg.playerUnits).where(eq(dbPkg.playerUnits.worldId, worldId))).toEqual([]);
    expect(await ledger()).toEqual([["army:s3", -100], ["desertion:s3:1650", 0], ["army:s4", 0], ["desertion:s4:400", 0]]);

    // With no men standing nothing is due: season after season the settle writes
    // no row at all, whether the treasury is empty or full.
    for (const season of [5, 6, 7]) expect(await dbPkg.settleLeagueArmy(at(season))).toEqual({ raised: false, charged: false, paid: 0, deserted: 0 });
    expect(await ledger()).toHaveLength(4);
    await db.update(dbPkg.treasuries).set({ balance: 9000 }).where(and(eq(dbPkg.treasuries.worldId, worldId), eq(dbPkg.treasuries.owner, "league")));
    for (const season of [8, 9]) expect(await dbPkg.settleLeagueArmy(at(season))).toEqual({ raised: false, charged: false, paid: 0, deserted: 0 });
    expect(await dbPkg.ensureLeagueArmy(worldId, at(5))).toBe(false);
    expect(await men()).toBe(0);
    expect(await balance()).toBe(9000);
    expect(await ledger()).toHaveLength(4);
    expect(await leagueRows()).toHaveLength(1);
  });

  it("a payment of 512 keeps 2,048: Massalia's hoplites and peltasts lose one man each", async () => {
    await treasury(512);
    expect(await dbPkg.settleLeagueArmy(at(3))).toEqual({ raised: true, charged: true, paid: 512, deserted: 2 });
    expect(await men()).toBe(2048);
    expect(await countOf("massalia", "hoplite")).toBe(499);
    expect(await countOf("massalia", "peltast")).toBe(249);
    expect(await countOf("massalia", "ekdromos")).toBe(150);
    expect(await countOf("emporion", "hoplite")).toBe(126);
    expect(await balance()).toBe(0);
    expect(await ledger()).toEqual([["army:s3", -512], ["desertion:s3:2", 0]]);
  });

  it("2,049 men and a treasury of 512: it pays 512 and nobody deserts", async () => {
    await treasury(512);
    await dbPkg.ensureLeagueArmy(worldId, at(3));
    const one = (await units()).find((r) => r.basedAt === "monoikos" && r.unitId === "hippeis")!;
    await db.update(dbPkg.playerUnits).set({ count: one.count - 1 }).where(eq(dbPkg.playerUnits.id, one.id));
    expect(await men()).toBe(2049);
    expect(await dbPkg.settleLeagueArmy(at(3))).toEqual({ raised: false, charged: true, paid: 512, deserted: 0 });
    expect(await men()).toBe(2049);
    expect(await balance()).toBe(0);
    expect(await ledger()).toEqual([["army:s3", -512]]);
  });
});
