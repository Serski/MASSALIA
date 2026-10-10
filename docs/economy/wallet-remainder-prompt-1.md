# Economy fix: the wallet keeps its fractions

Drafted by Claude on 10 Oct 2026 against 7cd7d2c. Save this prompt as docs/economy/wallet-remainder-prompt-1.md in the first commit. Read AGENTS.md first. No migration, no production write. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

Every settle pays a player what his buildings earned since the last one, less their upkeep, as Math.round(net), then sets the income marker's amount to 0, so whatever the rounding dropped is gone. A player settles on every dashboard load (GET /me/state), every map load and every building, barracks, map and koinon action. A Slipway earns 16.8 drachmae a day, 0.35 in half an hour: a player who settles every half hour has each of those rounded to 0 and banks nothing. A player who comes back once a day loses under half a drachma. The more he plays, the less his buildings pay him. The other way round, an idled building's small upkeep rounds to 0 on each frequent settle and is never paid.

The fix keeps the remainder. The settle still credits whole drachmae, and stores what it could not credit in the income marker's amount, which the next settle already adds to its net. Settling often then banks what settling once would, within a drachma.

## Rulings (10 Oct 2026)

1. The remainder carries. Each settle credits round(net), where net is the carried remainder plus the stretch's income less its upkeep, and stores net − round(net) (from −0.5 up to 0.5) as the income marker's amount, on the update and on the first insert alike.
2. A shortfall is forgiven whole. When the settle leaves the wallet short (owed > 0), the carry is 0, so a forgiven shortfall never comes back as a carried one.
3. The settle's `income` and the Ledger's `pendingIncomeTotal` are the stretch's own income, without the carry, so the collect receipt and the Ledger read as they do now. `collected` stays the whole drachmae credited.
4. No back pay. Nothing records what the rounding took, so it is not repaid.
5. No migration and no production write. Every income marker's amount is 0 today (Phase 0 checks it), and the first settle after the deploy starts carrying.
6. Not in this prompt: the staff and barracks settles (they settle whole days, so they lose at most half a drachma a day) and the season coefficient each income stretch takes from its end instant.

## Scope

One commit, which also saves this file. Touch only:
- docs/economy/wallet-remainder-prompt-1.md (this file)
- apps/server/src/services/buildings.ts: settleWallet, the comment inside it on the wallet write, and the incomePending line in mine
- apps/server/src/services/buildings.test.ts: three new tests

Do not touch: the markers' timestamps and their GREATEST guard, pendingIncome, continuousUpkeep, incomeAccrued, settleStaffing, settleBarracks, settleLeagueGrants, collect, the web, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at 7cd7d2c or a fast-forward of it; say which.
- apps/server/src/services/buildings.ts: INCOME_TYPE "building_income" (:201), and nothing else in apps/ or packages/ writes that type; readWallet (:268); WalletSettle (:547); settleWallet (:578-616): income adds the marker's amount to pendingIncome (:591), net = income − upkeep (:593), owed from the wallet read under the caller's player lock (:599), the relative clamped credit of Math.round(net) (:600-603), the marker's amount reset to "0" with GREATEST on lastUpdatedAt (:604-611) or a first insert with amount "0" (:613), and collected Math.round(net) in the return (:615). settleAll (:775) runs it; every caller takes lockPlayer first. mine (:951) adds the marker's amount to incomePending (:1015). collect (:1368) reports wallet.income and wallet.collected (:1384, :1390).
- Building upkeep is 0 a day at tier 1 and 1 at tier 2 (packages/shared/src/buildings.ts:12); the Slipway earns 16.8 a day and the Emporion 19.2 (content/buildings/buildings.json).
- apps/server/src/services/settle-markers.test.ts:95 expects an earlier-clock settle to report income 0, upkeep 0 and collected 0, and the state after it to equal the state before, amounts included. buildings.test.ts:588 expects mine's pendingIncomeTotal to be 0 right after the dismiss settle. Both must stay green unchanged.
- The web shows pendingIncomeTotal only from 1 drachma, floored (LedgerPanel.tsx:613, :751), and the collect receipt shows `collected` (:631); sheets.tsx keeps building_income out of the inventory (:40).

Then this production read, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If it cannot run, say so at STOP 1 and carry on.
- `SELECT count(*) AS markers, count(*) FILTER (WHERE amount <> 0) AS nonzero FROM resources WHERE type = 'building_income'`. A nonzero count is a STOP 0: something else writes the marker.

## Commit 1: economy: the wallet settle carries its remainder

1. buildings.test.ts first, in the Ledger suite, three tests. Run them against the settle as it is and read the result: the first two must fail.
   - Two shipbuilders build the Slipway at T0 (it stands at T0 + 1 hour). One collects every 30 minutes from T0 + 1 hour to T0 + 23 hours, the other once at T0 + 23 hours; all of it inside the first Winter and the new building's guard. Their wallets end within 1 drachma of each other, and the first has banked at least 14 drachmae of income.
   - After one collect, the income marker's amount equals that collect's income − upkeep − collected (toBeCloseTo) and lies from −0.5 up to 0.5.
   - A tier-2 Estate (built and upgraded as the upgrade test at :184 does), idled by setting its slaves to 0 outside the settle, with the wallet at 0: a collect a day later leaves the wallet at 0, owed above 0 and the marker's amount at 0.
2. settleWallet: carried is the marker's amount (0 with no marker); income is pendingIncome alone; upkeep as now; net = carried + income − upkeep; credit = Math.round(net); owed as now, from the locked wallet read and net; carry = owed > 0 ? 0 : net − credit. Credit the wallet with credit as now. Write String(carry) as the marker's amount, in the update (GREATEST on lastUpdatedAt as it is) and in the first insert. Return { income, upkeep, collected: credit, owed: Math.round(owed) }.
3. The comment above the wallet write says what the carry is: the settle banks whole drachmae and keeps the rest for the next one, so settling often banks what settling once would; a shortfall is forgiven whole and carries nothing.
4. mine: incomePending is pendingIncome alone, without the marker's amount.
5. Run the three tests again, then the server suite.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 1, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>
- Gate: the last line, suite counts; the audit exit code
- The production read
- The first test's two wallets with the fix, and what the three tests did against the settle as it was
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. If CI goes red before Checkout on a registry pull, rerun it once; if Railway then leaves the commit SKIPPED, deploy it as AGENTS.md says (environmentTriggersDeploy, the server first, then the worker). Any other red is a STOP with the log. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; no migration applied
- API health
- read only, an hour after the deploy: the marker count again, how many now carry a nonzero amount, and the smallest and largest amount (all from −0.5 up to 0.5)

Anything off is a STOP: report it and wait. Do not write to production to fix it.

## STOP 1 ruling (Argiris, 10 Oct 2026)

- Deviation 1: keep `Math.round(net) || 0`.
- Deviation 2: fine as is.
- Deviation 3: keep the clause, made exact: at an earlier clock the carry rides through unchanged unless the wallet is short, in which case it is forgiven like any shortfall. Commit that comment alone: "economy: the earlier-clock comment names the shortfall case".

Then append this ruling to docs/economy/wallet-remainder-prompt-1.md as its own commit, run the gate at that HEAD and read its last line, then push, following the Push section of the prompt. Report as it says.
