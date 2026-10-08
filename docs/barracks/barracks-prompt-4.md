# Barracks 4: open to every free man, the road out in red, and naval supplies for every voyage

Save this prompt as docs/barracks/barracks-prompt-4.md in the first commit.
Repo HEAD when this was drafted: b302042. No migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

1. The Barracks opens to every free character. The militia 20 entry requirement goes, from content, the server, the admin grant and the client. A slave sees the Barracks locked with "The unfree may not raise an army." until he is freed, as the koinon, the Three Hundred and the parties already refuse the unfree. Militia keeps its meaning for the mercenary contracts and the ranks, which are untouched.
2. The road out in red. Under Away · Returning, a raid, an attack or a scout still on its way to its target has a red bar; once it turns for home the bar is green, as today. Moves stay green, and so do ships at sea.
3. Naval supplies. Every hull that leaves port uses its ship's `suppliesPerTrip` naval supplies (1 for a pentekonter, 1 for a trireme) for the trip there and back, taken from the owner's stock when the party sets out: raids, attacks, scouts and moves by sea. Short of supplies, the order is refused before anything moves: "Not enough naval supplies: 3 needed, 1 in store." The picker shows the count for the hulls that will sail and refuses with the same line before Go; the set-out and move cards say what was spent. Koinon musters do not pay yet (raids prompt 5 adds them).

Rulings already made (8 Oct 2026): all of the above. The unfree line, the red, the supplies note on the picker and the cards, and the refusal are mine and yours to change at STOP 1. The only new numbers are the two `suppliesPerTrip` (1 and 1), in content.

## Scope

