# Holdings 2: a raid on another house's holding is refused, and Raid greys out with Attack

Drafted by Claude on 12 Oct 2026 against 9cb7c35 from Argiris's ruling of the same day. Save this prompt as docs/barracks/holdings-prompt-2.md in the first commit. Read AGENTS.md first. No migration, no production write. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

Holdings prompt 1 greyed Attack on another house's holding and left Raid and Scout as the server allows them: a raid there meets the empty pool, "wins" and takes nothing, and a koinon muster does the same. Two raiders and a muster did exactly that on Reii the afternoon it fell.

Ruling (Argiris, 12 Oct 2026): a raid on a place another house holds is refused like an attack, and the map greys Raid with Attack. A scout still goes: it reads the place and fights nothing.

## Rulings

1. **A player's raid on another house's holding is refused at launch** with the server's existing sentence, "Another house holds this town." or "Another house holds this land.", as an attack is. A scout is not.
2. **A raid that finds the place taken turns back.** At the arrival, a raid whose target another house now holds turns back whole, as an attack does, with the march line "… found X held by another house and turned back." A scout still arrives and reads the place.
3. **A koinon muster is a raid, so a held place is no target.** The muster's call refuses a target another house holds with the same sentences; the targets list offers no held place, any house's; and an army that arrives at a place another house now holds turns back, with the report line "Found X held by another house and turned back." where today it says "held by one of our own" only for the koinon's own houses.
4. **The map greys Raid with Attack** on another house's holding, both with the sentence; Scout keeps the matrix and reach verdicts. The caption rule of prompt 1 stays.
5. **Wording.** The new muster line is mine and yours to change at STOP 1.

## Phase 0: recon (no code)

`git fetch`, `git status -sb`, `git log --oneline origin/main..main`: a dirty tree or an unpushed commit is a STOP 0. Then confirm at 9cb7c35.

- `apps/server/src/services/mapActions.ts:352` and `:360`: the refusal is `input.type === "attack" && holderOf(...)`; `:580-581`: the arrival turns back when `holder === ctx.playerId || (holder !== null && kind === "attack")`; `renderMarchLine` (packages/shared/src/chronicle.ts:320-328) already renders the "taken" stage for any action.
- `apps/server/src/services/koinonMuster.ts:129-146` `musterTarget(input)` has no held-place check and no world id; `:198` its one call site, inside `openMuster` with `ctx`; `:382-412` `musterTargets` lists every reachable town and townless region not Massalia's; `:987-995` the arrival turns back only when `participantIds.includes(holder)`; `:1118-1122` the report's `outcome` and line. `MusterReport` at 637. `holderOf`, `listHoldings` imported at 41; `listWorldHoldings` exists since prompt 1.
- `packages/shared/src/muster.ts:144-149` `MusterReportLine` and `renderMusterReportLine`'s turned-back sentence; its test at `muster.test.ts:158`.
- `apps/web/src/map/mapActions.ts` `withHolder` greys Attack alone; `apps/web/test/world2map-holdings.test.tsx:52,97` and `world2map-cards.test.tsx:163` pin Raid enabled.
- `apps/web/src/api.ts:1501-1502` and `:1937-1939` carry the outcome unions and their comments; `BarracksPanel.tsx:186` renders "Turned back from X" for any turned-back report. No client code switches on why.
- Tests: `apps/server/src/services/mapActions.test.ts:247` ("a party that finds the place taken turns back") and `:539` ("… a raid there still goes"); `koinonMuster.test.ts:794` (the own-house turn-back) and `:144` (`musterTargets`).

## Commit 1: `raids: a raid on another house's holding is refused, and turns back if it finds the place taken`

1. Save this prompt.
2. `mapActions.ts`: the two launch checks refuse every type but a scout; the arrival turns back every type but a scout; the two comments say so.
3. `mapActions.test.ts`: the test at 539 becomes "an attack or a raid is refused at launch and nothing moves; a scout there still goes", asserting both sentences for the raid on the land and the town and a scout that goes. The test at 247 gains a raid by the second player arriving after the conquest, which turns back with "20 peltasts found Salyes held by another house and turned back." and whose men go home.

## Commit 2: `koinon muster: a held place is no target, and the army turns back from another house's holding`

1. `musterTarget(input, worldId)` refuses a held town or land with the two sentences, after its own-ground checks. `musterTargets` skips every held place, any house's, read once with `listWorldHoldings`.
2. The arrival turns back for any holder. `MusterReport` gains `heldBy: "ours" | "another" | null` (null unless turned back), and `MusterReportLine` an optional `heldBy` that defaults to "ours", so an old report reads as before. The sentence for "another": "Found X held by another house and turned back."
3. Tests: `muster.test.ts` the new sentence and the default; `koinonMuster.test.ts` a call on a held land and a held town refused with the sentences, a held place absent from `musterTargets`, and an army arriving at a place a non-member took after the launch turning back with the new line, `heldBy: "another"`, every man bound home. The existing own-house case asserts `heldBy: "ours"`.
4. `apps/web/src/api.ts`: the `MusterReport` type gains the optional `heldBy`; the comments at 1501 and 1937 say a raid turns back too. No rendering change: the line carries the words.

## Commit 3: `web: Raid greys out on another house's holding too`

1. `withHolder` greys Attack and Raid with the sentence; Scout and Colonise untouched.
2. The three test lines pin Raid disabled with the sentence and Scout enabled; the pure `withHolder` case says so.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 3, then `pnpm audit --audit-level=high`; `GATE GREEN: HEAD <sha>, tree clean` and audit exit 0. No push. Report:

```
Committed: <SHA> raids: a raid on another house's holding is refused, and turns back if it finds the place taken
Committed: <SHA> koinon muster: a held place is no target, and the army turns back from another house's holding
Committed: <SHA> web: Raid greys out on another house's holding too
Gate: <the gate's last line>, suite counts; audit exit code
Lines: the march line a turned-back raid reads, and the muster's new line
Rulings for Argiris: <each with the reason, or "none">
```

## Scope fence

Only `mapActions.ts` (the two checks and the arrival condition), `koinonMuster.ts` (the target check, the targets list, the arrival and the report field), `packages/shared/src/muster.ts` (the field and the sentence), `apps/web/src/map/mapActions.ts` (`withHolder`), `apps/web/src/api.ts` (the type and two comments) and the tests named. The scout, the legality matrix, the conquest and tribute rules, the plunder, the Chronicle kinds, the client's muster card and the Barracks reports do not change. No migration.

## STOP 1 rulings (Argiris, 12 Oct 2026), all four kept

1. The muster call refuses the caller's own holding with "You hold this town." / "You hold this land." Keep.
2. heldBy optional on the muster report. Keep.
3. Peltasts in the scout test. Keep.
4. The muster target list follows the server; the 409 reads as other refusals do. Keep.

Append these rulings to this prompt's docs file as its own docs commit, run the gate at HEAD and the audit, then push (plain git push, not at or after 23:00 UTC) and report: remote HEAD, the CI run with Gate and Audit, Pages, Railway server and worker on the new SHA, no migration, API health.
