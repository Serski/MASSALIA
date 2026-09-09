import { and, eq } from "drizzle-orm";
import type { StandingsInput } from "../routes/standings.js";

// The standings roster: every active player in a world with the sort keys the
// ranker needs. Shared by GET /api/standings and GET /api/lobby (a player's
// prestige rank). @massalia/db opens a connection at module load, so it is
// pulled in lazily — the pure ranking tests import routes/standings.ts (and
// through it nothing here at runtime: the import above is type-only) without
// a DATABASE_URL.
type Db = ReturnType<typeof import("@massalia/db").createDb>;
let _db: Db | null = null;

export async function loadStandingsRoster(worldId: string): Promise<StandingsInput[]> {
  const { createDb, houses, players, playerCharacters } = await import("@massalia/db");
  const db = (_db ??= createDb());

  // All active players; LEFT JOIN their character (a legacy player may predate
  // the sheet — they rank with zeroed stats) and house (for the display name).
  const rows = await db
    .select({
      playerId: players.id,
      name: players.name,
      houseSlug: players.houseSlug,
      houseName: houses.name,
      createdAt: players.createdAt,
      characterId: playerCharacters.id,
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
    characterId: r.characterId ?? null,
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

  return roster;
}
