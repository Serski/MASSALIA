import type { FastifyInstance } from "fastify";
import { loadStandingsRoster } from "../services/standings.js";

// The five public leaderboards. "wealth" ranks by drachmae; the rest map 1:1 to
// the character stat columns.
export type StandingsBoard = "prestige" | "wealth" | "devotion" | "militia" | "intelligence";

export const STANDINGS_BOARDS: StandingsBoard[] = ["prestige", "wealth", "devotion", "militia", "intelligence"];

// A player's ranking inputs. The metric values are the SORT KEYS ONLY — they are
// never copied into the response (rank position is all the client ever sees).
export type StandingsInput = {
  playerId: string;
  // The player's character (dynasty slot) id — the public-profile key. Null for a
  // legacy player with no character row yet (they rank with zeroed stats).
  characterId: string | null;
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
  // The public-profile key — null for a legacy player with no character row.
  characterId: string | null;
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
      characterId: p.characterId,
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
  // the underlying stat values are loaded (services/standings.ts) and never serialized.
  app.get("/", async (request, reply) => {
    // Imported lazily: these modules open a DB connection at module load, which
    // would otherwise pull a DATABASE_URL requirement into the pure unit tests
    // (services/standings.ts defers its own @massalia/db import the same way).
    const { requireAuth } = await import("../services/auth.js");
    const { getActivePlayer, getActiveWorldId } = await import("../services/character.js");

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

    const roster = await loadStandingsRoster(worldId);
    return rankStandings(roster, viewer.id);
  });
}
