import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { characterTraits, createDb, effectLog, playerBuildings, players, playerCharacters } from "@massalia/db";
import {
  accrueService,
  canReclass,
  capStat,
  currentAge,
  gateShortfall,
  isReclassTarget,
  meetsGate,
  nextRankId,
  parseRanksContent,
  rankDef,
  reclassReason,
  RECLASS_TARGETS,
  WOUND_TRAITS,
  type ArmyRank,
  type RankDef,
  type RanksContent,
  type ReclassReason,
} from "@massalia/shared";
import { getAgeConfig } from "./age.js";
import { classBuildingIdFor } from "./buildings.js";
import { broadcastState } from "./worldState.js";
import type { CharacterRow } from "./character.js";

// ---------------------------------------------------------------------------
// The hoplite's home army — RANKS + SALARY (Hoplite Step 1 of 5). Promotion is an
// APPLICATION (gate-checked on militia + prestige), NOT an election — distinct
// from the Strategos office (elections.appointStrategos), which this never touches.
//
// Salary + a small militia trickle accrue LAZILY on the existing economy clock
// (shared military.accrueService → calendar.REAL_MS_PER_SEASON), credited to the
// integer wallet on collect — the same lazy "collect into the wallet" approach the
// building income uses. No background loop, no new clock.
//
// TODO (later hoplite steps — NOT here): mercenary contracts + hiring board,
// abroad pools, lethality/injury, death/succession hooks, re-class, veteran
// Strategos eligibility.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const ranksFile = path.join(repoRoot, "content/military/ranks.json");

const HOPLITE = "hoplite";

let content: RanksContent | null = null;

// Validate the rank ladder at boot (fail fast on a malformed file); memoized.
export async function loadRanksContent(): Promise<RanksContent> {
  content = parseRanksContent(JSON.parse(await fs.readFile(ranksFile, "utf8")));
  return content;
}

export function getRanksContent(): RanksContent {
  if (!content) throw new Error("Ranks content not loaded. Call loadRanksContent() at boot.");
  return content;
}

export function isHoplite(row: Pick<CharacterRow, "classId">): boolean {
  return row.classId === HOPLITE;
}

// --- Status (GET /api/service) ----------------------------------------------

export type RankView = { id: string; name: string; rank?: string; salaryPerDay: number; militiaPerDay: number };
export type NextRankView = RankView & { gate: { militia: number; prestige: number } };

export type ServiceStatus = {
  isHoplite: boolean;
  rankId: ArmyRank;
  rank: RankView | null;
  next: NextRankView | null;
  // Whether the player currently clears `next`'s gate (drives the Enlist/Promote button).
  qualifies: boolean;
  // How far short of `next`'s gate the player is (0s when met), for the UI copy.
  shortfall: { militia: number; prestige: number } | null;
  // Accrued-but-uncollected salary + militia at the current rank.
  accrued: { drachmae: number; militia: number };
  salaryPerDay: number;
  stats: { militia: number; prestige: number };
  // True while sworn to a mercenary contract (Step 2): home rank salary PAUSES and
  // foreign income accrues instead (see the merc service / hiring board).
  abroad: boolean;
  // Re-class (Step 5 capstone): the "leave soldiering" option. Available (not
  // prompted) when a living hoplite is wounded or has reached the retirement age.
  reclass: {
    eligible: boolean;
    reason: ReclassReason | null;
    targets: { classId: string; name: string; flavor: string }[];
  };
};

// One-line flavour of each citizen life the hoplite may take up (code, like the
// manumission flavour bank — not tuning).
const CLASS_FLAVOR: Record<string, { name: string; flavor: string }> = {
  landowner: { name: "Landowner", flavor: "Wheat fields and a name on the land — the slow, sure wealth of soil." },
  trader: { name: "Trader", flavor: "Wine, risk, and the harbor's churn — fortunes made on a good crossing." },
  philosopher: { name: "Philosopher", flavor: "The Stoa and the scroll — influence won by the sharpened mind." },
  priest: { name: "Priest", flavor: "The altar and the god's favor — devotion the city heeds." },
};

const RECLASS_CHOICES = RECLASS_TARGETS.map((classId) => ({ classId, name: CLASS_FLAVOR[classId]?.name ?? classId, flavor: CLASS_FLAVOR[classId]?.flavor ?? "" }));

// Career-ending wounds (one-eyed / lamed) — the forced-early re-class trigger.
async function isWounded(characterId: string): Promise<boolean> {
  const rows = await db
    .select({ traitId: characterTraits.traitId })
    .from(characterTraits)
    .where(and(eq(characterTraits.characterId, characterId), inArray(characterTraits.traitId, [...WOUND_TRAITS])));
  return rows.length > 0;
}

function rankView(def: RankDef): RankView {
  return { id: def.id, name: def.name, rank: def.rank, salaryPerDay: def.salaryPerDay, militiaPerDay: def.militiaPerDay };
}

