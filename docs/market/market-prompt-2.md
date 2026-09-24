# Market prompt 2: sales and purchases leave the Chronicle

Drafted at HEAD de35798.

## Why

Argiris ruled 24 Sept 2026 that player-market transactions are not part of the Chronicle. The two kinds market prompt 1 added (`market_sale`, `market_purchase`) come out of every Chronicle, past lines included.

## Rulings

1. The Chronicle stops reading `market_sale` and `market_purchase`. `gatherChronicleForCharacter` reads `effect_log` through `CHRONICLE_EFFECT_LOG_KINDS`, so every sale already in production drops out of the Chronicle with the deploy. No migration, no production write.
2. `buyListing` keeps writing both `effect_log` rows (same kinds, same characters, same flat fields): they stay the trade record the `/admin` character log shows. Only the nested `chronicle` block goes; `detail` becomes the flat object.
3. The payload type leaves the chronicle module: `MarketChroniclePayload` becomes `MarketTradeDetail` in `packages/shared/src/market.ts`, same fields.
4. `TYPE_ORDER` loses 18 and 19; `story_line` stays at 20 (only the relative order is read, `chronicle.ts:487`).
5. Nothing else changes: tax, stalls, the Player market tab, the wording of every other Chronicle kind.

## Scope fence

Touch only:
- `packages/shared/src/chronicle.ts`
- `packages/shared/src/market.ts`
- `packages/shared/src/chronicle.test.ts`
- `packages/db/src/chronicle.ts`
- `packages/db/src/chronicle.test.ts`
- `apps/server/src/services/market.ts`
- `apps/server/src/services/market.test.ts`
- `apps/web/src/api.ts`
- `apps/web/src/dashboard/panels/FamilyPanel.tsx`
- `apps/web/test/chronicle-entry.test.tsx`
- `docs/market/market-prompt-2.md` (this prompt, verbatim)

Do not touch migrations, content, `MarketPanel.tsx`, `docs/market/market-prompt-1.md`, `AGENTS.md`, or any other Chronicle kind.

## Phase 1: recon, no writes

Confirm at HEAD:
- `packages/shared/src/chronicle.ts`: union members 65-66 with their comment 63-64; `ChronicleInput.market` 159-161; `ChronicleMarketKind` 171; `ChronicleEffectLogKind` 173; allowlist entries 178-179; `isChronicleMarketKind` 182-184; `ChronicleMarketRow` 198-204; `MarketChroniclePayload` 206-222; `TYPE_ORDER` 382-383; the market staging loop 468-470.
- `packages/db/src/chronicle.ts`: imports at 5 and 13; comment 249-250; the `market` array 256; the market branch 264-265; `market,` in the `buildChronicle` call 284.
- `apps/server/src/services/market.ts`: import at 9; `const chronicle: MarketChroniclePayload` at 234; the insert at 254 with `detail: { ...chronicle, chronicle }`.
- `apps/web/src/api.ts` 287-288; `FamilyPanel.tsx` 807-810 (comment and two renderers).
- `grep -rn "market_sale\|market_purchase\|MarketChroniclePayload\|ChronicleMarket\|isChronicleMarketKind" apps packages --include=*.ts --include=*.tsx` (no node_modules) finds nothing outside the fence.

If anything differs in a way that changes this plan, STOP 0 and report. Otherwise carry on.

## Phase 2: one commit

Subject: `chronicle: market sales and purchases leave the Chronicle`

1. `packages/shared/src/market.ts`: add `export type MarketTradeDetail` with the fields of `MarketChroniclePayload`, commented as the flat detail `buyListing` writes on both `effect_log` rows.
2. `packages/shared/src/chronicle.ts`: remove the two union members and their comment, `ChronicleInput.market` and its comment, `ChronicleMarketKind`, the two kinds from `ChronicleEffectLogKind` and `CHRONICLE_EFFECT_LOG_KINDS`, `isChronicleMarketKind`, `ChronicleMarketRow`, `MarketChroniclePayload`, the two `TYPE_ORDER` entries, and the market staging loop in `buildChronicle`.
3. `packages/db/src/chronicle.ts`: drop the two imports, the `market` array, the market branch and `market` in the `buildChronicle` call; the comment at 249-250 loses its market clause. The story and campaign branches stay as they are.
4. `apps/server/src/services/market.ts`: import `MarketTradeDetail`, rename the local `chronicle` to `detail`, insert `detail` flat with no nested block. Kinds, characters and order unchanged.
5. `apps/web/src/api.ts`: remove the two union members. `FamilyPanel.tsx`: remove the market comment and the two renderers.
6. Tests:
   - `packages/shared/src/chronicle.test.ts`: delete the "player market" describe (301-341). In the story-lines case at 361, drop `marketPayload` and the market row, expect `["story_line", "story_line"]`, drop ", after the market kinds" from its name and the TYPE_ORDER comment. Add one case asserting `CHRONICLE_EFFECT_LOG_KINDS` equals `["map_action", "holding_reverted", "holding_tribute", "story_line"]`.
   - `packages/db/src/chronicle.test.ts`: the case at 47 becomes "skips market_sale and market_purchase rows, even with a detail.chronicle block": insert the same three rows (the first two shaped like production's existing rows, block included) and expect `[]`. The header comment says story_line rows reach the Chronicle and market rows no longer do.
   - `apps/server/src/services/market.test.ts`: the case at 161 is renamed to end "writes both trade rows"; lines 199-200 expect `detail` flat (`toEqual(detail)`) and `not.toHaveProperty("chronicle")`.
   - `apps/web/test/chronicle-entry.test.tsx`: the "player market" describe becomes one case: an old `market_sale` entry (cast the way line 17 casts an unknown kind) renders `""`.
7. Gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit, ending `GATE GREEN: HEAD <sha>, tree clean`, with the DB-gated suites run, not skipped.

## STOP 1: report, nothing pushed

- `Committed: <SHA> <subject>`
- The gate's last line and the suite counts (shared, server, db, web, worker).
- The recon grep re-run at HEAD: `MarketChroniclePayload`, `ChronicleMarket` and `isChronicleMarketKind` return nothing; `market_sale` / `market_purchase` remain only in `apps/server/src/services/market.ts`, its test, `packages/db/src/chronicle.test.ts` and `apps/web/test/chronicle-entry.test.tsx`.
- Rulings for Argiris: every departure from this prompt, with the reason.

The push comes in a separate prompt.
