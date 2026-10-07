# Admin: the Military block on a character's sheet

Save this prompt as docs/admin/admin-units-prompt-1.md in the first commit (the koinon prompts have referred to this path since 4 October; this is that prompt). Repo HEAD when this was drafted: 6c37320. No migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

The admin sheet (`GET /admin/characters/:characterId/sheet`, the "stats and inventory" section of `/admin`) gains a fourth block, Military: the levy, the altar and every unit row the player owns, each adjustable the way goods and pops are. Every edit is relative or explicit, takes a reason, settles the player's economy first under the player lock (`settledEdit`), refuses rather than clamps, writes one `effect_log` row of its own kind and one `admin_audit` row, and returns the new value. Ships are goods and stay in the Goods block.

Rulings already made (7 Oct 2026): all five actions (adjust a row's count, remove a row, grant trained men, adjust the levy, cool the altar); grants are trained men only, bands come from the market; a count change is allowed on trained rows only; a row pledged to a koinon muster or on the march is refused for every edit; the block sits inside the existing sheet. Standing from 4 Oct 2026: adding men (a grant, or a positive count change) is refused below the militia gate, since a player under it can neither move nor disband them.

## Scope

Two commits; the first also saves this file. Touch only:
- docs/admin/admin-units-prompt-1.md (this file)
- apps/server/src/routes/admin.ts
- apps/server/src/services/barracks.ts (only to export `massaliaRegionId`)
- apps/server/src/routes/admin.test.ts
- apps/web/src/api.ts (the `AdminSheet` type and the new admin calls)
- apps/web/src/AdminPage.tsx
- apps/web/test/admin-sheet.test.tsx

Do not touch: the player's own Barracks routes and services beyond that export, the settle, the levy growth, the koinon muster code, the Chronicle, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- apps/server/src/routes/admin.ts: `settledEdit(owner, edit)` at :156 locks the player, runs `settleAll`, runs the edit in the same transaction and applies shrine composure after; `characterOwner`, `deltaOf(request, max)`, `reasonOf(request, true)`, `bodyText`, `httpError` and `audit` exist (:32-:140). The sheet endpoint is at :357 and returns `{ characterId, name, drachmae, stats, goods, pops }`; the pops endpoint at :431 is the model for a guarded relative count.
- `settledEdit`'s edit callback receives `(tx, now)` only; the `ActingContext` it builds for `settleAll` is not passed on. The sheet endpoint reads rows as stored and does not settle (:353-:356).
- apps/server/src/services/barracks.ts exports `getUnitsContent`, `UnitRow`, `isActive`, `isPledged`, `PLEDGED_REFUSAL` ("These men are pledged to the koinon's muster."), `ensureLevy(exec, ctx, season)`, `seasonFor(ctx, now)`, `gateFor(exec, ctx)` and `altarBonusFor`; `massaliaRegionId()` at :108 is private. `getBattleContent().altar.goods` maps a good to its morale bonus.
- `settleAll` always runs `settleBarracks` (apps/server/src/services/buildings.ts:722), which first calls `ensureLevy` (barracks.ts:413), then releases any pledge whose muster is not open or resolved, or whose koinon the player has left (barracks.ts:417-441), and ends or renews band contracts that have run out.
- `unitDef(content, id)` is `content.units[id] ?? null`, so a prototype key such as "constructor" reads as truthy; the goods and pops endpoints check their keys with `Object.hasOwn`.
- packages/db/src/schema.ts: `player_units` (:856) has `count >= 0` as a check constraint, `readyAt` / `contractEndAt` / `basedAt` / `movingTo` / `arrivesAt` / `mission`; `player_levy` (:921) is keyed on (world_id, owner_player_id) with `men >= 0`; `players` carries `altarUntil` and `altarGood`.
- apps/web/src/AdminPage.tsx: the sheet section at :187-:231 renders Stats, Goods and Household tables with an Adjust button per line through `adjustLine(open, what, current, work)` and `promptAdjust` (window.prompt for the amount, then the reason); `act(question, work, okNote)` confirms with window.confirm and reloads the sheet.
- apps/web/test/admin-sheet.test.tsx mocks `../src/api.js` with a factory, stubs `window.prompt` and `window.confirm`, and reads rows with `rowOf(section, label)`; apps/server/src/routes/admin.test.ts has `admin()`, `register()`, `characterFor()` and `call()` helpers, and the sheet test at :269. The test world starts when the suite does (:74).

## Commit 1: server: the Military block and its five edits

1. The sheet gains `military`:
   ```ts
   military: {
     levy: { men: number };
     altar: { good: string; mor: number; until: string } | null; // null when cold or expired at now
     units: {
       id: string; source: "trained" | "band"; unitId: string; label: string; count: number; startCount: number;
       state: "pledged" | "moving" | "training" | "ready"; // in that precedence
       readyAt: string | null; contractEndAt: string | null; basedAt: string; movingTo: string | null; arrivesAt: string | null;
       editable: boolean; // false when pledged or moving
     }[];
   }
   ```
   `state`: `pledged` when `isPledged(row)`; else `moving` while `movingTo !== null` and `arrivesAt` is after now; else `training` when a trained row's `readyAt` is after now; else `ready`. The sheet does not settle, so a row that has arrived since the player's last load reads as home and editable, with `basedAt` showing where it now stands (its `movingTo`); the edit's own settle lands it first. There is no `mission` state: a muster mission is `pledged`, and every other mission travels with `movingTo` until the settle clears both. The label comes from units.json or bands.json by `unitId`, falling back to the id. The levy is read, not ensured (a player with no row reads `men: 0`). The altar reads `players.altar_until` / `altar_good` and `getBattleContent().altar.goods` for `mor`.
2. `settledEdit` hands its edit the `ActingContext` it already builds, as a third argument; the existing callers ignore it. Five endpoints under `/admin/characters/:characterId/`, each `requireAdmin`, each through `settledEdit`, each writing an `effect_log` row with `adminUserId` in the detail and an `admin_audit` row, each returning `{ ok: true, characterId, … }` with the new value. Deltas go through `deltaOf(request, 10_000)`, as pops do. Adding men (a grant, or a positive count change) is refused below the gate: `gateFor(tx, ctx)`, 409 "Militia <required> required."
   - `POST units/:unitRowId/count` `{ delta, reason }`: trained rows only (a band answers 409 "A band is a fixed company; remove it or leave it."). Refuse a pledged row with `PLEDGED_REFUSAL` and a moving row with "These men are on the march; wait until they arrive." (both 409). The row must belong to the character's player (404 otherwise). Guarded relative update: `count + delta >= 0` or 409 "They field only N <plural>." A row that reaches 0 is deleted in the same transaction, as a battle deletes a row it wipes out; the response carries `count: 0` and `removed: true`. `startCount` rises with a positive delta so the progress arithmetic never exceeds 100%. Kind `admin_adjust_units`.
   - `POST units/:unitRowId/remove` `{ reason }`: trained or band, refused when pledged or moving as above. Deletes the row regardless of the player's release rule. Kind `admin_remove_units`. Returns `{ removed: true, unitId, count }`.
   - `POST units/grant` `{ unitId, count, reason }`: `unitId` must be an own key of the units content (`Object.hasOwn(getUnitsContent().units, unitId)`; 400 otherwise), `count` a positive integer up to 10,000. Inserts a trained row: `startCount = count`, `recruitedSeason = seasonFor(ctx, now)`, `readyAt = now` (ready at once), `basedAt = massaliaRegionId()`, `createdAt = now`. No levy draw, no gear. Kind `admin_grant_units`. Returns the new row id.
   - `POST levy` `{ delta, reason }`: relative, `men + delta >= 0` or 409 "The levy holds only N men." The settle inside `settledEdit` has already made the levy row (barracks.ts:413), so the edit is the guarded update alone. Kind `admin_adjust_levy`.
   - `POST altar/cool` `{ reason }`: `UPDATE players SET altar_until = NULL, altar_good = NULL WHERE id = <player> AND altar_until > now RETURNING id`; no row → 409 "The altar is already cold." (an expired altar is cold, as the sheet shows it). Kind `admin_cool_altar`.
3. Export `massaliaRegionId` from barracks.ts (`seasonFor` and `gateFor` are already exported). No other change there.
4. admin.test.ts, one new test after the sheet test. Seed so that the settle every edit runs first leaves the fixture alone: every row with `createdAt` now (no upkeep day owed); a trained row (10 hoplites, ready); a band row with `contractEndAt` ahead; a pledged row (`mission: { kind: "muster", musterId, … }`, `movingTo: null`) whose muster is real and open (a koinon with the target as a member and a `koinon_musters` row with `status: "open"` and `launchAt` ahead), since the settle releases any other pledge; a moving row with `arrivesAt` ahead; a levy of 50 with `lastGrowthSeason` 0; and a lit altar. Then assert in order: the sheet's `military` block lists all four rows with the right `state` and `editable`, the levy and the altar; at militia 0 a grant is 409 with the gate message; raise the target's militia to 20; count +5 on the hoplites gives 15 with `startCount` 15; count −20 is 409 with the "field only" message; count on the band is 409; count on the pledged row is 409 with `PLEDGED_REFUSAL`; count on the moving row is 409; count −15 deletes the row and answers `removed: true`; remove on the band deletes it; grant 20 peltasts inserts a ready row at Massalia and draws nothing from the levy; levy −60 is 409, levy +10 gives 60; altar cool clears both columns and a second cool is 409; every call wrote exactly one `admin_audit` row and the right `effect_log` kind; a non-admin is 403 on each.

## Commit 2: web: the Military block in the sheet

1. apps/web/src/api.ts: `AdminSheet` gains `military` as above; new calls `adminAdjustUnits(characterId, unitRowId, delta, reason)`, `adminRemoveUnits(characterId, unitRowId, reason)`, `adminGrantUnits(characterId, unitId, count, reason)`, `adminAdjustLevy(characterId, delta, reason)`, `adminCoolAltar(characterId, reason)`.
2. apps/web/src/AdminPage.tsx, inside the sheet section after Household, an `<h3>Military</h3>` block:
   - A line "Levy: N men" with Adjust (the `adjustLine` flow, calling `adminAdjustLevy`).
   - A line "Altar: cold" or "Altar: <good> · +N morale until <date>" with a Cool button when lit (reason via window.prompt, confirmation via `act`).
   - A table with columns Unit, Men, State, Base and an actions cell: Adjust (trained rows only, the `adjustLine` flow calling `adminAdjustUnits`) and Remove (reason prompt, `act`). Both buttons are absent when `editable` is false, and the State cell then reads "pledged to a muster" or "on the march".
   - Under the table a "Grant men" button: `window.prompt` for the unit id (listing the trained unit ids in the prompt text), then the count, then the reason, then `act` calling `adminGrantUnits`.
   - The wording above is mine and yours to change at STOP 1.
3. apps/web/test/admin-sheet.test.tsx: add the new mocks to the factory and the `military` block to `sheetOf`; a second test "the Military block" that reads the levy, the altar and the four rows with their states, adjusts the hoplites (+5, "event bug") and asserts the call, removes the band and asserts the call, sees no buttons on the pledged and moving rows, grants 20 peltasts through the three prompts and asserts the call, adjusts the levy, cools the altar, and asserts the sheet reloaded after each. Plain DOM selectors as the file already uses; no role queries.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 2, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The five endpoints with their request bodies and refusal messages, verbatim
- The Military block's wording as rendered, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, Pages green, API health. No migration: confirm the deploy log shows every migration skipped.

## STOP 1 ruling (7 Oct 2026)

1. Loading the map topology in the admin suite's setup: accepted.
2. The trained unit ids as a literal in the grant prompt: accepted. The server checks every id, so the hint cannot grant a wrong unit. When a trained unit is added to units.json, its id goes into that hint in the same commit.
3. The Military block's wording stands as rendered, "under contract" for a band at home included.

Append this ruling verbatim to docs/admin/admin-units-prompt-1.md as one docs commit. Run the gate at the new HEAD and read its exit code; on GATE GREEN with the tree clean, push as the prompt's push section says and report. Any red is a STOP with the log.
