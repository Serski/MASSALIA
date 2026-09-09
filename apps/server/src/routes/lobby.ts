import type { FastifyInstance } from "fastify";
import { and, asc, count, countDistinct, desc, eq } from "drizzle-orm";
import { createDb, dynasties, houses, officeHistory, players, playerCharacters, professions, users, worlds } from "@massalia/db";
import { formatGameDate, gameDate } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { findCharacterRow, getActivePlayer, getActiveWorld } from "../services/character.js";
import { loadStandingsRoster } from "../services/standings.js";
import { rankStandings } from "./standings.js";

const db = createDb();

// The account-level Lobby: the signed-in user's account, the worlds (the active
// one with their seat in it, the announced ones, the ended ones) and their
// record across worlds. Read-only — nothing here mutates, so no player lock.
// Rank only, never a stat value: the prestige position comes out of the same
// ranker as /api/standings and the metric itself is never serialized.
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
      you: null | {
        characterId: string | null;
        name: string;
        houseName: string;
        professionName: string | null;
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
    you: await youSection(userId, world.id),
  };
}

async function youSection(userId: string, worldId: string): Promise<NonNullable<LobbyResponse["worlds"]["active"]>["you"]> {
  const player = await getActivePlayer(userId, worldId);
  if (!player) return null;

  const house = player.houseSlug ? (await db.select({ name: houses.name }).from(houses).where(eq(houses.slug, player.houseSlug)).limit(1))[0] : undefined;
  const profession = player.professionSlug
    ? (await db.select({ name: professions.name }).from(professions).where(eq(professions.slug, player.professionSlug)).limit(1))[0]
    : undefined;
  const character = await findCharacterRow(player.id, worldId);
  const dynasty = character?.dynastyId
    ? (await db.select({ name: dynasties.name, generation: dynasties.generation }).from(dynasties).where(eq(dynasties.id, character.dynastyId)).limit(1))[0]
    : undefined;

  // The same roster + ranker as /api/standings; only the position survives.
  const prestigeBoard = rankStandings(await loadStandingsRoster(worldId), player.id).boards.prestige;
  const prestigeRank = prestigeBoard.find((row) => row.playerId === player.id)?.rank ?? null;

  return {
    characterId: character?.id ?? null,
    name: player.name,
    houseName: house?.name ?? player.houseSlug ?? "—",
    professionName: profession?.name ?? null,
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