function anchorMs(row: CharacterRow): number {
  return (row.lastSalaryAt ?? row.createdAt).getTime();
}

export async function serviceStatus(row: CharacterRow, now: Date = new Date()): Promise<ServiceStatus> {
  const ranks = getRanksContent();
  const rankId = row.armyRank as ArmyRank;
  const currentDef = rankId === "none" ? null : rankDef(ranks, rankId);
  const nextId = nextRankId(rankId);
  const nextDef = nextId ? rankDef(ranks, nextId) : null;

  const qualifies = nextDef ? meetsGate(nextDef.gate, row.militia, row.prestige) : false;
  const shortfall = nextDef ? gateShortfall(nextDef.gate, row.militia, row.prestige) : null;
  // Home salary PAUSES while on a mercenary contract — no home accrual to show.
  const abroad = row.contractId !== null;
  const accrued = currentDef && !abroad ? accrueService(currentDef, anchorMs(row), now.getTime()) : { drachmae: 0, militia: 0 };

  // Re-class availability (Step 5): a living hoplite who is wounded or aged out.
  const wounded = await isWounded(row.id);
  const age = currentAge(row.startAge, row.createdAt.getTime(), now.getTime(), getAgeConfig());
  const eligible = canReclass(row.classId, row.status, age, wounded);

  return {
    isHoplite: isHoplite(row),
    rankId,
    rank: currentDef ? rankView(currentDef) : null,
    next: nextDef ? { ...rankView(nextDef), gate: nextDef.gate } : null,
    qualifies,
    shortfall,
    accrued: { drachmae: accrued.drachmae, militia: accrued.militia },
    salaryPerDay: currentDef?.salaryPerDay ?? 0,
    stats: { militia: row.militia, prestige: row.prestige },
    abroad,
    reclass: { eligible, reason: eligible ? reclassReason(wounded, age) : null, targets: eligible ? RECLASS_CHOICES : [] },
  };
}

// --- Salary settle (shared by collect + promote) ----------------------------
// Bank accrued salary into the integer wallet and the militia trickle into the
// militia stat (clamped to the cap), advancing the anchor only by the consumed
// time. The wallet only ever increases here, so it can never go negative.

export async function settleSalary(tx: DbTx, characterId: string, now: Date): Promise<{ drachmae: number; militia: number }> {
  const ranks = getRanksContent();
  const rows = await tx.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const row = rows[0];
  if (!row || row.armyRank === "none") return { drachmae: 0, militia: 0 };
  // Home salary is PAUSED while on a mercenary contract (foreign income takes over).
  if (row.contractId) return { drachmae: 0, militia: 0 };
  const def = rankDef(ranks, row.armyRank);
  if (!def) return { drachmae: 0, militia: 0 };

  const anchor = (row.lastSalaryAt ?? row.createdAt).getTime();
  const accrual = accrueService(def, anchor, now.getTime());
  if (accrual.consumedMs <= 0) return { drachmae: 0, militia: 0 };

  const nextMilitia = capStat(row.militia + accrual.militia, getAgeConfig());
  await tx
    .update(playerCharacters)
    .set({
      drachmae: row.drachmae + accrual.drachmae,
      militia: nextMilitia,
      lastSalaryAt: new Date(anchor + accrual.consumedMs),
    })
    .where(eq(playerCharacters.id, characterId));
  return { drachmae: accrual.drachmae, militia: accrual.militia };
}

// --- Engine actions ---------------------------------------------------------

export type ServiceResult =
  | { ok: false; code: number; error: string }
  | { ok: true; collected?: { drachmae: number; militia: number }; status: ServiceStatus };

async function freshRow(characterId: string): Promise<CharacterRow | null> {
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  return rows[0] ?? null;
}

function notHoplite(): ServiceResult {
  return { ok: false, code: 403, error: "Only hoplites serve in the home army." };
}

// none → recruit (gate-checked; recruit's gate is 0/0, so an enlisting hoplite
// always clears it — but the check is honoured, not assumed).
export async function enlist(row: CharacterRow, now: Date = new Date()): Promise<ServiceResult> {
  if (!isHoplite(row)) return notHoplite();
  if (row.armyRank !== "none") return { ok: false, code: 409, error: "You have already enlisted." };
  const ranks = getRanksContent();
  const recruit = rankDef(ranks, "recruit");
  if (!recruit) return { ok: false, code: 500, error: "Rank ladder misconfigured." };
  if (!meetsGate(recruit.gate, row.militia, row.prestige)) {
    return { ok: false, code: 403, error: "You do not yet meet the muster." };
  }
  await db.update(playerCharacters).set({ armyRank: "recruit", lastSalaryAt: now }).where(eq(playerCharacters.id, row.id));
  return { ok: true, status: await serviceStatus((await freshRow(row.id))!, now) };
}

