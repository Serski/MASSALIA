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

import { z } from "zod";
import { formatGameDate, gameDate } from "./calendar.js";

// How a character died, recorded on the succession handoff (see successions.cause,
// migration 0047). A NULL/unknown cause (legacy rows, regent maturation) reads as a
// plain death everywhere. These are the only lethal paths that exist in the code:
// old age (natural), the hidden blade (assassinated), the cup (poison), and a
// mercenary contract gone wrong (mercenary).
export const deathCauseSchema = z.enum(["natural", "assassinated", "poison", "mercenary"]);
export type DeathCause = z.infer<typeof deathCauseSchema>;

export type ChronicleType =
  | "marriage"
  | "divorce"
  | "birth"
  | "megas_choregos"
  | "festival_participation"
  | "olympic_selection"
  // Pack C: a marriage that ended in tragedy, one type per archetype, dated at
  // endedAt. Each renders a single flat line in the web register.
  | "tragedy_phaedra"
  | "tragedy_clytemnestra"
  | "tragedy_medea"
  // Pack: the adoption rite — an in-life adopted heir, dated at the candidate's
  // consumedAt. One flat line in the web register.
  | "adoption"
  // Interaction Pipeline (Prompt 1): drachmae received from another player, dated
  // at the gift instant. One flat line in the web register.
  | "gift_received"
  // Interaction Pipeline (Prompt 2): the poison channel. Hostile actions are
  // anonymous — no actor name. Illness is recorded (a physician may yet cure it);
  // a successful treatment is recorded too. Poison DEATH produces no chronicle line
  // (the succession flow is the announcement), and failures leave no record at all.
  | "poison_illness"
  | "venom_purged"
  // Interaction Pipeline (Prompt 3): a FAILED assassination attempt (target-visible,
  // anonymous). A successful assassination has no survived-line — instead it lands as
  // a "death" entry below (cause assassinated), the same as any other death.
  | "assassination_survived"
  // The end of a generation: this character died. One per death handoff (successions
  // blood/adopted/fresh), dated at the succession instant, carrying the age at death
  // and the cause (murder reads plainly; a null/natural cause reads as a plain death).
  | "death"
  // Barracks prompt 3b: a map action the character led (scout / raid / attack on a
  // townless region) and a holding that reverted for want of a garrison. Sourced
  // from effect_log; the payload is structured and renderCampaignLine turns it
  // into the one sentence both the register and the server report use.
  | "map_action"
  | "holding_reverted";

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
  // Present once the marriage has ended; a "divorced" endReason emits a divorce
  // entry dated at endedAt (pack B).
  endedAt?: number | null;
  endReason?: string | null;
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
  // In-life adoptions (the current adopted heir, dated at consumedAt). At most one
  // per slot today — adoptedCandidateId holds only the standing heir (ruling B/C).
  // Optional: a new input the pre-existing chronicle fixtures need not supply.
  adoptions?: ChronicleAdoptionRow[];
  // Interaction Pipeline (Prompt 1): drachmae this dynasty RECEIVED from other
  // players. Optional — pre-existing fixtures need not supply it.
  gifts?: ChronicleGiftRow[];
  // Interaction Pipeline (Prompt 2): poison illness onsets + cures for this
  // character. Optional — pre-existing fixtures need not supply it.
  afflictions?: ChronicleAfflictionRow[];
  // One row per death handoff in the dynasty (successions blood/adopted/fresh).
  // Optional — pre-existing fixtures need not supply it.
  deaths?: ChronicleDeathRow[];
  // Barracks prompt 3b: map actions and holding reversions from effect_log.
  // Optional — pre-existing fixtures need not supply it.
  campaigns?: ChronicleCampaignRow[];
};

// A map action or a holding reversion, dated at the effect_log instant. The
// payload is the structured summary the action wrote (see CampaignPayload).
export type ChronicleCampaignRow = {
  id: string;
  at: number;
  kind: "map_action" | "holding_reverted";
  payload: CampaignPayload;
};

// Structured summary of a map action (all fields optional so a reversion row can
// share the shape). Rendered by renderCampaignLine.
export type CampaignPayload = {
  action?: "scout" | "raid" | "attack";
  regionId: string;
  regionName?: string;
  men?: number;
  // The force, as parts so the wording (unit plurals) can change under old
  // rows: a trained part carries label + plural, a band part its label (already
  // plural). Older rows carry the prose string and render as stored.
  force?: string | CampaignForcePart[];
  winner?: "attacker" | "defender" | "stand";
  killed?: number;
  lost?: number;
  plunder?: { drachmae: number; grain: number } | null;
  conquest?: boolean;
  warband?: number; // scout: the strength seen
  previousOwner?: string | null; // reversion
};

export type CampaignForcePart = { count: number; label: string; plural?: string; source?: "trained" | "band" };

