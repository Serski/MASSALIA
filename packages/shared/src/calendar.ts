// ---------------------------------------------------------------------------
// In-game calendar: 1 real day = 1 in-game season. Four seasons make a year, and
// the game counts BC years *down* from 300 BC at the start of the run.
//
// Every function is pure and takes the clock (nowMs) and the world start
// (startedMs) as arguments — never call Date.now() in here, so the math stays
// deterministic and unit-testable.
// ---------------------------------------------------------------------------

export const SERVER_DURATION_DAYS = 182;
export const REAL_MS_PER_SEASON = 86_400_000; // one real day per in-game season
export const SEASONS_PER_YEAR = 4;
export const SEASON_NAMES = ["Winter", "Spring", "Summer", "Autumn"] as const;
export const START_YEAR_BC = 300;

export type GameDate = {
  // Seasons elapsed since the world started (0 = the opening Winter).
  seasonIndex: number;
  // Whole in-game years elapsed since the start.
  yearInGame: number;
  // Which season of the current year, 0..3.
  seasonOfYear: number;
  seasonName: (typeof SEASON_NAMES)[number];
  // BC year, counting down from START_YEAR_BC.
  yearBC: number;
};

// Map a wall-clock instant to the in-game date. seasonIndex is clamped at 0 so a
// not-yet-started (or clock-skewed) world reads as the opening Winter, 300 BC.
export function gameDate(nowMs: number, startedMs: number): GameDate {
  const seasonIndex = Math.max(0, Math.floor((nowMs - startedMs) / REAL_MS_PER_SEASON));
  const yearInGame = Math.floor(seasonIndex / SEASONS_PER_YEAR);
  const seasonOfYear = seasonIndex % SEASONS_PER_YEAR;
  return {
    seasonIndex,
    yearInGame,
    seasonOfYear,
    seasonName: SEASON_NAMES[seasonOfYear]!,
    yearBC: START_YEAR_BC - yearInGame,
  };
}

// Human label, e.g. "Summer, 282 BC".
export function formatGameDate(d: GameDate): string {
  return `${d.seasonName}, ${d.yearBC} BC`;
}
