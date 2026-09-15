import { and, asc, count, eq, gte, isNull, sql } from "drizzle-orm";
import { createDb, effectLog, houses, marketListings, players } from "@massalia/db";
import {
  MARKET_PRICE_MAX,
  MARKET_QTY_MAX,
  MARKET_STALL_CAP,
  MARKET_TAX_EXEMPT_CLASS,
  marketTax,
  type MarketChroniclePayload,
} from "@massalia/shared";
import { agedPortraitFor } from "./age.js";
import {
  creditDrachmae,
  creditResource,
  creditWorldTreasury,
  debitDrachmae,
  debitResource,
  flipActivations,
  getBuildingsContent,
  getOrCreateResource,
  ownedRows,
  settleGoods,
  spendTransaction,
  spendTransactionFor,
  SpendRejected,
  type ActingContext,
} from "./buildings.js";
import { findCharacterRow } from "./character.js";

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
type Exec = DbTx | typeof db;

// ---------------------------------------------------------------------------
// The player market (market prompt 1): sell-only stalls. Listing escrows the
// seller's stock at once (settle, then the guarded debit — the vendor sell path);
// a buy claims units off the stall with a guarded decrement FIRST, then moves the
// money and the goods in the same transaction, both players locked in id order.
// A tenth of every sale goes to the world treasury; Traders pay nothing. Stalls
// never expire and nothing sweeps them.
// ---------------------------------------------------------------------------

type MarketError = { ok: false; code: number; error: string };

export type MarketSeller = {
  playerId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  professionSlug: string | null;
  faceId: string | null;
  portrait: string | null;
};

export type MarketListingView = {
  id: string;
  good: string;
  remaining: number;
  price: number;
  createdAt: string;
  mine: boolean;
  seller: MarketSeller;
};

export type MarketView = { listings: MarketListingView[]; open: number; cap: number; taxExempt: boolean };

const STALL_GONE = "That stall is gone.";

function goodLabel(good: string): string {
  return getBuildingsContent().goodLabels?.[good] ?? good[0]!.toUpperCase() + good.slice(1);
}

function isWhole(n: unknown, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
}

const qtyError = (verb: string): MarketError => ({ ok: false, code: 400, error: `${verb} a whole quantity from 1 to ${MARKET_QTY_MAX.toLocaleString("en-US")}.` });

async function openStallCount(exec: Exec, playerId: string): Promise<number> {
  const rows = await exec
    .select({ n: count() })
    .from(marketListings)
    .where(and(eq(marketListings.sellerPlayerId, playerId), isNull(marketListings.closedAt)));
  return rows[0]?.n ?? 0;
}

// A player's display facts for the stall and the chronicle: name, house, class,
// portrait. The character row is the one findCharacterRow returns for the world.
async function sellerFacts(exec: Exec, playerId: string, worldId: string, now: Date) {
  const player = (
    await exec
      .select({ name: players.name, houseSlug: players.houseSlug, professionSlug: players.professionSlug, faceId: players.faceId })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1)
  )[0];
  const character = await findCharacterRow(playerId, worldId, exec);
  const houseSlug = character?.houseSlug ?? player?.houseSlug ?? "";
  const house = houseSlug ? (await exec.select({ name: houses.name }).from(houses).where(eq(houses.slug, houseSlug)).limit(1))[0] : undefined;
  return {
    characterId: character?.id ?? null,
    classId: character?.classId ?? null,
    seller: {
      playerId,
      name: player?.name ?? "—",
      houseSlug,
      houseName: house?.name ?? houseSlug,
      professionSlug: player?.professionSlug ?? null,
      faceId: player?.faceId ?? null,
      portrait: agedPortraitFor(character, now.getTime()),
    } satisfies MarketSeller,
  };
}

