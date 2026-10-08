# Raids 4: the march. A party travels out, fights when it arrives, and travels home; its report waits in the Barracks

Save this prompt as docs/barracks/raids-prompt-4.md in the first commit.
Repo HEAD when this was drafted: 537d914. One migration (0068). One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

Today a raid, an attack or a scout is fought inside the request that sends it, and the survivors are then away 3 hours a step. From now on the party travels.

1. The road. Raids, attacks and scouts get their own clock in content: `"march": { "minutesPerStep": 30, "minutesWithinRegion": 10 }`, replacing `recovery` (3 hours a step). A step is one land step (a neighbour) or one sea crossed; a target in the base's own region (0 land steps) is 10 minutes. So a land neighbour is 30 minutes each way, Corsica (two seas) 60, Thapsus (five seas) 150. Moves keep their own `move` clock.
2. Setting out. Every check runs at the click as today (winter, the target, another house's holding for an attack, the men, the reach, the ships). Then the men set out for the target, the hulls that sail leave port for the round trip (twice the road), and the answer is a set-out card: "40 peltasts set out to raid Salyes, arriving in 00:30:00." Nothing is fought yet.
3. Arrival. The battle is fought at the arrival instant against the place as it stands then, resolved by the first request after that instant, as a koinon muster's launch already is, and in the order the parties arrive, musters included. Everything is dated the arrival: the pool and its regrowth, the altar, the plunder, the intel, a conquest. The survivors take the same road home. A won attack keeps its survivors where they won: they hold the place from that instant, with no recovery. Scouts see the place when they get there.
4. Turned back, or lost on the road. A party that arrives at a place its own house now holds turns back without a fight, and so does an attack that arrives at a place another house now holds (a raid or a scout there still goes, as at launch). A party whose men all left the roster on the road (unpaid upkeep, a band's contract ending) breaks up: no fight. Winter refuses only new departures: a party already on the road arrives and fights, and every party can come home.
5. The report. The battle report is kept on its march and listed in the Barracks under Reports, newest first, the latest ten. A report not yet opened carries a small highlight until it is first opened; opening it shows the same report card as today. Raids, attacks and scouts write no Chronicle line any more (moves and holdings keep theirs). No pop-up, no badge on the Barracks button, no email or phone.
6. The map. The picker shows the road for an action ("arrives in 00:30:00"), as it does for a move. Today the map takes a place's new strength from the action's answer; from now on it reads the numbers again when a party bound for the place open on the map gets there, so the strength shown is what the fight left.
7. Koinon musters still fight at their launch (raids prompt 5 marches them). Their army comes home on the march clock, the road's minutes from the launch, in place of 3 hours a step.
8. No recall: a party on the road cannot be called back.

Rulings already made (8 Oct 2026): all of the above. The set-out, turned-back, broken-up and way-home lines, the Reports list and its highlight are mine and yours to change at STOP 1. The only balance numbers are the march clock's (30 and 10, new); every other number is untouched.

## Scope

Seven commits; the first also saves this file. Touch only:
- docs/barracks/raids-prompt-4.md (this file)
- content/military/battle.json (`march` in, `recovery` out)
- packages/shared/src/barracks.ts (BattleContent's `march` and `recovery`, their schema, a new `marchMinutes`)
- packages/shared/src/battle.test.ts
- packages/shared/src/chronicle.ts (a new `renderMarchLine` only)
- packages/shared/src/chronicle.test.ts (its cases only)
- packages/db/migrations/0068_player_marches.sql (new)
- packages/db/src/schema.ts (the new table and its kinds, and `UnitMission.marchId`)
- apps/server/src/services/mapActions.ts
- apps/server/src/services/barracks.ts (the settle's arrivals, the Barracks view's reports, a new `markReportRead`)
- apps/server/src/routes/barracks.ts (a new POST /report-read)
- apps/server/src/routes/map.ts (the comment on POST /act only)
- apps/server/src/services/holdings.ts (the comment on `insertConquest` only)
- apps/server/src/services/factionOpinion.ts (its header comment only)
- apps/server/src/services/koinonMuster.ts (the return clock and the comments that name the recovery, the hook)
- apps/server/src/index.ts (the hook's registration only)
- apps/server/src/services/mapActions.test.ts
- apps/server/src/services/koinonMuster.test.ts
- apps/server/src/routes/map.test.ts
- apps/server/src/routes/barracks.test.ts (one new case)
- apps/web/src/api.ts
- apps/web/src/map/World2Map.tsx (the report state, `onActed`, the military read, the picker's road, `BattleReport`)
- apps/web/src/dashboard/panels/BarracksPanel.tsx (a new Reports section, and the away row's key)
- apps/web/src/dashboard/dashboard.css (the report rows only)
- apps/web/test/towns-and-move.test.tsx
- apps/web/test/world2map-cards.test.tsx (one new case, and `mountMap`'s roster)
- apps/web/test/barracks-panel.test.tsx

Do not touch: packages/shared/src/battle.ts (the resolver); turnout, plunder, the grudge, intel, regrowth, hulls and their rules; moves; the muster's battle at its launch (prompt 5); KoinonView; the Chronicle's kinds, allowlist and existing renderers (no new kind: battles simply stop writing `map_action`); the dashboard's nav and /me; migrations 0064 and 0067; AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- HEAD 537d914. packages/db/migrations ends at 0067_player_voyages.sql, and no `player_marches` table exists. In packages/db/src/schema.ts, `UnitMission` (:898) has no `marchId`, `playerVoyages` is at :1098, and a jsonb list with an empty default is declared as `traits` is (:241).
- content/military/battle.json:10 is `"recovery": { "hoursPerStep": 3 }` and :16 the `move` block. packages/shared/src/barracks.ts: `recovery` in the type at :62 and the schema at :282, `move` at :73 and :295.
- apps/server/src/services/mapActions.ts: `MS_PER_HOUR` (:63); `MapActReport` (:77-118) with `recoveryHours` (:93), `arrivesAt` (:94) and `winner` (:98); `MapActResult` (:121); `writeIntel` (:152-173); `characterOf` (:175-179); `act` (:280): winter (:291-292), the target checks (:294-317), the selection (:319-326, `selectForce` reads the rows with no ORDER BY), the reach (:328-337), the ships (:339-386), the split (:388-389), the defender and the recovery (:391-413, the recovery at :404-406, the game date at :407-408), the town's fleet check (:419-426), the scout (:428-458), the repulse (:459-489), the battle (:490-590, its seed at :492), the survivors' recovery (:592-594), the hulls (:595-598), the `map_action` log (:600-601), the response (:605-617). `move` (:654) is untouched.
- apps/server/src/services/barracks.ts: `UUID_RE` (:66); `settleBarracks` (:461), its arrivals (6b, :669-677) land every row whose `arrives_at` has passed; `BarracksView` (:1018) with `atSea` (:1035); `barracksView` (:1066), `places` (:1103-1108), `atSea` (:1110). apps/server/src/routes/barracks.ts ends with POST /disband (:120-139), whose 400 reads "A rowId is required.".
- apps/server/src/services/holdings.ts: `holderOf(exec, worldId, regionId, townId)` (:39); `insertConquest` (:122) and `insertTownConquest` (:130) take `garrisonedAt`, and their comment (:119-121) says the survivors are "in recovery". apps/server/src/services/factionOpinion.ts:15-16 says the grudge rides on "the map_action detail".
- apps/server/src/services/koinonMuster.ts: `MusterReport` (:558) with `recoveryHours` (:571); `MS_PER_HOUR` (:592); the stand-down close (:702); the recovery (:716-717); the resolved close (:876); the comments that name the recovery (:699, :766, :835); the hook (:913-961): `RESOLVE_BACKOFF_MS`, `failedAt`, `MusterResolverDeps`, `resolveDueMusters` (:928, which ignores each resolve's outcome, so a `busy` one is passed over and the next is tried), `registerMusterResolver` (:948). apps/server/src/index.ts imports it at :49 and registers it at :127-129.
- apps/server/src/routes/map.ts:217-221 says POST /act "Resolves in the request; the rhythm is the recovery afterwards".
- apps/web/src/dashboard/shared.tsx: `useCountdownSeconds` (:638-650) sets its count inside an effect, so on the render where its target changes it still answers the previous value (0 when it had none).
- apps/web/src/map/World2Map.tsx: the `report` state (:389) and `onActed` (:1127) take `MapActReport | MapMoveReport`, and `onActed` applies `report.intel` (:1135); the arrival refetch of the roster (:403-413) trusts `menLeft`, so a party newly bound for the open place (the roster `onActed` sets after Go) reads as arrived on its first render; the military read, once per map load (:439-444); `ACTION_LABEL` (:1545); `MOVE_MINUTES_PER_STEP` and `MOVE_MINUTES_WITHIN` (:1556-1557); `PickerReport` (:1559); `travelClock` (:1590); the picker's `route` (:1674) and its footer (:1858-1876, the move's "arrives in" at :1874); `BattleReport` (:1904), its `hours` (:1921), its rows table (:1945) and its "The party … returns in …h." line (:1980). apps/web/src/dashboard/panels/BarracksPanel.tsx: `MISSION_TAG` (:91), `SectionHead` (:170), `AwayRow` (:283) asks for a refetch when its count reaches zero (:285-288) and is keyed by the row's id alone (:842), while `AltarSection` is keyed on its end (:914); `moveReport` (:607, above the early return at :682), the summary strip (:768), the columns (:791). apps/web/src/api.ts: the comment on `mapAct` (:662-665) says it "resolves in the request", `mapAct` (:666-667), `BarracksRosterRow.mission` (:1728), `BarracksView` (:1748, `atSea` at :1770), `MapActReport`, `MapMoveReport` and `MapActResponse` (:1815-1874).
- Tests. mapActions.test.ts: `HOUR` (:20) is read only by `recovered` (:22); `act`/`actRows`/`actShips`/`actTown` (:124-136) call `m.actions.act` and read the battle from its answer; "attack win" reads the bases from the action's answer (:327-328); the conquerors are pinned moving (:326, :786); "hulls at sea carry no second party" tries the second party at at(9) (:462); "partial force" tries two bad counts at at(9.1) (:626-627), while the 20 sent are still away; a comment says the seed carries the player id (:793). routes/map.test.ts's POST /act cases (:121, :150) read a battle and a scout's intel from the answer. koinonMuster.test.ts's `recovered` (:538) and the repulse's `home` (:838) use `recovery.hoursPerStep`, a comment says the army is "home by at(23 hours)" (:752), and the hook cases call `registerMusterResolver` (:988, :1055). towns-and-move.test.tsx builds `MapActReport`s with `recoveryHours` (:70-75) and expects "The party returns in 6h." (:84) and "The party settles in in 6h." (:93). world2map-cards.test.tsx's `mountMap` (:59) answers /api/barracks with `{ roster: [] }` (:68).

## Commit 1: the road's clock

1. Save this prompt file.
2. content/military/battle.json: after the `move` block, `"march": { "minutesPerStep": 30, "minutesWithinRegion": 10 },`. `recovery` stays until commit 5, so every commit builds.
3. packages/shared/src/barracks.ts:
   - The type gains `march: { minutesPerStep: number; minutesWithinRegion: number };` with a comment: a raid, an attack or a scout travels minutesPerStep a land step or a sea crossed, or minutesWithinRegion to a target in its base's own region, each way. The schema gains `march: z.object({ minutesPerStep: z.number().int().positive(), minutesWithinRegion: z.number().int().positive() }).strict()`: whole minutes, since a march stores them as an integer.
   - `export function marchMinutes(march: { minutesPerStep: number; minutesWithinRegion: number }, route: { route: "within" | "land" | "sea"; steps: number }): number`: `march.minutesWithinRegion` for "within" or a land route of 0 steps, else `route.steps * march.minutesPerStep`. (An action's route is only ever land or sea; "within" is accepted so the web picker can pass its route as it stands.)
4. packages/shared/src/chronicle.ts, beside `renderCampaignLine`: `export function renderMarchLine(p: { stage: "setout" | "taken" | "ours" | "dispersed"; action: "scout" | "raid" | "attack"; force: CampaignForcePart[]; place: string; minutes?: number }): string`, with `renderForce` and the file's `clock`:
   - setout: a raid `"<force> set out to raid <place>, arriving in <clock>."`, a scout `"<force> set out to scout <place>, arriving in <clock>."`, an attack `"<force> march on <place>, arriving in <clock>."`
   - taken: `"<force> found <place> held by another house and turned back."`
   - ours: `"<force> found <place> already ours and turned back."`
   - dispersed: `"The party sent to <place> broke up on the road."`
5. Tests:
   - battle.test.ts: the content case pins `battle.march` as `{ minutesPerStep: 30, minutesWithinRegion: 10 }` and rejects a `march` with `minutesPerStep: 0` and one with `minutesWithinRegion: 7.5`. A new case: `marchMinutes` gives 10 for land 0 and for within 0, 30 for land 1, 60 for sea 2 and 150 for sea 5.
   - chronicle.test.ts, after the move line (:465), with the `force` of that case (40 peltasts): the three set-out lines at 30 minutes ("40 peltasts set out to raid Salyes, arriving in 00:30:00." and the other two), "40 peltasts found Salyes held by another house and turned back.", "40 peltasts found Salyes already ours and turned back." and "The party sent to Salyes broke up on the road.".

## Commit 2: the march table

1. packages/db/migrations/0068_player_marches.sql, in 0067's style:
   ```sql
   -- Parties on the march (raids prompt 4). A raid, an attack or a scout no longer
   -- fights inside the request that sends it: the party sets out, and the battle
   -- is fought when it arrives (arrives_at), resolved by the first request after
   -- that instant, in arrival order with the koinon's musters. One row per party:
   -- the target, the base it set out from and comes home to, the route and its
   -- minutes each way, its rows in the order they set out (`party`, the order the
   -- fight sees), the hulls it took (`ships`, as the report names them) and every
   -- hull that sailed (`sailing`, the escort included, whose naval power meets a
   -- town's fleet), and once it has arrived its report and the instant its owner
   -- first opened it. The party's rows carry the march's id on their mission until
   -- it arrives. Idempotent, one transaction.
   CREATE TABLE IF NOT EXISTS player_marches (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     world_id uuid NOT NULL REFERENCES worlds(id),
     owner_player_id uuid NOT NULL REFERENCES players(id),
     kind text NOT NULL CHECK (kind IN ('scout', 'raid', 'attack')),
     region_id text NOT NULL,
     town_id text,
     base_id text NOT NULL,
     route text NOT NULL CHECK (route IN ('land', 'sea')),
     steps integer NOT NULL,
     minutes integer NOT NULL,
     party jsonb NOT NULL DEFAULT '[]'::jsonb,
     ships jsonb NOT NULL DEFAULT '{}'::jsonb,
     sailing jsonb NOT NULL DEFAULT '{}'::jsonb,
     departed_at timestamptz NOT NULL,
     arrives_at timestamptz NOT NULL,
     status text NOT NULL DEFAULT 'marching' CHECK (status IN ('marching', 'resolved')),
     resolved_at timestamptz,
     report jsonb,
     seen_at timestamptz
   );
   CREATE INDEX IF NOT EXISTS player_marches_due_idx ON player_marches (arrives_at) WHERE status = 'marching';
   CREATE INDEX IF NOT EXISTS player_marches_owner_idx ON player_marches (owner_player_id, arrives_at);
   ```
2. packages/db/src/schema.ts, after `playerVoyages`: `export const MARCH_KINDS = ["scout", "raid", "attack"] as const`, `MarchKind`, and `playerMarches` matching the SQL (the checks named `player_marches_kind_check`, `player_marches_route_check` and `player_marches_status_check`; `party` as `jsonb("party").$type<string[]>()` with the empty-list default `traits` uses; `ships` and `sailing` as `jsonb(...).$type<Record<string, number>>()` with the empty-object default; `report` as `jsonb("report").$type<Record<string, unknown> | null>()`; the due index partial as `koinon_musters_due_idx` is). `UnitMission` gains `marchId?: string`, and the comment above it says a party's rows carry it while they march out (raids prompt 4) and lose it when they arrive.

## Commit 3: the march

1. apps/server/src/services/mapActions.ts:
   - Types. `MapActReport` loses `recoveryHours` and `arrivesAt` and gains `marchId: string`, `minutes: number` (the road each way), `arrivedAt: string` (the instant the party reached the place) and `homeAt: string | null` (when the survivors are home; null after a conquest, whose survivors hold the place, and when nobody comes back); `winner` gains `"turned_back" | "dispersed"`. A new `MapSetOutReport = { type: "setout"; action: MapActionType; marchId: string; regionId: string; regionName: string; townId: string | null; townName: string | null; base: string; route: "land" | "sea"; steps: number; minutes: number; departedAt: string; arrivesAt: string; ships: Record<string, number>; shipLabels: Record<string, string>; men: number; rows: { id: string; unitId: string; label: string; icon: string; count: number }[]; line: string }`, where `ships` is every hull that sailed. `MapActResult`'s report becomes `MapSetOutReport`. `MS_PER_HOUR` goes.
   - `act` keeps winter, the target checks, the selection, the reach, the ships and the split (:291-389) as they are. After the split it sets out: `minutes = marchMinutes(battleC.march, { route, steps })`, `arrivesAt = now + minutes`; one `player_marches` row (kind, region, town, `base_id: base`, route, steps, minutes, `party` the marching rows' ids in the order `act` holds them, `ships`, `sailing`, `departed_at: now`, `arrives_at`); every marching row gets `movingTo: townId ?? regionId`, `arrivesAt` and `mission: { kind, regionId, townId?, departedAt: now, marchId }`; a sea crossing sails `sailing` with `sailHulls(…, { sailedAt: now, returnsAt: now + 2 × minutes })`. The answer's report is the `MapSetOutReport`, its line `renderMarchLine({ stage: "setout", action, force: describeForce(rows), place, minutes })`. No effect_log row: the march is the record. The response is composed as now (:605-617).
   - `export async function resolveMarch(marchId: string, now: Date): Promise<{ outcome: "busy" | "not_due" | "resolved" }>`, in one transaction, every clock in it the arrival instant `at = march.arrivesAt`, never `now`, which only decides whether the march is due (resolved a minute or three days after it arrives, the result is the same):
     1. `pg_try_advisory_xact_lock(hashtext('map_march'), hashtext(<id>::text))`, the two-int keyspace as `musterLockKey` uses; not granted: `busy`.
     2. The march; unknown, not `marching`, or `arrives_at > now`: `not_due`. Lock the owner. Claim first: `UPDATE … SET status = 'resolved', resolved_at = arrives_at WHERE id = … AND status = 'marching' AND arrives_at <= now RETURNING`; lost: `not_due`.
     3. The owner's context `{ playerId, worldId, worldStartedMs }` from the world's `started_at`, as `resolveMuster` builds it, and `settleAll(tx, ctx, at)`; its shrine days are applied after the commit, at `at`, as `act` applies them.
     4. The party: the owner's rows whose `mission->>'marchId'` is this march, in the order of the march's `party` (rows that left on the road are simply missing).
     5. In this order: no rows left means it broke up on the road (`winner: "dispersed"`, no battle, nobody comes home); the place now held by its own house (`holderOf(tx, worldId, regionId, townId ?? "")` is the owner) turns any party back (`"turned_back"`, stage `ours`); held by another house, an attack turns back (stage `taken`); a scout scouts; a sea assault on a town meets its fleet with the naval power of `sailing` (content weights) and is repulsed or lands; the rest fight. The scout, the repulse and the battle are today's code (:391-590) with `now` replaced by `at` everywhere (the pool, the town's fleet, the altar, the plunder credits, the intel and its game date, the battle_loss logs), the seed `sha256([worldId, march.id, townId ?? regionId, at.toISOString()].join("|"))`, and `rows`, `base`, `route`, `steps`, `ships` and `sailing` read from the march and its party.
     6. A conquest: `insertConquest`/`insertTownConquest(…, at, at)` (the holding garrisoned from `at`), and the survivors stand there at once: `basedAt` the place, `movingTo`, `arrivesAt` and `mission` null. Everyone else who survived, turned back included: `movingTo: base`, `arrivesAt: at + minutes`, `mission: { kind, regionId, townId?, departedAt: march.departedAt }` (no `marchId`). The hulls need nothing: they sailed for the round trip.
     7. The report: as today's for the outcome, with `marchId`, `minutes`, `arrivedAt: at` and `homeAt` (`at + minutes` when any survivor comes home, else null). A turned-back or broken-up report has `town`, `fleet`, `defender`, `plunder`, `conquest`, `intel` and `opinion` null, `rounds: 0` and `destination: base`; turned back, `attacker` is the party unchanged (start and end its count, not broken, `losses: 0`) and the line `renderMarchLine` (stage `taken` or `ours`); broken up, `attacker.rows` is empty and the line `renderMarchLine` (stage `dispersed`). The march row stores it (`report`). One effect_log row of kind `map_report` (not a Chronicle kind) dated `at`, detail `{ ...report, source: "map" }`. No `map_action` row for a raid, an attack or a scout any more.
   - The header comment (:38-58) describes the two halves: `act` sets out, `resolveMarch` fights on arrival. The comments in the code that moves into `resolveMarch` say the march home where they said recovery.
2. apps/server/src/services/barracks.ts:
   - In the settle's arrivals (6b, :669-677), a row whose mission has a `marchId` is skipped: a party on its way out is landed by its march's arrival, never by the settle. The comment says so.
   - `export type MarchReportView = { id: string; kind: "scout" | "raid" | "attack"; regionId: string; townId: string | null; arrivedAt: string; gameDate: string; seen: boolean; report: MapActReport }` (`import type` from mapActions.ts, so no cycle at runtime). `BarracksView` gains `reports: MarchReportView[]`: the player's resolved marches in this world, by `arrives_at` descending then id, the latest ten, `gameDate` the arrival's game date (`formatGameDate(gameDate(…))`), `seen` from `seen_at`.
   - `export async function markReportRead(ctx: ActingContext, marchId: string, now: Date): Promise<{ ok: true } | Failure>`: a malformed id (`UUID_RE`) is 404 "No such report." before any query; then one guarded `UPDATE player_marches SET seen_at = now WHERE id = … AND owner_player_id = … AND world_id = … AND status = 'resolved' AND seen_at IS NULL RETURNING`. Nothing returned: a march that is his, in this world and resolved was read before and is `{ ok: true }` with nothing changed; anything else (unknown, not his, not resolved, another world) is 404 "No such report.". No player lock: nothing of the wallet, the stock or the roster changes.
3. apps/server/src/routes/barracks.ts, after /disband: POST /report-read, body `{ marchId }` (400 "A marchId is required." when it is not a non-empty string, as /disband words it), the result's code and error on failure, else the Barracks view, as the other POSTs answer.
4. Comments. apps/server/src/routes/map.ts:217-221: POST /act sends the party; the battle is fought when it arrives (raids prompt 4). apps/server/src/services/holdings.ts:119-121: `garrisonedAt` dates when the men first stand there, the battle's instant since raids prompt 4. apps/server/src/services/factionOpinion.ts:15-16: the change rides on the raid's report, stored on its march or on the muster.
5. mapActions.test.ts. The suite keeps reading battles through its helpers:
   - `launch`, `launchRows`, `launchShips` and `launchTown`: the raw `m.actions.act`, taking what today's helpers take (set-out answers). `act`, `actRows`, `actShips` and `actTown` send the party and let it arrive: on success they `resolveMarch(report.marchId, new Date(report.arrivesAt))` and return the launch answer with `report` replaced by the march's stored report (the set-out report kept as `setOut`). A refusal is returned as it is.
   - `recovered` and `HOUR` go (nothing else reads `HOUR`, and an unused constant fails the lint); `const MIN = 60_000`, `fought(from, minutes)` = from + minutes, `home(from, minutes)` = from + 2 × minutes. The roads: R046 and Reii 30, R078 and Aleria 60, Thapsus 150, Album from Genoa 10.
   - Expectations that move: `recoveryHours: 3` becomes `minutes: 30` (:184; Album's at :819 `minutes: 10`), `recoveryHours: 6` becomes `minutes: 60` (:430), and `report.arrivesAt` becomes `report.homeAt` (:185, :431). Every return moves to `home`: `recovered(at(9), 1)` becomes `home(at(9), 30)`, `recovered(at(9), 2)` `home(at(9), 60)`, `recovered(at(10), 2)` `home(at(10), 60)`, for rows, voyages' `returnsAt` and the settles that bring them home. Intel `scoutedAt` moves to the arrival: `fought(at(9), 30)` (:221, :277, :287, :319), `fought(at(9.5), 30)` (:286), `fought(at(9), 60)` and `fought(at(10), 60)` at Aleria (:719, :738). A conquest's holding (:324, :785): `since`, `lastGarrisonedAt` and `lastTributeAt` (where pinned) at `fought(at(9), 30)`. The conquerors (:326, :786) stand at once: `basedAt` the place, `movingTo`, `arrivesAt` and `mission` null.
   - Other changes: "attack win" reads the bases and R046's entry from `reach(ctx, fought(at(9), 30))` (:327-328), since the launch's answer predates the conquest. The scout case (:192) finds one `map_report` log and no `map_action` log. In "a sea target without enough hulls…" the view is read at `at(9)` plus 90 minutes (:438, after the fight, before the hulls are home at plus 120), and its local `home` (:442) is renamed so it does not shadow the helper. In "hulls at sea carry no second party", the second party is tried at `fought(at(9), 60)` (:462: the first has fought and its hull is still at sea), so no call for a player runs before an earlier call's arrival, and `again` (:465) sails at `home(at(9), 60)`. In "partial force", the two bad counts (:626-627) are tried at `fought(at(9), 30)`: the 20 sent are now home at plus 60, and at at(9.1) the settle would land them and fold them into the 10 at home. The comment at :793 says the seed carries the march id. The three test names that promise recovery say what now happens: :174 "…and sends the party out and home", :309 "…survivors standing there at once…", :771 "…survivors standing at the town at once…".
   - New, first after the helpers: "a raid sets out and fights when it arrives; the settle never lands a party on its way out". `launch` 40 peltasts on R046 (warband 20) at 9: the report is `{ type: "setout", action: "raid", regionId: "R046", regionName: "Salyes", townId: null, townName: null, base: "R060", route: "land", steps: 1, minutes: 30, departedAt: at(9), arrivesAt: fought(at(9), 30), men: 40, line: "40 peltasts set out to raid Salyes, arriving in 00:30:00." }` (instants as ISO strings); the row reads `{ movingTo: "R046", arrivesAt: fought(at(9), 30), mission: { kind: "raid", regionId: "R046", departedAt, marchId } }`; the march row `{ status: "marching", kind: "raid", baseId: "R060", minutes: 30, party: [the row's id], report: null, seenAt: null }`; the warband is still 20, and there is no `map_report` log. A settle at the arrival instant leaves the row on the road. `resolveMarch` a minute early is `not_due`; at the arrival `resolved`; again `not_due`. Then the march is `resolved` at the arrival with a report won by the attacker (`arrivedAt` the arrival, `homeAt` `home(at(9), 30)`); the row is going home (`movingTo: "R060"`, `arrivesAt: home(at(9), 30)`, a mission with no `marchId`); the warband is `20 - killed`; one `map_report` log dated the arrival, no `map_action` log.
   - New: "a party that finds the place taken turns back". By `launch`, house A sends 30 hoplites to attack R046 (warband 10) at 9 and 20 peltasts to raid it at 9 plus 5 minutes; house B sends 30 hoplites to attack it at 9 plus 10 minutes. Resolve the three marches in arrival order, each at its arrival: A takes R046 at plus 30; A's raid arrives at plus 35 to `{ winner: "turned_back", line: "20 peltasts found Salyes already ours and turned back." }`; B's attack at plus 40 to `{ winner: "turned_back", defender: null, line: "30 hoplites found Salyes held by another house and turned back." }`. Both turned-back parties are whole and going home (`arrivesAt` `home(launch, 30)`); A still holds R046 and the warband is still 0.
   - New: "a party whose men all left on the road breaks up". `launch` 40 peltasts on R046 (warband 20), delete their row (as an unpaid-upkeep disband would), resolve at the arrival: `{ winner: "dispersed", homeAt: null, defender: null, line: "The party sent to Salyes broke up on the road." }`, `attacker.rows` empty, the warband still 20, no `battle_loss` log.
   - New: "winter stops departures, not arrivals": 40 peltasts raid R046 (warband 20, set before the launch) 10 minutes before at(8), in Autumn; resolved at the arrival, 20 minutes into Winter, the raid is fought and won.
   - New: "reports: the Barracks lists them newest first, unread until opened". `launch` a scout of R046 at 9 and a raid on it at 9 plus 10 minutes, then resolve each at its arrival; `barracksView(ctx, at(10)).reports` is the raid then the scout, both `seen: false`, with their `kind`, `arrivedAt`, a `gameDate` and the stored report. `markReportRead` on the raid is ok, and the view shows it `seen: true` and the scout still unread; a second read is ok and changes nothing (`seen_at` keeps the first instant); another player's `markReportRead` on it, an unknown uuid and `"nope"` are each `{ ok: false, code: 404, error: "No such report." }`.
6. apps/server/src/routes/map.test.ts:
   - The raid case (:121): the answer's report is the set-out `{ type: "setout", action: "raid", regionName: "Salyes" }` with the set-out line, the force is 0 (the party is on the march), and the row reads `movingTo: "R046"`. Then `resolveMarch(report.marchId, new Date(report.arrivesAt))` (import mapActions.js), and the march's stored report is won by the attacker with plunder above 0 and a line beginning "Raided Salyes".
   - The scout case (:150): the answer is `{ type: "setout", action: "scout", townId: "reii", townName: "Reii" }`; the move half is unchanged.
7. apps/server/src/routes/barracks.test.ts: "POST /report-read: no marchId is 400, an unknown one 404, without a session 401".

## Commit 4: the hook resolves marches and musters in the order their battles fall

1. apps/server/src/services/koinonMuster.ts, the hook (:913-961):
   - `MusterResolverDeps` becomes `CampaignResolverDeps = { resolve?: (musterId, now) => Promise<unknown>; resolveMarch?: (marchId, now) => Promise<unknown>; onError?: (id, err) => void }`.
   - `resolveDueMusters` becomes `resolveDueCampaigns(now, deps)`: the open musters whose `launch_at <= now` and the marching marches whose `arrives_at <= now` (both indexed), merged by their instant (a muster's launch, a march's arrival), a march before a muster at the same instant, then by id, each resolved in turn (`deps.resolve ?? resolveMuster`, `deps.resolveMarch ?? resolveMarch` from mapActions.ts, which this file already imports from) with today's per-id backoff and error report. The loop stops at the first resolve that answers `busy`: another request is resolving that one and goes on down the same list, so nothing later is fought ahead of it (two parties on one place would otherwise fight the same pool, or both take it). An id in its backoff is passed over as today and holds nothing back.
   - `registerMusterResolver` becomes `registerCampaignResolver`, same paths and the same never-fail rule, calling `resolveDueCampaigns`; its log messages say "campaign resolve failed".
   - The header comment (:68-71) says the same hook resolves a march at its arrival.
2. apps/server/src/index.ts: the import (:49) and the registration (:127-129) use `registerCampaignResolver`; the comment says a muster marches, and a party fights, before the handler of any /api, /me or /admin request.
3. Tests:
   - koinonMuster.test.ts: the two hook cases (:988, :1055) call `registerCampaignResolver`; they are otherwise unchanged. New, after them: "resolveDueCampaigns: marches and musters in the order their battles fall". A muster due at LAUNCH and three marches inserted directly (status `marching`), arriving one hour before LAUNCH, one hour after, and one after `now`, resolved with recording `resolve` and `resolveMarch`: the order is the early march, the muster, the late march, and the march not yet due is not called. A second run whose `resolveMarch` answers `{ outcome: "busy" }` for the early march calls nothing after it.
   - mapActions.test.ts (load koinonMuster.js as `m.muster`): "two parties on one place fight in the order they arrive". Houses A and B each raid R046 (warband 100) with 30 hoplites, A at 9, B at 9 plus 10 minutes, both by `launch`; `resolveDueCampaigns(at(10))` resolves both, and B's report's `defender.start` is `100 - <A's kills>`.

## Commit 5: musters come home on the march clock; `recovery` goes

1. apps/server/src/services/koinonMuster.ts: at :716-717, `const minutes = marchMinutes(battleC.march, { route, steps })` and `arrivesAt = launchAt + minutes`. `MusterReport.recoveryHours` (:571) becomes `minutes: number | null`: null on a stand-down (:702), `minutes` on the resolved close (:876). `MS_PER_HOUR` (:592) goes if nothing else reads it. The comments at :699, :766 and :835 say the march home where they say recovery.
2. content/military/battle.json: `recovery` (:10) goes. packages/shared/src/barracks.ts: `recovery` leaves the type (:62) and the schema (:282).
3. Tests:
   - battle.test.ts: the `recovery` pin and its rejection go.
   - koinonMuster.test.ts: `recovered(steps)` (:538) becomes `LAUNCH + steps × battle().march.minutesPerStep` minutes (every muster in the suite marches one land step or by sea), the repulse's `home` (:838) `at(4 * HOUR) + seaTown.steps × battle().march.minutesPerStep` minutes, and the comment at :752 says seven seas bring the army home by LAUNCH plus 3½ hours. Every other case is unchanged and still green.

## Commit 6: web: the set-out card, the road in the picker, the way home in the report, the map's numbers after a fight

1. apps/web/src/api.ts: `MapSetOutReport` (as the server's), `MapActReport` as the server's (no `recoveryHours` or `arrivesAt`; `marchId`, `minutes`, `arrivedAt`, `homeAt`; the two new winners), `BarracksRosterRow.mission` gains `marchId?: string`, `mapAct` answers `MapActResponse<MapSetOutReport>`, and its comment (:662-665) says it sends the party and answers the set-out report.
2. apps/web/src/map/World2Map.tsx:
   - The `report` state (:389) holds a `PickerReport`, and `onActed` (:1127) takes a `PickerResult`. `onActed` no longer reads `intel`: an action's answer is a set-out report now.
   - The military read (:439-444) becomes a `loadMilitary` function, declared above the effects (all of it above the early return); the mount effect calls it. The arrival refetch (:403-413) waits for the instant itself (it returns while `Date.parse(menHere.earliest) - clockOffset > Date.now()`) instead of trusting `menLeft`, which on a party's first render still reads 0, so it fires when the party gets there, not when it sets out; and it calls `loadMilitary` once the roster has answered (in that request's `.then`), so the strength is read after the battle has committed and shows what the fight left. Once per arrival, as today.
   - `PickerReport` (:1559) adds `MapSetOutReport`.
   - Beside the move constants (:1556-1557), `const MARCH_CLOCK = { minutesPerStep: 30, minutesWithinRegion: 10 }`, mirroring battle.json's `march` (the server decides; this only labels the picker). For an action the footer's route line ends with " · arrives in " and the clock `travelClock(marchMinutes(MARCH_CLOCK, route))`, as a move's does (:1874).
   - `BattleReport`: a `setout` report is a one-line card like a move's, headed "<action> · <place>" (`ACTION_LABEL[report.action]`). For a battle report, the line at :1980 goes; when `homeAt` is set, the note "The march home takes <clock>." (`travelClock(report.minutes)`) takes its place. A turned-back or broken-up report shows no rows table and no turnout line, as a repulse does (:1945).
3. apps/web/test/towns-and-move.test.tsx:
   - The fixture (:70-75) uses `marchId`, `minutes: 60`, `arrivedAt` and `homeAt` in place of `recoveryHours` and `arrivesAt`. The repulsed case (:84) reads "The march home takes 01:00:00."; the taken-town case (:93) reads the conquest line and no way-home line (`homeAt: null`).
   - New: a set-out card ("Raid · Salyes" and the set-out line, no rows table) and a turned-back report (the line, no rows table, the way home).
   - The sea-route picker case (:127) also reads " · arrives in 01:00:00".
4. apps/web/test/world2map-cards.test.tsx: `mountMap` takes an optional roster for /api/barracks (default `[]`), and its /api/map/reach answer takes `now` when it answers (today's REACH.now is fixed at module load, which skews the clock offset by however long the file has run). New: "a party bound for the open region: nothing is read again when it is chosen, the roster and the military numbers once when it gets there". A row moving to R046 (a raid mission with a `marchId`) arriving a moment after the mount; tap R046: still one /api/barracks and one /api/map/military. After the arrival (fake timers for `setInterval` and `Date` only, or `vi.waitFor` on the count; never a fixed sleep): exactly one more of each, the military after the roster; a further flush fetches neither.

## Commit 7: web: Reports in the Barracks, and a party's row across its two legs

1. apps/web/src/api.ts: `BarracksReport` (as the server's `MarchReportView`), `BarracksView.reports?: BarracksReport[]` (optional: an older payload has none), and `barracksReportRead: (marchId: string) => apiFetch<BarracksView>("/api/barracks/report-read", { method: "POST", body: { marchId } })`.
2. apps/web/src/dashboard/panels/BarracksPanel.tsx:
   - Beside `moveReport` (:607), above the early return, `const [openReport, setOpenReport] = useState<MapActReport | null>(null);`.
   - Between the summary strip and the columns, when there is at least one report: a section `data-section="reports"` headed "Reports" (`SectionHead`), one row per report in the order the view gives (newest first): a `<button type="button" className="barracks-row barracks-report" data-report={id}>` laid out as an away row is (`barracks-row-grid two`), with the report's line, its game date under it, and its kind's tag (`MISSION_TAG`). A report not yet opened adds the class `is-new` and a small "NEW" tag before its kind's.
   - A click opens the report in `BattleReport` (in a `w2map-modal-host`, as `moveReport` is); when it was unread, `api.barracksReportRead(id)` follows and the panel takes the returned view, so the highlight is gone and stays gone. A failed read is ignored (the highlight stays).
   - `AwayRow` (:842) is keyed by `${row.id}:${row.arrivesAt}`, as `AltarSection` is keyed on its end (:914). A party's row now makes two legs under one id (out to the place, then home), and with the id alone the countdown carries the old leg's zero into the new one: it refetches at once at the turn and never at the homecoming, leaving the row at 00:00:00.
3. apps/web/src/dashboard/dashboard.css, beside the other `.dashboard-shell .barracks-*` rules: `.barracks-report` as a full-width, left-aligned, borderless button inside the list (no background of its own, inheriting the row's font and colour, a pointer cursor), `.barracks-report.is-new` a faint tint and a gold edge on the left (`--accent-rgb`, `--dash-gold-bright`), and the "NEW" tag in gold. Nothing else changes.
4. apps/web/test/barracks-panel.test.tsx, a new case: "reports: newest first; an unread one is highlighted until opened, and opening it shows the card and marks it read". Two reports over the default payload, an unread raid and a read scout: the raid's row has `is-new` and "NEW", the scout's neither; a click on the raid shows its line in the card and calls `barracksReportRead` with its id; with the returned view the raid's row loses `is-new`. A payload with no reports has no reports section. No hook-order warnings. A second new case: "a party that turns for home counts down again: one refetch at its arrival, none at the turn". The first view has a raid row bound for R046 (a mission with a `marchId`) whose `arrivesAt` has passed; the refetch at its zero answers the same row bound home (`movingTo: "R060"`, `arrivesAt` 30 minutes on, no `marchId`); `api.barracks` is called twice in all, and the row shows "Returning from Salyes" with a running clock.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 7, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- Each new or changed test by name, and anything that came out differently from this prompt, with the reason
- For ruling, as rendered: a set-out card, a turned-back report, the way-home line, and the Reports list with one unread and one read report
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, migration 0068 in `__massalia_migrations` on production (a select through `railway run --service Postgres --environment production`), Pages green and API health.
