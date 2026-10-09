# Government 1: the Government tab and the League treasury

Save this prompt as docs/politics/government-prompt-1.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: a911188. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

The first of five Government prompts. The sitting Archons, Ephors and Strategoi get a Government tab in Politics with the League treasury's books and the League agenda's docket. Everyone else sees only the treasury's amount, and the docket and the ledger stop reaching their browsers. The treasury opens with 60,000 drachmae, takes in the market tax and routine fees, and collects a tax from every polis each season.

## Rulings (7 to 9 Oct 2026)

- The Government tab belongs to the sitting Archons, Ephors and Strategoi, and each of them sees all of it. Everyone else sees the League treasury's amount on the Oligarchy Council tab, and never the docket while it is drafted, the veto or the ledger. The server enforces this; hiding it in the browser is not enough.
- The League treasury opens with 60,000 drachmae, once, in every world. World 2 gets it at the first sync after the deploy, on top of what it already holds.
- The market tax and routine fees stop piling up in world_treasury: once a season the League treasury takes whatever is there, starting with everything collected so far.
- Each polis pays the League treasury a tax every season: its population × 0.02, rounded. It is the rule a conquered town's tribute follows (apps/server/src/services/holdings.ts:148) at a quarter of its rate, 910 drachmae a season at the starting populations. The Cities tab's Tax column shows that number; the number it shows now was never paid by anyone.
- The party agendas and treasuries do not change. GET /api/agenda keeps sending both parties' dockets and ledgers to every caller until the parties round. The League cards stay until prompt 2 replaces them with the Archons' motions.
- Later prompts: building projects, the motions, the buildings on the Cities tab, the stability decay and the Temple (2); the festival motion (3); war (4); the state army (5).

## Scope

Seven commits; the first also saves this file. Touch only:
- docs/politics/government-prompt-1.md (this file)
- packages/db/migrations/0070_treasury_claims.sql (new)
- packages/db/src/schema.ts (the index mirror and two comments)
- packages/db/src/leagueRevenue.ts and leagueRevenue.test.ts (new), packages/db/src/index.ts (one export line)
- packages/shared/src/government.ts and government.test.ts (new), packages/shared/src/index.ts (one export line)
- packages/shared/src/agenda.ts (treasuryConfigSchema only) and agenda.test.ts (the treasury assertion at :30)
- content/politics/politics-config.json (two keys in the treasury block)
- apps/worker/src/index.ts (the agenda-sweep only)
- apps/server/src/services/agenda.ts and services/government.ts (new)
- apps/server/src/routes/agenda.ts, routes/league.ts, routes/government.ts (new), routes/government.test.ts (new), routes/league.test.ts (new)
- apps/server/src/index.ts (one route registration)
- apps/web/src/api.ts, apps/web/src/dashboard/panels/PoliticsPanel.tsx, panels/AgendaSection.tsx (new), panels/GovernmentView.tsx (new)
- apps/web/test/politics-chamber.test.tsx (one mock) and apps/web/test/politics-government.test.tsx (new)

