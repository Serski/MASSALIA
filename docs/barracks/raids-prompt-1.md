# Raids: a fifth of the warband turns out, and the plunder takes a third good

Save this prompt as docs/barracks/raids-prompt-1.md in the first commit.
Repo HEAD when this was drafted: 77915b8. No migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

Two changes to raids. Attack, Scout, moves, regeneration, reversion and tribute are untouched.

1. Turnout. A raid no longer meets the whole warband, or a town's whole garrison: a fifth of it turns out. `raidTurnout(pool)` is 0 for an empty pool, else `min(pool, max(1, round(pool × raid.warbandShare)))` with `warbandShare` 0.2. Only those men fight. The kills still come off the whole pool, so raiding a place first leaves less to face in an attack. The same rule holds in a koinon raid muster. Why: the defender's damage is set by how many defend, so today a small party loses every raid even against the smallest warband of 100. It takes 36 peltasts or 61 hoplites to win nine raids in ten there, and 10 hoplites lose 8 of their 10 men for one kill. With a fifth turning out it takes 18 peltasts or 20 hoplites; a warband of 600 needs 37 or 73, and sending too few still costs men.
2. Plunder. Each kill pays 50 drachmae (was 40), 5 grain (unchanged) and 5 of one good drawn once per raid from olive oil, leather, salt and wool. Every kill in that raid pays the same good. A town still pays `townPlunderMultiplier` (2) times the region rate, now on all three.

Rulings already made (8 Oct 2026): a fifth turns out, towns and the koinon muster included; 50 drachmae, 5 grain and 5 of the third good per kill; the good drawn at random once per raid on the battle's own seed. Balance stays in content.

## Scope

Four commits; the first also saves this file. Touch only:
- docs/barracks/raids-prompt-1.md (this file)
- content/military/battle.json (the `raid` block only)
- packages/shared/src/barracks.ts (the `raid` type in BattleContent, the `raid` schema in battleContentSchema, two new functions)
- packages/shared/src/battle.test.ts
- packages/shared/src/chronicle.ts (a new plunder type and `renderPlunder`, `CampaignPayload.plunder`, the raid line)
- packages/shared/src/chronicle.test.ts (one new case)
- packages/shared/src/muster.ts (the share and report-line plunder types, the two won lines)
- packages/shared/src/muster.test.ts (two new cases)
- apps/server/src/services/mapActions.ts
- apps/server/src/services/mapActions.test.ts
- apps/server/src/services/koinonMuster.ts
- apps/server/src/services/koinonMuster.test.ts
- apps/web/src/api.ts (MapActReport, KoinonMusterPart and KoinonMusterReport only)
- apps/web/src/map/World2Map.tsx (BattleReport only)
- apps/web/src/dashboard/panels/KoinonView.tsx (the part line at :211 only)
- apps/web/test/towns-and-move.test.tsx (one new BattleReport case)
- apps/web/test/koinon-view.test.tsx (one new case)

