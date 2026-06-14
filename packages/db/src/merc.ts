import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  ageRiskScale,
  canAddTrait,
  foreignIncomeAccrual,
  injuryTrait,
  REAL_MS_PER_SEASON,
  resolveRisk,
  seasonsElapsed,
  SEASONS_PER_YEAR,
  type ContractRisk,
  type RiskConfig,
  type RiskOutcome,
  type Trait,
} from "@massalia/shared";
import { createDb } from "./client.js";
import { characterTraits, composureLog, dynasties, playerCharacters, players, worlds } from "./schema.js";

// ---------------------------------------------------------------------------
// Mercenary contract settlement + the worker completion sweep (Hoplite Steps 2–4).
//
// The single source of truth for resolving an active contract: it banks foreign
// income into the integer wallet and, when the term is served (or on cancel),
// clears the contract back to home. On SUCCESSFUL term completion (NOT cancel) it
// rolls the RISK once (Step 4) — death / career-ending injury / minor scare /
// clean — and applies the outcome. Shared by the server (lazy on-read completion +
// collect + cancel) and the worker sweep, so contracts resolve — and roll — at
// season boundaries even for an offline player.
//
// IDEMPOTENCY: a contract resolves exactly once. The first settle to clear it nulls
// contract_id; any later settle (the other path) reads no contract → returns null.
// So lazy + sweep on the same served-out contract never double-roll or double-award.
//
// DEATH reuses the EXISTING succession flow: it settles income to the estate (gold
// comes home → inherited, drachmae is not reset by becomeHeir), bumps dynasty
// prestige (glorious death), stashes the chronicle line on pending_death_note (which
// becomeHeir writes into successions.note), and sets status 'deceased' — exactly
// what old-age death does, so the normal heir UI takes over. No parallel death path.
//
// TODO (Step 5): re-class offer after a career injury; voluntary retirement at 50;
// veteran Strategos eligibility.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
const MS_PER_GAME_YEAR = REAL_MS_PER_SEASON * SEASONS_PER_YEAR;

// The runtime config the server/worker pass in (from content/military/contracts.json),
// so this DB-layer routine needs no content loader of its own.
export type MercContractCfg = { dailyDrachmae: number; termSeasons: number; completionTraits: string[]; risk: ContractRisk; deathSetting: string };
export type MercContractCfgMap = Record<string, MercContractCfg>;

// "collect": bank income now, clear (+ roll risk) iff the term is served.
// "complete": no-op unless the term is served, then settle + roll risk + clear.
// "cancel": settle income earned so far and clear unconditionally — NO risk roll,
//           NO awards (gating is the caller's job — minCancelSeasons lives in content).
export type SettleMode = "collect" | "complete" | "cancel";

// What the settle needs beyond the contract config: the trait catalog (for rule-
// checked awards), the global risk config, an injectable rng (seeded in tests), now.
export type MercSettleCtx = { traitDefs: Trait[]; riskCfg: RiskConfig; rng?: () => number; now?: Date };

export type MercSettle = {
  contractId: string;
  collected: number;
  completed: boolean;
  cleared: boolean;
  awardedTraits: string[];
  // Null for cancel / not-yet-due; the rolled outcome on a successful completion.
  outcome: RiskOutcome | null;
  died: boolean;
  composureHit: number;
} | null;

// Award a list of traits idempotently, honouring cap/opposite rules (skip silently
// on a violation or unknown trait). Runs inside the settle tx — atomic with the clear.
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
    held.push(candidate);
    heldIds.add(id);
    awarded.push(id);
  }
  return awarded;
}