Do not touch: accrueTreasuries, creditWorldTreasury and its four callers, the agenda cycle, the card files, the chamber vote, the elections and offices services, the party views, CitiesView.tsx, the city drift, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at a911188 or a fast-forward of it; say which. The newest migration is 0069_muster_march.sql. If main has moved, the new file takes the next free number, and 0070 below means that number.
- packages/db/src/agenda.ts: ensureTreasuries :60, treasuryBalance :67, creditTreasury :76 (takes an exec), treasuryLedgerRows :95 (20 rows by default), accrueTreasuries :117 (it reads for `levy:s<season>` and credits when the row is absent: check-then-act, no lock).
- treasury_ledger (0023_agenda_treasury.sql) has a plain index and no unique one. The reasons written are `levy:s<N>`, `dues:s<N>:<M>members`, `cut:seat_purchase`, `cut:festival_donation` and `agenda:<cardId>`; apps/server/src/services/agenda.test.ts also writes `seed`.
- world_treasury is credited only through creditWorldTreasury (apps/server/src/services/buildings.ts:529), from market.ts:225 (the market tax), koinon.ts:174 and :550, and buildings.ts:1433 (routine fees). Nothing outside the tests reads it.
- syncAgenda (apps/server/src/services/agenda.ts:82) runs on every GET /me/state (routes/me.ts:124) and inside agendaScopeView, draftCard and vetoCard, each of which takes a `now`. The worker's hourly agenda-sweep (apps/worker/src/index.ts:177) calls accrueTreasuries itself at :182, not syncAgenda. Migrations run in the server's start command (`railway:start` in the root package.json), so the worker can be on new code before they have run.
- apps/server/src/services/festival.ts: the choregos transaction applies the choice's effects (applyChoiceInTx, :179), which can write league_cities, before it credits the League's cut on the treasuries row (:186).
- agendaScopeView (:223) gives every caller the docket (`cards`), `draftedCardId`, `vetoedCardId` and the treasury with 20 ledger rows. GET /api/agenda (routes/agenda.ts) returns league, palaioi, dynatoi and leaders to anyone with a session.
- apps/server/src/routes/league.ts: GET /cities (:111) inserts the start rows on read (:125-:135) and returns the stored `tax`, which nothing pays. The file imports @massalia/db lazily inside its handlers.
- packages/shared/src/agenda.ts: treasuryConfigSchema at :58. packages/shared/src/agenda.test.ts:30 pins `politics.treasury` with toEqual.
- packages/db/src/military.ts reads content files from the repo root (:15-:16) for ensureTownMilitary.
- apps/web/src/dashboard/panels/PoliticsPanel.tsx: TreasuryCard :691 (the balance, then six ledger rows with the raw reason), AgendaScopeSection :712, LeagueAgendaSection :772 (the Council tab), PartyGovernmentSection :782, the tab union :809, the tab buttons :852-:866. The voting heading at :760 tells the voter to vote below, but the chamber vote sits above it, in OligarchySection.
- apps/web/test/politics-chamber.test.tsx: mount() (:62) mocks agenda, offices and elections with a promise that never settles. The tab-order assertion is at :115, and the Koinon test counts five tabs.

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If they cannot run, say so at STOP 1 and carry on.
- the active world's id, name and started_at
- its three treasuries' balances, and its world_treasury balance
- `SELECT count(*) FROM treasury_ledger WHERE reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%'`. Anything but 0 is STOP 0: the index in commit 1 would not build.
- its league_cities rows: city_id and population
- its archon, ephor and strategos seats, and which of them are filled

## Commit 1: db: the League treasury's once-only credits, claimed by their ledger row (migration 0070)

1. Save this prompt file.
2. packages/db/migrations/0070_treasury_claims.sql:
```sql
   -- The League treasury's once-only credits (government prompt 1). The ledger
   -- row is the claim: 'opening' once per world, 'tax:s<N>' and 'fees:s<N>' once
   -- per world per season. Every other reason repeats and stays unconstrained.
   -- Idempotent: IF NOT EXISTS.
   CREATE UNIQUE INDEX IF NOT EXISTS treasury_ledger_claim_idx ON treasury_ledger (world_id, owner, reason)
     WHERE reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%';
```
3. schema.ts: mirror it on `treasuryLedger` as a partial `uniqueIndex(…).on(…).where(sql…)`, the way oligarchSeats declares its own (:556).

## Commit 2: shared: the Government's seats, the polis tax and the ledger's words

