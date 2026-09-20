# Buildings, prompt 1: fuller commons and the build bar

## What this builds

Two things. First, three common buildings produce more: the Poultry Yard 6 chicken a day (was 2), the Vineyard 4 wine (was 2), the Timber Lot 4 timber (was 3). Second, every building under construction, class or common, fresh build or upgrade, shows the same live countdown and progress bar the Barracks shows for a unit in training: the clock in hh:mm:ss on the right of the row, the bar under it, the row flipping to active on its own when the clock reaches zero.

Rulings (Argiris, 18 Sept 2026):

- Yields only. Prices, materials, staffing, build days, upkeep, the vendor bands and the seasonal coefficients stay as they are. Yields are read from content at every settle, so every yard, vineyard and lot already standing produces at the new rate from the deploy on; nobody is refunded or back-paid.
- The balance guardrail in `packages/shared/src/buildings.test.ts` encodes the old design note (commons at 20 to 35 percent of the class line by price-only yield value) and goes red on these numbers. It is replaced by the rule the new numbers were chosen against: at tier 1, every class building repays its all-in cost (price, materials, staff hire) faster than every producing common, and no producing common takes longer than 70 days to repay. Section "The guardrail" gives the arithmetic and the expected figures.
- The construction window is derived, not stored: a row's construction began at `completes_at` minus the build time of its current tier (`def.buildDays(tier) × MS_PER_DAY`), the same derivation the income settle already uses for `upgradeStart` in `apps/server/src/services/buildings.ts`. No migration.
- The bar is the Barracks bar. `ProgressBar` and `onDeviceClock` move out of `BarracksPanel.tsx` into `dashboard/shared.tsx` and the Barracks imports them back; class names and CSS unchanged, so the Barracks render tests pass untouched. The building bar advances with the clock (percent from the live seconds left over the window), which the Barracks bar does not; the Barracks is not changed to match.
- Three surfaces show a building under construction and all three change: the owned-building rows of the Ledger, the class building ladder of the Ledger, and the income lines of the Economy sheet. The Ledger rows and the ladder get the clock and the bar. The Economy sheet's income lines keep their one-line form and get the live clock in place of the "ready in 5h" text, no bar.
- Labels: tier 1 reads "Under construction", an upgrade reads "Upgrading to Tier N" (N is the row's `tier`, which is already the target tier while an upgrade runs). `buildCountdown` in `shared.tsx` loses its last callers and is deleted.
- The clock is anchored to the server, as in the Barracks: `GET /api/buildings/mine` gains `now`, the parent computes the offset once per payload, every countdown counts down to the server instant on the device clock.
- One refetch per completion, no polling: the Ledger gets the one-shot timer the Economy sheet already has (refetch when the soonest constructing building lands, at once if the payload is already stale).

## The guardrail

All-in cost of a building at tier 1 = its drachmae price + its tier-1 material bill at the vendor's asking price (`vendor[good].sell`) + the hire cost of its tier-1 staff (`pops[type].hireCost`). Net per day = `income` + each yield's `base × vendor[good].buy` (yields with `fromTier` do not count at tier 1) − staff wages (`upkeepPerDay`) − staff food (`foodPerDay` × the price of grain: `vendor.grain.buy` for a building whose yields include grain, since it feeds its men from its own stock, `vendor.grain.sell` for every other). Payback = all-in ÷ net, in days. Class prices come from `buildingCost(1)` = 25, materials from `buildCost.materials` (`materialCostForTier` at tier 1 is the base), staff from `staffing` (`staffCountForTier` at tier 1 is the base).

Expected on the content as it will stand (the agent verifies these in Phase 1 and reports any that differ):

- Class, tier 1: slipway 143 ÷ 13.4 = 10.7 days, salon 115 ÷ 8.8 = 13.1, estate 141 ÷ 10 = 14.1, sanctuary 187 ÷ 12.2 = 15.3, emporion 133 ÷ 7.6 = 17.5, school 159 ÷ 7.8 = 20.4.
- Producing commons: timber lot 121 ÷ 5 = 24.2, poultry yard 80 ÷ 3 = 26.7, vineyard 137 ÷ 5 = 27.4, horse farm 228 ÷ 4.5 = 50.7, bull farm 195 ÷ 3 = 65.0.
- The assertion: the slowest class building (20.4) is faster than the fastest common (24.2); every common is under 70.

## Phase 0: recon (no code)

Confirm each reference. If any is not as described, STOP 0 with the mismatch before writing anything.

- `content/buildings/buildings.json`, `commonBuildings`: `poultry-yard` yields `chicken` base 2, `vineyard` yields `wine` base 2, `timber-lot` yields `timber` base 3; `bull-farm`, `horse-farm`, `harbor-warehouse` (`hidden: true`, no yields), `household-shrine` (no yields). `vendor` has `chicken` buy 1 sell 3, `wine` 2 and 5, `timber` 2 and 4, `grain` 1 and 3. `content/people/pops.json`: slave hire 30, wage 0, food 1; freeman 20, 2, 0; citizen 50, 3, 0.
- `packages/shared/src/buildings.test.ts`: fixtures at the top (`content`, `pops`, `estate`, `vendor`, `seasonal`, `DAY`); `describe("BALANCE GUARDRAIL — class ROI beats commons for the owner"` at 146 with three cases: the tiers 1 to 3 out-return case (150), the 20 to 35 percent band case (159), the 610 dr grind case (171). `classBuildingRoi`, `commonBuildingRoi` and `dailyFloorValue` in `packages/shared/src/buildings.ts` are used by tests only.
- `apps/server/src/services/buildings.ts`: `MS_PER_DAY` (50); `ResolvedDef.buildDays` (94; the class line at 116 `(tier) => buildingBuildDays(tier)`, the common at 134 `() => common.buildDays`); the `upgradeStart = C - buildMs(row.tier)` derivation (417, 442); `OwnedBuilding` (833 to 850, `completesAt: string | null` at 840); `MineView` (852 to 866); `mine()` (870; the row map returns `completesAt: active ? null : row.completesAt.toISOString()` at 916).
- `apps/server/src/services/buildings.test.ts`: the day-1 case at 103 (`midBuild` read at `T0 + DAY / 48` at 111, the active read `view` at 117); `(U1)` at 611 (upgrade at `T0 + 2 * DAY`, mid-construction read `emp` at `T0 + 3 * DAY`).
- `apps/web/src/api.ts`: `OwnedBuilding` (1234 to 1249), `BuildingsMine` (1273 to 1285), `BarracksView.now` with its comment (1500).
- `apps/web/src/dashboard/shared.tsx`: `PanelRow` (289, `sub?: ReactNode`), `formatClock` (596), `useCountdownSeconds` (618), `buildCountdown` (653 to 660).
- `apps/web/src/dashboard/panels/BarracksPanel.tsx`: `onDeviceClock` (66 to 71), `progressPct` (73 to 80), `ProgressBar` (165 to 171, `tone: "away" | "training"`, classes `barracks-bar` and `barracks-bar-fill`), `TrainingRow` (296 to 345: the name line `.barracks-row-name.split` with the clock in `.barracks-row-left`, the bar under it), the offset memo and `serverNowMs` (555 to 558).
- `apps/web/src/dashboard/panels/LedgerPanel.tsx`: `buildCountdown` imported at 4; `ClassBuildingLadder` (36, props at 37 to 54) with its constructing cell in `.tier-meta` (123 to 127); the panel's hooks (528 to 549) above the loading return (569); `ownedRow` (622 to 655: the constructing `sub` at 632 to 633, `tag="building"` at 643); the ladder call site (739 to 749).
- `apps/web/src/dashboard/sheets.tsx`: `ResRow` (181, `sub?: string` at 193, rendered inline as `· {sub}` at 205); `InventoryEconomy` (477, early return at 478); the constructing lines (575 to 580); the staleness guard (659 to 676, `reload`).
- `apps/web/src/dashboard/dashboard.css`: `.pr-s` (2561), `.tier-meta` (2807), `.barracks-row-left` (4071), `.barracks-bar` and `.barracks-bar-fill` (4076 to 4078).
- `apps/web/test/barracks-roster-row.test.tsx`: the "in training" case (clock `/^02:14:0[67]$/`, fill `width: 47%` from `readyAt` +2h14m07s and `createdAt` −2h). `apps/web/test/market-panel.test.tsx`: the `hookWarnings` console spy (46 to 60) and the `vi.spyOn(api, ...)` mocks (62 to 66).

## Phase 1: yields and the guardrail (one commit)

1. Save this prompt verbatim as `docs/buildings/buildings-prompt-1.md`.
2. `content/buildings/buildings.json`: `poultry-yard` chicken base 2 → 6, `vineyard` wine base 2 → 4, `timber-lot` timber base 3 → 4. Nothing else in the file.
3. `packages/shared/src/buildings.test.ts`: replace the first two cases of the BALANCE GUARDRAIL describe (150 and 159) with two cases on a test-local `paybackDays(...)` helper that follows "The guardrail" exactly, over `content.classBuildings` (all six) and the commons with yields; keep the 610 dr grind case. Rename the describe to `"BALANCE GUARDRAIL — the class line repays first; no common is a trap"` and carry the arithmetic into a comment. Case one: `max(class T1 payback) < min(common payback)`. Case two: every common payback `< 70`. No source change; `classBuildingRoi`, `commonBuildingRoi` and `dailyFloorValue` stay where they are.
4. Print the eleven paybacks in the report.

Commit: `commons: poultry 6, vineyard 4, timber 4; the guardrail reads all-in payback`.

## Phase 2: the construction window on the mine payload (one commit)

1. `apps/server/src/services/buildings.ts`: `OwnedBuilding` gains `startedAt: string | null` after `completesAt`, with the comment: the instant this tier's construction began, `completesAt` less the tier's build time, null once active. `MineView` gains `now: string` (server time, ISO; the client anchors its countdowns to it). In `mine()`: `startedAt: active ? null : new Date(row.completesAt.getTime() - def.buildDays(row.tier) * MS_PER_DAY).toISOString()` beside `completesAt`; `now: now.toISOString()` on the returned view.
2. `apps/server/src/services/buildings.test.ts`: in the day-1 case, `midBuild.buildings[0].startedAt` is `new Date(T0).toISOString()` and `midBuild.now` is `new Date(T0 + DAY / 48).toISOString()`; after activation `view.buildings[0].startedAt` is null. In `(U1)`, `emp.startedAt` is `new Date(T0 + 2 * DAY).toISOString()`.
3. `apps/web/src/api.ts`: `OwnedBuilding` gains `startedAt: string | null`; `BuildingsMine` gains `now: string` with the `BarracksView.now` comment.

Commit: `buildings: mine reports the construction window and the server clock`.

## Phase 3: the build bar (two commits)

Commit A, a pure move: `onDeviceClock` and `ProgressBar` leave `BarracksPanel.tsx` for `dashboard/shared.tsx` as exports, unchanged apart from `tone` widening to `"away" | "training" | "build"` (no CSS: the default fill is the bronze-to-gold gradient, only `.away` overrides it). `BarracksPanel.tsx` imports both; `progressPct` and everything else in the Barracks stay put. `barracks-panel.test.tsx` and `barracks-roster-row.test.tsx` pass with no edit.

Commit: `shared: the progress bar and the device-clock shift move out of the Barracks`.

Commit B, the bar on the three surfaces:

1. `apps/web/src/dashboard/shared.tsx`, two components next to `useCountdownSeconds` (each holds its own hook, so the callers stay hook-free; `ownedRow` in the Ledger is a plain function, not a component, and must not call a hook itself):
   - `export function BuildClock({ completesAt, offset }: { completesAt: string | null; offset: number })`: `useCountdownSeconds(onDeviceClock(completesAt, offset))`, renders `<span className="build-clock">{formatClock(left)}</span>`.
   - `export function BuildProgress({ label, startedAt, completesAt, offset }: { label: string; startedAt: string | null; completesAt: string | null; offset: number })`: the same countdown; `total = (Date.parse(completesAt) − Date.parse(startedAt)) / 1000`; `pct = total > 0 ? round(100 × (1 − left / total)) clamped to 0..100 : 100`; renders `<div className="build-progress"><div className="build-progress-head"><span>{label}</span><BuildClock … /></div><ProgressBar pct={pct} tone="build" /></div>`.
   - `export function buildLabel(tier: number): string` = `tier >= 2 ? \`Upgrading to Tier ${tier}\` : "Under construction"`.
   - Delete `buildCountdown`.
2. `apps/web/src/dashboard/panels/LedgerPanel.tsx`:
   - Above the loading return, with the other hooks: `const offset = useMemo(() => (mine ? Date.parse(mine.now) - Date.now() : 0), [mine]);` and the one-shot completion refetch, the Economy sheet's guard (659 to 676) transposed onto `mine` and `load`: soonest `completesAt` among constructing rows, `load()` at once if it has passed, else a `setTimeout` at `delay + 500`, cleared on change.
   - `ownedRow`: the constructing `sub` becomes `<BuildProgress label={buildLabel(b.tier)} startedAt={b.startedAt} completesAt={b.completesAt} offset={offset} />`; the `tag="building"` stays.
   - `ClassBuildingLadder` gains an `offset: number` prop (passed at the call site); its constructing `.tier-meta` cell renders `<BuildProgress label={buildLabel(t.tier)} startedAt={owned?.startedAt ?? null} completesAt={owned?.completesAt ?? null} offset={offset} />` in place of the text.
   - Drop the `buildCountdown` import.
3. `apps/web/src/dashboard/sheets.tsx`: `ResRow.sub` becomes `ReactNode`; `InventoryEconomy` gets `const offset = useMemo(() => (data ? Date.parse(data.mine.now) - Date.now() : 0), [data]);` above its early return; the two lines become `<>upgrading · <BuildClock completesAt={r.completesAt} offset={offset} /> — earning {r.income} dr/day now, {r.nominal} when done</>` and `<>under construction · <BuildClock completesAt={r.completesAt} offset={offset} /> — will earn {r.nominal} dr/day</>`. Drop the `buildCountdown` import. The staleness guard stays as it is.
4. `apps/web/src/dashboard/dashboard.css`, under `.dashboard-shell`, beside the `.barracks-bar` rules: `.build-progress{ display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }`, `.build-progress-head{ display: flex; justify-content: space-between; gap: 12px; }`, `.build-clock{ font-variant-numeric: tabular-nums; color: var(--dash-stone-dim); }`. The bar itself keeps `.barracks-bar` and `.barracks-bar-fill`.
5. Tests, cheap (plain DOM selectors, no fake timers, no fixed delays):
   - `apps/web/test/build-progress.test.tsx`: `BuildProgress` with `startedAt` −2h and `completesAt` +2h14m07s at offset 0: `.build-clock` matches `/^02:14:0[67]$/`, `.barracks-bar-fill` style contains `width: 47%`, the head shows the label; `buildLabel(1)` is "Under construction", `buildLabel(3)` is "Upgrading to Tier 3"; `BuildClock` with a null `completesAt` renders "00:00:00".
   - `apps/web/test/ledger-panel.test.tsx`: `LedgerPanel` mounted against `vi.spyOn(api, "buildingsCatalog")` and `vi.spyOn(api, "buildingsMine")` (the market test's pattern, with its `hookWarnings` spy) with a payload of two buildings: the class building at `tier: 2, status: "constructing"` and a `poultry-yard` at `tier: 1, status: "constructing"`, both with `startedAt` −1h and `completesAt` +1h, `now` = the device time. Assert two `.build-progress` blocks, the ladder's reading "Upgrading to Tier 2" and the yard's "Under construction", both clocks matching `/^00:59:5\d$/`, and `hookWarnings` empty. Wait for real state (the rows appearing), never a fixed delay.
6. Render check before the report: the Ledger with a common under construction and the class building mid-upgrade, and the Economy sheet's income lines, seen in the browser (a hidden pane or "not verified in the browser" does not count).

Commit: `ledger: a live build bar on every building under construction`.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN: HEAD <sha>, tree clean`; a run where the DB-gated suites skip is not green. No push. Report:
```

Committed: <SHA> commons: poultry 6, vineyard 4, timber 4; the guardrail reads all-in payback
Committed: <SHA> buildings: mine reports the construction window and the server clock
Committed: <SHA> shared: the progress bar and the device-clock shift move out of the Barracks
Committed: <SHA> ledger: a live build bar on every building under construction
Paybacks: <the eleven figures from Phase 1, each against its expected value>
Gate: <the gate output, per package, DB-gated suites confirmed run>
Render check: <what was seen, on which rows>
Deviations: <each as a ruling for Argiris, or "none">
Post-deploy check: build a Poultry Yard on the live account and watch the row count down with the bar; after a day, `select amount from resources where scope = 'player' and scope_id = '<player>' and type = 'chicken';` moves by about 6 a day.

```

## Scope fence

Do not touch: prices, materials, staffing, build days, upkeep, the vendor bands, the seasonal coefficients, `COST_TABLE`, the Philosopher's income, any class building's numbers, any other content file, the settle and accrual code in `services/buildings.ts` beyond the two payload fields, the Barracks beyond the import swap of commit A, the map, the market, the worker, the Chronicle, `AGENTS.md`, any guide or news copy. No migration. No new endpoint. No polling and no browser storage. No refactors along the way.

END OF PROMPT

## STOP 0 ruling (18 Sept 2026)

STOP 0 ruling (Argiris, 18 Sept 2026): B. Commons take the build days their content states; the prompt's `startedAt` derivation stands as written and now agrees with what `build()` does for every row. Save this ruling verbatim under a heading `STOP 0 ruling (18 Sept 2026)` at the end of `docs/buildings/buildings-prompt-1.md` when Phase 1 saves the prompt. Changes to the prompt:

1. Phase 2 splits into two commits.
   * 2a, first: in `apps/server/src/services/buildings.ts` `build()` (1041), `completesAt = new Date(now.getTime() + def.buildDays(1) * MS_PER_DAY)` in place of `buildMs(1)`. `upgrade()` keeps `buildMs(nextTier)`; it is class-only and the two agree there. In `apps/server/src/services/buildings.test.ts`, a new case: a funded landowner builds `poultry-yard` at `T0` and the result's `completesAt` is `T0 + DAY`; `mine()` at `T0 + 23 * HOUR` shows it `constructing`; at `T0 + DAY + 60_000` it is `active` and `pendingGoods.chicken` is above 0. A `bull-farm` built at `T0` returns `completesAt` = `T0 + 2 * DAY`. Confirm the routine-waiver case at 209 still passes (the waiver reads ownership, not activity). Commit: `buildings: a common takes the build days its content states`.
   * 2b, second: the payload fields exactly as the prompt has them. Add to the poultry case of 2a: the `T0 + 23 * HOUR` read has `startedAt` = `new Date(T0).toISOString()`, the active read has `startedAt` null. Commit as the prompt names it.
2. The prompt's sentence "the same derivation the income settle already uses for `upgradeStart`" reads: the settle uses `C − buildMs(row.tier)`, and `buildMs(t)` is `buildingBuildDays(t) × MS_PER_DAY`, so the two derivations agree on every class row; after 2a they agree on every common row too.
3. Scope fence: "build days" means the content numbers, which do not move; the `build()` change in 2a is the code honouring them. Everything else in the fence stands.
4. Report: five `Committed:` lines, 2a between the yields and the payload. Post-deploy check: the Poultry Yard built on the live account opens with its bar near empty and its clock near 23:59:59, and lands a day later; the chicken query stands. Under Deviations, one line: commons standing before the deploy are unaffected (they are active); a common built after it takes its stated days.

Proceed from Phase 1.
END OF RULING

## STOP 1 ruling (18 Sept 2026)

STOP 1 ruling (Argiris, 18 Sept 2026): the five commits stand (4771f38, f3bc6b1, 83b7249, 916f076, b659f1a). Deviations 1 and 2 are accepted as rulings: a `:has()` row-width rule so the bar spans the row, and the Ledger test's clock regex admitting `01:00:00` since `remainingSeconds` rounds up. Deviation 3, the pre-existing Economy-sheet refetch loop on a device clock ahead of the server, was fixed before the push by a sixth commit anchoring the sheet's completion refetch to the payload's `now` (ce26944 `sheets: the completion refetch counts on the server clock`). All six pushed and live 18 Sept 2026, CI run 35346702571 green, no migration.
