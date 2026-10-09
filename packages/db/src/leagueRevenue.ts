import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { gameDate, leagueTax, parseCitiesContent, treasuryClaimReason, type CitiesContent, type PoliticsConfig } from "@massalia/shared";
import { createDb, type DbExec } from "./client.js";
import { ensureTreasuries } from "./agenda.js";
import { leagueCities, treasuries, treasuryLedger, worldTreasury } from "./schema.js";
import { activeWorld } from "./world.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The League treasury's income (government prompt 1). Once per world it opens
// with the config's balance; once a season it takes the poleis' tax and sweeps
// world_treasury (the market tax, routine fees, koinon fees and purses) into
// the League's books. Each credit is claimed by its ledger row: the unique
// partial index of migration 0070 makes 'opening', 'tax:s<N>' and 'fees:s<N>'
// once-only at the database, and the lock + re-read below make it so even
// before that migration has run (the worker can be on this code first).
// Season-correct like the levy: only the current season is ever taxed.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const citiesFile = path.join(repoRoot, "content/cities/cities.json");

let cities: CitiesContent | null = null;
export async function loadCities(): Promise<CitiesContent> {
  if (!cities) cities = parseCitiesContent(JSON.parse(await readFile(citiesFile, "utf8")));
  return cities;
}

// The nine poleis' start rows for a world, from content, inserted once. These are
// the rows GET /api/league/cities seeded on read; the tax and the drift read them.
// Idempotent. Run it OUTSIDE the treasury transaction: the festival transaction
// writes league_cities before it takes the treasuries row, so inserting here under
// that row's lock could deadlock against it.
export async function ensureLeagueCities(exec: DbExec, worldId: string): Promise<void> {
  const content = await loadCities();
  await exec
    .insert(leagueCities)
    .values(
      content.cities.map((c) => ({
        worldId,
        cityId: c.id,
        population: c.start.population,
        tax: c.start.tax,
        stability: c.start.stability,
        fortifications: c.start.fortifications,
        garrison: c.start.garrison,
      })),
    )
    .onConflictDoNothing({ target: [leagueCities.worldId, leagueCities.cityId] });
}

export interface LeagueRevenue {
  opened: number;
  fees: number;
  tax: number;
}

const NOTHING: LeagueRevenue = { opened: 0, fees: 0, tax: 0 };

async function claimedReasons(exec: DbExec, worldId: string, reasons: string[]): Promise<Set<string>> {
  const rows = await exec
    .select({ reason: treasuryLedger.reason })
    .from(treasuryLedger)
    .where(and(eq(treasuryLedger.worldId, worldId), eq(treasuryLedger.owner, "league"), inArray(treasuryLedger.reason, reasons)));
  return new Set(rows.map((r) => r.reason));
}

async function worldTreasuryBalance(exec: DbExec, worldId: string): Promise<number> {
  const rows = await exec.select({ balance: worldTreasury.balance }).from(worldTreasury).where(eq(worldTreasury.worldId, worldId)).limit(1);
  return rows[0]?.balance ?? 0;
}

// Claim the reason with its ledger row, then move the money. A lost claim (the
// row already there, from a run that got in first) returns 0 and moves nothing.
// The credit is a relative write whose row count must be 1, or the transaction
// throws and nothing is kept.
async function claimAndCredit(tx: DbExec, worldId: string, reason: string, amount: number, now: Date): Promise<number> {
  const claimed = await tx.insert(treasuryLedger).values({ worldId, owner: "league", delta: amount, reason, createdAt: now }).onConflictDoNothing().returning({ id: treasuryLedger.id });
  if (claimed.length === 0) return 0;
  const credited = await tx
    .update(treasuries)
    .set({ balance: sql`${treasuries.balance} + ${amount}`, updatedAt: now })
    .where(and(eq(treasuries.worldId, worldId), eq(treasuries.owner, "league")))
    .returning({ id: treasuries.id });
  if (credited.length !== 1) throw new Error(`league treasury credit for ${reason} touched ${credited.length} rows`);
  return amount;
}

// Collect what the League treasury is owed now, for the active world: the opening
// balance (once), this season's polis tax (once) and this season's sweep of
// world_treasury (once, and only when the pot holds anything). Returns the amounts
// this call credited. Cheap when nothing is due: GET /me/state runs it on every
// dashboard load, so the first read takes no lock and opens no transaction.
export async function collectLeagueRevenue(cfg: PoliticsConfig, now: Date = new Date()): Promise<LeagueRevenue> {
  const world = await activeWorld();
  if (!world) return NOTHING;
  const season = gameDate(now.getTime(), world.startedMs).seasonIndex;
  const reason = { opening: treasuryClaimReason.opening, tax: treasuryClaimReason.tax(season), fees: treasuryClaimReason.fees(season) };
  const reasons = [reason.opening, reason.tax, reason.fees];

  // 1. The cheap read, no lock.
  const claimed = await claimedReasons(db, world.id, reasons);
  const pot = await worldTreasuryBalance(db, world.id);
  const openingDue = cfg.treasury.openingBalance > 0 && !claimed.has(reason.opening);
  const taxDue = cfg.treasury.taxPerHead > 0 && !claimed.has(reason.tax);
  const feesDue = pot > 0 && !claimed.has(reason.fees);
  if (!openingDue && !taxDue && !feesDue) return NOTHING;

  // 2. The idempotent inserts, outside any transaction (see ensureLeagueCities).
  await ensureTreasuries(world.id);
  await ensureLeagueCities(db, world.id);

  // 3. One transaction: the League's treasuries row first, then the claims.
  return db.transaction(async (tx) => {
    await tx.select({ id: treasuries.id }).from(treasuries).where(and(eq(treasuries.worldId, world.id), eq(treasuries.owner, "league"))).for("update");
    const claimedNow = await claimedReasons(tx, world.id, reasons);
    const out: LeagueRevenue = { opened: 0, fees: 0, tax: 0 };

    if (openingDue && !claimedNow.has(reason.opening)) {
      out.opened = await claimAndCredit(tx, world.id, reason.opening, cfg.treasury.openingBalance, now);
    }

    if (taxDue && !claimedNow.has(reason.tax)) {
      const rows = await tx.select({ population: leagueCities.population }).from(leagueCities).where(eq(leagueCities.worldId, world.id));
      const amount = leagueTax(rows.map((r) => r.population), cfg.treasury);
      if (amount > 0) out.tax = await claimAndCredit(tx, world.id, reason.tax, amount, now);
    }

    // Fees last: the world_treasury lock that market sales wait on is held for the
    // shortest time. An empty pot writes nothing, so money that comes in later this
    // season goes with a later run, and never twice in a season.
    if (feesDue && !claimedNow.has(reason.fees)) {
      const locked = await tx.select({ balance: worldTreasury.balance }).from(worldTreasury).where(eq(worldTreasury.worldId, world.id)).for("update");
      const balance = locked[0]?.balance ?? 0;
      if (balance > 0) {
        const credited = await claimAndCredit(tx, world.id, reason.fees, balance, now);
        if (credited > 0) {
          const debited = await tx
            .update(worldTreasury)
            .set({ balance: sql`${worldTreasury.balance} - ${balance}` })
            .where(and(eq(worldTreasury.worldId, world.id), gte(worldTreasury.balance, balance)))
            .returning({ worldId: worldTreasury.worldId });
          if (debited.length !== 1) throw new Error(`world_treasury debit of ${balance} touched ${debited.length} rows`);
          out.fees = credited;
        }
      }
    }
    return out;
  });
}
