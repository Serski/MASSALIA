# Economy, prompt 1: double income, double soldier's pay, dearer ships, double plunder and tribute

## What this builds

Four content changes, one commit each, with the tests and the hand-typed class cards that pin the old numbers moved to the new ones. No source change outside test files and the class cards in `packages/shared/src/league.ts`. No migration.

1. Every class building earns twice the drachmae it did.
2. The Hoplite's pay doubles, at home (the four ranks) and abroad (the five contracts).
3. Ships cost half as much again at the vendor, and the vendor pays a fifth more when he buys one back.
4. A raid's plunder and a held town's tribute pay twice the drachmae.

The Slave has no class building and no salary and is not touched.

Rulings (Argiris, 3 Oct 2026):

- Class building drachmae income x2 for all six classes. Hoplite home salary x2. The Slave stays as it is; its card keeps "0 dr/day · earn your freedom".
- Contracts abroad x2 as well, so the lowest contract still tops a recruit's home pay, the rule `packages/shared/src/military.test.ts` asserts.
- Ships: the vendor's asking price rises 50 percent (Pentekonter 60 to 90, Trireme 120 to 180). The buy-back rises 20 percent, not 50 (30 to 36, 60 to 72). Crafting is instant and the vendor trades without limit, so a buy-back above the asking price of a ship's recipe is free money for a tier 3 or tier 4 yard. At a flat 50 percent a Trireme's recipe costs 109 in Winter and the hull sells back for 113, and recipes bought in Summer sell back in Winter for 8 more per Pentekonter and 23 more per Trireme. 36 and 72 are the highest buy-backs with no such pair of seasons. Section "The ship band" gives the arithmetic.
- Raid plunder x2 in drachmae: 20 to 40 a kill. The town multiplier of 2 stays, so a town raid pays 80 a kill. Town tribute x2: 4 to 8 drachmae a day per hundred people (Reii 60 to 120, Vienna 120 to 240, Nemausus 160 to 320, Tolosa 320 to 640). The grain a raid takes (5 a kill), the garrison a town needs to pay (one man per hundred people) and a held region's grain, timber and levy stay.
- Drachmae only. Goods yields, every other vendor band, craft recipes, seasonal coefficients, materials, staffing, wages, upkeep, build costs and days, the commons, starting drachmae, rank and contract gates, the militia trickle, contract terms and risk stay as they are.
- No back-pay and no migration. Content is read at every settle, so from the deploy on every standing building and every serving hoplite earns at the new rate. Whatever is accrued and not yet settled at the deploy is paid at the new rate too: building income since the last settle, salary since the last collect, the uncollected part of a contract term, a town's whole tribute days not yet settled. Accepted.
- The `professions` rows in production keep their old `income` text, because `packages/db/src/seed.ts` inserts them with `onConflictDoNothing`. No player screen reads that column: the client builds the class cards from the bundled `professions` array. Left alone, no production write.
- The payback guardrail in `packages/shared/src/buildings.test.ts` stays green and only its comment moves. A second guardrail joins it for the ships: in no pair of seasons does the vendor's buy-back for a crafted ship beat his asking price for its recipe.

## The numbers

Class buildings, `income` at tier 1 in `content/buildings/buildings.json` (upper tiers follow `YIELD_GROWTH` on their own):

| Class | Building | Now | New |
|---|---|---|---|
| Landowner | estate | 6.0 | 12.0 |
| Priest | sanctuary | 7.2 | 14.4 |
| Trader | emporion | 9.6 | 19.2 |
| Philosopher | school | 10.8 | 21.6 |
| Hetaira | salon | 10.8 | 21.6 |
| Shipbuilder | slipway | 8.4 | 16.8 |

Hoplite, `salaryPerDay` in `content/military/ranks.json`: recruit 8 to 16, veteran 16 to 32, lochagos 28 to 56, archilochagos 45 to 90.

Contracts, `dailyDrachmae` in `content/military/contracts.json`: trade-ship 12 to 24, gaul-caravan 16 to 32, syracuse 22 to 44, carthage 30 to 60, ptolemy 42 to 84.