export async function settleMercContract(characterId: string, cfgMap: MercContractCfgMap, mode: SettleMode, ctx: MercSettleCtx): Promise<MercSettle> {
  const now = ctx.now ?? new Date();
  const rng = ctx.rng ?? Math.random;
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
    const row = rows[0];
    if (!row || !row.contractId || !row.contractStartedAt) return null; // idempotent: already cleared
    const cfg = cfgMap[row.contractId];
    if (!cfg) return null; // defensive: unknown contract id (stale content)

    const startedMs = row.contractStartedAt.getTime();
    const termEndMs = startedMs + cfg.termSeasons * REAL_MS_PER_SEASON;
    const anchor = (row.lastSalaryAt ?? row.contractStartedAt).getTime();
    const completed = seasonsElapsed(startedMs, now.getTime()) >= cfg.termSeasons;

    // "complete" mode is a pure tick check: do nothing until the term is served.
    if (mode === "complete" && !completed) {
      return { contractId: row.contractId, collected: 0, completed: false, cleared: false, awardedTraits: [], outcome: null, died: false, composureHit: 0 };
    }

    const accrual = foreignIncomeAccrual(cfg.dailyDrachmae, anchor, now.getTime(), termEndMs);
    const nextDrachmae = row.drachmae + accrual.drachmae; // income always comes home

    // Still serving (collect mid-term): bank income, advance the anchor, no clear/roll.
    if (!completed && mode !== "cancel") {
      await tx.update(playerCharacters).set({ drachmae: nextDrachmae, lastSalaryAt: new Date(anchor + accrual.consumedMs) }).where(eq(playerCharacters.id, characterId));
      return { contractId: row.contractId, collected: accrual.drachmae, completed: false, cleared: false, awardedTraits: [], outcome: null, died: false, composureHit: 0 };
    }

    // From here the contract CLEARS (served-out completion, or a cancel).
    const clearedFields = { contractId: null, contractStartedAt: null, contractSeasonsTotal: null } as const;

    // CANCEL: settle income, return home — NO risk, NO awards (Step 2/3 behaviour).
    if (mode === "cancel") {
      await tx.update(playerCharacters).set({ ...clearedFields, drachmae: nextDrachmae, lastSalaryAt: now }).where(eq(playerCharacters.id, characterId));
      return { contractId: row.contractId, collected: accrual.drachmae, completed, cleared: true, awardedTraits: [], outcome: null, died: false, composureHit: 0 };
    }

    // SUCCESSFUL COMPLETION → roll the risk ONCE (Step 4). Age mirrors shared
    // currentAge (elapsed clamped at 0): startAge + whole game-years lived.
    const age = row.startAge + Math.floor(Math.max(0, now.getTime() - row.createdAt.getTime()) / MS_PER_GAME_YEAR);
    const outcome = resolveRisk(cfg.risk, age, ctx.riskCfg, rng);

    if (outcome === "death") {
      // Income to the estate FIRST (inherited — drachmae is not reset by becomeHeir),
      // glorious-death dynasty prestige bump, the chronicle line, then mark deceased.
      const seasonNo = Math.floor((now.getTime() - (await worldStartedMs(tx, row.worldId))) / REAL_MS_PER_SEASON) + 1;
      const name = await playerName(tx, row.playerId);
      const note = `${name} fell ${cfg.deathSetting}, season ${seasonNo}`;
      if (row.dynastyId) {
        await tx.update(dynasties).set({ prestige: sql`${dynasties.prestige} + ${ctx.riskCfg.gloriousDeathPrestige}` }).where(eq(dynasties.id, row.dynastyId));
      }
      await tx
        .update(playerCharacters)
        .set({ ...clearedFields, drachmae: nextDrachmae, lastSalaryAt: now, status: "deceased", pendingDeathNote: note })
        .where(eq(playerCharacters.id, characterId));
      return { contractId: row.contractId, collected: accrual.drachmae, completed: true, cleared: true, awardedTraits: [], outcome, died: true, composureHit: 0 };
    }

    // Non-fatal outcomes return home alive; pick the traits to award.
    let awardIds: string[];
    if (outcome === "injury") awardIds = [injuryTrait(rng)]; // one-eyed OR lamed (the hard-contract bar)
    else if (outcome === "scare") awardIds = ["war-scarred"];
    else awardIds = cfg.completionTraits; // clean return → the Step-3 completion traits

    const awardedTraits = await awardTraits(tx, characterId, awardIds, ctx.traitDefs);

    // Minor scare: a small, temporary composure hit (recovers via normal recovery).
    let composureHit = 0;
    const set: Record<string, unknown> = { ...clearedFields, drachmae: nextDrachmae, lastSalaryAt: now };
    if (outcome === "scare" && ctx.riskCfg.scareComposureHit > 0) {
      composureHit = Math.min(row.composure, ctx.riskCfg.scareComposureHit);
      set.composure = row.composure - composureHit;
      await tx.insert(composureLog).values({ characterId, delta: -composureHit, reason: "merc:scare" });
    }
    await tx.update(playerCharacters).set(set).where(eq(playerCharacters.id, characterId));

    return { contractId: row.contractId, collected: accrual.drachmae, completed: true, cleared: true, awardedTraits, outcome, died: false, composureHit };
  });
}

async function worldStartedMs(tx: DbTx, worldId: string): Promise<number> {
  const rows = await tx.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, worldId)).limit(1);
  return rows[0]?.startedAt.getTime() ?? 0;
}
async function playerName(tx: DbTx, playerId: string): Promise<string> {
  const rows = await tx.select({ name: players.name }).from(players).where(eq(players.id, playerId)).limit(1);
  return rows[0]?.name ?? "A hoplite";
}

// Re-export for callers that want the scaled rates (previews/tests).
export { ageRiskScale };

// The worker's belt-and-suspenders sweep (mirrors sweepSpouseDeaths): complete every
// served-out contract — rolling the risk + awards — even for an offline player.
// Idempotent: "complete" mode no-ops contracts not yet due.
export async function sweepMercenaryContracts(cfgMap: MercContractCfgMap, ctx: MercSettleCtx): Promise<{ checked: number; completed: number; died: number; awarded: number }> {
  const now = ctx.now ?? new Date();
  const rows = await db
    .select({ id: playerCharacters.id })
    .from(playerCharacters)
    .where(and(eq(playerCharacters.status, "alive"), isNotNull(playerCharacters.contractId)));

  let completed = 0;
  let died = 0;
  let awarded = 0;
  for (const r of rows) {
    const res = await settleMercContract(r.id, cfgMap, "complete", { ...ctx, now });
    if (res?.completed) completed++;
    if (res?.died) died++;
    awarded += res?.awardedTraits.length ?? 0;
  }
  return { checked: rows.length, completed, died, awarded };
}
