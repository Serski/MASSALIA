import type { FastifyInstance } from "fastify";
import { and, asc, count, countDistinct, desc, eq, inArray } from "drizzle-orm";
import { createDb, dynasties, houses, officeHistory, players, playerCharacters, professions, users, worlds } from "@massalia/db";
import { currentAge, formatGameDate, gameDate, portraitFor } from "@massalia/shared";
import { getAgeConfig, portraitUrl } from "../services/age.js";
import { requireAuth } from "../services/auth.js";
import { findCharacterRow, getActivePlayer, getActiveWorld, type PlayerRow } from "../services/character.js";
import { loadStandingsRoster } from "../services/standings.js";
import { rankStandings, type StandingRow } from "./standings.js";

const db = createDb();

// The account-level Lobby: the signed-in user's account, the worlds (the active
// one with their seat in it, the announced ones, the ended ones) and their
// record across worlds. Read-only — nothing here mutates, so no player lock.
// Rank only, never a stat value: the prestige position comes out of the same
// ranker as /api/standings and the metric itself is never serialized. Citizens
// is the top five of that board — no presence or online tracking of any kind.
export type LobbyCitizen = {
  rank: number;
  characterId: string | null;
  name: string;
  houseName: string;
  professionSlug: string | null;
  professionName: string | null;
  faceId: string | null;
  portrait: string | null;
};

export type LobbyResponse = {
  user: { email: string; emailVerified: boolean; newsletterOptIn: boolean; isAdmin: boolean; memberSince: string };
  worlds: {
    active: null | {
      id: string;
      name: string;
      tagline: string | null;
      startedAt: string;
      endsAt: string;
      gameDateLabel: string;
      seasonEndsIn: number;
      playerCount: number;
      // The first five rows of the prestige board, in board order.
      citizens: LobbyCitizen[];
      you: null | {
        characterId: string | null;
        name: string;
        houseName: string;
        professionSlug: string | null;
        professionName: string | null;
        // The aged avatar portrait the player sees in game (as /me/state); null
        // without a character row. faceId is the class-portrait fallback.
        portrait: string | null;
        faceId: string | null;
        dynastyName: string | null;
        generation: number | null;
        prestigeRank: number | null;
        rosterSize: number;
      };
    };
    announced: Array<{ id: string; name: string; tagline: string | null; startsAt: string }>;
    ended: Array<{ id: string; name: string; tagline: string | null; startedAt: string; endsAt: string; playerCount: number }>;
  };
  record: {
    worldsPlayed: number;
    offices: Array<{ worldName: string; office: string; side: string | null; startedYear: number; endedYear: number | null; acquiredVia: string }>;
  };
};

// The portrait the player sees in game, resolved exactly as /me/state does it:
// the avatar's stage for the character's current age. null without a character
// row (or an avatar the config no longer knows).
function agedPortrait(character: { avatarId: string | null; startAge: number; createdAt: Date } | null, now: number): string | null {
  if (!character) return null;
  const ageCfg = getAgeConfig();
  const age = currentAge(character.startAge, character.createdAt.getTime(), now, ageCfg);
  return portraitUrl(portraitFor(character.avatarId ?? "", age, ageCfg));
}

async function activeWorldSection(userId: string, now: number): Promise<LobbyResponse["worlds"]["active"]> {
  const active = await getActiveWorld();
  if (!active) return null;
  const world = (
    await db
      .select({ id: worlds.id, name: worlds.name, tagline: worlds.tagline, startedAt: worlds.startedAt, endsAt: worlds.endsAt })
      .from(worlds)
      .where(eq(worlds.id, active.id))
      .limit(1)
  )[0];
  if (!world) return null;

  const playerCount = (await db.select({ n: count() }).from(players).where(and(eq(players.worldId, world.id), eq(players.isActive, true))))[0]?.n ?? 0;

  // One ranking per request — the same roster + ranker as /api/standings — shared
  // by the viewer's own rank and the Citizens list. Only positions survive.
  const viewer = await getActivePlayer(userId, world.id);
  const prestigeBoard = rankStandings(await loadStandingsRoster(world.id), viewer?.id ?? null).boards.prestige;

  return {
    id: world.id,
    name: world.name,
    tagline: world.tagline,
    startedAt: world.startedAt.toISOString(),
    endsAt: world.endsAt.toISOString(),
    // In-game date: 1 real day = 1 season, counting BC years down from 300 (as /me/state).
    gameDateLabel: formatGameDate(gameDate(now, active.startedMs)),
    // Secondary real-time countdown to the end of the 182-day run (as /me/state).
    seasonEndsIn: Math.max(0, Math.ceil((world.endsAt.getTime() - now) / 86_400_000)),
    playerCount,
    citizens: await citizensSection(prestigeBoard.slice(0, 5), world.id, now),
    you: viewer ? await youSection(viewer, world.id, prestigeBoard, now) : null,
  };
}