Do not touch: packages/shared/src/battle.ts (the resolver stays pure: its callers hand it the men who turn out, as they already hand it the altar's morale on a copy of the stats); packages/shared/scripts/battle-calibration.ts; the Attack, Scout and move paths; services/mapPools.ts and services/holdings.ts (only call the credit helpers holdings.ts already exports); units, bands, ships, vendor prices and goodLabels; the Chronicle kinds and allowlist (no new kind); FamilyPanel (it renders through the shared functions); the force picker; apps/server/src/routes/map.test.ts (its raid, 40 peltasts against a warband of 20, still wins on every seed with 4 slain); AGENTS.md. No migration. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- content/military/battle.json:9 is `"raid": { "rounds": 1, "plunderPerKill": 40, "grainPerKill": 5, "townPlunderMultiplier": 2 }`.
- packages/shared/src/barracks.ts: the `raid` type at :45; the `raid` schema at :244-246, `.strict()`, inside `battleContentSchema(goods)` (:234), whose `goods` are the vendor goods that `parseBattleContent(data, knownGoods)` (:273) receives; `goodsSchema` (:122) checks a good-to-quantity map, not a list; `seededRoll(seedParts)` (:352) is exported and returns a number in [0, 1).
- packages/shared/src/battle.test.ts:26 pins the raid block with `toEqual`; :41 is the altar's unknown-good rejection, the pattern for the new one.
- apps/server/src/services/mapActions.ts: `MapActReport` at :71-100 (defender :95, plunder :96); the repulsed report's defender at :434; the battle seed at :442; the defender row at :450 is `count: warband` for raid and attack alike; the raid plunder at :469-479 credits through `creditDrachmae` and `creditGood` (services/holdings.ts:60, :65); the battle report's defender at :520. `getBuildingsContent` is exported from services/buildings.ts:61.
- apps/server/src/services/koinonMuster.ts: `MusterPart` at :544 and `MusterReport` at :546-569; the stood-down close at :685 writes `defender: null, plunder: null, parts: []`; `drachmaeOf` and `grainOf` at :719-720; the pool at :737, the seed at :740, the defender row at :750 (`count: pool`); `defender` set at :773; the plunder at :776-787, split by `splitByShares` per owner; the chronicle share at :810; the report line at :818; the parts at :830-840. It already imports `describeForce` from ./mapActions.js (:39).
- packages/shared/src/chronicle.ts: `CampaignPayload.plunder` at :248 and the raid line at :316-322. packages/shared/src/muster.ts: `MusterChronicle.share` at :119, the won member line at :136, `MusterReportLine` at :143 and its won line at :150.
- apps/web/src/api.ts: `KoinonMusterPart` at :1422, `KoinonMusterReport.plunder` at :1430, `MapActReport.defender` at :1829 and `.plunder` at :1830. apps/web/src/map/World2Map.tsx: `@massalia/shared` imported at :2, the enemy row at :1958, the plunder line at :1962. apps/web/src/dashboard/panels/KoinonView.tsx:211 is the part line.
- content/buildings/buildings.json `goodLabels` has `"oliveoil": "Olive Oil"` and no entry for leather, salt or wool.
- The map-action suite's world and player ids are random, so a battle's seed changes every run. The muster suite fixes its ids and LAUNCH (koinonMuster.test.ts:25-28, the world at :130), so its seeds are fixed. Every count below was checked against the real resolver and content on 3000 random seeds with random row ids, so it holds on either suite.

## Commit 1: docs, content and shared: the raid rules

1. Save this prompt file.
2. content/military/battle.json, the raid block becomes:
   ```json
   "raid": { "rounds": 1, "warbandShare": 0.2, "plunderPerKill": 50, "grainPerKill": 5, "spoilPerKill": 5, "spoilGoods": ["oliveoil", "leather", "salt", "wool"], "townPlunderMultiplier": 2 },
   ```
3. packages/shared/src/barracks.ts:
   - The `raid` type gains `warbandShare: number; spoilPerKill: number; spoilGoods: string[]`, with a comment: the share of a warband or garrison that meets a raid, and the third good of the plunder.
   - The schema gains `warbandShare: z.number().positive().max(1)`, `spoilPerKill: z.number().nonnegative()` and `spoilGoods: z.array(z.string()).min(1)`, refined so that every id is a known good (`raid.spoilGoods: unknown good "<id>"`) and none appears twice (`raid.spoilGoods: "<id>" twice`). The object stays `.strict()`.
   - `export function raidTurnout(raid: BattleContent["raid"], pool: number): number`: 0 when `pool <= 0`, else `Math.min(pool, Math.max(1, Math.round(pool * raid.warbandShare)))`. Math.round, not ceil: `7 * 0.2` is 1.4000000000000001 in floating point.
   - `export type RaidPlunder = { drachmae: number; grain: number; spoil: { good: string; amount: number } }` and `export function raidPlunder(raid: BattleContent["raid"], kills: number, isTown: boolean, seed: string): RaidPlunder`. With `mult = isTown ? raid.townPlunderMultiplier : 1`: `drachmae = Math.round(kills * raid.plunderPerKill * mult)`, `grain` the same with `grainPerKill`, `spoil.amount` the same with `spoilPerKill`, and `spoil.good = raid.spoilGoods[Math.floor(seededRoll([seed, "spoil"]) * raid.spoilGoods.length)]`. Pure: the good depends only on the seed, so a raid's good is fixed by its battle.
4. apps/server/src/services/mapActions.test.ts: the region rate is now 50, so in "raid win" :197 and :198 read `killed * 50` and `100 + killed * 50`, and in "town raid" :486 and :487 read `killed * 50 * 2` and `100 + killed * 100`. Nothing else in that file in this commit. The server plunders through `plunderPerKill` until commit 3, so the suites stay green here.
5. packages/shared/src/battle.test.ts:
   - "battle content": :26 becomes the new block with `toEqual`. Reject a `spoilGoods` with an unknown good (`/raid\.spoilGoods: unknown good/`), one with a good twice, and `warbandShare` 0 and 1.5.
   - A new `describe("raid rules")`: `raidTurnout` gives 0→0, 1→1, 2→1, 7→1, 10→2, 20→4, 30→6, 90→18, 100→20, 600→120, 3300→660 and is never above the pool. `raidPlunder(battle.raid, 10, false, "s")` is 500 drachmae, 50 grain and 50 of a good in `spoilGoods`; with `isTown` it is 1000, 100 and 100 of the same good; 0 kills pays 0, 0 and 0; the same seed twice draws the same good; over the seeds `s0` to `s399` each of the four goods is drawn at least 80 times (my run, with node's sha256 standing in for `sha256Words`: olive oil 88, leather 116, salt 98, wool 98).

## Commit 2: shared: the plunder in words

1. packages/shared/src/chronicle.ts:
   - `export type PlunderPayload = { drachmae: number; grain: number; spoil?: { good: string; label: string; amount: number } }`. `spoil` is optional because rows written before this change have none. `label` is the good in running text ("olive oil").
   - `export function renderPlunder(p: PlunderPayload | null | undefined): string`: with a spoil, "500 drachmae, 50 grain and 50 wool"; without one, the old "400 drachmae and 50 grain"; null reads "0 drachmae and 0 grain", as the lines do today.
   - `CampaignPayload.plunder` (:248) becomes `plunder?: PlunderPayload | null` (still optional), and the won raid line (:320) becomes `` `Raided ${place}${force}: ${killed}, ${lost}, ${renderPlunder(p.plunder)} of plunder.` ``
2. packages/shared/src/muster.ts: `MusterChronicle.share` (:119) and `MusterReportLine.plunder` (:143) become `PlunderPayload | null`. The won member line (:136) ends `` `, ${renderPlunder(p.share)} for our share.` `` and the won report line (:150) ends `` `, ${renderPlunder(p.plunder)} taken.` ``
3. Tests. Every existing line case stays unchanged and must pass as it is: that is the proof that old rows read the same. Add to chronicle.test.ts: the raid line with `killed: 5` and `plunder: { drachmae: 250, grain: 25, spoil: { good: "oliveoil", label: "olive oil", amount: 25 } }` reads "Raided Salyes with 40 peltasts: 5 tribesmen slain, none of ours lost, 250 drachmae, 25 grain and 25 olive oil of plunder." Add to muster.test.ts: the member line with `share: { drachmae: 240, grain: 30, spoil: { good: "salt", label: "salt", amount: 30 } }` ends "240 drachmae, 30 grain and 30 salt for our share.", and the report line with the same `plunder` ends "240 drachmae, 30 grain and 30 salt taken."

## Commit 3: server: a fifth turns out, and the third good

1. apps/server/src/services/mapActions.ts:
   - `export function spoilLabel(good: string): string`: `(getBuildingsContent().goodLabels?.[good] ?? good).toLowerCase()`, giving "olive oil", "leather", "salt" and "wool".
   - `MapActReport.defender` (:95) gains `turnout: number`: the men who fought, a fifth for a raid, the whole pool for an attack, 0 when the landing was repulsed. `start` and `end` stay the whole pool before and after. `MapActReport.plunder` (:96) becomes `PlunderPayload | null`.
   - :450: `const met = input.type === "raid" ? raidTurnout(battleC.raid, warband) : warband;` and the defender row takes `count: met`. An attack keeps the whole pool.
   - :469-479: on a raid won, `const p = raidPlunder(battleC.raid, defLosses, isTown, seed)` with the seed from :442 (the town multiplier is inside it, so the local `mult` goes); `plunder = { drachmae: p.drachmae, grain: p.grain, spoil: { good: p.spoil.good, label: spoilLabel(p.spoil.good), amount: p.spoil.amount } }`; credit the drachmae and the grain as now, then `creditGood(tx, ctx.playerId, p.spoil.good, p.spoil.amount, now)`. `remaining` and `writeDefender` stay as they are: the kills come off the whole pool.
   - :434 gains `turnout: 0` and :520 gains `turnout: met`. The Chronicle payload at :494 carries the plunder as it is, spoil included.
2. apps/server/src/services/koinonMuster.ts:
   - `MusterPart` (:544) gains `spoil: number`, the owner's part of the third good (the good itself is on the report's plunder). `MusterReport.defender` (:565) gains `turnout: number`. `MusterReport.plunder` (:567) becomes `PlunderPayload | null`.
   - :750: `const met = raidTurnout(battleC.raid, pool)` and `count: met`. :773: `defender = { label: npc.label, start: pool, end: remaining, turnout: met }`.
   - :776-787: `const p = raidPlunder(battleC.raid, killed, isTown, seed)` and `plunder` built as in `act`, with `spoilLabel` imported from ./mapActions.js. Add `let spoilOf: Record<string, number> = {}` beside `grainOf` (:720), set `spoilOf = splitByShares(p.spoil.amount, shares)`, and credit each owner `creditGood(tx, id, p.spoil.good, spoilOf[id] ?? 0, launchAt)` after his grain.
   - :810: a won `share` gains `spoil: { good, label, amount: spoilOf[o.playerId] ?? 0 }` with the good and label from the plunder's spoil. The parts (:838-839) gain `spoil: spoilOf[o.playerId] ?? 0`.
3. apps/server/src/services/mapActions.test.ts:
   - "raid win" (:186): 40 peltasts against 20 meet 4 and kill all 4 on every seed, losing 0 or 1. :194 becomes `expect(r.report.defender).toMatchObject({ start: 20, turnout: 4 })`; assert `killed` is 4. :197 becomes `toEqual({ drachmae: killed * 50, grain: killed * 5, spoil: { good, label, amount: killed * 5 } })`, where `good` is read from the report and is one of the four, and `label` is "olive oil" for oliveoil and the id otherwise. The stock of that good is `(good === "oliveoil" ? 5000 - 3 * 40 : 0) + killed * 5` (the peltasts eat olive oil too). :205 becomes `/^Raided Salyes with 40 peltasts: 4 tribesmen slain, (none|1) of ours lost, 200 drachmae, 20 grain and 20 (olive oil|leather|salt|wool) of plunder\.$/`.
   - "town raid" (:476): against Reii's 10 (walls 1), 2 turn out and both are slain on every seed. :483 adds `turnout: 2` to the defender; assert `killed` is 2; :486 adds the spoil with `amount: killed * 5 * 2`, and the good's stock is checked as above with `killed * 10`.
   - "attack against a stronger warband" (:233): add `expect(r.report.defender).toMatchObject({ start: 100, turnout: 100 })`. An attack still meets everyone.
   - Three new cases, each with `makePlayer()`, a fresh party at Massalia, and Salyes set by `setWarband("R046", n, at(9))` (a value above the content 100 is read back as written):
     a. "a small party raids a full warband": 20 peltasts against 100. On every seed: winner "attacker", defender `{ start: 100, turnout: 20 }`, 2 or 3 slain, 0 or 1 of ours lost, the warband at 100 less the kills, `killed * 50` drachmae of plunder.
     b. "hoplites raid a full warband": 30 hoplites against 100. On every seed: winner "attacker", 4 or 5 slain, 1 to 3 of ours lost.
     c. "too few for the tribe": 20 peltasts against 600. On every seed: winner "defender", `turnout` 120, 2 or 3 slain, exactly 3 of ours lost, `plunder` null, the wallet unchanged, the warband at 600 less the kills, and the line starts "Raided Salyes with 20 peltasts and were driven off: ".
4. apps/server/src/services/koinonMuster.test.ts:
   - "a land raid of three members" (:551): against 30, 6 turn out and all 6 are slain on every seed; the army loses 0 to 2. :584 becomes `toEqual({ label: battle().npc.warband.label, start: 30, end: 30 - report.killed, turnout: 6 })`; assert `report.killed` is 6. `total` (:588) gains `spoil: { good, label, amount: report.killed * battle().raid.spoilPerKill }`, with `good` and `label` read from `report.plunder`. The parts' `spoil` add up to `total.spoil.amount` and equal `splitByShares(total.spoil.amount, sent)`, and each member's stock of that good equals his `spoil`. The share at :603 gains `spoil: { good, label, amount: p.spoil }`. :609 ends `` `, ${total.drachmae} drachmae, ${total.grain} grain and ${total.spoil.amount} ${total.spoil.label} taken.` ``
   - "the altar" (:621): `setWarband(landRegion, 660)` becomes 3300, whose fifth is 660, so the fight is the one it was. The assertions stay (cold 27 to 30, blessed 24 to 26, checked again on 3000 seeds); the comment says a fifth of 3300 turns out.
   - "shares" (:688): with a fifth turning out, 20 hoplites against a garrison of 3 meet one man and can lose the raid on a rounding roll. Make it 40 peltasts on two of the ship owner's pentekonters against a garrison of 10: `setTown(seaTown.townId, 10)`, `pledgedMen(soldier, "peltast", 40, bySea, 501)` and `pledgedHulls(shipowner, bySea, "trade-ship", 2)`. On every seed and at any walls, 2 turn out, both are slain and the raid is won. `report.fleet` toEqual `{ hulls: { "trade-ship": 2 }, naval: 2, space: 40, filled: 40, defender: null, held: true }`; the shares are 40 and 40; the soldier's part has `men: 40`, the ship owner's `hulls: 2, seats: 40`, and both their `spoil`; the trade-ship stock reads "2"; the garrison is `10 - report.killed`; the totals and the ship owner's share gain the spoil as above. By land: `setWarband(landRegion, 10)` and `pledgedMen(soldier, "peltast", 20, byLand, 505)`: 2 turn out, both are slain, won on every seed, and :729 stays. Rename the case "shares: 40 men carried on another member's two pentekonters are 40 shares each; by land the ship owner gets nothing".
   - Unchanged and still green, checked: "by sea: a trireme…" (it asserts the route, the fleet and the parts, not the outcome), "men gone before launch", "claim first" (against 4, a fifth is one man and about one run in fourteen is driven off, but its wallets, grain and pool are read against each run's own report), the two hook cases, and "deterministic".

## Commit 4: web: the turnout and the third good on the reports

1. apps/web/src/api.ts: `MapActReport.defender` gains `turnout?: number`; `MapActReport.plunder` and `KoinonMusterReport.plunder` become `{ drachmae: number; grain: number; spoil?: { good: string; label: string; amount: number } } | null`; `KoinonMusterPart` gains `spoil?: number`. Optional, since a report stored before this change has neither.
2. apps/web/src/map/World2Map.tsx, BattleReport only:
   - For a raid whose defender has a `turnout`, the enemy row counts the men who fought: `turnout`, then `turnout - losses`. Otherwise it shows `start` and `end` as now.
   - Under the table, for a raid whose `turnout` is below `start`: `<p className="w2map-report-note" data-testid="turnout-line">20 of 100 tribesmen turned out.</p>`, with "soldiers" for a town.
   - The plunder line becomes `Plunder: {renderPlunder(report.plunder)}.`, with `renderPlunder` from `@massalia/shared`.
3. apps/web/src/dashboard/panels/KoinonView.tsx:211: for a won report, the part's tail is `renderPlunder` of the part's drachmae and grain, plus, when the report's plunder has a spoil, that good's label with the part's `spoil` amount: "· 288 drachmae, 36 grain and 36 salt". A report without a spoil reads as now.
4. Tests:
   - apps/web/test/towns-and-move.test.tsx, a new case in "BattleReport · towns and moves": a town raid, `report({ type: "raid", rounds: 1, defender: { label: "Town garrison", start: 10, end: 8, losses: 2, turnout: 2 }, plunder: { drachmae: 200, grain: 20, spoil: { good: "salt", label: "salt", amount: 20 } }, line: "Raided Aleria with 40 peltasts: 2 soldiers slain, none of ours lost, 200 drachmae, 20 grain and 20 salt of plunder." })`. The enemy row reads "Town garrison20", the turnout line "2 of 10 soldiers turned out.", and the text contains "Plunder: 200 drachmae, 20 grain and 20 salt."; the taken-town report of the case above it shows no turnout line.
   - apps/web/test/koinon-view.test.tsx: the won case at :842 stays as it is (a report from before this change). Add a won report whose plunder has `spoil: { good: "salt", label: "salt", amount: 120 }` and whose parts carry `spoil` 36, 48 and 36: the part lines end "· 288 drachmae, 36 grain and 36 salt", "· 384 drachmae, 48 grain and 48 salt" and "· 288 drachmae, 36 grain and 36 salt".
   - The turnout line's wording is mine and yours to change at STOP 1.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 4, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- Each new or changed test by name, and any count that differs from the ones given above, with the reason
- The new BattleReport case as rendered (enemy row, turnout line, plunder line), for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, Pages green and API health. No migration to confirm.

## STOP 1 ruling (8 Oct 2026)

1. The by-land leg of "shares": keep it as built. The warband written at 10 regenerates to 15 by the launch a day later, so 3 turn out, and 20 peltasts win on every seed with 2 or 3 slain and 0 or 1 lost. The assertions on `{ start: 15, turnout: 3 }`, killed in [2, 3] and the win stand. The prompt's 10 and 2 missed the day of regeneration.
2. The BattleReport as rendered: accepted. Enemy row "Town garrison | 2 | 0", "2 of 10 soldiers turned out.", "Plunder: 200 drachmae, 20 grain and 20 salt." All other wording stands as rendered.
3. The `renderPlunder` import in KoinonView.tsx: accepted. The part line needs it.
4. The two spoil-good rejection regexes: accepted. The ZodError message escapes the quotes.
5. The spoil on every won muster share: accepted. That is the rule, and older rows read as before.

One commit: this ruling appended verbatim to docs/barracks/raids-prompt-1.md under its heading, subject `docs: the raids prompt's STOP 1 ruling`. Run the gate at the new HEAD, then `pnpm audit --audit-level=high`. On GATE GREEN and audit exit 0, push as the prompt's Push section says: fast-forward only, plain `git push`. Report the Committed line, the gate's last line with suite counts, the audit exit code, remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, Pages green and API health. On any red, STOP with the log and do not push.
