import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, offices, playerCharacters, settleMercContract, type MercContractCfgMap } from "@massalia/db";
import {
  contractDef,
  foreignIncomeAccrual,
  gateShortfall,
  meetsGate,
  parseContractsContent,
  REAL_MS_PER_SEASON,
  seasonsElapsed,
  type ContractDef,
  type ContractsContent,
} from "@massalia/shared";
import { isHoplite, settleSalary } from "./service.js";
import type { CharacterRow } from "./character.js";

// ---------------------------------------------------------------------------
// The hoplite's mercenary contracts — hiring board + the SAFE go/return lifecycle
// (Hoplite Step 2 of 5). Taking a contract pauses home rank salary and accrues
// FOREIGN income; the contract completes safely at term (no death/injury — Step 4)
// and returns home. The actual settlement/clear lives in @massalia/db.merc
// (settleMercContract), shared with the worker sweep so offline players resolve too.
//
// A character on contract stays status "alive" — voting (oligarchy/elections) is
// untouched, so he keeps his chamber/election vote while abroad (proxy voting).
//
// TODO (Step 3): swap the routine pool to the contract's poolKey (CAMPAIGN_POOL
// precedent). TODO (Step 4): the death/injury roll at completion. TODO (Step 5):
// veteran/Strategos eligibility rules.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const contractsFile = path.join(repoRoot, "content/military/contracts.json");

let content: ContractsContent | null = null;

// Validate the contract catalog at boot (fail fast on a malformed file); memoized.
export async function loadContractsContent(): Promise<ContractsContent> {
  content = parseContractsContent(JSON.parse(await fs.readFile(contractsFile, "utf8")));
  return content;
}

export function getContractsContent(): ContractsContent {
  if (!content) throw new Error("Contracts content not loaded. Call loadContractsContent() at boot.");
  return content;
}

// The runtime config the DB-layer settle/sweep needs (id → income + term).
export function contractCfgMap(): MercContractCfgMap {
  return Object.fromEntries(getContractsContent().contracts.map((c) => [c.id, { dailyDrachmae: c.dailyDrachmae, termSeasons: c.termSeasons }]));
}

// --- Strategos eligibility --------------------------------------------------
// A Strategos cannot be sworn abroad (per design). The office is held in the
// `offices` table; reading it by holder is enough (a character is in one world).
async function holdsStrategos(characterId: string): Promise<boolean> {
  const rows = await db.select({ office: offices.office }).from(offices).where(eq(offices.holderCharacterId, characterId));
  return rows.some((r) => r.office === "strategos");
}

// --- Board (GET /api/merc/board) --------------------------------------------

export type ContractBoardEntry = {
  id: string;
  name: string;
  gate: { militia: number; prestige: number };
  dailyDrachmae: number;
  termSeasons: number;
  minCancelSeasons: number;
  poolKey: string;
  qualifies: boolean;
  shortfall: { militia: number; prestige: number };
};

export type CurrentContractView = {
  id: string;
  name: string;
  poolKey: string;
  dailyDrachmae: number;
  seasonsElapsed: number;
  seasonsTotal: number;
  // Accrued-but-uncollected foreign income.
  accrued: number;
  // Early return allowed once seasonsElapsed >= minCancelSeasons.
  canCancel: boolean;
  earliestCancelSeason: number;
};

export type MercBoard = {
  isHoplite: boolean;
  abroad: boolean;
  holdsStrategos: boolean;
  stats: { militia: number; prestige: number };
  contracts: ContractBoardEntry[];
  current: CurrentContractView | null;
};

function boardEntry(def: ContractDef, militia: number, prestige: number): ContractBoardEntry {
  return {
    id: def.id,
    name: def.name,
    gate: def.gate,
    dailyDrachmae: def.dailyDrachmae,
    termSeasons: def.termSeasons,
    minCancelSeasons: def.minCancelSeasons,
    poolKey: def.poolKey,
    qualifies: meetsGate(def.gate, militia, prestige),
    shortfall: gateShortfall(def.gate, militia, prestige),
  };
}

function currentContractView(row: CharacterRow, now: Date): CurrentContractView | null {
  if (!row.contractId || !row.contractStartedAt) return null;
  const def = contractDef(getContractsContent(), row.contractId);
  if (!def) return null;
  const startedMs = row.contractStartedAt.getTime();
  const termEndMs = startedMs + def.termSeasons * REAL_MS_PER_SEASON;
  const anchor = (row.lastSalaryAt ?? row.contractStartedAt).getTime();
  const elapsed = seasonsElapsed(startedMs, now.getTime());
  return {
    id: def.id,
    name: def.name,
    poolKey: def.poolKey,
    dailyDrachmae: def.dailyDrachmae,
    seasonsElapsed: elapsed,
    seasonsTotal: def.termSeasons,
    accrued: foreignIncomeAccrual(def.dailyDrachmae, anchor, now.getTime(), termEndMs).drachmae,
    canCancel: elapsed >= def.minCancelSeasons,
    earliestCancelSeason: def.minCancelSeasons,
  };
}