// The top of the prestige board with what a card needs: one query for the five
// players (house + profession names, the character for the aged portrait),
// then reordered by the board — the query returns rows in no particular order.
async function citizensSection(top: StandingRow[], worldId: string, now: number): Promise<LobbyCitizen[]> {
  if (!top.length) return [];
  const rows = await db
    .select({
      playerId: players.id,
      name: players.name,
      faceId: players.faceId,
      professionSlug: players.professionSlug,
      houseSlug: players.houseSlug,
      houseName: houses.name,
      professionName: professions.name,
      characterId: playerCharacters.id,
      avatarId: playerCharacters.avatarId,
      startAge: playerCharacters.startAge,
      createdAt: playerCharacters.createdAt,
    })
    .from(players)
    .leftJoin(playerCharacters, and(eq(playerCharacters.playerId, players.id), eq(playerCharacters.worldId, worldId)))
    .leftJoin(houses, eq(houses.slug, players.houseSlug))
    .leftJoin(professions, eq(professions.slug, players.professionSlug))
    .where(
      inArray(
        players.id,
        top.map((row) => row.playerId),
      ),
    );
  const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
  return top.flatMap((row) => {
    const p = byPlayer.get(row.playerId);
    if (!p) return [];
    const character = p.characterId && p.startAge !== null && p.createdAt !== null ? { avatarId: p.avatarId, startAge: p.startAge, createdAt: p.createdAt } : null;
    return [
      {
        rank: row.rank,
        characterId: p.characterId ?? null,
        name: p.name,
        houseName: p.houseName ?? p.houseSlug ?? "—",
        professionSlug: p.professionSlug,
        professionName: p.professionName ?? null,
        faceId: p.faceId,
        portrait: agedPortrait(character, now),
      },
    ];
  });
}

async function youSection(player: PlayerRow, worldId: string, prestigeBoard: StandingRow[], now: number): Promise<NonNullable<LobbyResponse["worlds"]["active"]>["you"]> {
  const house = player.houseSlug ? (await db.select({ name: houses.name }).from(houses).where(eq(houses.slug, player.houseSlug)).limit(1))[0] : undefined;
  const profession = player.professionSlug
    ? (await db.select({ name: professions.name }).from(professions).where(eq(professions.slug, player.professionSlug)).limit(1))[0]
    : undefined;
  const character = await findCharacterRow(player.id, worldId);
  const dynasty = character?.dynastyId
    ? (await db.select({ name: dynasties.name, generation: dynasties.generation }).from(dynasties).where(eq(dynasties.id, character.dynastyId)).limit(1))[0]
    : undefined;

  const prestigeRank = prestigeBoard.find((row) => row.playerId === player.id)?.rank ?? null;

  return {
    characterId: character?.id ?? null,
    name: player.name,
    houseName: house?.name ?? player.houseSlug ?? "—",
    professionSlug: player.professionSlug,
    professionName: profession?.name ?? null,
    portrait: agedPortrait(character, now),
    faceId: player.faceId,
    dynastyName: dynasty?.name ?? null,
    generation: dynasty?.generation ?? null,
    prestigeRank,
    rosterSize: prestigeBoard.length,
  };
}

export async function lobbyRoutes(app: FastifyInstance) {
  app.get("/", async (request): Promise<LobbyResponse> => {
    const auth = await requireAuth(request);
    const now = Date.now();

    const userRow = (
      await db
        .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, newsletterOptIn: users.newsletterOptIn, isAdmin: users.isAdmin, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, auth.id))
        .limit(1)
    )[0];
    if (!userRow) {
      const error = new Error("Authentication required");
      (error as Error & { statusCode?: number }).statusCode = 401;
      throw error;
    }

    const active = await activeWorldSection(auth.id, now);

    const announced = await db
      .select({ id: worlds.id, name: worlds.name, tagline: worlds.tagline, startedAt: worlds.startedAt })
      .from(worlds)
      .where(eq(worlds.status, "announced"))
      .orderBy(asc(worlds.startedAt));

    // Every player row that ever joined the world, active or not.
    const ended = await db
      .select({ id: worlds.id, name: worlds.name, tagline: worlds.tagline, startedAt: worlds.startedAt, endsAt: worlds.endsAt, playerCount: count(players.id) })
      .from(worlds)
      .leftJoin(players, eq(players.worldId, worlds.id))
      .where(eq(worlds.status, "ended"))
      .groupBy(worlds.id)
      .orderBy(desc(worlds.endsAt));

    const worldsPlayed = (await db.select({ n: countDistinct(players.worldId) }).from(players).where(eq(players.userId, auth.id)))[0]?.n ?? 0;

    const offices = await db
      .select({
        worldName: worlds.name,
        office: officeHistory.office,
        side: officeHistory.side,
        startedYear: officeHistory.startedYear,
        endedYear: officeHistory.endedYear,
        acquiredVia: officeHistory.acquiredVia,
      })
      .from(officeHistory)
      .innerJoin(playerCharacters, eq(playerCharacters.id, officeHistory.characterId))
      .innerJoin(players, eq(players.id, playerCharacters.playerId))
      .innerJoin(worlds, eq(worlds.id, officeHistory.worldId))
      .where(eq(players.userId, auth.id))
      .orderBy(desc(officeHistory.createdAt));

    return {
      user: {
        email: userRow.email,
        emailVerified: Boolean(userRow.emailVerifiedAt),
        newsletterOptIn: userRow.newsletterOptIn,
        isAdmin: userRow.isAdmin,
        memberSince: userRow.createdAt.toISOString(),
      },
      worlds: {
        active,
        announced: announced.map((w) => ({ id: w.id, name: w.name, tagline: w.tagline, startsAt: w.startedAt.toISOString() })),
        ended: ended.map((w) => ({
          id: w.id,
          name: w.name,
          tagline: w.tagline,
          startedAt: w.startedAt.toISOString(),
          endsAt: w.endsAt.toISOString(),
          playerCount: w.playerCount,
        })),
      },
      record: { worldsPlayed, offices },
    };
  });
}
