import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";

// @massalia/db opens a connection at module load (every db helper calls createDb
// at import time), so it is pulled in lazily inside the handler. That keeps the
// pure ranking helper below importable — and unit-testable — without a DATABASE_URL.
type Db = ReturnType<typeof import("@massalia/db").createDb>;
let _db: Db | null = null;

// The five public leaderboards. "wealth" ranks by drachmae; the rest map 1:1 to
// the character stat columns.
export type StandingsBoard = "prestige" | "wealth" | "devotion" | "militia" | "intelligence";

export const STANDINGS_BOARDS: StandingsBoard[] = ["prestige", "wealth", "devotion", "militia", "intelligence"];

// A player's ranking inputs. The metric values are the SORT KEYS ONLY — they are
// never copied into the response (rank position is all the client ever sees).
export type StandingsInput = {
  playerId: string;
  name: string;
  house: string;
  classId: string;
  // Unfree (slave) players sink to the bottom of every board regardless of stat.
  isUnfree: boolean;
  // Deterministic tiebreak anchor (ms epoch): earliest-joined ranks higher.
  createdAt: number;
  metrics: Record<StandingsBoard, number>;
};

// A single leaderboard row — rank position only, by design. No stat value.
export type StandingRow = {
  rank: number;
  playerId: string;
  name: string;
  house: string;
  classId: string;
  isViewer: boolean;
};

export type StandingsResponse = {
  boards: Record<StandingsBoard, StandingRow[]>;
};

// Pure ranking: descending by the board's stat, ties broken by earliest createdAt,
// then playerId for full determinism. Unfree players are forced to the bottom.
// Emits rank-only rows — raw stat values are intentionally dropped here.
export function rankStandings(roster: StandingsInput[], viewerPlayerId: string | null): StandingsResponse {
  const boards = {} as Record<StandingsBoard, StandingRow[]>;
  for (const board of STANDINGS_BOARDS) {
    const sorted = [...roster].sort((a, b) => {
      if (a.isUnfree !== b.isUnfree) return a.isUnfree ? 1 : -1;
      const av = a.metrics[board];
      const bv = b.metrics[board];
      if (av !== bv) return bv - av;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    });
    boards[board] = sorted.map((p, index) => ({
      rank: index + 1,
      playerId: p.playerId,
      name: p.name,
      house: p.house,
      classId: p.classId,
      isViewer: viewerPlayerId !== null && p.playerId === viewerPlayerId,
    }));
  }
  return { boards };
}

export async function standingsRoutes(app: FastifyInstance) {
  // Every active player in the world, ranked across the five boards. Rank-only:
  // the underlying stat values are computed here and never serialized.
  app.get("/", async (request, reply) => {
    // Imported lazily: these modules open a DB connection at module load, which
    // would otherwise pull a DATABASE_URL requirement into the pure unit tests.
    const { createDb, houses, players, playerCharacters } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const { getActivePlayer, getActiveWorldId } = await import("../services/character.js");
    const db = (_db ??= createDb());

    const user = await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }
    const viewer = await getActivePlayer(user.id, worldId);
    if (!viewer) {
      reply.code(404);
      return { error: "No active character found." };
    }

    // All active players; LEFT JOIN their character (a legacy player may predate
    // the sheet — they rank with zeroed stats) and house (for the display name).
    const rows = await db
      .select({
        playerId: players.id,
        name: players.name,
        houseSlug: players.houseSlug,
        houseName: houses.name,
        createdAt: players.createdAt,
        classId: playerCharacters.classId,
        prestige: playerCharacters.prestige,
        drachmae: playerCharacters.drachmae,
        devotion: playerCharacters.devotion,
        militia: playerCharacters.militia,
        intelligence: playerCharacters.intelligence,
      })
      .from(players)
      .leftJoin(playerCharacters, and(eq(playerCharacters.playerId, players.id), eq(playerCharacters.worldId, worldId)))
      .leftJoin(houses, eq(houses.slug, players.houseSlug))
      .where(and(eq(players.worldId, worldId), eq(players.isActive, true)));

    const roster: StandingsInput[] = rows.map((r) => ({
      playerId: r.playerId,
      name: r.name,
      house: r.houseName ?? r.houseSlug ?? "—",
      classId: r.classId ?? "",
      isUnfree: r.classId === "slave",
      createdAt: r.createdAt.getTime(),
      metrics: {
        prestige: r.prestige ?? 0,
        wealth: r.drachmae ?? 0,
        devotion: r.devotion ?? 0,
        militia: r.militia ?? 0,
        intelligence: r.intelligence ?? 0,
      },
    }));

    return rankStandings(roster, viewer.id);
  });
}
