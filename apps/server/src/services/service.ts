import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, playerCharacters } from "@massalia/db";
import {
  accrueService,
  capStat,
  gateShortfall,
  meetsGate,
  nextRankId,
  parseRanksContent,
  rankDef,
  type ArmyRank,
  type RankDef,
  type RanksContent,
} from "@massalia/shared";
import { getAgeConfig } from "./age.js";
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
};

function rankView(def: RankDef): RankView {
  return { id: def.id, name: def.name, rank: def.rank, salaryPerDay: def.salaryPerDay, militiaPerDay: def.militiaPerDay };
}

function anchorMs(row: CharacterRow): number {
  return (row.lastSalaryAt ?? row.createdAt).getTime();
}

export function serviceStatus(row: CharacterRow, now: Date = new Date()): ServiceStatus {
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
  return { ok: true, status: serviceStatus((await freshRow(row.id))!, now) };
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
  return { ok: true, status: serviceStatus((await freshRow(row.id))!, now) };
}

// Bank accrued salary (drachmae) + militia trickle, reset the anchor.
export async function collectSalary(row: CharacterRow, now: Date = new Date()): Promise<ServiceResult> {
  if (!isHoplite(row)) return notHoplite();
  if (row.armyRank === "none") return { ok: false, code: 409, error: "You have not enlisted." };
  const collected = await db.transaction(async (tx) => settleSalary(tx, row.id, now));
  return { ok: true, collected, status: serviceStatus((await freshRow(row.id))!, now) };
}