// GET /api/market — every open stall in the world (read-only, no settle), sorted by
// good, then price, then age; plus the viewer's open count, the cap, and whether
// the viewer's sales are tax-exempt.
export async function marketView(ctx: ActingContext, now: Date): Promise<MarketView> {
  const rows = await db
    .select()
    .from(marketListings)
    .where(and(eq(marketListings.worldId, ctx.worldId), isNull(marketListings.closedAt), gte(marketListings.remaining, 1)))
    .orderBy(asc(marketListings.good), asc(marketListings.price), asc(marketListings.createdAt));

  const sellers = new Map<string, MarketSeller>();
  for (const sellerId of new Set(rows.map((r) => r.sellerPlayerId))) {
    sellers.set(sellerId, (await sellerFacts(db, sellerId, ctx.worldId, now)).seller);
  }

  const viewer = await findCharacterRow(ctx.playerId, ctx.worldId);
  return {
    listings: rows.map((r) => ({
      id: r.id,
      good: r.good,
      remaining: r.remaining,
      price: r.price,
      createdAt: r.createdAt.toISOString(),
      mine: r.sellerPlayerId === ctx.playerId,
      seller: sellers.get(r.sellerPlayerId)!,
    })),
    open: rows.filter((r) => r.sellerPlayerId === ctx.playerId).length,
    cap: MARKET_STALL_CAP,
    taxExempt: viewer?.classId === MARKET_TAX_EXEMPT_CLASS,
  };
}

export type ListResult =
  | MarketError
  | { ok: true; listing: { id: string; good: string; remaining: number; price: number; createdAt: string }; balance: number };

// POST /api/market/list — escrow `qty` whole units of `good` at `price` each.
export async function listGood(ctx: ActingContext, good: string, qty: unknown, price: unknown, now: Date): Promise<ListResult> {
  if (!isWhole(qty, MARKET_QTY_MAX)) return qtyError("List");
  if (!isWhole(price, MARKET_PRICE_MAX)) {
    return { ok: false, code: 400, error: `Set a whole price from 1 to ${MARKET_PRICE_MAX.toLocaleString("en-US")} drachmae.` };
  }
  if (!getBuildingsContent().vendor[good]) return { ok: false, code: 404, error: "The agora does not trade that good." };

  return spendTransaction(ctx.playerId, async (tx) => {
    if ((await openStallCount(tx, ctx.playerId)) >= MARKET_STALL_CAP) {
      return { ok: false as const, code: 409, error: "Ten stalls is the most one house may keep." };
    }
    const rows = await flipActivations(tx, await ownedRows(tx, ctx.playerId), now);
    await settleGoods(tx, ctx, rows, now); // bank pending so the escrow sees fresh stock
    const goodRow = await getOrCreateResource(tx, ctx.playerId, good, now);
    const balance = await debitResource(tx, goodRow.id, qty);
    if (balance === null) {
      // Nothing escrowed; the settle above still commits, as on the vendor sell path.
      return { ok: false as const, code: 409, error: `You hold only ${Math.floor(Number(goodRow.amount))} ${goodLabel(good).toLowerCase()}.` };
    }
    const listing = (
      await tx
        .insert(marketListings)
        .values({ worldId: ctx.worldId, sellerPlayerId: ctx.playerId, good, remaining: qty, price, createdAt: now })
        .returning()
    )[0]!;
    return {
      ok: true as const,
      listing: { id: listing.id, good: listing.good, remaining: listing.remaining, price: listing.price, createdAt: listing.createdAt.toISOString() },
      balance,
    };
  });
}

export type BuyResult =
  | MarketError
  | { ok: true; qty: number; total: number; tax: number; wallet: number; balance: number; remaining: number };