Ships, `vendor` in `content/buildings/buildings.json`: `trade-ship` sell 60 to 90 and buy 30 to 36; `galley` sell 120 to 180 and buy 60 to 72.

War, `content/military/battle.json`: `raid.plunderPerKill` 20 to 40; `tribute.perPopulation` 0.04 to 0.08.

Class cards in `packages/shared/src/league.ts`, the drachmae figure of each tier (whole drachmae, `Math.round(income × 1.8^(tier − 1))`, as the dashboard shows it):

| Class | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| Landowner | 6 to 12 | 11 to 22 | 19 to 39 | 35 to 70 |
| Trader | 10 to 19 | 17 to 35 | 31 to 62 | 56 to 112 |
| Priest | 7 to 14 | 13 to 26 | 23 to 47 | 42 to 84 |
| Philosopher | 11 to 22 | 19 to 39 | 35 to 70 | 63 to 126 |
| Shipbuilder | 8 to 17 | 15 to 30 | 27 to 54 | 49 to 98 |
| Hetaira | 11 to 22 | 19 to 39 | 35 to 70 | 63 to 126 |
| Hoplite | 8 to 16 | 16 to 32 | 28 to 56 | 45 to 90 |

Payback at tier 1 on the new income, by the arithmetic already in the guardrail comment: salon 115 ÷ 19.6 = 5.9 days, slipway 143 ÷ 21.8 = 6.6, emporion 133 ÷ 17.2 = 7.7, school 159 ÷ 18.6 = 8.5, estate 141 ÷ 16 = 8.8, sanctuary 187 ÷ 19.4 = 9.6. The commons do not move (timber lot 24.2, poultry yard 26.7, vineyard 27.4, horse farm 50.7, bull farm 65.0), so the slowest class building (9.6) is still faster than the fastest common (24.2).

## The ship band

Prices are `vendorUnitPrice`: `Math.max(1, Math.round(base × the season's price coefficient for the good's category))`, the player buying at `sell` and selling at `buy`. Both ships and timber and leather are `agricultural` (Winter 1.25, Spring 1.05, Summer 0.85, Autumn 0.95); naval-supplies and iron are `yearround` (1.05, 1.0, 0.98, 1.0).

| | Winter | Spring | Summer | Autumn |
|---|---|---|---|---|
| Pentekonter, asking (90) | 113 | 95 | 77 | 86 |
| Pentekonter, buy-back (36) | 45 | 38 | 31 | 34 |
| Pentekonter recipe at asking prices | 63 | 54 | 48 | 54 |
| Trireme, asking (180) | 225 | 189 | 153 | 171 |
| Trireme, buy-back (72) | 90 | 76 | 61 | 68 |
| Trireme recipe at asking prices | 109 | 98 | 90 | 98 |

The rule: the highest buy-back of the year (Winter) does not exceed the cheapest recipe of the year (Summer). Pentekonter 45 against 48; Trireme 90 against 90, level and no profit. A yard that makes its own naval supplies and timber still earns more per hull than before: against the recipe valued at buy-back prices a Pentekonter clears 11 in Spring (was 5) and a Trireme 27 (was 14).

## Phase 0: recon (no code)

Line numbers are at `6818d29`. Confirm each reference. If any is not as described, STOP 0 with the mismatch before writing anything.