Four commits; the first also saves this file. Touch only:
- docs/barracks/barracks-prompt-4.md (this file)
- content/military/units.json (`gate` out)
- content/military/ships.json (`supplyGood` and each ship's `suppliesPerTrip`)
- packages/shared/src/barracks.ts (`gate` out of the units content; the ships content's new keys; a new `voyageSupplies`)
- packages/shared/src/reach.ts (`REACH_REASON.supplies` only)
- packages/shared/src/barracks.test.ts
- apps/server/src/services/barracks.ts (the gate; `fleetInStock`'s supplies; a new `takeSupplies`)
- apps/server/src/routes/admin.ts (the grant's refusal and its comment only)
- apps/server/src/services/mapActions.ts (the supplies in `act` and `move`, and on their reports)
- apps/server/src/services/mapReach.ts (the reach fleet's `supplies` only)
- apps/server/src/services/barracks.test.ts
- apps/server/src/services/mapActions.test.ts
- apps/server/src/routes/barracks.test.ts
- apps/server/src/routes/admin.test.ts (the grant case only)
- apps/server/src/routes/map.test.ts (the reach fleet pin only)
- apps/web/src/api.ts
- apps/web/src/dashboard/shared.tsx (`ProgressBar`'s tone only)
- apps/web/src/dashboard/panels/BarracksPanel.tsx (the lock reason, the away row's tone)
- apps/web/src/dashboard/dashboard.css (the red bar only)
- apps/web/src/map/World2Map.tsx (the picker's supplies, the cards' supplies note)
- apps/web/test/barracks-panel.test.tsx
- apps/web/test/barracks-roster-row.test.tsx
- apps/web/test/towns-and-move.test.tsx

Do not touch: koinon musters and their hulls (raids prompt 5); the mercenary contracts, the ranks and their militia and prestige gates (merc.ts, service.ts, contracts.json, ranks.json); `sailHulls` and the voyages; the market and its prices; the battle; the ships' other numbers; KoinonView; AGENTS.md. No migration, no production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- HEAD b302042. content/military/units.json:4 is `"gate": { "militia": 20 },`. content/military/ships.json has two ships, `trade-ship` (Pentekonter) and `galley` (Trireme), with no running cost. `naval-supplies` is a vendor good (buildings.json; the Shipbuilder's yield and a ship-craft material).
- packages/shared/src/barracks.ts: `gate` in `UnitsContent` (:102) and its schema (:174); `ShipDef` (:29) and `ShipsContent` (:30); `shipsContentSchema` (:212-233), whose superRefine requires every ship id to be a vendor good. packages/shared/src/reach.ts: `REACH_REASON` (:60-65).
- apps/server/src/services/barracks.ts: `import { sheetStats }` (:32), read only by `gateFor`; `getOrCreateResource` (:177) and `drainResource` (:204); `sailHulls` (:383); the gate's comment (:228-229), `GateView` (:230) and `gateFor` (:232-241, the sheet's militia against `getUnitsContent().gate.militia`); recruit (:800-801), hire (:845-846) and the altar (:895-896) refuse with 403 "Militia N required."; `FleetStripView` (:1048) and `fleetInStock` (:1049-1069); `BarracksView.gate` (:1072); the view's gate (:1128) and `canDisband` (:1154).
- apps/server/src/routes/admin.ts: the comment on adding men below the militia gate (:527-530); `requireGate` (:543-546), called by a positive count (:560) and the grant (:614), answers 409 "Militia N required.".
- apps/server/src/services/mapActions.ts: `MapSetOutReport` (:140); `act` (:321): the ships (step 4, :380-425, `sailing` the hulls that sail), the split (:427), the set-out (:430-448, `sailHulls` at :448), the report (:451); `MapMoveReport` (:734); `move` (:756): the route and its ships (step 3, :780-804), the split (:806), `sailHulls` (:812), the report (:823). apps/server/src/services/mapReach.ts: `ReachView["fleet"]` (:57), built at :186 from `fleetInStock`.
- apps/web/src/api.ts: `BarracksGate` (:1700); the Barracks view's fleet ships (:1775); `FleetHull` (:1806) and `FleetView` (:1807); `MapSetOutReport` (:1863) and `MapMoveReport` (:1885). apps/web/src/dashboard/shared.tsx: `ProgressBar` (:630) with tone "away" | "training" | "build". apps/web/src/dashboard/panels/BarracksPanel.tsx: `LOCK_REASON` (:19); `lockReason` (:704); `AwayRow` (:283) and its bar (:299); `VoyageRow`'s bar (:326). apps/web/src/dashboard/dashboard.css: `.barracks-bar.away` (:4146). apps/web/src/map/World2Map.tsx: `seaSteps` (:1688, actions only), `automatic()` (:1689-1703), `chosenShips` (:1704), the chosen fleet's verdict (:1712-1715), the footer's sea route (:1879-1880) and its " · arrives in" (:1881), `BattleReport` (:1911) with the set-out and move card (:1913-1929).
- Tests. packages/shared/src/barracks.test.ts: the units case pins the gate (:21-23) and the ships case pins both ships with `toEqual` (:145-146), rejections at :148-154. apps/server/src/services/barracks.test.ts: `makePlayer` (:42, class "hoplite"), the "gate" block (:159-192), the altar's militia-19 refusal (:668-670). apps/server/src/routes/barracks.test.ts: the View's gate type (:38), `freshPlayer` (:89, class "hoplite"), "GET below the gate…" (:112-135), "GET above the gate…" (:137-143). apps/server/src/routes/admin.test.ts: the grant refused below the gate, then militia set to 20 (:382-386); its character is a "trader". apps/server/src/routes/map.test.ts: the reach fleet pinned with `toEqual` (:113). apps/server/src/services/mapActions.test.ts: `makePlayer` (:54) gives grain, olive oil and chicken (:68-70) through `give` (:73), which inserts a row, and resources rows are unique per player and type (the "move refusals" case sets a stock by update, :1134). apps/web/test/barracks-panel.test.tsx: the payload's gate (:37), "locked…" (:90-99), "the altar, below the gate…" (:361-371). apps/web/test/towns-and-move.test.tsx: the set-out card case (:87), the hulls and stock fixture (:185-189), the chosen-fleet case (:192), the Barracks view's gate (:287). apps/web/test/barracks-roster-row.test.tsx: the AwayRow case (:40-52).

## Commit 1: the Barracks open to every free character

1. Save this prompt file.
2. content/military/units.json: `"gate"` (:4) goes. packages/shared/src/barracks.ts: `gate` leaves `UnitsContent` (:102) and its schema (:174).
3. apps/server/src/services/barracks.ts:
   - `export const UNFREE_REFUSAL = "The unfree may not raise an army.";`
   - `GateView` (:230) becomes `{ met: true; reason: null } | { met: false; reason: string }`, so `gate.reason` is a string wherever `!gate.met` has narrowed it (`fail` and admin's `httpError` take a string). `gateFor` (:232-241) reads the character's `classId`: met unless the class is "slave" or there is no character, `reason` `UNFREE_REFUSAL` when not met. The comment (:228-229) says every free character may raise an army and the unfree may not, as the koinon, the Three Hundred and the parties refuse them. The `sheetStats` import (:32) goes with its last reader.
   - Recruit (:800-801), hire (:845-846) and the altar (:895-896) refuse with 403 and `gate.reason`. The view's gate (:1128) and `canDisband` (:1154) are otherwise unchanged.
4. apps/server/src/routes/admin.ts: `requireGate` (:543-546) answers 409 with the gate's reason; the comment (:527-530) says adding men is refused for the unfree.
5. apps/web/src/api.ts: `BarracksGate` (:1700) is `{ met: boolean; reason: string | null }`. apps/web/src/dashboard/panels/BarracksPanel.tsx: `LOCK_REASON` (:19) goes and `lockReason` (:704) is `view.gate.reason ?? ""`.
6. Tests:
   - packages/shared/src/barracks.test.ts: the units case (:21-23) drops the gate pin and "gate militia 20" from its name.
   - apps/server/src/services/barracks.test.ts: `makePlayer` (:42) takes an optional `classId` (default "hoplite"). The "gate" block (:159-192) becomes two cases: "a free character raises an army whatever his militia: militia 0 recruits and hires, and the view's gate is { met: true, reason: null }"; and "a slave is refused recruit, hire and the altar with 403 and the unfree line, and the view's gate carries the line": no unit row, the gear and the bull still in stock, the offer not hired, the altar cold (the settle still writes the levy and hire still rolls the offers, as today). The altar case (:668-670) refuses a slave in place of militia 19.
   - apps/server/src/routes/barracks.test.ts: `freshPlayer` (:89) takes an optional `classId`, and the View's gate (:38) is `{ met: boolean; reason: string | null }`. "GET below the gate…" (:112-135) becomes a slave's GET: the catalogue, offers and levy are served, `gate` is `{ met: false, reason: "The unfree may not raise an army." }`, and recruit and hire are 403. "GET above the gate…" (:137-143) becomes a free character at militia 0: `{ met: true, reason: null }`, and the same offers twice.
   - apps/server/src/routes/admin.test.ts (:382-386): the character is made a slave, the grant is 409 `{ error: "The unfree may not raise an army." }`, and the class goes back to "trader" in place of the militia update.
   - apps/web/test/barracks-panel.test.tsx: the payload's gate (:37) is `{ met: true, reason: null }`; "locked…" (:90-99) and "the altar, below the gate…" (:361-371, renamed "the altar, locked…") use `{ met: false, reason: "The unfree may not raise an army." }` and read that line in the banner and as both buttons' title. apps/web/test/towns-and-move.test.tsx: the Barracks view's gate (:287).

## Commit 2: web: the road out in red

1. apps/web/src/dashboard/shared.tsx: `ProgressBar`'s tone (:630) adds "out".
2. apps/web/src/dashboard/panels/BarracksPanel.tsx: an exported `isOutbound(row)`: a raid, an attack or a scout still bound for its place (`row.movingTo` is the mission's `townId ?? regionId`, the test `missionLine` makes). `AwayRow` (:299) draws its bar with tone "out" when the row is outbound, else "away". `VoyageRow` (:326) is unchanged.
3. apps/web/src/dashboard/dashboard.css, after `.barracks-bar.away` (:4146): `.dashboard-shell .barracks-bar.out .barracks-bar-fill{ background: linear-gradient(90deg, #7a2e34, var(--danger)); }`. Nothing else changes.
4. apps/web/test/barracks-roster-row.test.tsx, a new case: "the bar is red on the way out and green coming home": the AwayRow bars of a raid, an attack and a scout bound for R046 have `.barracks-bar.out`; the same raid bound home, and a move, have `.barracks-bar.away`.

## Commit 3: naval supplies for every voyage

1. content/military/ships.json: `"supplyGood": "naval-supplies",` after `source`, and `"suppliesPerTrip": 1` on each ship.
2. packages/shared/src/barracks.ts:
   - `ShipDef` (:29) gains `suppliesPerTrip: number` and `ShipsContent` (:30) `supplyGood: string`, with a comment: every hull that leaves port uses its `suppliesPerTrip` of `supplyGood` for the trip there and back. The schema (:212-233): `suppliesPerTrip: z.number().int().nonnegative()` on a ship, and `supplyGood` a string the superRefine also requires to be a vendor good (`supplyGood "<id>" is not a vendor good`).
   - `export function voyageSupplies(content: ShipsContent, ships: Record<string, number>): number`: over counts of 1 or more, the sum of `Math.floor(count) × suppliesPerTrip`; an id the content does not know counts 0.
3. packages/shared/src/reach.ts: `REACH_REASON.supplies(need, have)`: `Not enough naval supplies: ${need} needed, ${have} in store.`
4. apps/server/src/services/barracks.ts:
   - `fleetInStock` (:1049-1069) reads the supply good in its one query and also returns `supplies` (whole units in store, `Math.floor`). `counts` keeps ship ids only: the supply row feeds `supplies` and nothing else (in `counts` it would reach the reach's `fleet.ships` and the move footer). Each strip ship (`FleetStripView`, :1048) carries its `suppliesPerTrip`.
   - Beside `sailHulls`, `export async function takeSupplies(exec: Exec, owner: Pick<ActingContext, "playerId">, need: number): Promise<{ ok: true } | { ok: false; have: number }>`: need 0 reads and writes nothing; otherwise it reads the supply good's row without creating one, `have` its whole units (no row reads 0). Short is `{ ok: false, have }` with nothing written (a refusal returns from the transaction, so a row created here would be committed); else `need` is drawn with `drainResource` on the row (the draw computed in SQL; a failed draw throws).
5. apps/server/src/services/mapActions.ts:
   - `act`: after the ships (step 4) and before the split (:427), a sea route takes `voyageSupplies(shipsC, sailing)` with `takeSupplies`; short is 409 `REACH_REASON.supplies(need, have)` and nothing moves. `MapSetOutReport` (:140) gains `supplies: number` (0 by land).
   - `move`: after its route and ships (step 3) and before the split (:806), the same for its `ships`. `MapMoveReport` (:734) gains `supplies: number` (0 unless by sea).
   - The comments on step 4 and on the move's step 3 name the supplies.
6. apps/server/src/services/mapReach.ts: `ReachView["fleet"]` (:57) gains `supplies: number`, set at :186 from `fleetInStock`.
7. Tests:
   - packages/shared/src/barracks.test.ts, the ships content (:140-155): both ship pins (:145-146) carry `suppliesPerTrip: 1` and `supplyGood` reads "naval-supplies"; the rejections add a fractional `suppliesPerTrip` and a `supplyGood` that is not a vendor good. A new case: `voyageSupplies` gives 0 for `{}`, 2 for two pentekonters, 7 for two pentekonters and five triremes, and 0 for an id the content does not know.
   - apps/server/src/services/mapActions.test.ts: `makePlayer` (:54) also gives 100 naval supplies with the upkeep stock (:68-70), so every existing sea case sails as before. A case that needs another stock sets it by update, as "move refusals" sets its hulls (:1134): `give` would insert a second row for one player and type, which the unique index refuses.
   - New in mapActions.test.ts: "a sea raid takes a naval supply per hull at the click; short, it is refused and nothing moves". 40 peltasts raid R078 (two seas) on two pentekonters: the set-out report has `supplies: 2` and the store reads 98. A second player with the same men and hulls and 1 supply in store is refused 409 "Not enough naval supplies: 2 needed, 1 in store.": his row is home and whole, his hulls are in port, the store still reads 1, and no march or voyage row exists for him. A land raid has `supplies: 0` and leaves the store as it was.
   - New: "a move by sea takes its supplies too": 40 peltasts moved to Emporion (one sea) on two pentekonters, as in "move refusals", have `supplies: 2` on the report, and the store reads 98.
   - New: "the reach reads the supplies in store and each hull's supplies per trip": with a pentekonter in port, `reach(ctx, at(9)).fleet.supplies` is 100 and its entry in `fleet.hulls` has `suppliesPerTrip: 1`.
   - apps/server/src/routes/map.test.ts: the reach fleet pin (:113) gains `supplies: 0`.

## Commit 4: web: the supplies on the picker and the cards

1. apps/web/src/api.ts: `FleetHull` (:1806) gains `suppliesPerTrip?: number`, `FleetView` (:1807) `supplies?: number`, the Barracks view's fleet ships (:1775) `suppliesPerTrip?: number`, and `MapSetOutReport` (:1863) and `MapMoveReport` (:1885) `supplies?: number`. Optional: an older payload has none.
2. apps/web/src/map/World2Map.tsx:
   - `automatic()` (:1689-1703) takes the seas as an argument (`automatic(steps)`); `seaSteps`, `chosenShips` and the Ships section stay actions only (a move sends no ships, and the server assembles its own).
   - The hulls a sea crossing sails: an action's chosen hulls (`chosenShips`, as now); a move's, `automatic(route.steps)` when its route is by sea and the payload has hulls (transports first, warships for what is still short, as the server's `assembleFleet` takes them). Their supplies are each hull's count × its `suppliesPerTrip`; a payload without hulls, or hulls without `suppliesPerTrip`, shows no supplies and checks nothing.
   - A move's sea route with hulls in the payload names the hulls that will sail in place of the whole stock ("space 40 of 60 aboard · 2 pentekonters"); without hulls it reads as today.
   - The footer's sea route (:1879-1880) adds " · N naval supplies" ("1 naval supply" for one) before " · arrives in" when N > 0. With `fleet.supplies` present and below N, after the hull and range checks, the verdict is `REACH_REASON.supplies(N, fleet.supplies)` (import it from @massalia/shared, as `routeFor` is) and Go is disabled.
   - The set-out and move cards (:1913-1929): when the report's `supplies` is above 0, a note under the line reads "N naval supplies for the voyage." ("1 naval supply" for one).
3. apps/web/test/towns-and-move.test.tsx:
   - The hulls fixture (:185-188) gives each hull `suppliesPerTrip: 1` and the stock (:189) `supplies: 10`. In the chosen-fleet case (:192) the footer reads " · 2 naval supplies" for the automatic two pentekonters and " · 4 naval supplies" with two triremes added; the existing footer strings still read as they do.
   - New: "short of naval supplies the picker refuses before Go": the same raid with `supplies: 1` reads "Not enough naval supplies: 2 needed, 1 in store." and Go is disabled.
   - New: "a sea move names the hulls that will sail and their supplies": 40 peltasts moved to Emporion (one sea from R060 in `moveTargets`) with the hulls fixture read "· 2 pentekonters" and " · 2 naval supplies", not the whole stock.
   - The set-out card case (:87) gains a sea report with `supplies: 2` reading "2 naval supplies for the voyage."; the land card has no such note.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 4, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- Each new or changed test by name, and anything that came out differently from this prompt, with the reason
- For ruling, as rendered: a slave's locked Barracks (banner and a button title), an outbound row's red bar beside a returning row's green one, the picker footer with its supplies and the short-of-supplies refusal, and a set-out card's supplies note
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, Pages green and API health.

## STOP 1 ruling (9 Oct 2026)

1. A slave's locked Barracks as rendered: accepted. "The unfree may not raise an army." on the banner and as the altar buttons' title.
2. The road out in red as rendered: accepted. `.barracks-bar.out`, from #7a2e34 to the theme's danger red, on a raid, an attack or a scout bound for its place; green once it is bound home, and for moves.
3. The picker's supplies as rendered: accepted. "· 2 naval supplies" before the arrival clock; "Not enough naval supplies: 2 needed, 1 in store." with Go disabled; the sea move's "space 40 of 68 aboard · 2 pentekonters · 2 naval supplies".
4. The card note: accepted. "2 naval supplies for the voyage." ("1 naval supply" for one).
5. The sea move's footer keeping the whole stock's space: accepted. The prompt's 60 was only an example; the footer names the hulls that sail and keeps the stock's space as before.
6. `supplyGood` checked by a superRefine on the whole ships content: accepted, with the message as given.
7. `takeSupplies` reading the row with a plain select, so a player who never held naval supplies reads 0 and is refused without a row being made: accepted, as the prompt asks.

One commit: this ruling appended verbatim to docs/barracks/barracks-prompt-4.md under its heading, subject `docs: the barracks prompt 4 STOP 1 ruling`. Run the gate at the new HEAD, then `pnpm audit --audit-level=high`. On GATE GREEN and audit exit 0, push as the prompt's Push section says: fast-forward only, plain `git push`. Report the Committed line, the gate's last line with suite counts, the audit exit code, remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, Pages green and API health. On any red, STOP with the log and do not push.
