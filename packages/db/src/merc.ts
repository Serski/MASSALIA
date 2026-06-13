import { and, eq, isNotNull } from "drizzle-orm";
import { foreignIncomeAccrual, REAL_MS_PER_SEASON, seasonsElapsed } from "@massalia/shared";
import { createDb } from "./client.js";
import { playerCharacters } from "./schema.js";

// ---------------------------------------------------------------------------
// Mercenary contract settlement + the worker completion sweep (Hoplite Step 2).
//
// The single source of truth for resolving an active contract: it banks foreign
// income into the integer wallet and, when the term is served (or on cancel),
// clears the contract back to home (resuming home salary from the return instant).
// Shared by the server (lazy on-read completion + collect + cancel) and the worker
// sweep, so contracts resolve at season boundaries even for an offline player.
//
// SAFE completion only. TODO (Step 4): insert the death/injury roll at the marked
// site below — before the contract is cleared — with age>30 lethality scaling and
// the succession / "died gloriously abroad" hook.
// ---------------------------------------------------------------------------

const db = createDb();

// The runtime config the server/worker pass in (from content/military/contracts.json),
// so this DB-layer routine needs no content loader of its own.
export type MercContractCfg = { dailyDrachmae: number; termSeasons: number };
export type MercContractCfgMap = Record<string, MercContractCfg>;

// "collect": bank income now, clear iff the term is served.
// "complete": no-op unless the term is served, then settle final income + clear.
// "cancel": settle income earned so far and clear unconditionally (gating is the
//           caller's job — minCancelSeasons lives in content).
export type SettleMode = "collect" | "complete" | "cancel";

export type MercSettle = { contractId: string; collected: number; completed: boolean; cleared: boolean } | null;

export async function settleMercContract(characterId: string, cfgMap: MercContractCfgMap, mode: SettleMode, now: Date = new Date()): Promise<MercSettle> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
    const row = rows[0];
    if (!row || !row.contractId || !row.contractStartedAt) return null;
    const cfg = cfgMap[row.contractId];
    if (!cfg) return null; // defensive: unknown contract id (stale content)

    const startedMs = row.contractStartedAt.getTime();
    const termEndMs = startedMs + cfg.termSeasons * REAL_MS_PER_SEASON;
    const anchor = (row.lastSalaryAt ?? row.contractStartedAt).getTime();
    const completed = seasonsElapsed(startedMs, now.getTime()) >= cfg.termSeasons;

    // "complete" mode is a pure tick check: do nothing until the term is served.
    if (mode === "complete" && !completed) {
      return { contractId: row.contractId, collected: 0, completed: false, cleared: false };
    }

    const cleared = completed || mode === "cancel";
    const accrual = foreignIncomeAccrual(cfg.dailyDrachmae, anchor, now.getTime(), termEndMs);
    const nextDrachmae = row.drachmae + accrual.drachmae;

    if (cleared) {
      // TODO (Step 4): roll death/injury HERE, before clearing — age>30 lethality,
      // succession / "died gloriously abroad". Step 2 always returns home safely.
      await tx
        .update(playerCharacters)
        .set({
          contractId: null,
          contractStartedAt: null,
          contractSeasonsTotal: null,
          drachmae: nextDrachmae,
          lastSalaryAt: now, // home rank salary resumes from the return instant
        })
        .where(eq(playerCharacters.id, characterId));
    } else {
      await tx
        .update(playerCharacters)
        .set({ drachmae: nextDrachmae, lastSalaryAt: new Date(anchor + accrual.consumedMs) })
        .where(eq(playerCharacters.id, characterId));
    }
    return { contractId: row.contractId, collected: accrual.drachmae, completed, cleared };
  });
}

// The worker's belt-and-suspenders sweep (mirrors sweepSpouseDeaths): complete
// every contract whose term has been served, even for an offline player. Idempotent
// — "complete" mode no-ops contracts that are not yet due.
export async function sweepMercenaryContracts(cfgMap: MercContractCfgMap, now: Date = new Date()): Promise<{ checked: number; completed: number }> {
  const rows = await db
    .select({ id: playerCharacters.id })
    .from(playerCharacters)
    .where(and(eq(playerCharacters.status, "alive"), isNotNull(playerCharacters.contractId)));

  let completed = 0;
  for (const r of rows) {
    const res = await settleMercContract(r.id, cfgMap, "complete", now);
    if (res?.completed) completed++;
  }
  return { checked: rows.length, completed };
}
