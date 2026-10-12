# Politics 3b: a party leader may stand for league office

Save this prompt as docs/politics/politics-prompt-3b.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: b5cf075. No migration, no production write. One commit. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Run the suites the files touch and read the exit code. Commits stay local; no push until I say push. This needs to be live before declarations close at 00:00 UTC on 13 October, so report as soon as the gate is green.

## What it is

Politics prompt 3 made the party Archon and party Ephor for-life seats whose holders may not stand for the League's Archon or Ephor: the career fork between machine boss and magistrate. The four party seats in World 2 were handed out as interim seats on day one, and Ajax Marius, the Palaioi party archon, cannot declare for Archon because of it. Ruling (Argiris, 12 Oct 2026): the bar goes entirely. A party leader, interim or chosen, may stand for and hold league office. Nothing else about the party seats changes: still for life, still filled by the internal ballot when vacant, still shown on the Politics panel.

## Phase 0: recon (no code)

Confirm at b5cf075; any mismatch is a STOP 0.

- `packages/shared/src/elections.ts:113`: `barredFromLeagueOffice: boolean` on the `canDeclare` input, and `:123` the check that answers "A party leader may not stand for league office."
- `packages/shared/src/elections.test.ts:99` sets the field false in the base input; `:116-117` is the test "bars party leaders via the barredFromLeagueOffice hook".
- `apps/server/src/services/elections.ts:66-74`: `barredFromLeagueOffice(characterId)` reads `offices` for a `party_archon` / `party_ephor` row; it is passed at `:121` (declaration) and `:205` (the candidacy view).
- `packages/db/src/agenda.ts:229-237`: `partyLeaderCharacterIds`, "Characters barred from LEAGUE office". Confirm with a grep that nothing outside its own file calls it.
- `apps/web/src/dashboard/panels/PoliticsPanel.tsx:727`: the party-leader row's role text "For life · barred from league office".
- No test in `apps/server` seats a party leader and expects the refusal (`elections.test.ts` has none; `agenda.test.ts:311` covers the vacancy ballot and stays).

## Commit: `elections: a party leader may stand for league office`

1. Save this prompt.
2. `packages/shared/src/elections.ts`: remove the `barredFromLeagueOffice` field from the `canDeclare` input type and the check at 123. The other refusals (not a seat-holder, regent, wrong side, term limit) are untouched and keep their order.
3. `packages/shared/src/elections.test.ts`: drop the field from the base input and replace test 116 with one that proves the opposite: an input that would have been barred now passes `canDeclare`.
4. `apps/server/src/services/elections.ts`: delete `barredFromLeagueOffice` and its two call sites. No other change to declaration or the candidacy view.
5. `packages/db/src/agenda.ts`: delete `partyLeaderCharacterIds` if the grep in recon found no caller; otherwise leave it and say so in the report.
6. `PoliticsPanel.tsx:727`: the role text becomes "For life". Nothing else in the client changes: the declaration form already shows whatever reason the server gives, and this reason no longer exists.
7. Suites: `pnpm --filter @massalia/shared test`, the server's `elections.test.ts`, `agenda.test.ts` and the routes that cover declaration, and the web suite if a render test touches the Politics panel's leader rows. Typecheck and lint clean.

## Gate and STOP 1

`DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the commit; it must end `GATE GREEN … tree clean`. No push. Report:

```
Committed: <SHA> elections: a party leader may stand for league office
Gate: <the gate's last line>
Removed: the shared field and check, the server reader and its two call sites, partyLeaderCharacterIds (or why it stayed), the panel wording
Rulings for Argiris: <each with the reason, or "none">
Post-deploy check: Ajax Marius, Palaioi party archon, declares for Archon himself from the Politics panel before 00:00 UTC; the declaration is accepted and his row appears in election_candidates. Nobody declares on his behalf.
```

## Scope fence

Only the five files named. Do not touch the party seats themselves, `ensurePartyLeaders`, the internal ballot, the endorsement, the regent rules, the term limit, the election phases, the worker, any content file or stylesheet. No migration. No production write: Ajax declares himself once it is deployed.
