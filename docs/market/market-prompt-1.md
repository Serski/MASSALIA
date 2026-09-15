# MASSALIA — Player market, prompt 1: stalls

Read `AGENTS.md` first. Pull `main` (baseline `1ab3192`). Commit locally only. Do not push. Web changes ship only with a render test.

## What this prompt builds

A third tab in the Market panel, **Player market**, where a player lists goods from their own stock at a price they set, and any other player buys some or all of it. Sell-only listings, escrowed stock, immediate settlement into the seller's wallet, a tenth of every sale to the city treasury, Traders exempt. Ten open stalls per player, no expiry. Server: one table, one service, four routes. Client: one tab, two Chronicle lines.

Save this prompt as `docs/market/market-prompt-1.md` in the first commit.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- `apps/web/src/dashboard/panels/MarketPanel.tsx`: `tab` state at line 173 is `useState<"goods" | "people">("goods")`; `SheetTabs` at 243–250; `load()` at ~181 fetches catalog, mine, people and `api.state()` in one `Promise.all`; `act()` at ~195 reloads and calls `onRefresh()`; `GoodsMarketRow` (73–121) is the row pattern, `QtyStepper` comes from `dashboard/shared.tsx:321`, `GoodGlyph` is used at 267, `marketGroup` (line 12) buckets goods, `label()` at 225 reads `catalog.goodLabels`.
- `apps/server/src/services/buildings.ts`: `spendTransaction` (243, not exported), `SpendRejected` (exported), `readWallet` (255), `debitDrachmae` (262, exported), `creditDrachmae` (271, not exported; a second copy lives in `holdings.ts:60`), `debitResource` (282, guarded in SQL), `creditResource` (291), `getOrCreateResource` (206), `ownedRows` (165), `flipActivations` (178), `settleGoods` (483, exported). `vendorTrade` (1311): its sell branch (settle, guarded stock debit, wallet credit) is the escrow path to copy. World treasury upsert pattern at 517–519 (`worldTreasury.balance + amount`, `onConflictDoUpdate`). `ActingContext` (153) and `buildingContext` (155).
- `apps/server/src/routes/buildings.ts`: the `acting(userId)` helper (22–32: `requireAuth`, `getActiveWorldId`, `getActivePlayer`, `ensureCharacterRow`, `buildingContext`) and the `/vendor` handler (109–130) are the route pattern. Routes register in `apps/server/src/index.ts:145`.
- Wallet is `player_characters.drachmae` (integer). A Trader is `player_characters.class_id = 'trader'`. House name is `houses.name` through `house_slug`. The seller's current character row comes from `findCharacterRow(playerId, worldId, tx)` in `services/character.ts`.
- Vendor orientation (`packages/shared/src/buildings.ts:275`): `VendorPrice.buy` is what the player pays the agora, `VendorPrice.sell` is what the agora pays the player, both seasonal. The Goods tab prints them as `buy Xdr · sell Ydr`.
- Portrait: `agedPortrait(character, now)` is a private function in `routes/lobby.ts:72` (`currentAge` + `portraitFor` + `portraitUrl`); the client renders it with `LobbyPortrait({ portrait, faceId, professionSlug, name, size })` from `apps/web/src/lobby/LobbyPortrait.tsx`, house crest with `HouseCrest({ house })` from `dashboard/shared.tsx:832`, house name as `titleCase(slug)` the way Standings does. `faceId` and `professionSlug` are on `players`.
- Chronicle: `chronicleRenderers` in `dashboard/panels/FamilyPanel.tsx` (~740–807), keyed by `effect_log.kind`, payload = `detail`; `gift_received` is the precedent for a line naming another player and their house (`p.actorName`, `p.houseName`). Test: `apps/web/test/chronicle-entry.test.tsx`.
- Lock: `lockPlayer(tx, playerId)` in `services/lock.ts:34` (`pg_advisory_xact_lock(hashtext(id))`), re-entrant within a transaction.
- Migrations: append-only SQL, `IF NOT EXISTS`, `gen_random_uuid()`; last is `0057_town_holdings.sql`; Drizzle schema in `packages/db/src/schema.ts`.
- Tests: server suites gate on `describe.runIf(dbUrl.includes("_test"))` (`buildings.test.ts:14–15`); web render tests live in `apps/web/test/` with `// @vitest-environment jsdom` (`barracks-panel.test.tsx` is the model).

## Rulings

