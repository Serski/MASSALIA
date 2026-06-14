import { and, eq, isNotNull } from "drizzle-orm";
import { canAddTrait, foreignIncomeAccrual, REAL_MS_PER_SEASON, seasonsElapsed, type Trait } from "@massalia/shared";
import { createDb } from "./client.js";
import { characterTraits, playerCharacters } from "./schema.js";

// ---------------------------------------------------------------------------
// Mercenary contract settlement + the worker completion sweep (Hoplite Step 2),
// plus the SAFE-completion trait awards (Step 3).
//
// The single source of truth for resolving an active contract: it banks foreign
// income into the integer wallet and, when the term is served (or on cancel),
// clears the contract back to home (resuming home salary from the return instant).
// On SUCCESSFUL completion (term served, NOT cancel) it also awards the contract's
// reputation traits, idempotently and respecting cap/opposite rules. Shared by the
// server (lazy on-read completion + collect + cancel) and the worker sweep, so
// contracts resolve — and award — at season boundaries even for an offline player.
//
// SAFE completion only. TODO (Step 4): insert the death/injury roll at the marked
// site below — before the contract is cleared — with age>30 lethality scaling and
// the succession / "died gloriously abroad" hook (the death path awards NOTHING).
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];

// The runtime config the server/worker pass in (from content/military/contracts.json),
// so this DB-layer routine needs no content loader of its own. completionTraits are
// the reputation/class traits awarded on safe completion.
export type MercContractCfg = { dailyDrachmae: number; termSeasons: number; completionTraits: string[] };
export type MercContractCfgMap = Record<string, MercContractCfg>;

// "collect": bank income now, clear iff the term is served.
// "complete": no-op unless the term is served, then settle final income + clear.
// "cancel": settle income earned so far and clear unconditionally (gating is the
//           caller's job — minCancelSeasons lives in content).
export type SettleMode = "collect" | "complete" | "cancel";

export type MercSettle = { contractId: string; collected: number; completed: boolean; cleared: boolean; awardedTraits: string[] } | null;

// Award the contract's completion traits idempotently, honouring cap/opposite rules
// (skip silently on a violation or unknown trait). Runs inside the settle tx so the
// award is atomic with the contract clear. traitDefs is the full trait catalog.
async function awardTraits(tx: DbTx, characterId: string, traitIds: string[], traitDefs: Trait[]): Promise<string[]> {
  if (traitIds.length === 0) return [];
  const byId = new Map(traitDefs.map((t) => [t.id, t]));
  const heldRows = await tx.select({ traitId: characterTraits.traitId }).from(characterTraits).where(eq(characterTraits.characterId, characterId));
  const held: Trait[] = heldRows.map((r) => byId.get(r.traitId)).filter((t): t is Trait => Boolean(t));
  const heldIds = new Set(heldRows.map((r) => r.traitId));

  const awarded: string[] = [];
  for (const id of traitIds) {
    const candidate = byId.get(id);
    if (!candidate) continue; // unknown trait — skip silently
    if (heldIds.has(id)) continue; // idempotent — already held
    if (!canAddTrait(held, candidate).ok) continue; // cap/opposite violation — skip silently
    await tx.insert(characterTraits).values({ characterId, traitId: id }).onConflictDoNothing();
    held.push(candidate); // so later awards in this batch respect the cap
    heldIds.add(id);
    awarded.push(id);
  }
  return awarded;
}

export async function settleMercContract(characterId: string, cfgMap: MercContractCfgMap, mode: SettleMode, traitDefs: Trait[], now: Date = new Date()): Promise<MercSettle> {
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
      return { contractId: row.contractId, collected: 0, completed: false, cleared: false, awardedTraits: [] };
    }

    const cleared = completed || mode === "cancel";
    const accrual = foreignIncomeAccrual(cfg.dailyDrachmae, anchor, now.getTime(), termEndMs);
    const nextDrachmae = row.drachmae + accrual.drachmae;

    let awardedTraits: string[] = [];
    if (cleared) {
      // TODO (Step 4): roll death/injury HERE, before clearing — age>30 lethality,
      // succession / "died gloriously abroad". Step 3 always returns home safely.
      //
      // Award completion traits ONLY on a successful term-served completion — never
      // on an early cancel (mode "cancel"), never on the (future) death path.
      if (completed && mode !== "cancel") {
        awardedTraits = await awardTraits(tx, characterId, cfg.completionTraits, traitDefs);
      }
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
    return { contractId: row.contractId, collected: accrual.drachmae, completed, cleared, awardedTraits };
  });
}

// The worker's belt-and-suspenders sweep (mirrors sweepSpouseDeaths): complete
// every contract whose term has been served — awarding completion traits — even for
// an offline player. Idempotent: "complete" mode no-ops contracts not yet due.
export async function sweepMercenaryContracts(cfgMap: MercContractCfgMap, traitDefs: Trait[], now: Date = new Date()): Promise<{ checked: number; completed: number; awarded: number }> {
  const rows = await db
    .select({ id: playerCharacters.id })
    .from(playerCharacters)
    .where(and(eq(playerCharacters.status, "alive"), isNotNull(playerCharacters.contractId)));

  let completed = 0;
  let awarded = 0;
  for (const r of rows) {
    const res = await settleMercContract(r.id, cfgMap, "complete", traitDefs, now);
    if (res?.completed) completed++;
    awarded += res?.awardedTraits.length ?? 0;
  }
  return { checked: rows.length, completed, awarded };
}