- `content/buildings/buildings.json`: `classBuildings` `income` at 40 (landowner 6.0), 77 (priest 7.2), 120 (trader 9.6), 165 (philosopher 10.8), 203 (hetaira 10.8), 242 (shipbuilder 8.4). `vendor["trade-ship"]` sell 60 buy 30 (499 to 502), `vendor.galley` sell 120 buy 60 (503 to 506). `vendor`: naval-supplies 14 and 7, timber 4 and 2, leather 6 and 3, iron 8 and 4. `craft`: trade-ship is 2 naval-supplies, 5 timber, 1 leather at slipway tier 3; galley is 3 naval-supplies, 8 timber, 3 iron at tier 4. `seasonal.goodCategory` and the price coefficients as in "The ship band".
- `content/military/ranks.json`: `salaryPerDay` 8, 16, 28, 45 (3 to 6). `content/military/contracts.json`: `dailyDrachmae` 12, 16, 22, 30, 42 (9 to 13).
- `packages/shared/src/league.ts`: `professions` (75); the `income` string and four `tiers` of landowner (84 to 89), trader (101 to 106), priest (118 to 123), philosopher (135 to 140), shipbuilder (152 to 157), hetaira (169 to 174), hoplite (186 to 191); the slave's `income` (203). `apps/web/src/CharacterCreation.tsx` renders `profession.income` (178) and `tier.benefit` (200).
- `packages/shared/src/buildings.test.ts`: the vitest import (4), `goodPerDay` in the import list (12), `vendorUnitPrice` and `craftRawCost` already imported, `seasonal` defined (41); the guardrail comment's class lines (155 to 156); `toBe(7.2)` (207), `toBeCloseTo(12.96, 6)` (211); the trader case title "drachmae income 7 + wine stock" (252), `toBe(9.6)` (255); `toBe(10.8)` twice (266, 267); `toBe(8.4)` (279); the ship band case (286) with `sell).toBe(60)` (292) and `sell).toBe(120)` (293); the CRAFT RULE case (325 to 333); the pops case after it (335). `packages/shared/src/buildings.ts` exports `vendorUnitPrice` (268) and `goodCategoryFor` (280); `packages/shared/src/calendar.ts` exports `SEASON_NAMES` (13).
- `packages/shared/src/military.test.ts`: `[8, 16, 28, 45]` (49); `toBe(24)` (67); the "1/8 day" comment and `MS_PER_GAME_DAY / 16` (73, 74); the veteran comment (79) and `toBe(32)` (83); the contract comment (90) and `[12, 16, 22, 30, 42]` (92); `toBe(6)`, `toBe(12)`, `toBe(168)` with their comments (107 to 113).
- `apps/server/src/services/buildings.test.ts`: comments naming 10.8 (196), 7.2 (259), "6–7/day" (322), 8.4 (357, 360, 412), 9.6 (538); `toBeGreaterThanOrEqual(5)` (260), `toBeLessThanOrEqual(8)` (261), `toBeGreaterThan(8)` (357), `toBe(8)` (360).
- `apps/server/src/services/service.test.ts`: 24 at 90, 95, 97, 103 with the comment at 87; `toBe(8)` (148) with the comment at 143; `drachmae: 32` (153), `toBe(40)` (155) with the comment at 151.
- `apps/server/src/routes/concurrency.test.ts`: comments (217, 218, 236), `drachmae: 24` (234), `toBe(24)` (237).
- `apps/server/src/services/merc.test.ts`: comments (113, 127); `toBe(6)` (129, 138, 139, 186); `toBe(12)` (148, 161, 339); `toBe(16)` (355); `toBe(44)` (367, 389). Line 312 (`before.drachmae + 4`) is a card payout and stays.
- `content/military/battle.json`: `raid` (9) with `plunderPerKill` 20, `grainPerKill` 5, `townPlunderMultiplier` 2; `tribute` (13) with `perPopulation` 0.04, `minGarrisonPerPopulation` 0.01; `regionTribute` (14).
- `packages/shared/src/battle.test.ts`: the `raid` pin (26) and the `tribute` pin (31).
- `apps/server/src/services/mapActions.test.ts`: `killed * 20` in the plunder and the wallet (196, 197); `killed * 20 * 2` (453) and `100 + killed * 40` (454); Reii's `perDay: { drachmae: 60` (534); the Vienna case: the comments naming 120 and 240 (564, 571, 582), `drachmae: 240` (573), `before + 240` (574, 581), `drachmae: 120` (584), `before + 360` (585, 592). Plunder is computed in `apps/server/src/services/mapActions.ts` (472) and the tribute rate in `apps/server/src/services/holdings.ts` (136), both read only. The web tests `towns-and-move.test.tsx` and `chronicle-entry.test.tsx` carry made-up payloads (tribute 120, 240) and stay.
- Read only, nothing to change: `apps/server/src/services/buildings.ts` `incomeAtTier` (147), `craft()` (1239, no cooldown and no cap), `vendorTrade` (1326, no quantity cap); `packages/db/src/seed.ts` inserts `professions` with `onConflictDoNothing` (97 to 107).