1. **Tab.** A third `SheetTabs` entry after People, id `player`, label `Player market`.
2. **Sell-only listings.** A player lists N whole units of one good at an integer price per unit. There are no buy orders. A buyer fills any part of a listing (buy 5 of 20).
3. **Escrow.** Listing debits the stock at once (settle first, then the guarded SQL debit, exactly the `vendorTrade` sell path). A listing can never be sold twice or sold to the agora meanwhile. Cancel returns whatever remains.
4. **Settlement.** The buyer pays `price × qty` from their wallet; the seller's wallet is credited in the same transaction, online or not. No inbox, no seller settle, nothing to run at rollover.
5. **Agora tax.** The city takes `floor(total / 10)` drachmae from every sale into `world_treasury`; the seller receives the rest. A seller whose character class is `trader` pays no tax. The buyer always pays the full total.
6. **Free pricing.** No floor, no ceiling. The listing form shows the agora's current band for the chosen good so the seller can price against it.
7. **Ten stalls, no expiry.** A player may hold at most 10 open listings. Listings never expire and nothing sweeps them.
8. **What can be listed.** Any good in `content/buildings/buildings.json` `vendor` (all 21, ships and poison included). People cannot be listed.
9. **Who you are buying from.** Every row shows the seller's portrait, name and house. The server refuses a purchase of your own listing; the client shows Cancel on your own rows instead of Buy.
10. **Chronicle.** One line on each side of a sale: `market_sale` on the seller's character, `market_purchase` on the buyer's.

11. **Bounds.** `price` is 1 to 10,000 per unit and `qty` is 1 to 1,000 per listing. The client's price input and stepper enforce the same limits; the server rejects anything outside them with a 400.

## Phase 0: recon

