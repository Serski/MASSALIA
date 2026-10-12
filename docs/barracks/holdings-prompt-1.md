# Holdings 1: a conquered town shows its holder on everyone's map

Save this prompt as docs/barracks/holdings-prompt-1.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: c7bcea4. No migration, no production write. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. A map change needs a render test before push (AGENTS.md). Commits stay local; no push until I say push.

## What it is

On 12 October Konrad Curze took Reii, the first conquest in the game. Nobody can see it. The map shows a holding only to its holder: a held region is recoloured as Massalia's on his map alone, and a held town changes nothing but his own town panel. Every other player still sees Reii as a Saluvii town in the Vocontii region (R047), and learns otherwise only when an attack is refused with "Another house holds this town."

Ruling (Argiris, 12 Oct 2026): a conquered town changes the map for everyone, and the town says who controls it. The same for a conquered region.

## Rulings

1. **Who holds what is public.** Every signed-in player sees, for every held town and region, the holder's house and character name. Nothing else about the holding is public: no garrison count, no tribute, no dates. The holder's own panel keeps its tribute line as today.
2. **The map shows it.** A held town shows Massalia's town marker (the Greek culture icon her towns carry) and, in its town panel, Massalia's crest, name and colour, for every viewer. A held region is painted Massalia's for every viewer, as it is for the holder today.
2a. **A region with towns changes colour only when every one of its towns is held by the same house.** One held town out of two shows its new owner on its marker and in its panel, and the region keeps its colour; the second town taken by the same house flips the region. Towns held by two different houses never flip it. A region holding is always a townless region (the server sends an attack on a region with towns to its towns: "This land answers to its towns: choose one.") and is painted as in ruling 2. The rule is computed on the client from the public holdings and the region's town list in world2.json; the server records nothing new. 79 of the 86 non-Massalia regions with towns have a single town, so there one conquest flips the region; Reii is the only town of R047.
2b. **A town held by a player cannot be attacked.** The server already refuses it at launch; the map now greys Attack on every viewer's panel with the server's sentence, and the picker never opens for it.
3. **The town says who.** The town panel, for a viewer who is not the holder, reads "Held by House Kleitos · Konrad Curze" under the survey, where the holder's own panel reads the tribute line. A held region's panel, and the panel of a region flipped under 2a, read the same line for a viewer who is not the holder. The region panel's town list marks a held town with "· held by House Kleitos", or "· held by your house" for the viewer's own.
4. **The paint is not the legality.** Massalia's colour and crest on another house's holding are display only. The legality matrix keeps today's owners (the content owner, with Massalia only for the viewer's own holdings), so another house's town or region never reads "Massalia does not act against her own". On another house's holding Attack is greyed with the server's own sentence, "Another house holds this town." or "Another house holds this land."; Raid and Scout keep the matrix and reach verdicts, as the server allows them (a raid meets the town's empty pool and takes nothing).
5. **Wording.** The house name is the noble house's name as the Interactions and Elections views already carry it (`houseName`), the character name is the player's character name. These strings are mine and yours to change at STOP 1.

## Phase 0: recon (no code)

