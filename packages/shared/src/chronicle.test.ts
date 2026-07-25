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
        { id: "f-b", createdAt: 6 * S, festivalId: "fest-artemisia", gameYear: 1, choregos: true },
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

// A bare input with only the fields a case overrides — keeps the festival-trimming
// cases focused on the festival/choregos interaction.
function festivalCase(over: Partial<ChronicleInput>): ChronicleInput {
  return {
    startedMs: 0,
    successionBoundariesMs: [],
    marriages: [],
    births: [],
    choregos: [],
    festivals: [],
    olympics: [],
    ...over,
  };
}

describe("buildChronicle — festival trimming", () => {
  it("drops passive participation (choregos: false) entirely", () => {
    const out = buildChronicle(
      festivalCase({
        festivals: [{ id: "f1", createdAt: 6 * S, festivalId: "fest-dionysia", gameYear: 1, choregos: false }],
      }),
    );
    expect(out).toEqual([]);
  });

  it("keeps a funded patron who did not win (choregos: true, no matching Megas Choregos)", () => {
    const out = buildChronicle(
      festivalCase({
        festivals: [{ id: "f1", createdAt: 6 * S, festivalId: "fest-dionysia", gameYear: 1, choregos: true }],
      }),
    );
    expect(out.map((e) => e.type)).toEqual(["festival_participation"]);
    expect(out[0]!.payload).toMatchObject({ festivalId: "fest-dionysia", gameYear: 1, choregos: true });
  });

  it("suppresses the paired participation when the same instance was won — only the Megas Choregos line remains", () => {
    const out = buildChronicle(
      festivalCase({
        choregos: [{ id: "c1", closedAt: 6 * S, festivalId: "fest-dionysia", gameYear: 1 }],
        festivals: [
          // Same festivalId + gameYear as the win → suppressed.
          { id: "f1", createdAt: 6 * S, festivalId: "fest-dionysia", gameYear: 1, choregos: true },
          // Same festival, different year → key differs, so this one survives.
          { id: "f2", createdAt: 10 * S, festivalId: "fest-dionysia", gameYear: 2, choregos: true },
        ],
      }),
    );
    expect(out.map((e) => e.type)).toEqual(["megas_choregos", "festival_participation"]);
    // The surviving participation is the unwon, later-year instance — not the won one.
    expect(out.find((e) => e.type === "festival_participation")!.payload).toMatchObject({
      festivalId: "fest-dionysia",
      gameYear: 2,
    });
  });

  it("renders a Megas Choregos win that has no participation partner (the win never depends on one)", () => {
    const out = buildChronicle(
      festivalCase({
        choregos: [{ id: "c1", closedAt: 6 * S, festivalId: "fest-artemisia", gameYear: 3 }],
        festivals: [], // no choregos:true row for this instance at all
      }),
    );
    expect(out.map((e) => e.type)).toEqual(["megas_choregos"]);
    expect(out[0]!.payload).toMatchObject({ festivalId: "fest-artemisia", gameYear: 3 });
  });
});

describe("buildChronicle — divorce (pack B)", () => {
  const base = { startedMs: 0, successionBoundariesMs: [] as number[], births: [], choregos: [], festivals: [], olympics: [] };

  it("a divorced marriage emits a divorce entry at endedAt; an intact one does not", () => {
    const input: ChronicleInput = {
      ...base,
      marriages: [
        { id: "m1", marriedAt: 5 * S, spouseName: "Aristomache", endedAt: 12 * S, endReason: "divorced" },
        { id: "m2", marriedAt: 20 * S, spouseName: "Theano" }, // intact
      ],
    };
    const entries = buildChronicle(input);
    const divorces = entries.filter((e) => e.type === "divorce");
    expect(divorces).toHaveLength(1);
    expect(divorces[0]!.payload).toEqual({ spouseName: "Aristomache" });
    expect(divorces[0]!.seasonIndex).toBe(12); // dated at endedAt, not marriedAt
    expect(entries.filter((e) => e.type === "marriage")).toHaveLength(2); // both marriages still shown
  });

  it("a spouse_died end does not emit a divorce entry", () => {
    const input: ChronicleInput = {
      ...base,
      marriages: [{ id: "m1", marriedAt: 5 * S, spouseName: "X", endedAt: 12 * S, endReason: "spouse_died" }],
    };
    expect(buildChronicle(input).filter((e) => e.type === "divorce")).toHaveLength(0);
  });
});

