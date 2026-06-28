import { describe, expect, it } from "vitest";
import { REAL_MS_PER_SEASON } from "./calendar.js";
import { buildChronicle, type ChronicleInput } from "./chronicle.js";

// One real day = one in-game season; tests anchor the world start at ms 0 so a
// timestamp of N seasons is simply N * REAL_MS_PER_SEASON.
const S = REAL_MS_PER_SEASON;

// A mixed dynasty: founder (gen 1) up to a single succession at season 40, then
// the heir (gen 2). Two season-6 events exercise the type-order tiebreak.
function fixture(): ChronicleInput {
  return {
    startedMs: 0,
    successionBoundariesMs: [40 * S],
    marriages: [{ id: "m1", marriedAt: 5 * S, spouseName: "Aristomache" }],
    births: [
      { id: "b1", bornAt: 9 * S, childName: "Kleon", sex: "male" },
      { id: "b2", bornAt: 45 * S, childName: "Nausika", sex: "female" },
    ],
    choregos: [{ id: "c1", closedAt: 6 * S, festivalId: "fest-dionysia", gameYear: 1 }],
    festivals: [{ id: "f1", createdAt: 6 * S, festivalId: "fest-artemisia", gameYear: 1, choregos: true }],
    olympics: [{ id: "o1", nominatedAt: 30 * S, gameYear: 7, sent: true }],
  };
}

describe("buildChronicle", () => {
  it("sorts ascending by season, breaking ties by a fixed type order", () => {
    const entries = buildChronicle(fixture());
    expect(entries.map((e) => e.type)).toEqual([
      "marriage", // season 5
      "megas_choregos", // season 6 (type order before participation)
      "festival_participation", // season 6
      "birth", // season 9
      "olympic_selection", // season 30
      "birth", // season 45
    ]);
    // seasonIndex is non-decreasing.
    const seasons = entries.map((e) => e.seasonIndex);
    expect(seasons).toEqual([...seasons].sort((a, b) => a - b));
  });

  it("derives label and yearBC from the timestamp via the in-game calendar", () => {
    const entries = buildChronicle(fixture());
    const byType = (t: string) => entries.find((e) => e.type === t)!;
    expect(byType("marriage").label).toBe("Spring, 299 BC"); // season 5
    expect(byType("megas_choregos").label).toBe("Summer, 299 BC"); // season 6
    expect(byType("olympic_selection").label).toBe("Summer, 293 BC"); // season 30
    expect(byType("olympic_selection").payload.yearBC).toBe(293);
    expect(entries.filter((e) => e.type === "birth").map((e) => e.label)).toEqual([
      "Spring, 298 BC", // season 9 — Kleon
      "Spring, 289 BC", // season 45 — Nausika
    ]);
  });

  it("tags generation from the succession boundaries", () => {
    const entries = buildChronicle(fixture());
    // Everything before the season-40 handoff is generation 1.
    for (const e of entries.filter((e) => e.seasonIndex < 40)) {
      expect(e.generation).toBe(1);
    }
    // The post-handoff birth (season 45) belongs to generation 2.
    expect(entries.find((e) => e.payload.childName === "Nausika")!.generation).toBe(2);
  });

  it("treats an event at the exact succession instant as the incoming generation", () => {
    const entries = buildChronicle({
      ...fixture(),
      successionBoundariesMs: [9 * S], // handoff lands exactly on Kleon's birth
      births: [{ id: "b1", bornAt: 9 * S, childName: "Kleon", sex: "male" }],
    });
    expect(entries.find((e) => e.payload.childName === "Kleon")!.generation).toBe(2);
  });

  it("carries the right structured payload for each of the five types", () => {
    const entries = buildChronicle(fixture());
    const byType = (t: string) => entries.find((e) => e.type === t)!;

    expect(byType("marriage").payload).toEqual({ spouseName: "Aristomache" });
    expect(byType("birth").payload).toEqual({ childName: "Kleon", sex: "male" });
    expect(byType("megas_choregos").payload).toEqual({ festivalId: "fest-dionysia", gameYear: 1 });
    expect(byType("festival_participation").payload).toEqual({
      festivalId: "fest-artemisia",
      gameYear: 1,
      choregos: true,
    });
    expect(byType("olympic_selection").payload).toEqual({ gameYear: 7, yearBC: 293, sent: true });
  });

  it("preserves a nomination-only Olympic entry (sent: false)", () => {
    const entries = buildChronicle({
      ...fixture(),
      olympics: [{ id: "o1", nominatedAt: 30 * S, gameYear: 7, sent: false }],
    });
    expect(entries.find((e) => e.type === "olympic_selection")!.payload.sent).toBe(false);
  });

  it("is deterministic regardless of input order, with row id as the final tiebreak", () => {
    // Two participations in the same season (same type) — id breaks the tie.
    const sameSeason: ChronicleInput = {
      startedMs: 0,
      successionBoundariesMs: [],
      marriages: [],
      births: [],
      choregos: [],
      festivals: [
        { id: "f-b", createdAt: 6 * S, festivalId: "fest-artemisia", gameYear: 1, choregos: false },
        { id: "f-a", createdAt: 6 * S, festivalId: "fest-dionysia", gameYear: 1, choregos: true },
      ],
      olympics: [],
    };
    const first = buildChronicle(sameSeason).map((e) => e.payload.festivalId);
    // Reverse the input order; the output must not change.
    const reversed = buildChronicle({ ...sameSeason, festivals: [...sameSeason.festivals].reverse() });
    expect(reversed.map((e) => e.payload.festivalId)).toEqual(first);
    // "f-a" precedes "f-b" by id.
    expect(first).toEqual(["fest-dionysia", "fest-artemisia"]);
  });

  it("clamps a pre-start timestamp to the opening season and returns [] for no rows", () => {
    expect(
      buildChronicle({
        startedMs: 100 * S,
        successionBoundariesMs: [],
        marriages: [{ id: "m1", marriedAt: 0, spouseName: "Theano" }],
        births: [],
        choregos: [],
        festivals: [],
        olympics: [],
      })[0],
    ).toMatchObject({ seasonIndex: 0, label: "Winter, 300 BC", generation: 1 });

    expect(
      buildChronicle({
        startedMs: 0,
        successionBoundariesMs: [],
        marriages: [],
        births: [],
        choregos: [],
        festivals: [],
        olympics: [],
      }),
    ).toEqual([]);
  });
});