First `git fetch`, `git status -sb` and `git log --oneline origin/main..main`. A dirty tree, or any commit on main that is not on origin/main (another prompt's work), is a STOP 0: list them. Then confirm at c7bcea4. A behaviour that differs is a STOP 0; a line that moved a few is not.

- `apps/server/src/routes/map.ts:127-174`: `GET /military` answers `{ towns, regions }`. The server's `MilitaryPayload` is declared in the same file at 32-35, and the comment at 121-126 says the route returns only what the requester is entitled to see. The client's own type is `apps/web/src/map/World2Map.tsx:79` (not api.ts), read by `loadMilitary` at 394-401 on load and after an arrival. The route's test is `apps/server/src/routes/map-military.test.ts`.
- `apps/server/src/services/holdings.ts`: `holderOf` at 39, `listHoldings(exec, ctx)` at 43 (the requester's holdings only). `player_holdings` carries `world_id, region_id, town_id ("" for a region), owner_player_id, kind, previous_owner, since, last_garrisoned_at, last_tribute_at`. There is no reader of every holding yet. A holding reverts only inside its holder's own settle (`settleHoldings` from `settleBarracks`); this prompt does not change that.
- `apps/server/src/services/mapActions.ts:343-361`, the target checks: the requester's own town answers "You hold this town."; an attack on a town another house holds answers "Another house holds this town." (352); a region with towns answers "This land answers to its towns: choose one."; an attack on another house's region answers "Another house holds this land." (360). Raid and Scout pass. At the arrival (577-581) only an attack turns back from another house's holding.
- `World2Map.tsx`: `holdingLine` at 20-30; `StateCrest` at 327; `heldRegions` / `heldTowns` from `reachBases` at 491-492 and `politicsView` at 495-500 (the viewer's held regions as Massalia's); everything painted reads `politicsView`: the realm labels at 538-560, `townCultureIcon` at 564-575 (each town takes its region owner's culture icon) and the owner tint at 967-980; `selectedOwnerId` at 1067 from `politicsView` feeds both the region panel's crest and the legality (`regionActions` at 1104, `townOwnerId` and `townActions` at 1157-1158); the region panel's town list at 1205; the `TownPanel` call at 1252-1265 (`stateName`, `ownerId`, `color` take Massalia for the viewer's held town); `TownPanel` at 1430 (its `ownerId` is the crest; its actions come in computed); the town markers at 1359-1371, a culture icon or a plain white dot, with no crest and no colour.
- `apps/web/src/map/mapActions.ts`: `disabledReason` and `mapActionButtons` (legality from the shared matrix by owner) and `withReach`. No "another house holds it" reason exists; it is added here.
- Names: `players.name` is the character name and `players.house_slug` the house; `elections.ts` `holderInfo` joins them this way, and `interactions.ts:103-118` reads `houses.name`.
- `apps/web/public/map2`: R047 is named "Vocontii" in names2.json, owned by `saluvii` in politics2.json, and its only town is `reii` in world2.json. Massalia's polity is `massalia`, culture `greek`.
- Tests: `apps/server/src/routes/map-military.test.ts`, `apps/web/test/world2map-cards.test.tsx`, `apps/web/test/world2map-hooks.test.tsx`.

## Commit 1: `server: every holding's holder on the map's military read`

1. Save this prompt.
2. `holdings.ts`: `listWorldHoldings(exec, worldId)` returning every row of `player_holdings` in the world with `regionId`, `townId` and the holder's `playerId` (owner_player_id), `characterName` (`players.name`) and `houseName` (`houses.name` by `players.house_slug`, a left join). No filter on the holder's status or activity: every holding the server would refuse an attack on must appear, so the map never offers what the server refuses.
3. `GET /military` gains `holdings: { towns: Record<townId, Holder>, regions: Record<regionId, Holder> }` with `Holder = { playerId, characterName, houseName }`, for every holding in the world, to every authenticated player, the requester's own included. No garrison, tribute or date. `towns` and `regions` as today. Update the server's `MilitaryPayload` and the comment at 121-126 to say the holders are public.
4. Route test in `map-military.test.ts`: two players, one holds a town and one a region (insert `player_holdings` rows as the holdings tests do); each sees both holdings with the right names; each entry has exactly those three keys; a player with no holdings sees the same two; `towns` and `regions` unchanged.

## Commit 2: `web: a held town and a held region show their holder on everyone's map`

1. The client's `MilitaryPayload` (World2Map.tsx:79) gains an optional `holdings`, and `loadMilitary` keeps it (absent from an old server: empty). A place is the viewer's when it is in `reachBases`, as today, and another house's when it is in `holdings` and not the viewer's.
2. Two views of the owners. `politicsView` stays as it is (the viewer's own held regions as Massalia's) and keeps feeding the legality: `selectedOwnerId` for `regionActions`, and `townOwnerId`. A new display view adds every held region and every region flipped under 2a, and feeds the paint only: the region fills, the realm labels, `townCultureIcon`, the region panel's crest, name and colour, and the town panel's `stateName`, `ownerId` (the crest) and `color`, which take Massalia for every held town. A held town in a region that does not flip still shows Massalia's marker icon. Put the flip rule in a pure helper beside `holdingLine` with its own unit test: given a region's town ids and the public town holdings, answer whether it flips and to whom (every town held, all by one `playerId`).
3. The holder line: the viewer's own panel keeps `holdingLine`; another house's town panel, region panel, and the panel of a region flipped under 2a read "Held by House {houseName} · {characterName}". The region panel's town list suffixes a held town with "· held by House {houseName}", or "· held by your house" for the viewer's own.
4. Actions: in `mapActions.ts`, a helper that greys Attack with a given sentence. On another house's town, "Another house holds this town."; on another house's region, "Another house holds this land." Raid and Scout keep the matrix and reach verdicts. The viewer's own holdings as today.
5. Render tests in `apps/web/test`, cheap and with plain selectors as AGENTS.md asks: `TownPanel` for a town held by another house reads the holder line, shows the Massalia crest, greys Attack with the sentence, and leaves Raid and Scout enabled with no "Massalia does not act against her own"; the same town held by the viewer reads the tribute line; a townless region held by another house reads the holder line, greys Attack with "Another house holds this land." and leaves Raid enabled; a region whose one town another house holds is painted Massalia's and its town list carries the suffix; a payload without `holdings` renders as today. The pure flip helper: two towns with one held does not flip; both held by one house flips to that house; one held by each of two houses does not; a region with no towns is untouched; a region with one town, held, flips.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 2, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. No push. Report:

```
Committed: <SHA> server: every holding's holder on the map's military read
Committed: <SHA> web: a held town and a held region show their holder on everyone's map
Gate: <the gate's last line>, suite counts; audit exit code
Payload: the new field's shape
Views: where the display view is built and what reads it; confirm the legality still reads politicsView
Marker: how a held town's marker now differs, and where in World2Map.tsx
Lines: the strings as built
Rulings for Argiris: <each with the reason, or "none">
```

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; no migration applied
- API health
- read only: every `player_holdings` row with its holder's name and house, which is what every map now shows. Say whether Konrad Curze still holds Reii; the Atlas check is mine.

Anything off is a STOP: report it and wait. Do not write to production to fix it.

## Scope fence

Only `holdings.ts` (the one new reader), `routes/map.ts` (the one new field on `/military`, its type and comment), `World2Map.tsx`, `map/mapActions.ts` (the Attack helper), and the tests named. Do not touch the reach route, the actions route, the conquest, reversion and tribute rules, the intel rules (a held town's garrison stays as private as today), the polity content files, the shared legality matrix, the server's `HOME_POLITY` rules, any stylesheet beyond what the marker needs, or the Chronicle. No migration. Nothing under `apps/web/public` changes.

## STOP 1 rulings (Argiris, 12 Oct 2026), all four kept

1. `houseName` nullable, with the line falling back to "Held by {characterName}". Keep.
2. Attack's sentence also becomes the touch caption when reach left none. Keep.
3. No holder line on a flipped region whose towns are all the viewer's; the town list says it. Keep.
4. Noted: the Atlas check is mine.

Append these rulings to docs/barracks/holdings-prompt-1.md as `docs: the holdings 1 prompt's STOP 1 rulings`, run the gate at HEAD and the audit, then push as the prompt says (plain git push, not at or after 23:00 UTC) and report.
