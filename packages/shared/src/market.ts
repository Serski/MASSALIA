// ---------------------------------------------------------------------------
// The player market (market prompt 1): pure rules shared by the server service
// and the client form. Sell-only stalls, escrowed stock, a tenth of every sale
// to the city treasury, Traders exempt.
// ---------------------------------------------------------------------------

// Open stalls one player may keep at once. Stalls never expire.
export const MARKET_STALL_CAP = 10;

// Per-unit price bounds (whole drachmae) and per-listing quantity bounds.
export const MARKET_PRICE_MAX = 10_000;
export const MARKET_QTY_MAX = 1_000;

// The character class that pays no agora tax on its sales.
export const MARKET_TAX_EXEMPT_CLASS = "trader";

// The city's cut of one sale: a tenth of the total, rounded down; nothing for an
// exempt seller. The buyer always pays the full total; the seller nets the rest.
export function marketTax(total: number, exempt: boolean): number {
  return exempt ? 0 : Math.floor(total / 10);
}

// The flat detail buyListing writes on both effect_log rows of one sale (the
// seller's market_sale, the buyer's market_purchase): the trade record the admin
// character log shows. `net` is what the seller received (total − tax); the buyer
// paid `total`.
export type MarketTradeDetail = {
  listingId: string;
  good: string;
  goodLabel: string;
  qty: number;
  price: number;
  total: number;
  tax: number;
  net: number;
  sellerName: string;
  sellerHouseName: string;
  buyerName: string;
  buyerHouseName: string;
  source: "market";
};