describe("buildChronicle — tragedies (pack C)", () => {
  const base = { startedMs: 0, successionBoundariesMs: [] as number[], births: [], choregos: [], festivals: [], olympics: [] };

  it("stages each tragedy_* end as its own type, dated at endedAt, after the marriage", () => {
    const input: ChronicleInput = {
      ...base,
      marriages: [
        { id: "m1", marriedAt: 5 * S, spouseName: "Phaidra", endedAt: 10 * S, endReason: "tragedy_phaedra" },
        { id: "m2", marriedAt: 20 * S, spouseName: "Klytaimnestra", endedAt: 25 * S, endReason: "tragedy_clytemnestra" },
        { id: "m3", marriedAt: 30 * S, spouseName: "Medeia", endedAt: 35 * S, endReason: "tragedy_medea" },
      ],
    };
    const entries = buildChronicle(input);
    const t = (type: string) => entries.find((e) => e.type === type)!;
    expect(t("tragedy_phaedra").seasonIndex).toBe(10); // dated at endedAt, not marriedAt
    expect(t("tragedy_phaedra").payload).toEqual({ spouseName: "Phaidra" });
    expect(t("tragedy_clytemnestra").seasonIndex).toBe(25);
    expect(t("tragedy_medea").seasonIndex).toBe(35);
    expect(entries.filter((e) => e.type === "marriage")).toHaveLength(3); // each marriage still shown
    // A same-season marriage vs its end orders marriage-first (TYPE_ORDER).
    const same = buildChronicle({ ...base, marriages: [{ id: "m1", marriedAt: 8 * S, spouseName: "P", endedAt: 8 * S, endReason: "tragedy_phaedra" }] });
    expect(same.map((e) => e.type)).toEqual(["marriage", "tragedy_phaedra"]);
  });

  it("a non-tragedy end (spouse_died) stages no tragedy entry", () => {
    const input: ChronicleInput = { ...base, marriages: [{ id: "m1", marriedAt: 5 * S, spouseName: "X", endedAt: 12 * S, endReason: "spouse_died" }] };
    expect(buildChronicle(input).filter((e) => e.type.startsWith("tragedy_"))).toHaveLength(0);
  });

  it("lineage: a predecessor's tragedy_clytemnestra entry keeps generation 1 across a later handoff (the heir still sees it)", () => {
    // Founder murdered at season 10; handoff at season 20; the heir weds at 25.
    const input: ChronicleInput = {
      ...base,
      successionBoundariesMs: [20 * S],
      marriages: [
        { id: "m1", marriedAt: 5 * S, spouseName: "Klytaimnestra", endedAt: 10 * S, endReason: "tragedy_clytemnestra" },
        { id: "m2", marriedAt: 25 * S, spouseName: "Alkestis" }, // the heir's marriage
      ],
    };
    const entries = buildChronicle(input);
    expect(entries.find((e) => e.type === "tragedy_clytemnestra")!.generation).toBe(1); // the murdered founder's generation
    expect(entries.find((e) => e.type === "marriage" && e.payload.spouseName === "Alkestis")!.generation).toBe(2);
  });
});

describe("buildChronicle — adoption (the rite)", () => {
  const base = { startedMs: 0, successionBoundariesMs: [] as number[], marriages: [], births: [], choregos: [], festivals: [], olympics: [] };

  it("stages an adoption entry dated at adoptedAt with heir + house payload", () => {
    const entries = buildChronicle({ ...base, adoptions: [{ id: "ad1", adoptedAt: 10 * S, heirName: "Deon", houseName: "Xanthippos" }] });
    const a = entries.find((e) => e.type === "adoption")!;
    expect(a.seasonIndex).toBe(10); // dated at adoptedAt (the candidate's consumedAt)
    expect(a.payload).toEqual({ heirName: "Deon", houseName: "Xanthippos" });
  });

  it("no adoptions → no adoption entry (and the omitted field is fine)", () => {
    expect(buildChronicle(base).some((e) => e.type === "adoption")).toBe(false);
  });
});