// "20 peltasts", "1 ekdromos", "10 hoplites and 20 Cretan archers": trained
// units in lowercase running text with the plural past one man, bands by their
// (already plural) label.
export function renderForce(force: string | CampaignForcePart[] | undefined): string {
  if (!force) return "";
  if (typeof force === "string") return force;
  const parts = force.map((p) => {
    if (p.source === "band" || !p.plural) return `${p.count} ${p.label}`;
    return `${p.count} ${(p.count === 1 ? p.label : p.plural).toLowerCase()}`;
  });
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// The one sentence for a campaign entry, shared by the web register and the
// server's report so the wording never drifts.
const tribesmen = (n: number) => `${n} ${n === 1 ? "tribesman" : "tribesmen"}`;

export function renderCampaignLine(type: "map_action" | "holding_reverted", p: CampaignPayload): string {
  const place = p.regionName ?? p.regionId;
  if (type === "holding_reverted") return `${place} slipped from our hands: no garrison held it.`;
  const forceText = renderForce(p.force);
  const force = forceText ? ` with ${forceText}` : "";
  if (p.action === "scout") return `Scouted ${place}${force}: ${tribesmen(p.warband ?? 0)} under arms.`;
  const killed = `${tribesmen(p.killed ?? 0)} slain`;
  const lost = (p.lost ?? 0) === 0 ? "none of ours lost" : `${p.lost} of ours lost`;
  if (p.action === "raid") {
    if (p.winner === "attacker") {
      const dr = p.plunder?.drachmae ?? 0;
      const grain = p.plunder?.grain ?? 0;
      return `Raided ${place}${force}: ${killed}, ${lost}, ${dr} drachmae and ${grain} grain of plunder.`;
    }
    return `Raided ${place}${force} and were driven off: ${killed}, ${lost}.`;
  }
  if (p.winner === "attacker") return `Took ${place}${force}: ${killed}, ${lost}. The land is ours.`;
  if (p.winner === "stand") return `Attacked ${place}${force} and withdrew: ${killed}, ${lost}.`;
  return `Attacked ${place}${force} and were broken: ${killed}, ${lost}.`;
}

export type ChronicleAdoptionRow = {
  id: string;
  adoptedAt: number;
  heirName: string;
  houseName: string;
};

export type ChronicleGiftRow = {
  id: string;
  sentAt: number;
  actorName: string;
  houseName: string;
  amount: number;
};

// Poison-channel entries the character sees: an illness onset or a cure. Anonymous
// (no actor) by design; `kind` selects the chronicle type. `at` is the event instant.
export type ChronicleAfflictionRow = {
  id: string;
  at: number;
  kind: "poison_illness" | "venom_purged" | "assassination_survived";
};

// A death handoff for the dynasty: `at` is the succession instant, `age` the age at
// death (null on legacy rows), `cause` how they died (null reads as a plain death).
export type ChronicleDeathRow = {
  id: string;
  at: number;
  age: number | null;
  cause: DeathCause | null;
};

// Deterministic tiebreak when several events land in the same season.
const TYPE_ORDER: Record<ChronicleType, number> = {
  marriage: 0,
  birth: 1,
  megas_choregos: 2,
  festival_participation: 3,
  olympic_selection: 4,
  divorce: 5,
  tragedy_phaedra: 6,
  tragedy_clytemnestra: 7,
  tragedy_medea: 8,
  adoption: 9,
  gift_received: 10,
  poison_illness: 11,
  venom_purged: 12,
  assassination_survived: 13,
  // A death ends the generation, so it sorts last when several events share a season.
  death: 14,
  map_action: 15,
  holding_reverted: 16,
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
    if (m.endReason === "divorced" && m.endedAt != null) {
      staged.push(stage(`${m.id}:divorce`, m.endedAt, "divorce", { spouseName: m.spouseName }, input));
    } else if (
      m.endedAt != null &&
      (m.endReason === "tragedy_phaedra" || m.endReason === "tragedy_clytemnestra" || m.endReason === "tragedy_medea")
    ) {
      staged.push(stage(`${m.id}:${m.endReason}`, m.endedAt, m.endReason, { spouseName: m.spouseName }, input));
    }
  }
  for (const b of input.births) {
    staged.push(stage(b.id, b.bornAt, "birth", { childName: b.childName, sex: b.sex }, input));
  }
  for (const c of input.choregos) {
    staged.push(stage(c.id, c.closedAt, "megas_choregos", { festivalId: c.festivalId, gameYear: c.gameYear }, input));
  }
  // Festival lines are trimmed to at most one per instance, and only when worth
  // recording. Passive attendance (choregos: false) is dropped. A funded patron
  // who was crowned Megas Choregos is told only by that line, so the paired
  // "served as choregos" entry is suppressed for the same festivalId+gameYear.
  const wonInstances = new Set(input.choregos.map((c) => `${c.festivalId}|${c.gameYear}`));
  for (const f of input.festivals) {
    if (!f.choregos) continue;
    if (wonInstances.has(`${f.festivalId}|${f.gameYear}`)) continue;
    staged.push(
      stage(f.id, f.createdAt, "festival_participation", { festivalId: f.festivalId, gameYear: f.gameYear, choregos: f.choregos }, input),
    );
  }
  for (const o of input.olympics) {
    const yearBC = gameDate(o.nominatedAt, input.startedMs).yearBC;
    staged.push(stage(o.id, o.nominatedAt, "olympic_selection", { gameYear: o.gameYear, yearBC, sent: o.sent }, input));
  }
  for (const a of input.adoptions ?? []) {
    staged.push(stage(a.id, a.adoptedAt, "adoption", { heirName: a.heirName, houseName: a.houseName }, input));
  }
  for (const g of input.gifts ?? []) {
    staged.push(stage(g.id, g.sentAt, "gift_received", { actorName: g.actorName, houseName: g.houseName, amount: g.amount }, input));
  }
  for (const a of input.afflictions ?? []) {
    staged.push(stage(a.id, a.at, a.kind, {}, input));
  }
  for (const c of input.campaigns ?? []) {
    staged.push(stage(c.id, c.at, c.kind, { ...c.payload }, input));
  }
  for (const d of input.deaths ?? []) {
    // The succession instant is a generation boundary, so a death dated exactly on it
    // would tag as the INCOMING generation. A death belongs to the generation it
    // ends, so date it a hair earlier (in play occurredAt is never season-aligned, so
    // the label is unchanged) to keep it under the dying generation's heading.
    const at = Math.max(0, d.at - 1);
    const yearBC = gameDate(at, input.startedMs).yearBC;
    staged.push(stage(d.id, at, "death", { age: d.age, cause: d.cause ?? null, yearBC }, input));
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