## Phase 1: class income (one commit)

1. Save this prompt verbatim as `docs/economy/economy-prompt-1.md`.
2. `content/buildings/buildings.json`: the six `income` values as in "The numbers" (write 12.0, 14.4, 19.2, 21.6, 21.6, 16.8). Nothing else in the file in this commit.
3. `packages/shared/src/buildings.test.ts`:
   - 155 to 156, the two class lines of the guardrail comment become three: `// Class (income doubled, ruling 3 Oct 2026): salon 115 ÷ 19.6 = 5.9, slipway 143 ÷ 21.8 = 6.6,` then `// emporion 133 ÷ 17.2 = 7.7, school 159 ÷ 18.6 = 8.5, estate 141 ÷ 16 = 8.8,` then `// sanctuary 187 ÷ 19.4 = 9.6.` The commons lines stay. This adds one line, so every later reference in this file sits one lower.
   - 207: `toBe(14.4); // doubled 3 Oct 2026`. 211: `toBeCloseTo(25.92, 6)`.
   - 252: the title loses its stale figure: `"trader: drachmae income + wine stock from tier 2 (reuses the wine good, scales on the curve)"`. 255: `toBe(19.2)`.
   - 266, 267: `toBe(21.6)`. 279: `toBe(16.8); // doubled 3 Oct 2026`.
4. `apps/server/src/services/buildings.test.ts`:
   - 196: the comment reads `(21.6 dr/day)`.
   - 259: the comment reads `income 14.4/day`. 260: `toBeGreaterThanOrEqual(12)`. 261: `toBeLessThanOrEqual(16)`.
   - 322: the comment reads `// income 19.2 to 21.6 a day pending`; the bound stays.
   - 357: `toBeGreaterThan(16); // income 16.8/day → ~16.8 after one guarded day`. 360: `toBe(17); // round(16.8 income − 0 upkeep)`.
   - 412: the comment reads `16.8 dr/day`. 538: the comment reads `19.2 dr/day`.
5. `packages/shared/src/league.ts`, the six building classes (84 to 174): in each class's `income` string and in each tier's `benefit`, only the number before `dr/day` changes, to the table in "The numbers". The class `income` string carries the tier 1 figure. Goods figures, `upkeep` strings, notes and everything else stay; the Landowner's wheat figures (6, 11, 19, 35) happen to equal its old drachmae figures and do not move. The hoplite and the slave are not in this commit.
6. Check: `pnpm --filter @massalia/shared build`, `pnpm --filter @massalia/shared test` (601 passed), `pnpm --filter @massalia/server exec vitest run src/services/buildings.test.ts` against the `*_test` database (38 passed).

Commit: `economy: class building income doubled`.

## Phase 2: soldier's pay (one commit)

1. `content/military/ranks.json`: `salaryPerDay` 16, 32, 56, 90. Keep the one-line-per-rank layout and its column alignment (the recruit line gives up one of its two spaces after the comma).
2. `content/military/contracts.json`: `dailyDrachmae` 24, 32, 44, 60, 84. Nothing else on those lines.
3. `packages/shared/src/military.test.ts`:
   - 49: `[16, 32, 56, 90]`. 67: `toBe(48); // 16/day × 3`.
   - 73 to 74: the comment reads "1dr every 1/16 day" and the probe is `MS_PER_GAME_DAY / 32` (at 16 a day a sixteenth of a day now earns a whole drachma).
   - 79: the comment reads `32dr/day`. 83: `toBe(64); // 32 × 2 consumed days (not 80) — the 0.5d carries`.
   - 90: `// Lowest contract (24/season) already tops the recruit's 16/day home salary.` 92: `[24, 32, 44, 60, 84]`.
   - 107 to 113: `floor(24 × 0.5) = 12` and `toBe(12)`; `(24 × 1)` and `toBe(24)`; `84 × 4 = 336` and `toBe(336)`.