1. treasuryConfigSchema gains `openingBalance: z.number().int().nonnegative()` and `taxPerHead: z.number().min(0).max(1)`. politics-config.json's treasury block gains `"openingBalance": 60000` and `"taxPerHead": 0.02`. agenda.test.ts:30 pins all five keys.
2. packages/shared/src/government.ts, exported from index.ts, all pure:
   - `GOVERNMENT_OFFICES = ["archon", "ephor", "strategos"] as const`, and `governmentSeats(held: HeldOffice[])`: the held seats among those three as `{ office, side }`, Archon first, then Ephor, then Strategos.
   - `polisTax(population, cfg: TreasuryConfig)`: `Math.round(Math.max(0, population) * cfg.taxPerHead)`. `leagueTax(populations: number[], cfg)`: the sum of `polisTax` over each polis, rounded per polis as tribute is rounded per town.
   - `treasuryClaimReason`: `opening` is `"opening"`, `tax(season)` is `` `tax:s${season}` ``, `fees(season)` is `` `fees:s${season}` ``.
   - `treasuryReasonLabel(reason, cardTitle?: (cardId: string) => string | undefined)`:
     - `opening`: "Opening balance"
     - `levy:s…`: "Levy"
     - `tax:s…`: "Taxes of the poleis"
     - `fees:s…`: "Market tax and fees"
     - `cut:seat_purchase`: "Share of a seat sale"
     - `cut:festival_donation`: "Share of a festival gift"
     - `agenda:<id>`: "Passed measure: <title>", or "Passed measure" when the title is unknown
     - anything else: the reason as stored

     The words are mine and yours to change at STOP 1.
3. government.test.ts: party offices are not Government seats; polisTax(20000) is 400 at 0.02; leagueTax over the nine start populations, read from content/cities/cities.json, is 910; every label, an unknown card id and an unknown reason.

## Commit 3: treasury: the League opens with 60,000, takes the fees and taxes the poleis each season

1. packages/db/src/leagueRevenue.ts, exported from index.ts:
   - `ensureLeagueCities(exec, worldId)`: reads content/cities/cities.json from the repo root as military.ts does, through `parseCitiesContent`, memoized, and inserts each polis's start row ON CONFLICT (world_id, city_id) DO NOTHING. These are the rows GET /api/league/cities inserts today.
   - `collectLeagueRevenue(cfg: PoliticsConfig, now = new Date())`, for the active world only, at season = `gameDate(now.getTime(), startedMs).seasonIndex`:
     1. A cheap read first, because GET /me/state runs this on every dashboard load: the world's League ledger rows with reason `opening`, `tax:s<season>` or `fees:s<season>`, and world_treasury's balance. When nothing is due (the opening row is there or `openingBalance` is 0, this season's tax row is there or `taxPerHead` is 0, and this season's fees row is there or the pot is empty), return without a transaction.
     2. Otherwise `ensureTreasuries` and `ensureLeagueCities`, both outside any transaction. They are idempotent inserts, and ensureLeagueCities must not run under the locks below: the festival transaction writes league_cities before it takes the treasuries row, so the reverse order here could deadlock.
     3. Then one transaction. It locks the League's treasuries row first (`SELECT … FOR UPDATE`), then reads the three ledger rows again, since the first read took no lock. Each claim still missing is the ledger insert with `ON CONFLICT DO NOTHING` (no conflict target) and `RETURNING`, and the money moves only when a row comes back. Every credit and debit is a relative write whose row count must be 1, or the transaction throws and nothing is kept. In this order:
        - Opening, when `openingBalance` is above 0: claim `opening` with that amount, credit the League.
        - Tax: `leagueTax` over the world's league_cities populations, read with a plain select. Above 0: claim `tax:s<season>` with that amount, credit the League.
        - Fees, last, so the world_treasury lock that market sales wait on is held for the shortest time: read world_treasury's balance `FOR UPDATE`. Above 0: claim `fees:s<season>` with that amount, debit world_treasury guarded (`balance = balance - X WHERE world_id = $1 AND balance >= X`), credit the League. An empty pot writes nothing, so money that comes in later that season goes with a later run, and never twice in a season.

     The lock and the second read stop two runs from crediting twice even before the index exists, which matters because the worker can be on this code before the server's start command has run the migration; the index makes it a database rule. As with the levy, only the current season is ever taxed: no backlog.

     It returns `{ opened, fees, tax }`, the amounts this call credited.