async function freshRow(characterId: string): Promise<CharacterRow> {
  return (await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1))[0]!;
}

async function buildBoard(row: CharacterRow, now: Date): Promise<MercBoard> {
  const onStrategos = await holdsStrategos(row.id);
  return {
    isHoplite: isHoplite(row),
    abroad: row.contractId !== null,
    holdsStrategos: onStrategos,
    stats: { militia: row.militia, prestige: row.prestige },
    contracts: getContractsContent().contracts.map((c) => boardEntry(c, row.militia, row.prestige)),
    current: currentContractView(row, now),
  };
}

// The board, after a LAZY completion check (a served-out contract returns home on
// read, even if the player never collected). Read-only otherwise.
export async function board(row: CharacterRow, now: Date = new Date()): Promise<MercBoard> {
  if (isHoplite(row) && row.contractId) {
    await settleMercContract(row.id, contractCfgMap(), "complete", now);
  }
  return buildBoard(await freshRow(row.id), now);
}

// --- Engine actions ---------------------------------------------------------

export type MercResult = { ok: false; code: number; error: string } | { ok: true; collected?: number; completed?: boolean; board: MercBoard };

function notHoplite(): MercResult {
  return { ok: false, code: 403, error: "Only hoplites take mercenary contracts." };
}

export async function takeContract(row: CharacterRow, contractId: string, now: Date = new Date()): Promise<MercResult> {
  if (!isHoplite(row)) return notHoplite();
  if (row.status !== "alive") return { ok: false, code: 409, error: "The dead take no contracts." };
  if (row.contractId) return { ok: false, code: 409, error: "You are already sworn to a contract." };
  const def = contractDef(getContractsContent(), contractId);
  if (!def) return { ok: false, code: 404, error: "No such contract." };
  if (await holdsStrategos(row.id)) return { ok: false, code: 409, error: "A Strategos cannot be sworn abroad." };
  if (!meetsGate(def.gate, row.militia, row.prestige)) {
    const short = gateShortfall(def.gate, row.militia, row.prestige);
    return { ok: false, code: 403, error: `Not yet: need ${def.gate.militia} militia / ${def.gate.prestige} prestige (short ${short.militia} militia, ${short.prestige} prestige).` };
  }

  await db.transaction(async (tx: DbTx) => {
    // Bank any home rank salary earned up to now BEFORE home pay pauses.
    await settleSalary(tx, row.id, now);
    await tx
      .update(playerCharacters)
      .set({ contractId: def.id, contractStartedAt: now, contractSeasonsTotal: def.termSeasons, lastSalaryAt: now })
      .where(eq(playerCharacters.id, row.id));
  });
  return { ok: true, board: await buildBoard(await freshRow(row.id), now) };
}

// Bank accrued foreign income (does not end the contract unless the term is up).
export async function collectForeign(row: CharacterRow, now: Date = new Date()): Promise<MercResult> {
  if (!isHoplite(row)) return notHoplite();
  if (!row.contractId) return { ok: false, code: 409, error: "You are not on a contract." };
  const res = await settleMercContract(row.id, contractCfgMap(), "collect", now);
  return { ok: true, collected: res?.collected ?? 0, completed: res?.completed ?? false, board: await buildBoard(await freshRow(row.id), now) };
}

// Early return — allowed only once minCancelSeasons have elapsed. Settles income
// earned so far and returns home (no penalty in v1 beyond forgoing the rest).
export async function cancelContract(row: CharacterRow, now: Date = new Date()): Promise<MercResult> {
  if (!isHoplite(row)) return notHoplite();
  if (!row.contractId || !row.contractStartedAt) return { ok: false, code: 409, error: "You are not on a contract." };
  const def = contractDef(getContractsContent(), row.contractId);
  if (!def) return { ok: false, code: 404, error: "No such contract." };
  const elapsed = seasonsElapsed(row.contractStartedAt.getTime(), now.getTime());
  if (elapsed < def.minCancelSeasons) {
    return { ok: false, code: 409, error: `You are sworn for now — you may return after season ${def.minCancelSeasons} (served ${elapsed}).` };
  }
  const res = await settleMercContract(row.id, contractCfgMap(), "cancel", now);
  return { ok: true, collected: res?.collected ?? 0, board: await buildBoard(await freshRow(row.id), now) };
}