4. `apps/server/src/services/service.test.ts`: 87 comment `16/day → 48dr`; 90, 95, 97, 103: 24 becomes 48. 143 comment `(16dr)`; 148: `toBe(16)`. 151 comment `32/day` and `64dr`; 153: `drachmae: 64`; 155: `toBe(80); // 16 + 64`.
5. `apps/server/src/routes/concurrency.test.ts`: 217 to 218 comments `16 dr/day` and `48 dr`; 234: `drachmae: 48`; 236 comment `price + 48 − price`; 237: `toBe(48)`.
6. `apps/server/src/services/merc.test.ts`: 113 comment `home salary 32/day` and `foreign 24/season`; 127 comment `24/season → 12`; 129, 138, 139, 186: 6 becomes 12; 148: `toBe(24); // full term 24/season × 1 (12 collected + 12 final)`; 161, 339: 12 becomes 24; 355: `toBe(32)`; 367: `toBe(88)` with `(44×2)` in its comment; 389: `toBe(88)`.
7. `packages/shared/src/league.ts`, the hoplite (186 to 191): `income` and the four `benefit` strings take 16, 32, 56, 90 before `dr/day`; the militia and gate text stays.
8. Check: shared build and suite (601 passed), then `pnpm --filter @massalia/server exec vitest run src/services/service.test.ts src/services/merc.test.ts src/routes/concurrency.test.ts` (35 passed).

Commit: `economy: soldier's pay doubled, at home and abroad`.

## Phase 3: ships (one commit)

1. `content/buildings/buildings.json`, `vendor`: `trade-ship` sell 90 buy 36, `galley` sell 180 buy 72. Nothing else: no other band, no recipe, no category.
2. `packages/shared/src/buildings.test.ts`:
   - Imports: `import { SEASON_NAMES } from "./calendar.js";` under the vitest import, and `goodCategoryFor,` in the `./buildings.js` list above `goodPerDay`.
   - The ship band case: the title ends `(no wider than 3× floor)` in place of `(~2× floor)`; the two `sell` pins become

     ```ts
         // Ruling 3 Oct 2026: asking price +50%, buy-back +20% (see NO VENDOR LOOP below).
         expect(vendor["trade-ship"]).toEqual({ sell: 90, buy: 36 });
         expect(vendor.galley).toEqual({ sell: 180, buy: 72 });
     ```

     The ratio loop above them and the `goodCategory` line below stay.
   - A new case directly after the CRAFT RULE case, before the pops case:

     ```ts
       it("NO VENDOR LOOP — in no pair of seasons does the vendor's buy-back for a crafted ship beat his asking price for its recipe", () => {
         // Crafting is instant and the vendor trades without limit, so a buy-back above the
         // recipe's asking price would be free money for the yard: inside one season, or
         // with the materials bought in the cheap season and the hull sold in the dear one.
         // The tightest pair: a Trireme's recipe bought in Summer (90) against its Winter
         // buy-back (72 × 1.25 = 90).
         for (const [good, c] of Object.entries(content.craft!)) {
           for (const bought of SEASON_NAMES) {
             const recipeCost = Object.entries(c.recipe).reduce((sum, [g, qty]) => sum + qty * vendorUnitPrice(vendor[g]!, "buy", seasonal, goodCategoryFor(seasonal, g), bought), 0);
             for (const sold of SEASON_NAMES) {
               expect(vendorUnitPrice(vendor[good]!, "sell", seasonal, goodCategoryFor(seasonal, good), sold)).toBeLessThanOrEqual(recipeCost);
             }
           }
         }
       });
     ```

3. Prove the new case bites: with `trade-ship` buy 45 and `galley` buy 90 in the working tree it fails (`expected 56 to be less than or equal to 54`); restore 36 and 72 before committing. Report that it was seen red.
4. Check: shared build and suite (602 passed, one more than before).

