# Government 2b: what the League's buildings do

Save this prompt as docs/politics/government-prompt-2b.md in the first commit. Read AGENTS.md first. Repo HEAD when this was drafted: 54fd2a0. One migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Before each commit, run the suites its files touch and read the exit code. Commits stay local; no push until I say push.

## What it is

Prompt 2a built the League's buildings; nothing they do is in the game yet except the Walls' fortifications. This prompt gives the other four their effects: a grant to one class for four seasons, the Temple's morale and stability, and the dues the Bazaar and the Port pay the treasury. It also shows what each project does, on the docket and before the chamber, and shows a player the grants and the blessing he is drawing.

The first building can stand on 19 Oct 2026 (a Temple, Bazaar or Granary passed in year 7's Spring vote). Every effect here is keyed on the instant a building stands. A season's dues, a battle's morale and a year's stability that pass before this is live are lost (the grants are paid late, at the next settle), so it must be live before then.

## Rulings (9 Oct 2026)

- The class grants. A standing Temple pays every Priest in the world 20 drachmae a season, the Bazaar every Trader, the Granary every Landowner and the Port every Shipbuilder, for the 4 seasons after it stands. Each building pays on its own.
- Each season is settled once per character, whole, at his first settle in or after it (GET /me/state settles on every dashboard load, so in practice when he opens the game), and paid by the class he holds then. A season before the character was created, or one he has already settled, is never paid.
- The grants are new money, as a building's income is; the League treasury pays none of them.
- The Temple's morale. While a Temple's first 8 seasons (2 game years) from standing run, every row of every army that fights in the world gets +3 morale, on top of the altar's blessing (a bull's +3 and the Temple's make +6). Two Temples whose years overlap still give +3. The instant that counts is the battle's, as for the altar: from the instant the Temple stands to 8 seasons later, the end excluded.
- The Temple's stability. A polis whose Temple stood when a game year began gains 3 stability at that year's drift, so with the yearly fall of 1 it rises 2, never above 100 or below 0, for as long as the Temple stands.
- The dues. Each standing Bazaar pays the League treasury 100 drachmae a season and each Port 50, for as long as it stands, counted from the buildings standing when the season began and claimed once per world per season under the ledger reason `buildings:s<N>` (the party dues already use `dues:`). The Government's ledger shows the line as "Bazaar and harbor dues".
- The Walls keep their one effect: fortifications +1 when they stand (2a). No grant.
- Every number lives in content/politics/league-buildings.json beside each building's cost.
- The docket shows what each project does when it stands, and the Council tab shows it for the measure before the chamber. The Economy view lists the grants a player is drawing. The Barracks altar shows the Temple's blessing while it runs.
- Not in this prompt: the wallet settle's rounding (a separate prompt), the festival motion (3), war (4), the state army (5).

## Scope

Eight commits; the first also saves this file. Touch only:
- docs/politics/government-prompt-2b.md (this file)
- packages/db/migrations/0072_league_building_dues.sql (new) and packages/db/src/schema.ts (the claim index's predicate and its comment)
- content/politics/league-buildings.json
- packages/shared/src/leagueProjects.ts and leagueProjects.test.ts, packages/shared/src/government.ts and government.test.ts (the new reason and its label), packages/shared/src/league.ts (the drift section only) and league.test.ts (the driftCity tests)
- packages/db/src/leagueProjects.ts, leagueRevenue.ts and leagueRevenue.test.ts, leagueDrift.ts, leagueDrift.test.ts (new)
- apps/worker/src/index.ts (the agenda-sweep's return line only)
- apps/server/src/services/agenda.ts (its imports, AgendaCardView, leagueCardViews, syncAgenda's `credited` line), services/buildings.ts (its imports, the grant settle, settleAll, MineView and mine), services/barracks.ts (its imports, moraleBonusFor, BarracksView, barracksView), services/mapActions.ts and services/koinonMuster.ts (the import line and the battle's morale line in each), and the tests services/buildings.test.ts, services/barracks.test.ts, services/mapActions.test.ts, routes/government.test.ts
- apps/web/src/api.ts, apps/web/src/dashboard/panels/AgendaSection.tsx, apps/web/src/dashboard/sheets.tsx (NON_GOODS and InventoryEconomy only), apps/web/src/dashboard/panels/BarracksPanel.tsx (AltarSection only), apps/web/src/dashboard/dashboard.css (two rules), apps/web/test/politics-government.test.tsx, inventory-economy.test.tsx, barracks-panel.test.tsx

Do not touch: completeLeagueProjects, the League's resolve path and the docket's rules (leagueDocket), the chamber and its votes, sacrifice and altarBonusFor, settleWallet, the collect receipt, the party agendas and their dues, the Government's projects card and the Cities tab, AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- main is at 54fd2a0 or a fast-forward of it; say which. The newest migration is 0071_league_projects.sql. If main has moved, the new file takes the next free number, and 0072 below means that number.
- packages/db/migrations/0070_treasury_claims.sql creates treasury_ledger_claim_idx with the predicate `reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%'`; schema.ts mirrors it (:689-692). The migration runner (packages/db/src/migrate.ts) runs each file in its own transaction.
- packages/db/src/agenda.ts:138: the party dues already write the reason `dues:s<N>:<M>members` (accrueTreasuries, with the race prompt 1 recorded), and packages/shared/src/government.test.ts:85 expects such a reason to show as stored. No code writes a reason starting `buildings:`.
- packages/shared/src/government.ts: treasuryClaimReason (:55-59), treasuryReasonLabel (:64-76); government.test.ts tests the reasons (:62-64).
- packages/shared/src/leagueProjects.ts: leagueBuildingSchema is `.strict()` (:11-26); leagueProjects.test.ts checks the content (:21-30) and rejects an unknown key (:32-36).
- packages/db/src/leagueProjects.ts: loadLeagueBuildings (:24-27), memoized; it imports from ./leagueRevenue.js (:7). leagueRevenue.ts imports ensureTreasuries from ./agenda.js (:7) and agenda.ts imports from ./leagueProjects.js, so the three already form an import cycle, harmless because none calls another at load time. Commit 3 makes leagueRevenue.ts import from ./leagueProjects.js too, which adds no new hazard; if the build or a suite says otherwise, STOP.
- packages/db/src/leagueRevenue.ts: LeagueRevenue (:56-60) and NOTHING (:62); collectLeagueRevenue (:98-154): the cheap read (:105-111), the idempotent inserts (:114-115), one transaction that locks the League's treasuries row (:119), re-reads the claims (:120), then the opening (:123-125), the tax (:127-131) and the fees last (:136-151). claimAndCredit (:81-91).
- packages/db/src/leagueRevenue.test.ts: `at(n)` is the middle of season n (:25); the whole result is compared with toEqual at :60, :72, :81, :88 and :95; the index test is at :118-129.
- packages/shared/src/league.ts: CITY_STABILITY_DECAY and its comment (:537-539), driftCity (:558-577) with the stability line at :571. league.test.ts tests driftCity at :297-354.
- packages/db/src/leagueDrift.ts: accrueLeagueCities (:29-72) with its own activeWorld (:9-16) and the driftCity call (:51-62). The worker's league-drift-sweep is its only caller, and no db test covers it.
- apps/server/src/services/buildings.ts: ActingContext (:153); settleWallet (:574-612); settleAll (:716-725) runs flipActivations, staffingFor, settleGoods, settleWallet, settleStaffing, settleBarracks, settleShrine in that order; MineView (:869-883); mine(classId, ctx, now) (:887-991). routes/buildings.ts:56 calls mine with the character row's classId. The resources table is unique on (scope, scope_id, type) (getOrCreateResource, :209).
- apps/server/src/routes/me.ts:136-141: GET /me/state runs settleAll under the player lock on every load.
- A character's class can change (the re-class in services/service.ts, manumission in services/manumission.ts), and succession sets the heir's created_at to the instant he succeeds (services/succession.ts:155) while the player's resources rows stay.
- player_characters has `created_at` (defaults to the real clock) and is unique on (player_id, world_id) (schema.ts:324).
- apps/server/src/services/barracks.ts: altarBonusFor (:1017-1029); BarracksView's `altar` (:1189-1191); barracksView reads the altar (:1268-1269) and builds the result (:1270-1297).
- The battle's morale: apps/server/src/services/mapActions.ts imports altarBonusFor (:30) and adds it at :622-628; apps/server/src/services/koinonMuster.ts imports it (:38) and adds it per owner at :1016-1023. These are the only two resolveBattle calls in apps/.
- apps/server/src/services/agenda.ts: AgendaCardView (:234-243), leagueCardViews (:263-277), syncAgenda's `credited` (:121). apps/worker/src/index.ts: the agenda-sweep's return line (:195).
- apps/web/src/api.ts: AgendaCardView (:759), BuildingsMine (:1572-1585), BarracksView (:1807-1834). AgendaSection.tsx: the drafting card's flavor line (:74), the voting line (:100-101). sheets.tsx: NON_GOODS (:39-54) keeps the accrual markers out of the inventory; InventoryEconomy (:477), its income rows (:505-524), net (:554) and the Income section (:567-588). BarracksPanel.tsx: AltarSection (:588), its SectionHead (:622). dashboard.css: .agenda-flavor (:3552), .barracks-empty (:4121).

Then these production reads, read only, through `railway run --service Postgres --environment production` with DATABASE_PUBLIC_URL. If they cannot run, say so at STOP 1 and carry on.
- `SELECT count(*) FROM treasury_ledger WHERE reason LIKE 'buildings:%'`, in every world. Anything but 0 is a STOP 0: the new index would not build.
- `SELECT indexdef FROM pg_indexes WHERE indexname = 'treasury_ledger_claim_idx'`
- World 2's league_projects: city_id, building_id, started_at, completes_at, completed_at, every row
- its League agenda cycle for game year 7 (phase, drafted_card_id, vetoed_card_id) and its League chamber vote for year 7 (status, agenda_card_id, closes_at), if they exist yet
- the League's balance
- its league_cities: city_id, population, stability, last_growth_year
- its characters still alive, counted by class_id

## Commit 1: db: the League's building dues are claimed once a season (migration 0072)

1. Save this prompt file.
2. packages/db/migrations/0072_league_building_dues.sql:
```sql
   -- The League's building dues (government prompt 2b): 'buildings:s<N>' joins
   -- the once-only reasons of 0070, once per world per season. The party dues
   -- keep their own 'dues:' reasons, outside the index. The index is rebuilt with
   -- the wider predicate; no row has a 'buildings:' reason yet. Until this runs,
   -- the lock and re-read in collectLeagueRevenue keep the claim once-only (the
   -- worker can be on the new code first). Idempotent, one transaction.
   DROP INDEX IF EXISTS treasury_ledger_claim_idx;
   CREATE UNIQUE INDEX IF NOT EXISTS treasury_ledger_claim_idx ON treasury_ledger (world_id, owner, reason)
     WHERE reason = 'opening' OR reason LIKE 'tax:s%' OR reason LIKE 'fees:s%' OR reason LIKE 'buildings:s%';
```
3. schema.ts: the claim index's predicate gains `OR reason LIKE 'buildings:s%'`, and its comment names 0072 and the building dues.

## Commit 2: shared: what the League's buildings do

1. content/politics/league-buildings.json: each building gains four fields, after `fortifications`:

   | id | classBonus | morale | stabilityPerYear | treasuryPerSeason |
   |---|---|---|---|---|
   | temple | { "class": "priest", "perSeason": 20, "seasons": 4 } | { "amount": 3, "seasons": 8 } | 3 | 0 |
   | bazaar | { "class": "trader", "perSeason": 20, "seasons": 4 } | null | 0 | 100 |
   | granary | { "class": "landowner", "perSeason": 20, "seasons": 4 } | null | 0 | 0 |
   | walls | null | null | 0 | 0 |
   | port | { "class": "shipbuilder", "perSeason": 20, "seasons": 4 } | null | 0 | 50 |

2. packages/shared/src/leagueProjects.ts, all pure:
   - leagueBuildingSchema gains the four fields, all required: `classBonus` a strict object (`class` one of CLASS_IDS, `perSeason` and `seasons` positive integers) or null; `morale` a strict object (`amount` and `seasons` positive integers) or null; `stabilityPerYear` and `treasuryPerSeason` non-negative integers. Each gets a one-line comment, as the other fields have.
   - `ProjectTiming`: `{ cityId: string; buildingId: string; completesAt: number }`, the instant the building stands in ms. The rules below take every project of a world, under way or standing, and decide by time.
   - `CLASS_PLURALS: Record<ClassId, string>`: Landowners, Traders, Philosophers, Hetairai, Hoplites, Shipbuilders, Priests, Slaves.
   - `leagueClassPay(projects, buildings, classId, worldStartMs, fromSeason, toSeason)`: for each season from fromSeason to toSeason inclusive, every project whose building's classBonus names the class pays its perSeason when the season's first instant (`worldStartMs + season * REAL_MS_PER_SEASON`) lies in `[completesAt, completesAt + classBonus.seasons * REAL_MS_PER_SEASON)`. Each building pays on its own. 0 when fromSeason > toSeason.
   - `leagueClassGrants(projects, buildings, cities, classId, atMs)`: the grants running at atMs (the same span holds atMs), in completesAt order, each `{ cityId, buildingId, title, perSeason, untilMs }`: the title is the motion's ("A Temple of Artemis at Massalia"), untilMs the span's end (excluded).
   - `leagueMorale(projects, buildings, atMs)`: null when no building with a morale holds atMs in `[completesAt, completesAt + morale.seasons * REAL_MS_PER_SEASON)`. Otherwise `{ amount, untilMs }`: the largest amount among those that hold it (spans never add up), and the end of the run of spans that holds it, carried on by any span that starts at or before the run's end (a second Temple that stands before the first one's years run out carries the blessing on).
   - `leagueDues(projects, buildings, atMs)`: the sum of treasuryPerSeason over the projects standing at atMs (`completesAt <= atMs`).
   - `leagueStabilityBonus(projects, buildings, cityId, atMs)`: the sum of stabilityPerYear over that polis's projects standing at atMs.
   - `buildingEffects(building, polis)`: one line per effect, in this order, each only when its number is set: `"<CLASS_PLURALS[class]> +<perSeason> dr a season for <span>"`, `"Every army +<amount> morale for <span>"`, `"<polis> +<n> stability a year"`, `"League treasury +<n> dr a season"`, `"<polis>'s fortifications +<n>"`. `<span>` is "1 season" for 1, "<n/4> years" for a multiple of 4 that is 8 or more, else "<n> seasons".
   The words are mine; Argiris rules on them at STOP 1.
3. packages/shared/src/government.ts: `treasuryClaimReason.buildings(season)` gives `buildings:s<N>`; treasuryReasonLabel shows a `buildings:s` reason as "Bazaar and harbor dues"; the comment above the reasons names 0070 and 0072.
4. Tests, in leagueProjects.test.ts (a world started at 0; "season n" is n × REAL_MS_PER_SEASON):
   - The content parses with the table's four fields; a classBonus naming an unknown class and a morale of 0 seasons are rejected.
   - leagueClassPay, a Temple at Massalia standing at season 4: a Priest is paid 0 for seasons 0..3, 80 for 4..7, 20 for 4..4, 20 for 7..9 and 0 for 8..20; a Trader 0 for 4..7. With a second Temple at Nikaia standing at season 6: 160 for 4..9 and 80 for 6..7. 0 for 5..4.
   - leagueClassGrants, the same Temple: at seasons 4 and 5 one grant, `{ cityId: "massalia", buildingId: "temple", title: "A Temple of Artemis at Massalia", perSeason: 20, untilMs: <season 8> }`; none at season 8; none for a Trader.
   - leagueMorale, a Temple standing at season 4: null at 3, `{ amount: 3, untilMs: <season 12> }` at 4, null at 12. With a second Temple standing at 10: until season 18 at 5 and at 11. With the second at 12 instead: until 20 at 5. With it at 13: until 12 at 5, and null at 12.5.
   - leagueDues, a Bazaar at Massalia standing at 4, a Port at Nikaia at 8 and a Temple at Olbia at 4: 0 at 3, 100 at 4, 150 at 8.
   - leagueStabilityBonus, a Temple at Massalia standing at 4: 3 for Massalia at 4, 0 at 3, 0 for Nikaia at 4.
   - buildingEffects for Massalia, verbatim: the Temple `["Priests +20 dr a season for 4 seasons", "Every army +3 morale for 2 years", "Massalia +3 stability a year"]`, the Bazaar `["Traders +20 dr a season for 4 seasons", "League treasury +100 dr a season"]`, the Granary `["Landowners +20 dr a season for 4 seasons"]`, the Walls `["Massalia's fortifications +1"]`, the Port `["Shipbuilders +20 dr a season for 4 seasons", "League treasury +50 dr a season"]`.
   In government.test.ts: `treasuryClaimReason.buildings(3)` is `buildings:s3` and shows as "Bazaar and harbor dues"; `dues:s3:4members` still shows as stored.

## Commit 3: treasury: the Bazaars and the Ports pay their dues

1. packages/db/src/leagueProjects.ts: `projectTimings(exec: DbExec, worldId)`, every league_projects row of the world as a ProjectTiming. One select.
2. packages/db/src/leagueRevenue.ts, collectLeagueRevenue:
   - The cheap read also reads the world's projects and the buildings (loadLeagueBuildings) and computes `leagueDues` at the first instant of the current season (`world.startedMs + season * REAL_MS_PER_SEASON`). The dues are due when that is above 0 and `buildings:s<N>` is not claimed; `buildings:s<N>` joins the reasons read. A world with no Bazaar or Port standing stays as cheap as today: no transaction.
   - In the transaction, after the tax and before the fees (the fees stay last): when the dues were due and the re-read finds them unclaimed, recompute them under the lock and claimAndCredit `buildings:s<N>`.
   - LeagueRevenue and NOTHING gain `dues`. The header comment says so.
3. apps/server/src/services/agenda.ts: syncAgenda's `credited` counts the dues. apps/worker/src/index.ts: the agenda-sweep's line gains `dues N` after the tax.
4. leagueRevenue.test.ts. A project here stands at a season's first instant, `new Date(T0 + n * SEASON)`, not at `at(n)`, which is the middle of it.
   - The five whole-result toEqual gain `dues: 0`.
   - A Bazaar at Massalia standing at season 1, a Port at Nikaia at season 2 and a Temple at Olbia at season 1 (league_projects rows inserted for the test world): at(0) pays no dues and writes no `buildings:` row; at(1) pays 100 with one `buildings:s1` row of 100; a second call at(1) pays 0; at(2) pays 150 with a `buildings:s2` row; the balance ends at 60,000 + 3 × the start tax + 250.
   - With a Bazaar standing at season 0, two calls at once at(0) pay the dues exactly once.
   - A second `buildings:s0` row for the same world fails on treasury_ledger_claim_idx (in the index test or one of its own).

## Commit 4: cities: a Temple steadies its polis

1. packages/shared/src/league.ts: driftCity takes a fourth argument, `stabilityBonus = 0`: stability becomes `Math.min(100, Math.max(0, stability - CITY_STABILITY_DECAY + stabilityBonus))`. The comments on CITY_STABILITY_DECAY and driftCity say the Temple's stability comes in through it and stability stays within 0 to 100.
2. packages/db/src/leagueDrift.ts: accrueLeagueCities reads the world's projects (projectTimings) and the buildings (loadLeagueBuildings) once, and passes each polis `leagueStabilityBonus` at the first instant of the game year it is drifting into (`world.startedMs + year * SEASONS_PER_YEAR * REAL_MS_PER_SEASON`). The header comment says so.
3. Tests:
   - league.test.ts: 60 with a bonus of 3 drifts to 62, 99 to 100, 0 to 2; the existing tests stand without the argument.
   - packages/db/src/leagueDrift.test.ts (new; DB-gated and truncating as leagueRevenue.test.ts is): a world started at T0 and its cities seeded with ensureLeagueCities; a Temple at Massalia standing at the first instant of year 1 and one at Nikaia standing a season later. Drifting at year 1: Massalia rises 2, Nikaia and Olbia fall 1. Drifting at year 2: Massalia rises 2 more, Nikaia rises 2, Olbia falls 1 more. A second call in year 2 changes nothing. The start stabilities come from content.

## Commit 5: economy: the League pays a class its grant each season

1. packages/db/src/leagueProjects.ts:
   - `leagueClassPayFor(exec, worldId, worldStartMs, classId, fromSeason, toSeason)`: leagueClassPay over the world's projects.
   - `leagueClassGrantsFor(exec, worldId, classId, at)`: leagueClassGrants at `at`, titles from the cities content.
2. apps/server/src/services/buildings.ts, a new settle step and its marker type `league_grant` (a resources row whose lastUpdatedAt is the first instant of the last season settled):
   - `settleLeagueGrants(exec, ctx, now)`: read the player's character in the world (id, classId, createdAt); with none, return 0 and write nothing. The seasons owed run from the later of the season after the marker's and the season the character was created in (with no marker, from the season he was created in) to the current season. None owed (an earlier clock included): return 0 and write nothing.
   - Otherwise claim them first, whether or not anything is paid: with a marker, `UPDATE … SET last_updated_at = <first instant of the current season> WHERE id = <marker> AND last_updated_at < that RETURNING id`; with none, an insert of the marker at that instant that yields to a row already there (`ON CONFLICT DO NOTHING` on (scope, scope_id, type)) `RETURNING id`. No row back: return 0. Then compute the pay for the claimed seasons by the class he holds now. Above 0: credit the wallet relatively (`drachmae = drachmae + pay` on the character's row, row count 1, or throw) and write one effect_log row, kind `league_grant`, detail `{ fromSeason, toSeason, amount }`, at `now` (audit only, not a Chronicle kind). Return the pay. Settling every owed season, paid or not, is what keeps a character from being paid later for seasons he spent in another class.
   - settleAll runs it right after settleWallet, so wages and food can draw on it; FullSettle gains `grants`.
   - MineView gains `leagueGrants: { title: string; perDay: number; until: string; throughLabel: string }[]`, the grants running for the player's class at `now`: a season is a real day, so perDay is the grant a season; `until` is the span's end (excluded) as ISO; throughLabel is formatGameDate of the last season it pays (the instant before `until`). mine fills it from leagueClassGrantsFor.
3. buildings.test.ts. The character fixtures set created_at to the instant each test means (the column defaults to the real clock, years after T0). A Temple at Massalia standing at T0 + 2 days (its grant pays seasons 2 to 5):
   - Every character here has 100 drachmae, no pops and no buildings.
   - A Priest created at T0. Collect at T0 + 1.5 days: 100, the `league_grant` marker at T0 + 1 day and no log. At T0 + 2.5 days: 120 and the marker at T0 + 2 days. Again at T0 + 2.9 days: 120. At T0 + 9 days: 180. At T0 + 12 days: 180 and the marker at T0 + 12 days. Two `league_grant` log rows, `{ fromSeason: 2, toSeason: 2, amount: 20 }` and `{ fromSeason: 3, toSeason: 9, amount: 60 }`.
   - A settle at an earlier clock pays nothing and moves nothing: after the collect at T0 + 2.5 days, settleAll at T0 + 1.5 days leaves the wallet and the marker as they were.
   - A Trader collecting at the same five instants stays at 100, with no log, and his marker at T0 + 1, 2, 2, 9 and 12 days after them.
   - A Trader created at T0 who collects at T0 + 2.5 days and then becomes a Priest: collect at T0 + 2.9 days pays nothing (season 2 is settled), at T0 + 4.5 days 40 (seasons 3 and 4).
   - A Priest created at T0 + 4.5 days: collect at T0 + 4.6 days pays 20 (season 4 only), at T0 + 9 days 20 more (season 5).
   - mine for the first Priest at T0 + 3 days: `leagueGrants` is `[{ title: "A Temple of Artemis at Massalia", perDay: 20, until: <T0 + 6 days, ISO>, throughLabel: <formatGameDate of T0 + 6 days less 1 ms> }]`; at T0 + 6 days it is empty.

## Commit 6: battle: the Temple steadies every army

1. packages/db/src/leagueProjects.ts: `leagueMoraleAt(exec, worldId, at)`: leagueMorale over the world's projects, as `{ amount, until: Date }` or null.
2. apps/server/src/services/barracks.ts:
   - `moraleBonusFor(exec, worldId, playerIds, at)`: altarBonusFor plus the Temple's amount at `at` in that world, for every player in the map; the same Map shape. Its comment says the altar is each player's own and the Temple every army's in the world.
   - BarracksView gains `temple: { mor: number; until: string; throughLabel: string } | null`, the Temple's blessing at `now` (`until` the run's end, excluded; throughLabel formatGameDate of the instant before it); barracksView fills it inside its transaction.
3. mapActions.ts and koinonMuster.ts: each battle's morale line calls `moraleBonusFor(tx, <world>, …, at)` (`ctx.worldId` in the raid, `muster.worldId` in the muster) in place of altarBonusFor, and each import line trades altarBonusFor for moraleBonusFor (altarBonusFor stays exported for its tests). The comments above the two lines name the Temple.
4. Tests:
   - barracks.test.ts, in the altar describe: a Temple at Massalia standing at at(4). barracksView at at(9) carries `temple: { mor: 3, until: at(12) ISO, throughLabel: <formatGameDate of at(12) less 1 ms> }`; at at(12) it is null. With a bull burned at at(8) by one player and none by another: moraleBonusFor at at(9) gives 6 and 3, at at(10.5) 3 and 3, at at(12) 0 and 0. In an `it` of its own: a Temple standing only in another world (an ended one) adds nothing in this one.
   - mapActions.test.ts, beside the altar test, two `it` blocks (one Temple each: the projects are unique per polis and the blessing holds for the whole world): the 40 hoplites against the warband of 90, with no bull. A Temple standing at at(4): they stand and withdraw, as with the bull. A Temple standing at at(0), whose 8 seasons ran out at at(8): they are broken.

## Commit 7: server: what a project does, on the docket

1. apps/server/src/services/agenda.ts: AgendaCardView gains optional `effects: string[]`; leagueCardViews fills it with buildingEffects of the project's building and polis. A League card from before has none.
2. routes/government.test.ts: in the Archon's docket test, every card's `effects` equals buildingEffects of its building and polis, and the first card's (the Temple at Massalia) are the three Temple lines verbatim; in "shows the drafted card alone", the public card carries the same effects. The test's Scope type gains `effects?`.

## Commit 8: web: what a project does, the grants in the Economy view, the Temple at the altar

1. api.ts: AgendaCardView gains `effects?`; BuildingsMine gains `leagueGrants?`; BarracksView gains `temple?`. The page reads them as `?? []` and `?? null`: Pages can go live before Railway does, and an old server sends none of them.
2. AgendaSection.tsx: a card with effects shows one line under its flavor, `When it stands: <effects joined by " · ">`, class `agenda-effects`. While voting, the same line under the "is before the chamber" heading for the drafted card.
3. sheets.tsx: `league_grant` joins NON_GOODS beside the other markers. InventoryEconomy: under "Income · drachmae", after the buildings, one row per grant: the title, sub `League grant · through <throughLabel>`, amount `+<perDay> dr`, icon 🏛️. The grants count in the net. "No drachmae income yet" shows only when there are neither buildings nor grants.
4. BarracksPanel.tsx, AltarSection: while `temple` is set, one line under the section head, class `barracks-temple`: `Artemis watches over the League's armies · +<mor> morale to every man you field · through <throughLabel>`.
5. dashboard.css: `.agenda-effects` after `.agenda-flavor` (12px, the ledger's green #9ec487, margin 0 0 8px) and `.barracks-temple` after `.barracks-empty` (12px, var(--dash-stone-dim), padding 0 14px 10px, margin 0).
6. The words in 2 to 4 are mine; Argiris rules on them at STOP 1.
7. Tests:
   - politics-government.test.tsx: the DOCKET fixture's projects gain effects; each card shows its `When it stands:` line and the legacy CARDS show none. A citizen whose Council League card is in voting with the Temple at Massalia drafted sees `"A Temple of Artemis at Massalia" is before the chamber.` and the effects line under it.
   - inventory-economy.test.tsx: a payload with one grant shows its row with the sub and +20 dr, adds 20 to the net, and drops the "No drachmae income yet" line; a payload without `leagueGrants` renders as before.
   - barracks-panel.test.tsx: a view with `temple` shows the line in the altar section; a view with `temple: null`, and one without the field, show none.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 8, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean`; the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- The production reads, and what follows from them: whether a project is under way and when it stands, how many living characters each grant will reach, and the index's definition as it stands
- From a test or a local run: a Priest's GET /api/buildings/mine `leagueGrants` and GET /api/barracks `temple` with a Temple standing, and the docket card for project:massalia:bazaar from GET /api/government, as JSON
- Every player-facing string this adds or changes, verbatim, for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Not in the hour before the 00:00 UTC season rollover, and before 2026-10-19 00:00 UTC. Fast-forward only, plain `git push`. Report:
- remote HEAD
- the CI run with its Gate and Audit steps, and the Pages run
- Railway server and worker on the new SHA; the server's deploy log applying 0072 and skipping every other migration; 0072 in `__massalia_migrations`; the index's new definition from pg_indexes
- API health
- read only, after the next sync: World 2's league_projects rows, any `buildings:` ledger row and any `league_grant` effect_log row (none of either is expected until a building stands), and how many `league_grant` markers exist (one per player who has settled since the deploy)

A red run is a STOP with the log. Anything off is a STOP: report it and wait. Do not write to production to fix it. I check the tabs in the game myself.

## STOP 1 ruling (10 Oct 2026)

1. The words are approved as reported: the five buildings' effect lines and their spans, "When it stands:", the Economy row ("League grant · through <season>"), the Barracks line and "Bazaar and harbor dues".

2. The season clamp at 0 for a created_at before the world's start is accepted; nothing in production has one.

3. spanLabel, holds, the templeStands fixtures, league_projects in the four TRUNCATE lists, the ended world in the barracks test and the grantPlayer helper are accepted.

4. The three payloads captured through the services are accepted.

5. The grant rows keyed by title and until are accepted.

6. Antipolis falling to stability 0 at year 7's drift is expected: city stability is display-only today. No change.

7. Append this ruling verbatim to docs/politics/government-prompt-2b.md under "STOP 1 ruling (10 Oct 2026)", as its own commit: docs: the government prompt 2b's STOP 1 ruling

8. Run the gate and the audit at the new HEAD. If the gate ends GATE GREEN at that HEAD and the audit exits 0, push and report as the prompt's Push section says. Anything else is a STOP. The push must land before 2026-10-19 00:00 UTC, and not in the hour before any 00:00 UTC rollover. Land it before 2026-10-13 00:00 UTC if you can, so the Archons see the effects when the first docket opens.
