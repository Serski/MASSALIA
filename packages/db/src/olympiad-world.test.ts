import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OLYMPIC_DELEGATE_TRAIT_ID, parseCalendarConfig } from "@massalia/shared";

// The Olympiad is per world. game_year restarts with every world, so an ended
// world's candidates, votes and nominate cards at the same year must never reach
// the active world's ballot, tally, delegates or nomination close. Integration test
// against a REAL Postgres, guarded to a *_test database (mirrors festival.test.ts).

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg = parseCalendarConfig(JSON.parse(readFileSync(resolve(root, "content/calendar/calendar-config.json"), "utf8")));
const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2000, 0, 1);
const SUMMER_Y0 = new Date(T0 + 2 * DAY + HOUR); // the Olympiad's season, year 0

suite("the Olympiad is per world (integration)", () => {
  let db: Awaited<ReturnType<typeof load>>["db"];
  let dbPkg: Awaited<ReturnType<typeof load>>["dbPkg"];
  let oldWorld: string;
  let liveWorld: string;

  async function load() {
    const dbPkg = await import("./index.js");
    return { dbPkg, db: dbPkg.createDb() };
  }

  async function character(worldId: string, name: string, prestige = 0): Promise<string> {
    const user = (await db.insert(dbPkg.users).values({ email: `${name}-${Math.random().toString(36).slice(2)}@t`, passwordHash: "x" }).returning())[0]!;
    const player = (await db.insert(dbPkg.players).values({ worldId, userId: user.id, name, color: "#123456", houseSlug: "test-house" }).returning())[0]!;
    return (await db.insert(dbPkg.playerCharacters).values({ playerId: player.id, worldId, houseSlug: "test-house", classId: "trader", prestige }).returning())[0]!.id;
  }
  const cards = async (characterId: string) => db.select().from(dbPkg.festivalEvents).where(eq(dbPkg.festivalEvents.characterId, characterId));
  const holdsDelegate = async (characterId: string) =>
    (await db.select().from(dbPkg.characterTraits).where(and(eq(dbPkg.characterTraits.characterId, characterId), eq(dbPkg.characterTraits.traitId, OLYMPIC_DELEGATE_TRAIT_ID)))).length > 0;
  const cycle = (worldId: string, phase: string, ends: { nominationEndsAt?: Date; votingEndsAt?: Date } = {}) =>
    db.insert(dbPkg.olympiads).values({ worldId, gameYear: 0, phase, ...ends });
  const candidate = (worldId: string, characterId: string) => db.insert(dbPkg.olympicCandidates).values({ worldId, olympiadGameYear: 0, characterId });
  const vote = (worldId: string, voterCharacterId: string, candidateCharacterId: string) =>
    db.insert(dbPkg.olympicVotes).values({ worldId, olympiadGameYear: 0, voterCharacterId, candidateCharacterId });
  const nominateCard = (characterId: string) =>
    db.insert(dbPkg.festivalEvents).values({ characterId, festivalId: "olympiad", eventId: "olympic-nominate", gameYear: 0, resolved: false });

  beforeAll(async () => {
    ({ db, dbPkg } = await load());
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE olympiads, olympic_candidates, olympic_votes, festival_events, character_traits, player_characters, dynasties, players, sessions, users, worlds CASCADE`);
    await db.insert(dbPkg.houses).values({ slug: "test-house", name: "House Test", initial: "T", alignment: "c", stance: "s", motto: "m", patron: "p", crest: "c" }).onConflictDoNothing();
    oldWorld = (await db.insert(dbPkg.worlds).values({ name: "Old", seed: "oly-old", startedAt: new Date(T0 - 100 * DAY), endsAt: new Date(T0), status: "ended" }).returning())[0]!.id;
    liveWorld = (await db.insert(dbPkg.worlds).values({ name: "Live", seed: "oly-live", startedAt: new Date(T0), endsAt: new Date(T0 + 182 * DAY), status: "active" }).returning())[0]!.id;
  });

  it("(a) the sweep deals the nominate card to the live world's living characters only", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const live = await character(liveWorld, "A");
    expect(await dbPkg.deliverOlympicNominationToAll(cfg, SUMMER_Y0)).toBe(1);
    expect((await cards(live)).map((c) => c.festivalId)).toEqual(["olympiad"]);
    expect(await cards(ghost)).toHaveLength(0);
  });

  it("(b) the ballot is the live world's", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const live = await character(liveWorld, "A");
    await cycle(oldWorld, "voting");
    await cycle(liveWorld, "voting");
    await candidate(oldWorld, ghost);
    await candidate(liveWorld, live);
    const ballot = await dbPkg.getOlympiadBallot(0);
    expect(ballot.map((b) => b.characterId)).toEqual([live]);
  });

  it("(c) a vote for the ended world's candidate is unknown_candidate; for the live one it is ok", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const live = await character(liveWorld, "A");
    const voter = await character(liveWorld, "B");
    await cycle(oldWorld, "voting");
    await cycle(liveWorld, "voting");
    await candidate(oldWorld, ghost);
    await candidate(liveWorld, live);
    expect(await dbPkg.castOlympiadVote(voter, ghost, 0, SUMMER_Y0)).toBe("unknown_candidate");
    expect(await dbPkg.getVoterChoice(voter, 0)).toBeNull();
    expect(await dbPkg.castOlympiadVote(voter, live, 0, SUMMER_Y0)).toBe("ok");
    expect(await dbPkg.getVoterChoice(voter, 0)).toBe(live);
  });

  it("(d) the tally crowns inside the world", async () => {
    const ghost = await character(oldWorld, "Ghost", 100);
    const ghostVoter = await character(oldWorld, "GhostVoter");
    const live = await character(liveWorld, "A", 5);
    const voter = await character(liveWorld, "B");
    const votingEndsAt = new Date(SUMMER_Y0.getTime() + DAY);
    await cycle(oldWorld, "voting", { votingEndsAt });
    await cycle(liveWorld, "voting", { votingEndsAt });
    await candidate(oldWorld, ghost);
    await candidate(liveWorld, live);
    await vote(oldWorld, ghostVoter, ghost);
    await vote(liveWorld, voter, live);

    const advanced = await dbPkg.advanceOlympiads(cfg, new Date(votingEndsAt.getTime() + HOUR));
    expect(advanced).toHaveLength(1);
    expect(advanced[0]!.delegatesChosen).toEqual([live]);
    expect(await holdsDelegate(live)).toBe(true);
    expect(await holdsDelegate(ghost)).toBe(false);
    expect((await dbPkg.olympiadDelegates(0)).map((d) => d.characterId)).toEqual([live]);
  });

  it("(e) the nomination close expires only the live world's cards", async () => {
    const ghost = await character(oldWorld, "Ghost");
    const live = await character(liveWorld, "A");
    await cycle(oldWorld, "nomination", { nominationEndsAt: new Date(T0 - DAY) });
    await cycle(liveWorld, "nomination", { nominationEndsAt: new Date(SUMMER_Y0.getTime() - HOUR) });
    await nominateCard(ghost);
    await nominateCard(live);

    const advanced = await dbPkg.advanceOlympiads(cfg, SUMMER_Y0);
    expect(advanced.map((a) => a.transitions)).toEqual([["nomination→voting"]]);
    const liveCard = (await cards(live))[0]!;
    expect(liveCard.resolved).toBe(true);
    expect(liveCard.resolvedChoiceId).toBe("expired");
    expect((await cards(ghost))[0]!.resolved).toBe(false);
  });
});
