import { and, eq, isNull, sql } from "drizzle-orm";
import { createDb, effectLog, playerCharacters, playerHoldings, playerUnits, resources } from "@massalia/db";
import { renderCampaignLine, type CampaignPayload } from "@massalia/shared";
import type { ActingContext } from "./buildings.js";
import { getBattleContent, isActive } from "./barracks.js";
import { regionBaseWarband, townBaseGarrison, writeRegionWarband, writeTownGarrison } from "./mapPools.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";
import { townStats } from "./townStats.js";

// Holdings (barracks prompts 3b, 3c): the World 2 regions and towns a player
// holds by conquest (colonies arrive in 3d). A holding is a base for reach and
// movement, and it needs a garrison: with no active, non-moving row based there
// for a full day it reverts — the row is deleted and the region's warband or
// the town's garrison comes back at its content value. Reversion runs inside
// the barracks settle (after arrivals, so a returning garrison counts first)
// and so is re-checked by every locked handler before it reads bases.
//
// A held town pays tribute in drachmae, a held region in grain and timber,
// settled closed-form on whole days from last_tribute_at (see settleTribute).

type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = DbTx | Db;

const MS_PER_DAY = 86_400_000;

export type HoldingRow = typeof playerHoldings.$inferSelect;

// The id a holding's men are based at: the town slug for a town holding, the
// region id for a region holding.
export const holdingBaseId = (h: Pick<HoldingRow, "regionId" | "townId">): string => (h.townId ? h.townId : h.regionId);
export const isTownHolding = (h: Pick<HoldingRow, "townId">): boolean => h.townId !== "";

const holdingKey = (h: Pick<HoldingRow, "worldId" | "regionId" | "townId">) => and(eq(playerHoldings.worldId, h.worldId), eq(playerHoldings.regionId, h.regionId), eq(playerHoldings.townId, h.townId));

export async function listHoldings(exec: Exec, ctx: ActingContext): Promise<HoldingRow[]> {
  return exec
    .select()
    .from(playerHoldings)
    .where(and(eq(playerHoldings.worldId, ctx.worldId), eq(playerHoldings.ownerPlayerId, ctx.playerId)))
    .orderBy(playerHoldings.since, playerHoldings.regionId, playerHoldings.townId);
}

// Men standing at a base (a region id or a town id): active, non-moving rows
// the player has based there.
export async function garrisonCount(exec: Exec, ctx: ActingContext, baseId: string, now: Date): Promise<number> {
  const rows = await exec
    .select()
    .from(playerUnits)
    .where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId), eq(playerUnits.basedAt, baseId), isNull(playerUnits.movingTo)));
  return rows.filter((r) => isActive(r, now)).reduce((n, r) => n + r.count, 0);
}

async function characterIdOf(exec: Exec, playerId: string): Promise<string | null> {
  return (await exec.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, playerId)).limit(1))[0]?.id ?? null;
}

// Relative credits: the wallet on the character row, goods on the player's
// resource rows (created at zero when absent). Never a debit.
export async function creditDrachmae(exec: Exec, playerId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await exec.update(playerCharacters).set({ drachmae: sql`${playerCharacters.drachmae} + ${amount}` }).where(eq(playerCharacters.playerId, playerId));
}

export async function creditGood(exec: Exec, playerId: string, type: string, qty: number, now: Date): Promise<void> {
  if (qty <= 0) return;
  const existing = (await exec.select({ id: resources.id }).from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId), eq(resources.type, type))).limit(1))[0];
  if (existing) await exec.update(resources).set({ amount: sql`${resources.amount} + ${String(qty)}::numeric` }).where(eq(resources.id, existing.id));
  else await exec.insert(resources).values({ scope: "player", scopeId: playerId, type, amount: String(qty), ratePerSecond: "0", lastUpdatedAt: now });
}

export type HoldingsSettle = { reverted: { regionId: string; townId: string; kind: string; previousOwner: string | null }[] };

// Keep last_garrisoned_at current for garrisoned holdings; revert any holding
// that has stood empty for a full day.
export async function settleHoldings(exec: Exec, ctx: ActingContext, now: Date): Promise<HoldingsSettle> {
  const out: HoldingsSettle = { reverted: [] };
  const holdings = await listHoldings(exec, ctx);
  if (holdings.length === 0) return out;
  const characterId = await characterIdOf(exec, ctx.playerId);
  for (const h of holdings) {
    const men = await garrisonCount(exec, ctx, holdingBaseId(h), now);
    if (men > 0) {
      await exec.update(playerHoldings).set({ lastGarrisonedAt: now }).where(holdingKey(h));
      continue;
    }
    if (now.getTime() - h.lastGarrisonedAt.getTime() < MS_PER_DAY) continue;
    await exec.delete(playerHoldings).where(holdingKey(h));
    if (isTownHolding(h)) await writeTownGarrison(exec, h.worldId, h.townId, await townBaseGarrison(h.townId), now);
    else await writeRegionWarband(exec, h.worldId, h.regionId, await regionBaseWarband(h.regionId), now);
    if (characterId) {
      const chronicle: CampaignPayload = { regionId: h.regionId, regionName: await regionDisplayName(h.regionId), previousOwner: h.previousOwner };
      if (isTownHolding(h)) {
        chronicle.townId = h.townId;
        chronicle.townName = await townDisplayName(h.townId);
      }
      await exec.insert(effectLog).values({
        characterId,
        kind: "holding_reverted",
        detail: { regionId: h.regionId, townId: h.townId, kind: h.kind, previousOwner: h.previousOwner, since: h.since.toISOString(), source: "barracks", chronicle },
        createdAt: now,
      });
    }
    out.reverted.push({ regionId: h.regionId, townId: h.townId, kind: h.kind, previousOwner: h.previousOwner });
  }
  return out;
}