Commit: `economy: ships cost half as much again; no vendor loop for the yard`.

## Phase 4: plunder and tribute (one commit)

1. `content/military/battle.json`: `raid.plunderPerKill` 40 and `tribute.perPopulation` 0.08. Nothing else in the file.
2. `packages/shared/src/battle.test.ts`: 26: `plunderPerKill: 40`. 31: `perPopulation: 0.08`.
3. `apps/server/src/services/mapActions.test.ts`:
   - 196: `killed * 40` for the drachmae (the grain stays `killed * 5`). 197: `100 + killed * 40`.
   - 453: `killed * 40 * 2` for the drachmae (the grain stays `killed * 5 * 2`). 454: `100 + killed * 80`.
   - 534: Reii's `perDay: { drachmae: 120, grain: 0, timber: 0 }`; `minGarrison: 15` stays.
   - The Vienna case: 564 comment `240 dr a day`; 571 comment `480 dr`; 573: `drachmae: 480`; 574, 581: `before + 480`; 582 comment `pays 240`; 584: `drachmae: 240`; 585, 592: `before + 720`. The garrison figures (30, 29) stay.
4. Check: shared build and suite (602 passed), then `pnpm --filter @massalia/server exec vitest run src/services/mapActions.test.ts src/routes/map.test.ts` (31 passed).

Commit: `economy: raid plunder and town tribute doubled`.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN: HEAD <sha>, tree clean`; a run where the DB-gated suites skip is not green. On these four commits over `6818d29` the counts move by one test only: shared 601 to 602, server 515 unchanged, db, web and worker untouched. No push. Report:

```

Committed: <SHA> economy: class building income doubled
Committed: <SHA> economy: soldier's pay doubled, at home and abroad
Committed: <SHA> economy: ships cost half as much again; no vendor loop for the yard
Committed: <SHA> economy: raid plunder and town tribute doubled
Counts: <shared, server, db, web, worker, each against the count at 6818d29>
Loop case: <seen red on buy 45 and 90, green on 36 and 72>
Gate: <the gate's last line, DB-gated suites confirmed run>
Render check: <the character creation page: the Trader card reads 19 dr/day with tiers 19, 35, 62, 112; the Hoplite card reads 16 dr/day; the Slave card is unchanged>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy check: the Ledger's class ladder shows the doubled tier figures (a Farmstead 12 dr/day, a Boat Shed 17), the owned row that figure times the season's production coefficient; a Recruit's Service row reads 16dr/day; the market vendor asks for a Pentekonter 113 in Winter, 95 in Spring, 77 in Summer, 86 in Autumn, and for a Trireme 225, 189, 153, 171; a held, garrisoned town's card on the Atlas reads the doubled tribute (Vienna 240 dr a day).

```

## Scope fence

Do not touch: goods yields; any vendor band other than `trade-ship` and `galley`; craft recipes; `seasonal` (coefficients, `goodCategory`, the guard days); materials, staffing and `content/people/pops.json`; `COST_TABLE`, `UPKEEP`, `YIELD_GROWTH`, build days; the commons; rank gates and the militia trickle; contract gates, terms, risk, traits and `merc-cards.json`; Barracks units and bands; everything in `content/military/battle.json` other than `plunderPerKill` and `perPopulation` (`grainPerKill`, `townPlunderMultiplier`, `minGarrisonPerPopulation`, `regionTribute` and the rest); the plunder and tribute code in `services/mapActions.ts` and `services/holdings.ts`; starting drachmae; any event, story or dated card payout; the Slave's card and its routines; the settle and accrual code in `services/buildings.ts`, `services/service.ts` and `services/merc.ts`; the craft and vendor code; `packages/db/src/seed.ts`; any web source file; `content/news/news.json` and the guides; `AGENTS.md`. No migration. No production write. No new endpoint. No refactors along the way.

END OF PROMPT

## STOP 1 ruling (4 Oct 2026)

The verbatim text was not kept. The work as shipped in the commits ending 7152e21 is the record.