// POST /api/market/buy — take `qty` units off another player's stall.
export async function buyListing(ctx: ActingContext, listingId: string, qty: unknown, now: Date): Promise<BuyResult> {
  if (!isWhole(qty, MARKET_QTY_MAX)) return qtyError("Buy");
  const listing = (await db.select().from(marketListings).where(eq(marketListings.id, listingId)).limit(1))[0];
  if (!listing || listing.closedAt !== null || listing.worldId !== ctx.worldId) return { ok: false, code: 404, error: STALL_GONE };
  if (listing.sellerPlayerId === ctx.playerId) return { ok: false, code: 409, error: "That is your own stall. Cancel it instead." };
  const sellerId = listing.sellerPlayerId;

  return spendTransactionFor([ctx.playerId, sellerId], async (tx) => {
    // Claim first: the guarded decrement is what makes two buyers of the last unit
    // safe. Zero rows means the stall no longer holds `qty` (or has closed).
    const claimed = await tx
      .update(marketListings)
      .set({
        remaining: sql`${marketListings.remaining} - ${qty}`,
        closedAt: sql`CASE WHEN ${marketListings.remaining} - ${qty} = 0 THEN ${now.toISOString()}::timestamptz ELSE NULL END`,
      })
      .where(and(eq(marketListings.id, listingId), isNull(marketListings.closedAt), gte(marketListings.remaining, qty)))
      .returning({ remaining: marketListings.remaining });
    if (!claimed[0]) {
      const left = (await tx.select({ remaining: marketListings.remaining, closedAt: marketListings.closedAt }).from(marketListings).where(eq(marketListings.id, listingId)).limit(1))[0];
      const n = left && left.closedAt === null ? left.remaining : 0;
      return { ok: false as const, code: 409, error: `Only ${n} remain at that stall.` };
    }
    const remaining = claimed[0].remaining;

    const seller = await sellerFacts(tx, sellerId, ctx.worldId, now);
    const buyer = await sellerFacts(tx, ctx.playerId, ctx.worldId, now);
    const total = listing.price * qty;
    const tax = marketTax(total, seller.classId === MARKET_TAX_EXEMPT_CLASS);
    const net = total - tax;

    // Guarded buyer debit; a short wallet throws so the claim above rolls back.
    const wallet = await debitDrachmae(tx, ctx.playerId, total);
    if (wallet === null) throw new SpendRejected({ ok: false, code: 402, error: `You need ${total} drachmae for that.` });
    await creditDrachmae(tx, sellerId, net);
    if (tax > 0) await creditWorldTreasury(tx, ctx.worldId, tax);

    // Bank the buyer's pending output first so a freshly created good row cannot
    // reset an accrual marker (the vendor buy path settles the same way).
    const rows = await flipActivations(tx, await ownedRows(tx, ctx.playerId), now);
    await settleGoods(tx, ctx, rows, now);
    const goodRow = await getOrCreateResource(tx, ctx.playerId, listing.good, now);
    const balance = await creditResource(tx, goodRow.id, qty);

    const chronicle: MarketChroniclePayload = {
      listingId,
      good: listing.good,
      goodLabel: goodLabel(listing.good),
      qty,
      price: listing.price,
      total,
      tax,
      net,
      sellerName: seller.seller.name,
      sellerHouseName: seller.seller.houseName,
      buyerName: buyer.seller.name,
      buyerHouseName: buyer.seller.houseName,
      source: "market",
    };
    const entries = [
      { characterId: seller.characterId, kind: "market_sale" },
      { characterId: buyer.characterId, kind: "market_purchase" },
    ].filter((e): e is { characterId: string; kind: string } => e.characterId !== null);
    if (entries.length > 0) {
      await tx.insert(effectLog).values(entries.map((e) => ({ characterId: e.characterId, kind: e.kind, detail: { ...chronicle, chronicle }, createdAt: now })));
    }

    return { ok: true as const, qty, total, tax, wallet, balance, remaining };
  });
}

export type CancelResult = MarketError | { ok: true; returned: number; balance: number };

// POST /api/market/cancel — close one of your own stalls and take back what remains.
export async function cancelListing(ctx: ActingContext, listingId: string, now: Date): Promise<CancelResult> {
  return spendTransaction(ctx.playerId, async (tx) => {
    const claimed = await tx
      .update(marketListings)
      .set({ closedAt: now })
      .where(and(eq(marketListings.id, listingId), eq(marketListings.sellerPlayerId, ctx.playerId), isNull(marketListings.closedAt)))
      .returning({ remaining: marketListings.remaining, good: marketListings.good });
    if (!claimed[0]) return { ok: false as const, code: 404, error: STALL_GONE };
    const { remaining, good } = claimed[0];
    const goodRow = await getOrCreateResource(tx, ctx.playerId, good, now);
    const balance = await creditResource(tx, goodRow.id, remaining);
    return { ok: true as const, returned: remaining, balance };
  });
}