Confirm the facts above and locate: the wallet field in the `/me/state` payload the panel already loads (for the buy stepper's wallet clamp), the `GoodGlyph` source, and where `gift_received` writes `houseName`. Report in the final report. **STOP 0 only on a contradiction.**

## Phase 1: table and rules

Migration `packages/db/migrations/0058_market_listings.sql`, idempotent, one transaction:

```sql
CREATE TABLE IF NOT EXISTS market_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  seller_player_id uuid NOT NULL REFERENCES players(id),
  good text NOT NULL,
  remaining integer NOT NULL CHECK (remaining >= 0),
  price integer NOT NULL CHECK (price >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS market_listings_open_idx ON market_listings (world_id, good) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS market_listings_seller_open_idx ON market_listings (seller_player_id) WHERE closed_at IS NULL;
```

Schema: `marketListings` in `packages/db/src/schema.ts`, exported like the rest.

Shared: `packages/shared/src/market.ts`, exported from the package index: `MARKET_STALL_CAP = 10`, `MARKET_PRICE_MAX = 10_000`, `MARKET_QTY_MAX = 1_000`, `marketTax(total: number, exempt: boolean): number` (`exempt ? 0 : Math.floor(total / 10)`), `MARKET_TAX_EXEMPT_CLASS = "trader"`. Unit test: tax on 9, 10, 19, 20, 45, and exempt.

Gates: `pnpm -r lint`, db and shared builds, shared tests, the migration applied to a throwaway Postgres and to `massalia_test`.

Commits: `db: market_listings`, `shared: player market rules`.

## Phase 2: server

**Portrait resolver.** Move `agedPortrait` out of `routes/lobby.ts` into `services/age.ts` as an exported `agedPortraitFor(character, now)` with the same body; lobby imports it; no behaviour change.

**Helpers.** Export `spendTransaction`, `creditDrachmae`, `debitResource`, `creditResource`, `getOrCreateResource`, `ownedRows`, `flipActivations` from `buildings.ts`. Do not add a third `creditDrachmae`. Add `spendTransactionFor(playerIds: string[], fn)` beside `spendTransaction`: same shape, takes `lockPlayer` for each id in ascending string order (two players in a buy, locked in a fixed order so two crossing purchases cannot deadlock); `spendTransaction(id, fn)` becomes `spendTransactionFor([id], fn)`.

**Service** `apps/server/src/services/market.ts`:

- `marketView(ctx, now)`: read-only, no settle. All open listings of the world (`closed_at IS NULL`, `remaining > 0`), each with `id, good, remaining, price, createdAt, mine` and `seller: { playerId, name, houseSlug, houseName, professionSlug, faceId, portrait }` (portrait through `agedPortraitFor` on the seller's `findCharacterRow`), sorted by good then price ascending then `created_at` ascending; plus `open` (the viewer's open count), `cap`, `taxExempt` (viewer's class is the exempt class).
- `listGood(ctx, good, qty, price, now)`: 400 on a non-integer or out-of-bounds qty or price; 404 when `good` is not in `vendor`; inside `spendTransaction(seller)`: count open listings, 409 at the cap; `flipActivations(ownedRows)` → `settleGoods` → `getOrCreateResource` → `debitResource(row, qty)`, null → 409 `You hold only N <label>.` (the vendor wording); insert the listing. Returns `{ ok, listing, balance }`.
- `buyListing(ctx, listingId, qty, now)`: 400 on a bad qty; read the listing, 404 when unknown or closed; 409 when the seller is the buyer (`That is your own stall. Cancel it instead.`); inside `spendTransactionFor([buyer, seller])`: claim-first guarded decrement `UPDATE market_listings SET remaining = remaining - qty, closed_at = CASE WHEN remaining - qty = 0 THEN now ELSE NULL END WHERE id = $1 AND closed_at IS NULL AND remaining >= qty RETURNING remaining`, no row → 409 `Only N remain at that stall.` (re-read for N); `total = price × qty`, `tax = marketTax(total, sellerIsTrader)`; `debitDrachmae(buyer, total)`, null → throw `SpendRejected` 402 `You need N drachmae for that.` so the claim rolls back; `creditDrachmae(seller, total - tax)`; world treasury upsert `+tax` when tax > 0; `creditResource` on the buyer's `getOrCreateResource(good)`; two `effect_log` rows, `market_sale` on the seller's character and `market_purchase` on the buyer's, detail `{ listingId, good, goodLabel, qty, price, total, tax, net, sellerName, sellerHouseName, buyerName, buyerHouseName, source: "market" }`. Returns `{ ok, qty, total, tax, wallet, balance, remaining }`.
- `cancelListing(ctx, listingId, now)`: inside `spendTransaction(seller)`: claim `UPDATE … SET closed_at = now WHERE id = $1 AND seller_player_id = me AND closed_at IS NULL RETURNING remaining, good`, no row → 404 `That stall is gone.`; `creditResource` the remainder back to the seller's good row. Returns `{ ok, returned, balance }`.

Money and stock writes stay relative and guarded (AGENTS.md invariants); the listing decrement is the claim that makes two simultaneous buyers safe, the same lesson as the numeric-stock guard.

**Routes** `apps/server/src/routes/market.ts`, registered at `/api/market` in `index.ts`, the `acting()` helper copied from `routes/buildings.ts`:

- `GET /api/market` → the view.
- `POST /api/market/list` `{ good, qty, price }`.
- `POST /api/market/buy` `{ listingId, qty }`.
- `POST /api/market/cancel` `{ listingId }`.

Error codes: 400 validation, 402 short wallet, 404 unknown good or stall, 409 stock short, cap reached, own stall, stall short.

### Tests

`apps/server/src/services/market.test.ts`, DB-gated like `buildings.test.ts`, seeding its own world and three players (a Landowner seller, a Trader seller, a buyer): list escrows stock (balance drops by qty, listing row exists) and a second settle does not restore it; list rejects an over-stock qty (409, nothing written), an unknown good (404), a pop type (404), and the 11th stall (409); buy moves the goods to the buyer, pays the seller `total - tax`, puts `tax` in `world_treasury`, writes both `effect_log` rows with the expected detail; a Trader seller receives the full total and the treasury is unchanged; buy rejects the seller's own listing (409), a short wallet (402, listing unchanged, nothing written), a qty above `remaining` (409); a partial buy leaves `remaining` and the listing open, a full buy closes it; cancel returns the remainder and closes, a second cancel and a buy on a closed listing are 404; a race: two `buyListing` calls for the last unit of one listing run with `Promise.all`, exactly one succeeds and the other is 409, stock and wallets add up. Route smoke: `app.inject()` for the four endpoints with a minted session, 401 without.

Gates: `pnpm -r lint`, server tsc, server, db and shared suites against a migrated `massalia_test`.

Commits: `server: share the aged-portrait resolver`, `market: listings service and routes`, `market: service and route tests`.

**STOP 1.** Paste `buyListing` in full and the listing decrement SQL. Wait.

## Phase 3: client

`apps/web/src/api.ts`: `MarketView`, `MarketListing`, `api.market()`, `api.marketList(good, qty, price)`, `api.marketBuy(listingId, qty)`, `api.marketCancel(listingId)`.

`MarketPanel.tsx`: the tab type becomes `"goods" | "people" | "player"`; `api.market()` joins the `load()` `Promise.all` (a cheap read, refreshed by `act()` after every action like the rest). The tab renders, top to bottom:

- One line of copy under the tab header: `Citizens sell to citizens here, at their own price. The city takes one drachma in ten from every sale; Traders pay nothing.`
- **Sell** form: a good select listing every `catalog.vendor` good the player holds at least one whole unit of (label via `label()`, glyph via `GoodGlyph`, holding shown as `own N`); a `QtyStepper` clamped to `Math.floor(balances[good])`; an integer price input (min 1); a band line for the chosen good, `The agora pays {sell}dr · charges {buy}dr` from the same `VendorPrice` the Goods tab uses; a button `List {n} · {p}dr each`. `Your stalls: {open} of {cap}` beside the heading; at the cap the button is disabled with `Ten stalls is the most one house may keep.` in the note line.
- **Stalls**: every open listing in the world, grouped with `marketGroup` and headed like the Goods tab, rows sorted as the server sends them. A row: `GoodGlyph`, title `{label} · {remaining} at {price}dr`, sub line `LobbyPortrait` (size 24) + `{name} of House {houseName}` + `HouseCrest`. Action on another player's row: `QtyStepper` clamped to `min(remaining, floor(wallet / price))` and `Buy {n} · {n × price}dr`, disabled when the wallet cannot cover one unit. Action on the player's own row: a `Your stall` tag and `Cancel`, which runs `marketCancel` and notes `{returned} {label} returned to your stores.`. Empty state: `No stalls yet.`
- Notes after actions: `Listed {n} {label} at {p}dr each.`, `Bought {n} {label} for {total}dr.`; server errors surface as they are, like hire.

`FamilyPanel.tsx` `chronicleRenderers`:

- `market_sale`: `Sold {qty} {goodLabel lowercased} to {buyerName} of House {buyerHouseName} for {net} drachmae.` with ` The city took {tax}.` appended when `tax > 0`.
- `market_purchase`: `Bought {qty} {goodLabel lowercased} from {sellerName} of House {sellerHouseName} for {total} drachmae.`

Render test `apps/web/test/market-panel.test.tsx` on the model of `barracks-panel.test.tsx`, `MarketPanel` mounted against a mocked API on the Player market tab: the sell select offers only held goods; the qty stepper clamps to the floored holding; at 10 open stalls the List button is disabled with the reason; another player's row shows Buy with the stepper clamped to remaining and to the wallet; the player's own row shows Cancel and no Buy; a mocked buy re-renders with the new remaining; no hook-order warning across every render (the React #310 lesson). Add the two lines to `chronicle-entry.test.tsx`.

Gates: `pnpm -r lint`, web tsc, web build, web tests, plus the server suite.

Commit: `web: Player market tab`.

**STOP 2.** Final report. Wait. Do not push.

## Scope fence

`packages/db/migrations/0058_market_listings.sql`, `packages/db/src/schema.ts`, `packages/shared/src/market.ts` and the package index, `apps/server/src/services/market.ts`, `services/age.ts`, `services/buildings.ts` (exports and `spendTransactionFor` only, no logic change to any existing function), `routes/market.ts`, `routes/lobby.ts` (import swap only), `apps/server/src/index.ts` (one register line), their tests, `docs/market/market-prompt-1.md`; `apps/web/src/api.ts`, `dashboard/panels/MarketPanel.tsx`, `dashboard/panels/FamilyPanel.tsx` (the two renderers only), `dashboard/dashboard.css` if a class is needed, `apps/web/test/`. No changes to `buildings.json`, vendor bands, seasonal coefficients, pops, Barracks, the map, or `apps/web/public/**`. No expiry, no sweep, no buy orders, no price floor, no new balance rules. Player-facing copy beyond what is written here is new copy: list it in the report.

## Final report template

As 3c, plus:

```
MARKET
migration 0058 applied: throwaway / massalia_test
race test: N runs, 1 success 1 rejection every run
sample chronicle lines: sale (taxed) / sale (trader) / purchase
NEW PLAYER-FACING COPY: every string not quoted in this prompt
RECON: wallet field in /me/state, GoodGlyph source, gift_received houseName source
Committed: <SHA> per commit, in order
```

## STOP 0 rulings

Recon found that the Chronicle is not keyed by `effect_log.kind` directly: entries are a projection built in `packages/shared/src/chronicle.ts`, and `packages/db/src/chronicle.ts` reads only an allowlist of `effect_log` kinds through a nested `detail.chronicle` block. Rulings:

1. The scope fence widens to `packages/shared/src/chronicle.ts` (`market_sale` and `market_purchase` in the `ChronicleType` union and in `TYPE_ORDER` at 18 and 19, the effect_log kind widened), `packages/db/src/chronicle.ts` (both kinds in the allowlist, read through the nested `chronicle` block the way the campaign rows are), and one shared plus one db chronicle test covering both kinds.
2. The `effect_log` detail keeps every field listed in Phase 2 and nests the same fields under `chronicle`.
3. The agora tax uses the exported `creditWorldTreasury` (`services/buildings.ts:513`) instead of copying the upsert.
4. The client reads the wallet from `s.resources.drachmae` of `/me/state`.
