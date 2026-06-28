import { describe, expect, it } from "vitest";
import { rankStandings, STANDINGS_BOARDS, type StandingsInput } from "./standings.js";

// A roster helper: every metric defaults to 0; override per test. createdAt is a
// plain epoch ms so the earliest-joined tiebreak is easy to reason about.
function player(over: Partial<StandingsInput> & { playerId: string }): StandingsInput {
  return {
    name: over.playerId,
    house: "Xanthippos",
    classId: "trader",
    isUnfree: false,
    createdAt: 1000,
    metrics: { prestige: 0, wealth: 0, devotion: 0, militia: 0, intelligence: 0 },
    ...over,
  };
}

describe("rankStandings", () => {
  it("orders each board descending by its own stat", () => {
    const roster = [
      player({ playerId: "a", metrics: { prestige: 10, wealth: 1, devotion: 0, militia: 0, intelligence: 0 } }),
      player({ playerId: "b", metrics: { prestige: 30, wealth: 2, devotion: 0, militia: 0, intelligence: 0 } }),
      player({ playerId: "c", metrics: { prestige: 20, wealth: 3, devotion: 0, militia: 0, intelligence: 0 } }),
    ];
    const { boards } = rankStandings(roster, null);
    expect(boards.prestige.map((r) => r.playerId)).toEqual(["b", "c", "a"]);
    // Wealth ranks independently (by drachmae), so the order differs.
    expect(boards.wealth.map((r) => r.playerId)).toEqual(["c", "b", "a"]);
    expect(boards.prestige.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties by earliest createdAt, then playerId, deterministically", () => {
    const roster = [
      player({ playerId: "late", createdAt: 3000, metrics: { prestige: 50, wealth: 0, devotion: 0, militia: 0, intelligence: 0 } }),
      player({ playerId: "early", createdAt: 1000, metrics: { prestige: 50, wealth: 0, devotion: 0, militia: 0, intelligence: 0 } }),
      player({ playerId: "mid", createdAt: 2000, metrics: { prestige: 50, wealth: 0, devotion: 0, militia: 0, intelligence: 0 } }),
    ];
    const first = rankStandings(roster, null).boards.prestige.map((r) => r.playerId);
    expect(first).toEqual(["early", "mid", "late"]);
    // Same input → same output (no reliance on input array order / unstable sort).
    const shuffled = [roster[2]!, roster[0]!, roster[1]!];
    expect(rankStandings(shuffled, null).boards.prestige.map((r) => r.playerId)).toEqual(first);
  });

  it("falls back to playerId when createdAt also ties", () => {
    const roster = [
      player({ playerId: "z", createdAt: 1000 }),
      player({ playerId: "a", createdAt: 1000 }),
    ];
    expect(rankStandings(roster, null).boards.prestige.map((r) => r.playerId)).toEqual(["a", "z"]);
  });

  it("sinks unfree players to the bottom regardless of stat", () => {
    const roster = [
      player({ playerId: "slave", isUnfree: true, metrics: { prestige: 99, wealth: 99, devotion: 99, militia: 99, intelligence: 99 } }),
      player({ playerId: "free", isUnfree: false, metrics: { prestige: 1, wealth: 1, devotion: 1, militia: 1, intelligence: 1 } }),
    ];
    for (const board of STANDINGS_BOARDS) {
      expect(rankStandings(roster, null).boards[board].map((r) => r.playerId)).toEqual(["free", "slave"]);
    }
  });

  it("orders unfree players among themselves by stat then tiebreak", () => {
    const roster = [
      player({ playerId: "s-low", isUnfree: true, createdAt: 1000, metrics: { prestige: 5, wealth: 0, devotion: 0, militia: 0, intelligence: 0 } }),
      player({ playerId: "s-high", isUnfree: true, createdAt: 2000, metrics: { prestige: 9, wealth: 0, devotion: 0, militia: 0, intelligence: 0 } }),
      player({ playerId: "free", isUnfree: false, metrics: { prestige: 0, wealth: 0, devotion: 0, militia: 0, intelligence: 0 } }),
    ];
    expect(rankStandings(roster, null).boards.prestige.map((r) => r.playerId)).toEqual(["free", "s-high", "s-low"]);
  });

  it("marks only the viewer's rows", () => {
    const roster = [player({ playerId: "a" }), player({ playerId: "b" })];
    const { boards } = rankStandings(roster, "b");
    for (const board of STANDINGS_BOARDS) {
      const viewers = boards[board].filter((r) => r.isViewer).map((r) => r.playerId);
      expect(viewers).toEqual(["b"]);
    }
    // A null viewer (no active character) marks nobody.
    expect(rankStandings(roster, null).boards.prestige.every((r) => !r.isViewer)).toBe(true);
  });

  it("never leaks a raw stat value into the response rows", () => {
    const roster = [player({ playerId: "a", metrics: { prestige: 42, wealth: 77, devotion: 13, militia: 8, intelligence: 5 } })];
    const row = rankStandings(roster, "a").boards.prestige[0]!;
    expect(Object.keys(row).sort()).toEqual(["classId", "house", "isViewer", "name", "playerId", "rank"]);
  });
});
