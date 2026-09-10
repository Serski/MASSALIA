import { and, eq, isNull } from "drizzle-orm";
import { createDb, effectLog, playerCharacters, playerHoldings, playerUnits } from "@massalia/db";
import type { ActingContext } from "./buildings.js";
import { isActive } from "./barracks.js";
import { regionBaseWarband, writeRegionWarband } from "./mapPools.js";
import { regionDisplayName } from "./mapNames.js";

// Holdings (barracks prompt 3b): the World 2 regions a player holds by conquest
// (colonies arrive in 3c). A holding is a base for reach and movement, and it
// needs a garrison: with no active, non-moving row based there for a full day
// it reverts — the row is deleted and the region's warband comes back at its
// content value. Reversion runs inside the barracks settle (after arrivals, so
// a returning garrison counts first) and so is re-checked by every locked
// handler before it reads bases.

type Db = ReturnType<typeof createDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = DbTx | Db;

const MS_PER_DAY = 86_400_000;

export type HoldingRow = typeof playerHoldings.$inferSelect;

export async function listHoldings(exec: Exec, ctx: ActingContext): Promise<HoldingRow[]> {
  return exec
    .select()
    .from(playerHoldings)
    .where(and(eq(playerHoldings.worldId, ctx.worldId), eq(playerHoldings.ownerPlayerId, ctx.playerId)))
    .orderBy(playerHoldings.since, playerHoldings.regionId);
}

// Men standing in a region: active, non-moving rows the player has based there.
export async function garrisonCount(exec: Exec, ctx: ActingContext, regionId: string, now: Date): Promise<number> {
  const rows = await exec
    .select()
    .from(playerUnits)
    .where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, ctx.playerId), eq(playerUnits.basedAt, regionId), isNull(playerUnits.movingTo)));
  return rows.filter((r) => isActive(r, now)).reduce((n, r) => n + r.count, 0);
}

export type HoldingsSettle = { reverted: { regionId: string; kind: string; previousOwner: string | null }[] };

// Keep last_garrisoned_at current for garrisoned holdings; revert any holding
// that has stood empty for a full day.
export async function settleHoldings(exec: Exec, ctx: ActingContext, now: Date): Promise<HoldingsSettle> {
  const out: HoldingsSettle = { reverted: [] };
  const holdings = await listHoldings(exec, ctx);
  if (holdings.length === 0) return out;
  const characterId = (await exec.select({ id: playerCharacters.id }).from(playerCharacters).where(eq(playerCharacters.playerId, ctx.playerId)).limit(1))[0]?.id ?? null;
  for (const h of holdings) {
    const men = await garrisonCount(exec, ctx, h.regionId, now);
    if (men > 0) {
      await exec.update(playerHoldings).set({ lastGarrisonedAt: now }).where(and(eq(playerHoldings.worldId, h.worldId), eq(playerHoldings.regionId, h.regionId)));
      continue;
    }
    if (now.getTime() - h.lastGarrisonedAt.getTime() < MS_PER_DAY) continue;
    await exec.delete(playerHoldings).where(and(eq(playerHoldings.worldId, h.worldId), eq(playerHoldings.regionId, h.regionId)));
    await writeRegionWarband(exec, h.worldId, h.regionId, await regionBaseWarband(h.regionId), now);
    if (characterId) {
      await exec.insert(effectLog).values({
        characterId,
        kind: "holding_reverted",
        detail: { regionId: h.regionId, kind: h.kind, previousOwner: h.previousOwner, since: h.since.toISOString(), source: "barracks", chronicle: { regionId: h.regionId, regionName: await regionDisplayName(h.regionId), previousOwner: h.previousOwner } },
        createdAt: now,
      });
    }
    out.reverted.push({ regionId: h.regionId, kind: h.kind, previousOwner: h.previousOwner });
  }
  return out;
}

export async function insertConquest(exec: Exec, ctx: ActingContext, regionId: string, previousOwner: string | null, now: Date): Promise<HoldingRow> {
  const inserted = await exec
    .insert(playerHoldings)
    .values({ worldId: ctx.worldId, regionId, ownerPlayerId: ctx.playerId, kind: "conquest", previousOwner, since: now, lastGarrisonedAt: now })
    .returning();
  return inserted[0]!;
}
