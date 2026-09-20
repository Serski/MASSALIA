import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseAgeConfig, parseContractsContent, parseFamilyConfig, parseTraitsFile } from "@massalia/shared";

// The worker's spouse-death and merc-contract sweeps walk the active world only: an
// ended world is history, and its marriages and contracts stay as the flip left
// them. Integration test against a REAL Postgres, guarded to a *_test database
// (mirrors festival.test.ts).

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content = (file: string) => JSON.parse(readFileSync(resolve(root, "content", file), "utf8"));
const familyCfg = parseFamilyConfig(content("family/family-config.json"));
const ageCfg = parseAgeConfig(content("age/age-config.json"));
const contracts = parseContractsContent(content("military/contracts.json"));
const traitDefs = parseTraitsFile(content("traits/traits.json"));
// The cfg map the worker builds (apps/worker/src/index.ts, mercContractCfg).
const cfgMap = Object.fromEntries(contracts.contracts.map((c) => [c.id, { dailyDrachmae: c.dailyDrachmae, termSeasons: c.termSeasons, completionTraits: c.completionTraits, risk: c.risk, deathSetting: c.deathSetting }]));
const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);

suite("the worker sweeps walk the active world only (integration)", () => {
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
    return (await db.insert(dbPkg.playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "hoplite", startAge: 30, deathAge: 90 }).returning())[0]!.id;
  }
  const reload = async (characterId: string) => (await db.select().from(dbPkg.playerCharacters).where(eq(dbPkg.playerCharacters.id, characterId)).limit(1))[0]!;

  // An open marriage to a wife already past her rolled death age (seated as
  // apps/server/src/services/family-spouse.test.ts does, rows through the schema).
  async function marryWidowToBe(worldId: string, characterId: string): Promise<void> {
    const wife = (
      await db.insert(dbPkg.familyCandidates).values({ worldId, forCharacterId: characterId, purpose: "marriage", name: "Wife", sex: "female", houseSlug: "test-house", age: 65, consumedAt: new Date() }).returning()
    )[0]!;
    await db.insert(dbPkg.marriages).values({ characterId, candidateId: wife.id, spouseDeathAge: 60 });
    await db.update(dbPkg.playerCharacters).set({ spouseCandidateId: wife.id }).where(eq(dbPkg.playerCharacters.id, characterId));
  }
  const marriageOf = async (characterId: string) => (await db.select().from(dbPkg.marriages).where(eq(dbPkg.marriages.characterId, characterId)))[0]!;

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE marriages, family_candidates, composure_log, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    oldWorld = (await db.insert(dbPkg.worlds).values({ name: "Old", seed: "sweep-old", startedAt: new Date(T0 - 100 * DAY), endsAt: new Date(T0), status: "ended" }).returning())[0]!.id;
    liveWorld = (await db.insert(dbPkg.worlds).values({ name: "Live", seed: "sweep-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  it("(a) the spouse-death sweep ends the live world's marriage and leaves the ended world's open", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const live = await character(liveWorld, "A");
    await marryWidowToBe(oldWorld, ghost);
    await marryWidowToBe(liveWorld, live);

    const deaths = await dbPkg.sweepSpouseDeaths({ familyCfg, ageCfg });
    expect(deaths.map((d) => d.characterId)).toEqual([live]);

    expect((await marriageOf(live)).endedAt).not.toBeNull();
    expect((await reload(live)).spouseCandidateId).toBeNull();
    expect((await marriageOf(ghost)).endedAt).toBeNull();
    expect((await reload(ghost)).spouseCandidateId).not.toBeNull();
  });

  it("(b) the merc-contract sweep completes the live world's served-out contract and leaves the ended world's", async () => {
    const contract = contracts.contracts[0]!;
    const now = new Date();
    const servedOut = new Date(now.getTime() - (contract.termSeasons + 1) * DAY);
    const ghost = await character(oldWorld, "Ghost");
    const live = await character(liveWorld, "A");
    for (const id of [ghost, live]) {
      await db.update(dbPkg.playerCharacters).set({ contractId: contract.id, contractStartedAt: servedOut, contractSeasonsTotal: contract.termSeasons, lastSalaryAt: servedOut }).where(eq(dbPkg.playerCharacters.id, id));
    }

    // A clean return forced, so the completion is deterministic.
    const swept = await dbPkg.sweepMercenaryContracts(cfgMap, { traitDefs, riskCfg: contracts.risk, rng: () => 0.999999, now });
    expect(swept.checked).toBe(1);
    expect(swept.completed).toBe(1);
    expect(swept.died).toBe(0);

    expect((await reload(live)).contractId).toBeNull();
    expect((await reload(ghost)).contractId).toBe(contract.id);
  });
});