// Apply for the NEXT rank up (one at a time; never skips, never auto-demotes).
// Settles salary at the old rank first, then promotes iff the gate is met and
// resets the salary anchor to now.
export async function promote(row: CharacterRow, now: Date = new Date()): Promise<ServiceResult> {
  if (!isHoplite(row)) return notHoplite();
  if (row.armyRank === "none") return { ok: false, code: 409, error: "Enlist before you can be promoted." };
  const ranks = getRanksContent();
  const nextId = nextRankId(row.armyRank);
  if (!nextId) return { ok: false, code: 409, error: "You hold the highest rank." };
  const nextDef = rankDef(ranks, nextId)!;
  if (!meetsGate(nextDef.gate, row.militia, row.prestige)) {
    const short = gateShortfall(nextDef.gate, row.militia, row.prestige);
    return { ok: false, code: 403, error: `Not yet: need ${nextDef.gate.militia} militia / ${nextDef.gate.prestige} prestige (short ${short.militia} militia, ${short.prestige} prestige).` };
  }
  await db.transaction(async (tx) => {
    await settleSalary(tx, row.id, now); // bank pay earned at the old rank first
    await tx.update(playerCharacters).set({ armyRank: nextId, lastSalaryAt: now }).where(eq(playerCharacters.id, row.id));
  });
  return { ok: true, status: await serviceStatus((await freshRow(row.id))!, now) };
}

// Bank accrued salary (drachmae) + militia trickle, reset the anchor.
export async function collectSalary(row: CharacterRow, now: Date = new Date()): Promise<ServiceResult> {
  if (!isHoplite(row)) return notHoplite();
  if (row.armyRank === "none") return { ok: false, code: 409, error: "You have not enlisted." };
  const collected = await db.transaction(async (tx) => settleSalary(tx, row.id, now));
  return { ok: true, collected, status: await serviceStatus((await freshRow(row.id))!, now) };
}

// --- Re-class (Hoplite capstone, Step 5) ------------------------------------
// A hoplite hangs up the spear and takes up a new trade — ONE-WAY and IRREVERSIBLE.
// Follows the manumission template (classId + professionSlug + effectLog), but with
// NO stat bonus and NO kit: the same person carries his whole life (drachmae, seat,
// prestige, dynasty, court/family, militia value, ALL traits, army_rank, the
// was-hoplite signal). Only the class — and the class building line — change.
//
// Irreversibility is structural: eligibility requires classId === "hoplite", and the
// targets exclude hoplite, so once re-classed the door is shut for good. The military
// engine (enlist/promote/takeContract) gates on classId === "hoplite", so a re-classed
// veteran is automatically barred — army_rank staying set does NOT re-enable him.

export type ReclassResult = { ok: false; code: number; error: string } | { ok: true; from: string; to: string; reason: ReclassReason };

export async function performReclass(row: CharacterRow, targetClass: string, now: Date = new Date()): Promise<ReclassResult> {
  if (!isHoplite(row)) return { ok: false, code: 403, error: "Only a hoplite may leave soldiering." };
  if (row.status !== "alive") return { ok: false, code: 409, error: "The dead take up no new trade." };
  if (row.contractId) return { ok: false, code: 409, error: "Return from your contract before you hang up the spear." };
  if (!isReclassTarget(targetClass)) return { ok: false, code: 409, error: "A hoplite cannot take up that trade." };

  const wounded = await isWounded(row.id);
  const age = currentAge(row.startAge, row.createdAt.getTime(), now.getTime(), getAgeConfig());
  const reason = reclassReason(wounded, age);
  if (!canReclass(row.classId, row.status, age, wounded) || !reason) {
    return { ok: false, code: 403, error: "You may not yet leave soldiering — that door opens only to the wounded or the grey-haired." };
  }

  // Retire the OLD class building line (KEEP commons). The hoplite has no class
  // building in content, so this is a defensive no-op today; a class line that does
  // exist (e.g. the landowner's estate) would have its rows removed here.
  const oldClassBuilding = classBuildingIdFor(row.classId);

  await db.transaction(async (tx) => {
    await tx.update(playerCharacters).set({ classId: targetClass }).where(eq(playerCharacters.id, row.id));
    // Keep the display profession in sync (me/state reads players.professionSlug).
    await tx.update(players).set({ professionSlug: targetClass }).where(eq(players.id, row.playerId));
    if (oldClassBuilding) {
      await tx.delete(playerBuildings).where(and(eq(playerBuildings.ownerPlayerId, row.playerId), eq(playerBuildings.buildingId, oldClassBuilding)));
    }
    await tx.insert(effectLog).values({ characterId: row.id, kind: "reclass", detail: { from: row.classId, to: targetClass, reason } });
  });

  await broadcastState();
  return { ok: true, from: row.classId, to: targetClass, reason };
}