2. syncAgenda calls it right after accrueTreasuries and broadcasts when it credited anything. The worker's agenda-sweep calls it after accrueTreasuries and adds `revenue: opening N, fees N, tax N` to its log line.
3. schema.ts: the comment above `worldTreasury` (:951) says the League treasury takes its balance once a season (collectLeagueRevenue).
4. leagueRevenue.test.ts, DB-gated as sweeps-world.test.ts is, with the config parsed from content:
   - a fresh active world: one call writes `opening` (the config's amount) and `tax:s<N>` (910 at the start populations), creates the nine league_cities rows, and writes no fees row while the pot is empty
   - a second call in the same season writes nothing
   - with world_treasury at 37, the next call writes one `fees:s<N>` row of 37, world_treasury reads 0 and the League is up 37; a further call writes nothing
   - the next season: one new tax row and nothing else
   - a fresh world with two calls at once (`Promise.all`): one `opening` row, one tax row, the balance credited once
   - an ended world beside the active one gets nothing
   - a second `opening` row inserted directly for the same world fails on the index

## Commit 4: server: the Cities tab's tax is what each polis pays a season

1. routes/league.ts GET /cities: the inline insert gives way to ensureLeagueCities (imported lazily, as the file does), and each CityView's `tax` becomes `polisTax(population, getPoliticsConfig().treasury)`. The stored `tax` column and content's `start.tax` stay, unused; the comment above `tax` in schema.ts (:1215) says so.
2. routes/league.test.ts (new, a minimal app as the other route tests build one): 401 without a session; each city's tax is polisTax of its population, Massalia's 400 at the start.

## Commit 5: server: the Government view, and the League's docket and ledger leave the public agenda

1. services/agenda.ts: export `heldOffices`. Add `publicLeagueView(view)`: `cards` holds only the card going to the vote, which is the drafted card while voting when it is not the vetoed card, and is empty in every other case. After a veto an Archon may draft another card, and that one goes to the vote (packages/db/src/agenda.ts:371), so the test is `draftedCardId !== vetoedCardId`, not `vetoedCardId === null`. `draftedCardId` is that card's id or null; `vetoedCardId` is null; the treasury keeps its balance and loses its ledger; `youMayDraft` and `youMayVeto` are false.
2. routes/agenda.ts GET /: `league` goes through publicLeagueView for every caller, Government members included, since their docket is in the Government tab. The party scopes and leaders are unchanged.
3. services/government.ts, `governmentView(actor, now)`:
   - `seats = governmentSeats(await heldOffices(actor.id))`. With none it returns `{ member: false }` and nothing else.
   - Otherwise it calls agendaScopeView first, which syncs, so a fresh world's opening and tax are already in; then it reads the balance, the ledger and the populations, and answers:
```ts
     {
       member: true;
       seats: { office: "archon" | "ephor" | "strategos"; side: "palaioi" | "dynatoi" | null }[];
       treasury: {
         balance: number;
         taxPerSeason: number; // leagueTax over the world's poleis now
         ledger: { delta: number; label: string; dateLabel: string; createdAt: string }[]; // the 40 newest
       };
       league: AgendaScopeView; // agendaScopeView(actor, "league", now), unfiltered
     }
```
     `label` is treasuryReasonLabel with the League card titles from getAgendaPools(). `dateLabel` is `formatGameDate(gameDate(<the row's createdAt in ms>, startedMs))`, for example "Spring, 299 BC".
4. routes/government.ts: GET / with requireAuth and the acting character found as routes/agenda.ts finds it (the same 503 and 404), answering governmentView. Registered in index.ts at /api/government, after the agenda routes.
5. routes/government.test.ts (new): 401 without a session. In a world in its first Winter, with the League docket drafting:
   - a citizen with no office gets `{ member: false }`, and GET /api/agenda gives them a league scope with no cards, no ledger rows and neither power, but with the balance
   - an Archon gets `member: true`, their seat, the three cards, `youMayDraft`, `taxPerSeason` 910, and ledger rows labelled "Opening balance" and "Taxes of the poleis" with their date labels; after the Archon drafts a card, the citizen's league scope still shows no cards
   - an Ephor is a member and may veto once a card is drafted; a Strategos is a member with neither power; a party Archon is not a member
   - in a world whose docket has gone to the vote, the citizen's league scope shows the drafted card alone; nothing when the drafted card was vetoed; and the second card after a draft, a veto and a second draft. The routes run on the real clock and a cycle never opens once its window is voting, so start that world about a day and an hour back, open, draft and veto through syncAgenda, draftCard and vetoCard with a `now` in its Winter, then call GET /api/agenda

## Commit 6: web: the agenda card in its own file

Move TreasuryCard and AgendaScopeSection from PoliticsPanel.tsx to apps/web/src/dashboard/panels/AgendaSection.tsx unchanged, exported, and import them back. The only other change: PoliticsPanel.tsx drops the two imports it no longer uses, `titleCase` and the `AgendaScopeView` type, since the lint rule fails on unused imports. The web suite passes as it stands.

## Commit 7: web: the Government tab, and the League treasury's amount alone on the Council tab

1. api.ts: the `GovernmentView` type as the server sends it, and `api.government()` for GET /api/government.
2. AgendaSection.tsx:
   - AgendaScopeSection takes `treasury?: "full" | "amount" | "none"`, default "full". "full" is today's TreasuryCard, which the party tab keeps. "amount" is the label and the balance alone, without the ledger or "The books are empty." "none" renders no treasury.
   - The balance shows with `toLocaleString()`.
   - The voting heading (:760 before the move) becomes `"<title>" is before the chamber.` The rest of that sentence pointed the voter at a vote that is not below it.
3. PoliticsPanel.tsx:
   - It loads `api.government()` once on mount, in a hook placed with the others at the top. A "Government" tab sits after "Oligarchy Council" while the answer is `member: true`. A `member: false` answer while that tab is open sends the player back to the Council tab.
   - The Council tab's league card passes `treasury="amount"`.
4. GovernmentView.tsx takes the view and a reload (PoliticsPanel's own load, then onRefresh). It uses the existing treasury card classes and adds no CSS:
   - "The Government", then "You sit as Archon (Palaioi)." Seats are joined by " and "; a Strategos has no side.
   - The treasury: "League treasury", the balance, "The poleis pay N drachmae a season.", then the ledger, one line per row: the signed delta with `toLocaleString()`, then `label · dateLabel`. "The books are empty." when there are none.
   - The League docket: AgendaScopeSection with the league view and `treasury="none"`, reloading after a draft or a veto.
   - The wording here is mine and yours to change at STOP 1.
5. politics-chamber.test.tsx: mount() also mocks `api.government` with the never-settling promise, so its tab assertions stand.
6. politics-government.test.tsx (new), mocking as politics-chamber does:
   - a citizen (`member: false`) sees the five tabs, and the Council's league card shows the balance with no ledger and no "The books are empty."
   - an Archon sees six tabs, "Government" second; opening it shows the seat line, the balance, the tax line and the ledger rows; "Put forward" on a card calls `api.draftAgenda("league", id)` and loads the Government view again
   - a Strategos sees the cards with no "Put forward" and no veto button

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 7, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The production reads, and what World 2 gets at the first sync after the deploy: the opening 60,000, the fees (its world_treasury balance) and the tax (leagueTax at its live populations), with the League balance before and after
- How many Government seats are filled in World 2
- GET /api/government for the test Archon, as JSON
- Every player-facing string this adds or changes, verbatim, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover. Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; the server's deploy log applying 0070 and skipping every other migration; 0070 in `__massalia_migrations`
- API health
- after the first sync (the worker's hourly sweep, or sooner on any player's dashboard load), read only: World 2's newest League ledger rows, exactly one `opening` row, the balance against the STOP 1 figure, world_treasury's balance, and the worker's agenda-sweep log line with its revenue

A red run is a STOP with the log. A second `opening` row, or a balance that differs from the STOP 1 figure by more than what has come in since, is a STOP: report it and wait. Do not write to production to fix it. I check the tabs in the game myself.
