// ---------------------------------------------------------------------------
// The Player Chronicle (Timeline): a single, dated, dynasty-scoped projection of
// the life-events already persisted across other tables (marriages, births, the
// Megas Choregos win, festival patronage, Olympic selection).
//
// This module is PURE — no db / Drizzle imports. It takes already-fetched plain
// row arrays (timestamps as ms numbers) plus the world start and the dynasty's
// succession boundaries, and returns a sorted, generation-tagged chronicle. The
// db layer (packages/db/src/chronicle.ts) fetches the rows; the web layer renders
// each entry's structured payload into prose. Prose is NEVER stored here.
// ---------------------------------------------------------------------------

import { formatGameDate, gameDate } from "./calendar.js";

export type ChronicleType =
  | "marriage"
  | "birth"
  | "megas_choregos"
  | "festival_participation"
  | "olympic_selection";

export type ChronicleEntry = {
  // Sort key, from gameDate(timestamp, startedMs).seasonIndex.
  seasonIndex: number;
  // formatGameDate(...), e.g. "Summer, 282 BC".
  label: string;
  // The dynasty generation the event belongs to (1-based), derived from where the
  // event's timestamp falls among the dynasty's succession boundaries.
  generation: number;
  type: ChronicleType;
  // Structured data only — names, festival id, sex, year, delegate status. NO
  // prerendered prose: the web layer turns this into sentences.
  payload: Record<string, unknown>;
};

// --- Input row shapes (timestamps as epoch ms) ------------------------------

export type ChronicleMarriageRow = {
  id: string;
  marriedAt: number;
  spouseName: string;
};

export type ChronicleBirthRow = {
  id: string;
  bornAt: number;
  childName: string;
  sex: string;
};

export type ChronicleChoregosRow = {
  id: string;
  closedAt: number;
  festivalId: string;
  gameYear: number;
};

export type ChronicleFestivalRow = {
  id: string;
  createdAt: number;
  festivalId: string;
  gameYear: number;
  // True when the character actually served as choregos (funded the festival),
  // false for lighter participation.
  choregos: boolean;
};

export type ChronicleOlympicRow = {
  id: string;
  nominatedAt: number;
  gameYear: number;
  // True when the character was actually sent to compete (a delegate / Games
  // record); false for a nomination that did not win selection.
  sent: boolean;
};

export type ChronicleInput = {
  // The world's start instant (ms) — the anchor for every gameDate(...) call.
  startedMs: number;
  // The dynasty's succession instants (ms), each marking the handoff to the next
  // generation. Order does not matter; the count at-or-before an event's timestamp
  // determines its generation. Generation 1 is the founder (no boundary passed).
  successionBoundariesMs: number[];
  marriages: ChronicleMarriageRow[];
  births: ChronicleBirthRow[];
  choregos: ChronicleChoregosRow[];
  festivals: ChronicleFestivalRow[];
  olympics: ChronicleOlympicRow[];
};

// Deterministic tiebreak when several events land in the same season.
const TYPE_ORDER: Record<ChronicleType, number> = {
  marriage: 0,
  birth: 1,
  megas_choregos: 2,
  festival_participation: 3,
  olympic_selection: 4,
};

// generation = 1 + (boundaries that occurred at or before the event). An event at
// the exact instant of a handoff belongs to the incoming generation.
function generationFor(timestampMs: number, boundariesMs: number[]): number {
  let passed = 0;
  for (const boundary of boundariesMs) {
    if (boundary <= timestampMs) passed += 1;
  }
  return passed + 1;
}

type Staged = ChronicleEntry & { timestampMs: number; rowId: string };

function stage(
  rowId: string,
  timestampMs: number,
  type: ChronicleType,
  payload: Record<string, unknown>,
  input: ChronicleInput,
): Staged {
  const gd = gameDate(timestampMs, input.startedMs);
  return {
    seasonIndex: gd.seasonIndex,
    label: formatGameDate(gd),
    generation: generationFor(timestampMs, input.successionBoundariesMs),
    type,
    payload,
    timestampMs,
    rowId,
  };
}

// Assemble the chronicle: one entry per source row, dated by running its real
// timestamp through the in-game calendar, then sorted ascending and stably.
export function buildChronicle(input: ChronicleInput): ChronicleEntry[] {
  const staged: Staged[] = [];

  for (const m of input.marriages) {
    staged.push(stage(m.id, m.marriedAt, "marriage", { spouseName: m.spouseName }, input));
  }
  for (const b of input.births) {
    staged.push(stage(b.id, b.bornAt, "birth", { childName: b.childName, sex: b.sex }, input));
  }
  for (const c of input.choregos) {
    staged.push(stage(c.id, c.closedAt, "megas_choregos", { festivalId: c.festivalId, gameYear: c.gameYear }, input));
  }
  for (const f of input.festivals) {
    staged.push(
      stage(f.id, f.createdAt, "festival_participation", { festivalId: f.festivalId, gameYear: f.gameYear, choregos: f.choregos }, input),
    );
  }
  for (const o of input.olympics) {
    const yearBC = gameDate(o.nominatedAt, input.startedMs).yearBC;
    staged.push(stage(o.id, o.nominatedAt, "olympic_selection", { gameYear: o.gameYear, yearBC, sent: o.sent }, input));
  }

  staged.sort(
    (a, b) =>
      a.seasonIndex - b.seasonIndex ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.timestampMs - b.timestampMs ||
      a.rowId.localeCompare(b.rowId),
  );

  // Drop the internal sort fields — callers only see the public ChronicleEntry.
  return staged.map((s) => ({
    seasonIndex: s.seasonIndex,
    label: s.label,
    generation: s.generation,
    type: s.type,
    payload: s.payload,
  }));
}