// A conquest holding. `garrisonedAt` dates last_garrisoned_at and
// last_tribute_at (the survivors are in recovery until then, so the empty-for-
// a-day clock and the tribute both start when the men actually stand).
export async function insertConquest(exec: Exec, ctx: ActingContext, regionId: string, previousOwner: string | null, now: Date, garrisonedAt: Date = now): Promise<HoldingRow> {
  const inserted = await exec
    .insert(playerHoldings)
    .values({ worldId: ctx.worldId, regionId, townId: "", ownerPlayerId: ctx.playerId, kind: "conquest", previousOwner, since: now, lastGarrisonedAt: garrisonedAt, lastTributeAt: garrisonedAt })
    .returning();
  return inserted[0]!;
}

export async function insertTownConquest(exec: Exec, ctx: ActingContext, regionId: string, townId: string, previousOwner: string | null, now: Date, garrisonedAt: Date = now): Promise<HoldingRow> {
  const inserted = await exec
    .insert(playerHoldings)
    .values({ worldId: ctx.worldId, regionId, townId, ownerPlayerId: ctx.playerId, kind: "conquest", previousOwner, since: now, lastGarrisonedAt: garrisonedAt, lastTributeAt: garrisonedAt })
    .returning();
  return inserted[0]!;
}

// --- Tribute (3c) -------------------------------------------------------------

// What a holding pays a day, and the garrison it needs to pay it.
export type TributeRate = { drachmae: number; grain: number; timber: number; minGarrison: number };

export async function tributeRateOf(h: Pick<HoldingRow, "regionId" | "townId">): Promise<TributeRate> {
  const c = getBattleContent();
  if (isTownHolding(h)) {
    const { population } = await townStats(h.townId);
    return { drachmae: Math.round(c.tribute.perPopulation * population), grain: 0, timber: 0, minGarrison: Math.ceil(c.tribute.minGarrisonPerPopulation * population) };
  }
  const warband = await regionBaseWarband(h.regionId);
  const r = c.regionTribute;
  return { drachmae: 0, grain: Math.max(r.minGrain, Math.round(r.grainPerWarband * warband)), timber: Math.max(r.minTimber, Math.round(r.timberPerWarband * warband)), minGarrison: 1 };
}

export type TributePaid = { regionId: string; townId: string; name: string; days: number; drachmae: number; grain: number; timber: number };
export type TributeSettle = { paid: TributePaid[] };

// Credit each held holding's tribute for the whole days since its
// last_tribute_at, then advance the marker by those days. A holding whose
// garrison is under its minimum at the settle pays nothing for the days that
// elapsed (the marker still advances: those days are gone). Called from
// settleBarracks after reversion, so a holding that just slipped away pays
// nothing. One holding_tribute log and one Chronicle line per settle when
// anything was paid.
export async function settleTribute(exec: Exec, ctx: ActingContext, now: Date): Promise<TributeSettle> {
  const out: TributeSettle = { paid: [] };
  const holdings = await listHoldings(exec, ctx);
  for (const h of holdings) {
    const days = Math.floor((now.getTime() - h.lastTributeAt.getTime()) / MS_PER_DAY);
    if (days <= 0) continue;
    const advanced = new Date(h.lastTributeAt.getTime() + days * MS_PER_DAY);
    await exec.update(playerHoldings).set({ lastTributeAt: advanced }).where(holdingKey(h));
    const rate = await tributeRateOf(h);
    const men = await garrisonCount(exec, ctx, holdingBaseId(h), now);
    if (men < rate.minGarrison) continue;
    const paid: TributePaid = {
      regionId: h.regionId,
      townId: h.townId,
      name: isTownHolding(h) ? await townDisplayName(h.townId) : await regionDisplayName(h.regionId),
      days,
      drachmae: rate.drachmae * days,
      grain: rate.grain * days,
      timber: rate.timber * days,
    };
    if (paid.drachmae === 0 && paid.grain === 0 && paid.timber === 0) continue;
    await creditDrachmae(exec, ctx.playerId, paid.drachmae);
    await creditGood(exec, ctx.playerId, "grain", paid.grain, now);
    await creditGood(exec, ctx.playerId, "timber", paid.timber, now);
    out.paid.push(paid);
  }
  if (out.paid.length === 0) return out;
  const characterId = await characterIdOf(exec, ctx.playerId);
  if (characterId) {
    const chronicle: CampaignPayload = {
      regionId: out.paid[0]!.regionId,
      tribute: out.paid.map((p) => ({ name: p.name, days: p.days, drachmae: p.drachmae, grain: p.grain, timber: p.timber })),
    };
    await exec.insert(effectLog).values({
      characterId,
      kind: "holding_tribute",
      detail: { paid: out.paid, source: "barracks", chronicle, line: renderCampaignLine("holding_tribute", chronicle) },
      createdAt: now,
    });
  }
  return out;
}

// Region holdings with men standing in them right now: what the levy's yearly
// growth counts (regionTribute.levyPerYear each).
export async function heldGarrisonedRegions(exec: Exec, ctx: ActingContext, now: Date): Promise<number> {
  let n = 0;
  for (const h of await listHoldings(exec, ctx)) {
    if (isTownHolding(h)) continue;
    if ((await garrisonCount(exec, ctx, h.regionId, now)) > 0) n++;
  }
  return n;
}
