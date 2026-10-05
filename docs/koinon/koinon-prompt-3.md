# MASSALIA: Koinon, prompt 3: the Raid muster

Read `AGENTS.md` first. Pull `main` (baseline `a51a1fd`, or later if `docs/admin/admin-units-prompt-1.md` or `docs/tooling/tooling-prompt-2.md` has landed: build on top of it). Commit locally only. Do not push. Web changes ship only with a render test. Read every test command's exit code before committing; never chain a commit after a test with `;`.

## What this prompt builds

A koinon can raid as one army. Any member opens a **muster**: a Raid on a town or a townless region, a gathering place on Massalia's own ground, and a launch time. Members move men to the gathering place with the existing Move and pledge them, or pledge hulls, or both. At the launch instant every pledged row fights as one army through the existing battle resolver. Each owner takes the losses on his own rows, the plunder is split by shares, and the men come home to the gathering place.

Also: the Lesche costs 200, down from 500.

Server: one migration (two tables), pure share and loading rules in shared, a muster service with its routes, guards so a pledged row cannot be used elsewhere, the resolve and the hook that runs it. Client: a Muster card on the Koinon tab, a tag on pledged rows in the Barracks, one Chronicle line.

Raid only. Joint Attack is a later prompt.

Save this prompt as `docs/koinon/koinon-prompt-3.md` in the first commit.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- Last migration is `0063_koinon_treasury.sql`, so this prompt's is `0064_koinon_musters.sql`.
- Content `content/koinon/koinon.json`; schema `koinonContentSchema` in `packages/shared/src/koinon.ts:14`. `lesche.cost` is 500 today. The server tests pin it: `services/koinon.test.ts:742` to 763 (499, 500) and `routes/koinon.test.ts:194`, `:204`.
- **The battle is instant.** `act` in `apps/server/src/services/mapActions.ts:231` runs one locked transaction: `lockPlayer`, `settleAll`, target checks, `selectForce` (166), reach, `splitRows` (199), the defender pool, `resolveBattle`, losses per row, plunder (472), then recovery (525): every surviving row gets `movingTo`, `arrivesAt = now + max(1, steps) × recovery.hoursPerStep` hours (348) and a `mission`. The owner's next settle brings them home.
- The resolver is pure: `resolveBattle({ attacker, defender, seed, config, mode })` in `packages/shared/src/battle.ts:113`. Rows carry their own `id`, and the result reports `start` and `end` per row id. `act` seeds it with `sha256(worldId | playerId | target | now)` (441).
- Raid plunder is `round(defenderLosses × raid.plunderPerKill × mult)` drachmae and the same with `raid.grainPerKill`, `mult` being `raid.townPlunderMultiplier` for a town (472). Credits go through `creditDrachmae` and `creditGood` in `services/holdings.ts:60`, `:65`.
- A sea assault on a town must beat its fleet first: naval power of the hulls that sail against `pentekonters × 1 + triremes × 5` (366). Losing it is `repulsed`: no battle, no losses, the force returns with recovery.
- Reach is pure in `packages/shared/src/reach.ts`: `distancesFrom` (201), `stepsTo` (207), `forceStats` (94), `fleetStats` (77), `fleetSpaceAt` (88), `verdictsFor` (107), `routeFor` (149), `REACH_REASON` (60). Land reach is one step; the sea route needs range and space on the hulls whose range covers the crossing.
- Ships are goods in stock (`trade-ship` range 7, space 20, naval 1; `galley` range 4, space 4, naval 5). `act` counts them, never debits or moves them (`fleetInStock`, `barracks.ts:807`).
- Massalia's own places: `homePlaces(topology)` in `services/mapReach.ts:82` (every home region and home town but Massalia's own), beside `topology.massaliaRegion`. Any player may move men to them: `moveTargetsOf` (144) lists them for everyone, and `move` (`mapActions.ts:583`) does it.
- The campaign calendar: `campaignSeason(nowMs, worldStartedMs)` in `packages/shared/src/buildings.ts:230`; `open` is false in Winter.
- A row's mission: `UnitMission` and `UNIT_MISSION_KINDS` (`scout`, `raid`, `attack`, `move`) in `packages/db/src/schema.ts:884` to 887; the column at 876. The barracks settle clears it on arrival (`barracks.ts:552` to 557).
- **The settle merge keys on `movingTo`, not on the mission** (`barracks.ts:571`): a standing row with a mission would be folded into its neighbours today. `selectForce` (`mapActions.ts:166`) refuses a moving row but not a row with a mission, and `disbandRow` (`barracks.ts:738`) checks neither.
- The reach payload's default force is every active, non-moving row at a base (`mapReach.ts:162`).
- The settle can remove a row on its own: insolvency (`barracks.ts:482`) and a band's contract end (523).
- Koinon service `apps/server/src/services/koinon.ts`: the lock-order rule (88), `lockKoinon` (97), `removeMember` (140), `dissolve` (160), `settleHallLocked` (222), `inOwnKoinon` (242), `withOwnKoinon` (255), `KoinonView` (311), `koinonView` (385, read-only), `deriveArmyRow` (918).
- **The worker cannot reach the economy.** `apps/worker/src/index.ts:7` imports only `@massalia/db` and `@massalia/shared`. `settleAll`, the barracks settle, the pools, the holdings credits, the topology and the battle content all live in `apps/server/src/services`. Redis is best-effort: `services/queue.ts:4` says the server's lazy-on-read resolution is the safety net.
- Chronicle: `ChronicleType` (`packages/shared/src/chronicle.ts:25`), `CHRONICLE_EFFECT_LOG_KINDS` (172), `renderForce` (245), `renderCampaignLine` (283), `TYPE_ORDER` (342; 19 is free). Renderers in `FamilyPanel.tsx` (the `koinon` case at 812).
- Client: `KoinonView.tsx` (`KoinonCard` 30, the payload offset 189, the Lesche's one-shot read 198, Board 334, Treasury 374, Lesche 419). Barracks: `MISSION_TAG` and `missionLine` (`BarracksPanel.tsx:91`, `:92`), the home filter at 571. The map's force picker: `World2Map.tsx:1639`. The roster row's `mission` type: `api.ts:1609`.

## Rulings (agreed)

1. **Opening.** Any member opens a Raid muster: a target (a town or a townless region), a gathering place, and a launch time at most one season ahead, never in Winter. One open muster per koinon at a time.
2. **The gathering place** is Massalia or one of Massalia's own places (Arelate, Antipolis, Nikaia, Olbia and the rest), since anyone's men may stand there. Members move men there with the existing Move, then pledge them. Reach is computed once, at launch, from the gathering place, with the pooled fleet.
3. **Pledges.** A member pledges men, hulls, or both. A member with ships and no men can carry other members' men. A pledged row carries a mission, so the settle merge skips it, and it is locked until it returns.
4. **Launch.** The existing resolver fights every pledged row as one army. Each owner takes the losses on his own rows and keeps paying his own upkeep. The men come home to the gathering place.
5. **Plunder** splits by shares: one share per man sent and one per seat of hull space carried.
6. **Raid only.** Joint Attack is a later prompt (opened by the leader or the vice, the opener keeps the place, a holding can be given to a member who has men in it, with a one-year cooldown). Build nothing of it here.
7. **The Lesche costs 200.** `lesche.cost` in `content/koinon/koinon.json` goes from 500 to 200. The client already reads it from the rules block.

## Rulings for the gaps (ruled 5 Oct 2026)

The agreed rules did not settle these. Argiris has ruled on each: P1 to P11 stand as written, P12 is his replacement.

- **P1. Lead time.** The opener picks a lead of 30 minutes to 24 hours (one season). The server computes `launchAt = now + lead`, so no device clock is involved. Opening in Winter for a launch that falls in Spring is allowed; a launch instant that falls in Winter is refused.
- **P2. The target must be reachable in principle** from the gathering place when the muster opens: one land step, or a sea route no longer than the longest hull range in `ships.json`. Whether the pledged force and fleet actually reach it is decided once, at launch.
- **P3. Calling it off.** The opener or the leader may call the muster off before launch. Pledges fall with it.
- **P4. Withdrawing.** A member may withdraw his whole pledge before launch. After launch nothing can be withdrawn.
- **P5. Hulls are pledged, not escrowed.** A pledge of hulls is a count. At launch each pledge counts as the smaller of what was pledged and what the owner then has in stock, as `act` counts ships without moving them.
- **P6. Every pledged hull that can make the crossing sails,** and their naval power together meets a town's fleet. A hull whose range falls short neither sails nor limits the fleet.
- **P7. Seats carried.** On a land route no hull carries anyone, so hulls earn no share. On a sea route the men's space is loaded onto the sailing hulls in order of pledge time (then player id, transports before warships), and each owner earns one share per seat of his hulls that is filled.
- **P8. The split is exact.** Drachmae and grain are each split by largest remainder over the shares, ties to the lower player id, so the parts add up to the whole.
- **P9. A muster that cannot march stands down** at launch with a reason and no recovery: nobody pledged men, or the pooled force and fleet do not reach the target. A sea assault beaten by a town's fleet is `repulsed`: no battle, and the men return with recovery, as in `act`.
- **P10. Men who are gone do not fight.** A pledged row disbanded for unpaid upkeep, or a band whose contract ran out, is simply not there at launch. A member who left or was expelled before launch has no pledge.
- **P11. A member who holds the target cannot pledge to the muster,** as `act` refuses him his own town or land.
- **P12. The Politics count shows an open muster.** An open muster counts once in `koinonPending` for every member but its opener, through the posts' unread mechanism: it counts while the muster is `open` and its `opened_at` is later than the member's `last_read_at`, so opening the Koinon tab clears it. Nothing else about the count changes.

## Worker job or lazy resolve: lazy, and why

The agreed rules ask for one of the two, chosen after reading the code. **Lazy resolve, in the server.**

- The worker cannot run it. It imports only `@massalia/db` and `@massalia/shared`, and the resolve needs `settleAll`, the pools, the holdings credits, the topology and the battle content, which live in `apps/server/src/services`. A worker job would mean moving the economy into `packages/db` or copying it.
- A lazy path has to exist anyway: Redis is best-effort, and `queue.ts` already names the server's lazy-on-read resolution as the safety net.
- The battle is instant in this codebase, so a resolve is one transaction, not a journey to schedule.

To give the result a job at launch would have given, the lazy resolve does two things.

**It computes as of the launch instant.** Every clock in it is `launchAt`, never the clock of the request that triggers it: the owners' settles, the pool reads, the seed (`sha256(worldId | musterId | target | launchAt)`), the recovery (`arrivesAt = launchAt + recovery`), the log rows.

**It runs before anything can see or change its inputs.** Between launch and the resolve only time passes, because every write in this game happens inside a request. So one `preHandler` hook on `/api/*`, `/me/*` and `/admin/*` (never `/health` or static content) runs `resolveDueMusters(now)` before the handler: one indexed query when nothing is due. The hook never fails a request: a resolve that throws is logged and the request goes on, with the muster still open for the next request.

Two safeguards, so a muster in trouble cannot slow every request:

1. **A muster being resolved is skipped, not waited on.** `resolveMuster` begins with `pg_try_advisory_xact_lock` on a key derived from the muster id and returns at once when the lock is not granted. The claim-first update (step 3 below) stays as the guard against applying a muster twice.
2. **A muster whose resolve threw is not tried again for 60 seconds.** The hook keeps the failure time per muster id in process memory and skips that muster until 60 seconds have passed. Each failure is logged once, with the muster id and the error.

## The resolve, exactly

`resolveMuster(musterId, now)` in one transaction:

0. `pg_try_advisory_xact_lock` on the muster's key; not granted: return, nothing done.
1. Read the pledging owners (rows whose `mission.musterId` is this muster, and the hull pledges), unlocked.
2. `lockPlayer` for each, in ascending id order. Then `lockKoinon`. This is the order the rule above `lockKoinon` allows: player locks first, the koinon lock last, never the reverse.
3. Claim first: `UPDATE koinon_musters SET status = … WHERE id = $1 AND status = 'open' AND launch_at <= $now RETURNING`. A lost claim applies nothing.
4. Read the owners again under the locks. If the set differs from step 1, roll back and start again.
5. Keep only owners who are still members of the koinon (P10).
6. `settleAll(tx, ownerCtx, launchAt)` for each owner, so upkeep to the launch instant is charged on the roster that stood.
7. The army: every row still standing with this muster's mission, at the gathering place, active. The fleet: each hull pledge at `min(pledged, in stock)` (P5).
8. Stand down if no men (P9).
9. Reach, once: `stepsTo(topology, distancesFrom(topology, gatherRegion), targetRegion)`, then `verdictsFor(steps, forceStats(army), fleetStats(fleet)).raid`. Not ok: stand down with the verdict's reason. `routeFor` gives land or sea and the steps.
10. On a sea route: the sailing hulls (P6) and the seats loaded (P7). Against a town, the naval check; `repulsed` returns the men with recovery and ends here.
11. The defender pool read at `launchAt` (`readTownGarrison` or `readRegionWarband`), the town's walls as in `act`.
12. `resolveBattle` in `raid` mode with every row as its own `BattleRow`.
13. Losses per row on its owner, one `battle_loss` log each, as `act` writes them. The pool written back.
14. On a win: the plunder total by `act`'s formula, split by shares (ruling 5, P7, P8), credited to each owner.
15. Recovery: every surviving row gets `movingTo = gather_id`, `arrivesAt = launchAt + max(1, steps) × recovery.hoursPerStep` hours, and a `raid` mission. Rows of a stood-down muster just lose the mission.
16. One `koinon_muster` effect_log row per participant with his own Chronicle payload, and the report stored on the muster.

After the transaction, apply each owner's `composureDays` as `act` does.

**Released by the owner's own settle.** Calling off, leaving, expulsion and dissolving never write another player's rows: they hold no lock on him. They change the muster's status or the membership only. `settleBarracks` clears a `muster` mission from the settling player's own rows when the muster is no longer open or he is no longer a member. The resolve holds every owner's lock, so it writes rows directly.

## Phase 0: recon

Confirm the facts above. Also confirm three things the design rests on, and **STOP 0 if any fails**:

1. Every step of `settleAll` writes nothing when its clock is at or before the step's own marker (no negative days, no marker moved backwards). The resolve settles at `launchAt`, and a request already in flight at launch may have settled an owner a few milliseconds past it.
2. No server write to units, pools, wallets or ship stock happens outside a request under `/api/*`, `/me/*` or `/admin/*` (the admin goods adjust can change ship stock).
3. No worker job writes `player_units`, `resources`, `region_military` or `town_military`.

Report whether admin-units-prompt-1 is on `main`. Otherwise **STOP 0 only on a contradiction.**

## Phase 1: the Lesche, rules, tables

**Docs.** This prompt verbatim at `docs/koinon/koinon-prompt-3.md`.

**The Lesche costs 200.** `lesche.cost` to 200 in `content/koinon/koinon.json`. The server tests stop pinning the number: they read the cost from `getKoinonContent()` and build their cases around it (cost minus one refused, cost accepted, the message carrying the cost). The web tests use their own fixture and do not change.

**Content.** `koinon.json` gains:

```json
"muster": { "minLeadMinutes": 30, "maxLeadHours": 24 }
```

The parser refuses a `minLeadMinutes` longer than `maxLeadHours`.

**Shared** `packages/shared/src/muster.ts`, exported from the package index, pure and clock-free:

- `musterLaunch(nowMs, leadMinutes, worldStartedMs, content)`: the launch instant, or `lead` (not a whole number within the bounds) or `winter` (the instant falls in Winter).
- `loadMusterHulls(forceSpace, seaSteps, hulls)`: from `{ ownerId, shipId, count, range, troopSpace, naval, pledgedAtMs }[]`, the hulls that sail (range covers the crossing), their naval power, and the seats filled per owner in P7's order.
- `musterShares(men, seats)`: shares per owner, one per man and one per filled seat.
- `splitByShares(total, shares)`: whole parts per owner by largest remainder, ties to the lower id, summing to `total`.
- `renderMusterLine(payload)`: the Chronicle sentence (Phase 4), shared so the server report and the web agree.

Unit tests:

- `musterLaunch`: 29 minutes and 24 hours and one minute refused; 30 minutes and 24 hours accepted; a launch that lands in Winter refused; opened in Winter for a Spring instant accepted.
- `loadMusterHulls`: a trireme pledged first fills before a later pentekonter; a hull out of range neither sails nor adds naval power; the same pledge time breaks to the lower id; space short of the force fills every seat and reports the shortfall.
- `musterShares` and `splitByShares`: 20 men and 20 seats give 20 shares each; 100 drachmae over shares of 1, 1, 1 give 34, 33, 33 to ids in order; a total of 0; every split sums to its total over 200 seeded cases.

**Migration** `packages/db/migrations/0064_koinon_musters.sql`, idempotent, one transaction:

```sql
CREATE TABLE IF NOT EXISTS koinon_musters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id),
  koinon_id uuid NOT NULL REFERENCES koina(id),
  opener_player_id uuid NOT NULL REFERENCES players(id),
  kind text NOT NULL DEFAULT 'raid' CHECK (kind IN ('raid')),
  region_id text NOT NULL,
  town_id text,
  gather_id text NOT NULL,
  gather_region_id text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  launch_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'stood_down', 'cancelled')),
  closed_at timestamptz,
  report jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS koinon_musters_one_open_idx ON koinon_musters (koinon_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS koinon_musters_due_idx ON koinon_musters (launch_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS koinon_muster_hulls (
  muster_id uuid NOT NULL REFERENCES koinon_musters(id),
  owner_player_id uuid NOT NULL REFERENCES players(id),
  ship_id text NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  pledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muster_id, owner_player_id, ship_id)
);
```

Pledged men have no table: they are the `player_units` rows whose mission is `{ kind: "muster", musterId, regionId, townId?, departedAt }`, `departedAt` being the pledge instant. `"muster"` joins `UNIT_MISSION_KINDS`, and `UnitMission` gains the optional `musterId`. Drizzle schema to match.

Gates: `pnpm -r lint`, shared and db builds, shared tests, the migration applied to a throwaway Postgres and to `massalia_test` twice.

Commits: `docs: koinon prompt 3`, `content: the Lesche costs 200`, `shared: muster rules`, `db: koinon musters and hull pledges`.

## Phase 2: pledges

**A pledged row is locked.** A row is pledged when its mission kind is `muster` and it is not moving.

- `settleBarracks`: the merge (`barracks.ts:571`) skips a pledged row. At the start of the roster work it clears a `muster` mission from the player's own rows when the muster is no longer `open` or he is no longer a member of its koinon. One query, and only when the player has such a row.
- `selectForce` refuses a pledged row for `act` and `move`, and `disbandRow` refuses it: `These men are pledged to the koinon's muster.` (409).
- `reachView`'s default force leaves pledged rows out.
- `RosterView.mission` carries the new kind and `musterId`.
- Export `selectForce` and `splitRows` from `mapActions.ts` for the muster service. No other change to `act` or `move`.

**Service** `apps/server/src/services/koinonMuster.ts`. Every write that changes a muster runs under the koinon lock through `inOwnKoinon`; a write that touches the caller's own rows takes his player lock first and settles him.

- `openMuster(ctx, { regionId?, townId?, gatherId, leadMinutes }, now)`: any member. The target rules are `act`'s (a town, or a townless land region; not fog, not Massalia's own; reuse its sentences). The gathering place is the Massalia region or a home place. `musterLaunch` for the time. P2 for reach in principle. 409 when a muster is already open, with the partial unique index as the guard on two members opening at once.
- `pledge(ctx, { rows, ships }, now)`: `lockPlayer`, `settleAll`, then `inOwnKoinon`. Refused once `now >= launchAt`. Rows: the caller's own, active, standing at the gathering place, not moving, not already pledged; a whole number within the row, a band whole; split with `splitRows`; then the mission. Ships: whole numbers within stock; the given counts replace the caller's hull pledge, and 0 removes one. P11.
- `withdrawPledge(ctx, now)`: `lockPlayer`, then `inOwnKoinon`; clears the mission from the caller's rows and deletes his hull pledges. Before launch only.
- `cancelMuster(ctx, now)`: the opener or the leader; status `cancelled`. It writes no one's rows.
- `musterTargets(ctx, gatherId)`: every legal target reachable in principle from that gathering place, with its name, town or region, route and steps. No garrison, warband or fleet numbers.
- `myMusterPledge(ctx, now)`: settles the caller under his lock, as `GET /api/barracks` does, and returns his rows standing at the gathering place (each marked pledged or not) and his hulls in stock beside his pledge.
- `removeMember` and `dissolve` in `koinon.ts`: a member who goes loses his hull pledges; a koinon that ends has its open muster cancelled. Neither writes rows.
- `koinonPendingCount` in `koinon.ts`: P12. One more lean count, the open muster of the caller's koinon when he is not its opener and its `opened_at` is later than his `last_read_at`.
- **The view.** `koinonView` stays read-only. The `koinon` block gains `muster` (the open one, or null) and `lastMuster` (the most recent closed one, or null):

```
muster: {
  id, kind, openerName, canCancel,
  target: { regionId, townId, name }, gather: { id, name },
  openedLabel, launchAt,
  pledges: [{ playerId, name, men, space, pentekonters, triremes }],
  outlook: { route: "land" | "sea" | null, steps, ok, reason }
}
lastMuster: { id, targetName, gatherName, launchLabel, status, reason, report }
```

`outlook` is the launch verdict as the pledges stand now, derived with the same pure functions and never stored. `rules` gains `musterMinLeadMinutes` and `musterMaxLeadHours`.

**Routes** in `routes/koinon.ts`: `GET /muster/targets?gather=`, `GET /muster/mine`, `POST /muster/open`, `/muster/pledge`, `/muster/withdraw`, `/muster/cancel`. Codes as elsewhere in the file. Error messages are player-facing copy: reuse `act`'s sentence where one exists, and list every new one in the report.

### Tests

`services/koinonMuster.test.ts`, DB-gated, its own world and players:

- **Open.** Any member opens; a non-member gets 403; a second open muster is 409; two members opening at once leave exactly one. Refused: Massalia's own ground, a region with towns, an unknown place, a gathering place that is not Massalia's, a lead of 29 minutes, a launch in Winter, a target out of reach in principle.
- **Pledge.** Men at the gathering place are pledged and carry the mission; men standing elsewhere are refused; part of a trained row splits and the rest stays free; a band goes whole; hulls beyond stock are refused; a second pledge of hulls replaces the first; a holder of the target is refused; a pledge after launch time is refused.
- **Locked.** A pledged row is refused by `act`, by `move` and by `disbandRow`; the settle does not merge it into a free row of the same unit beside it; the reach payload's force leaves it out.
- **Released.** After `cancelMuster`, the owner's next settle clears the mission and the row merges again. The same after he leaves the koinon, after he is expelled, and after an admin dissolve.
- **Withdraw.** Clears the caller's rows and hull pledges and nobody else's.
- **Count.** An open muster adds one to every member's `koinonPending` but the opener's; `markRead` clears it; a muster opened before the member's `last_read_at` adds nothing; a closed muster adds nothing.
- **View.** A member sees the pledges and an outlook that turns from a hull shortfall to ok when a pentekonter is pledged; a non-member sees no muster; the `koina` row and every `player_units` row are byte-identical before and after the read.
- **Routes.** `app.inject()` smoke for the six endpoints, 401 without a session.

Gates: `pnpm -r lint`, server tsc, the server, db and shared suites.

Commits: `barracks: a pledged row is locked`, `koinon: opening a muster and pledging to it`, `koinon: the muster on the koinon page`, `koinon: muster tests`.

## Phase 3: the resolve

`resolveMuster` and `resolveDueMusters(now)` in `koinonMuster.ts`, as "The resolve, exactly" sets out. `registerMusterResolver(app)` adds the `preHandler` hook, registered in `apps/server/src/index.ts` before the routes.

### Tests

In `services/koinonMuster.test.ts`:

- **A land raid, three members.** Each owner's losses land on his own rows and on no one else's; the pool drops by the kills; the plunder parts sum to `act`'s total for those kills; every survivor is bound for the gathering place with `arrivesAt` at launch plus the recovery; one `koinon_muster` log per participant.
- **Deterministic.** The same muster resolved 30 minutes after launch and resolved 3 days after launch, from identical starting rows, gives byte-identical reports, rows, wallets and pool. `arrivesAt` is counted from `launchAt` in both.
- **Shares.** 20 men from one member carried on a second member's pentekonter: 20 shares each, and the split follows them. On a land route the ship owner gets nothing.
- **Sea.** A trireme that cannot make the crossing neither sails nor counts; pooled space short of the force stands the muster down with the hulls reason; a town fleet stronger than the pooled naval power gives `repulsed`, no losses, recovery.
- **Stand down.** No men pledged; out of reach. Rows are free at once, with no recovery.
- **Gone before launch.** A row disbanded for unpaid upkeep by the settle at `launchAt` does not fight; a member expelled before launch neither fights nor shares, and his rows are untouched by the resolve.
- **Hulls sold.** Three pentekonters pledged, one in stock at launch: one sails.
- **Claim first.** Two `resolveMuster` calls under `Promise.all`, 10 runs: one report, wallets credited once.
- **The hook.** A request to any `/api`, `/me` or `/admin` route after launch time resolves the muster before its handler runs; a second request does not resolve it again; `/health` never runs it; a resolve that throws is logged once and the request still answers; a second request within 60 seconds of that failure does not try the muster again, and one after 60 seconds does; a `resolveMuster` call while another holds the muster's advisory lock returns at once without waiting and without applying anything.

Gates as Phase 2.

Commits: `koinon: the muster marches`, `koinon: due musters resolve before any request`, `koinon: resolve tests`.

**STOP 1.** Paste `resolveMuster` in full, `loadMusterHulls`, `splitByShares`, and the hook. Report the three Phase 0 confirmations. Wait.

## Phase 4: Chronicle, client

**Chronicle.** A new kind `koinon_muster` in the five places AGENTS.md names (`TYPE_ORDER` 19), with its own row type and input field, its payload read through `detail.chronicle`. The line comes from `renderMusterLine`:

- won: `Raided {place} with the koinon {koinonName}: sent {sent}, {killed}, {lost}, {drachmae} drachmae and {grain} grain for our share.`
- driven off: `Raided {place} with the koinon {koinonName} and were driven off: sent {sent}, {killed}, {lost}.`
- repulsed: `Sailed against {place} with the koinon {koinonName} and were driven off by its fleet before landing.`

`{sent}` is `renderForce` of his own rows, with ` and {n} hulls` when he sent hulls too, or `{n} hulls` alone. `{killed}` is the army's kills in `renderCampaignLine`'s words (`12 tribesmen slain`, `soldiers` for a town). `{lost}` is his own (`none of ours lost`, `3 of ours lost`). A stood-down muster writes no line.

**`api.ts`.** The new view fields and rules, the two reads and four writes, the roster row's mission kind.

**`KoinonView.tsx`,** member layout, a **Muster** card between Board and Treasury, in the same pottery look.

With no muster open:

- `Any member may call the koinon to a raid. Members bring men to the gathering place and pledge them. At the hour they march as one.`
- A gathering place picker, then a target picker (`ChoicePicker`, filled from `musterTargets` for that place, each `{name} · by land` or `{name} · {n} seas`), then a launch picker (leads from `musterMinLeadMinutes` to `musterMaxLeadHours`, the ones that fall in Winter disabled), and `Call the muster`.
- Under it, when there is one, the last muster: its report line, then per member `{name} · sent {men} men · lost {lost} · {drachmae} drachmae and {grain} grain`; or `Stood down: {reason}`; or `Called off.`

With a muster open:

- `Raid on {target} · gathering at {gather} · marches in {countdown}`, the countdown on the payload's server clock, and `Called by {openerName}`.
- The outlook: `As pledged: by land.` or `As pledged: by sea, {n} seas, {space} of {hullSpace} seats filled.`; when it would not march, the reason in the danger colour.
- The pledges: `{name} · {men} men · {pentekonters} pentekonters · {triremes} triremes`; `No one has pledged yet.` when empty.
- **Your pledge**, from `GET /muster/mine`: each of the member's rows at the gathering place with a count input, each hull type in stock with a count input, and `Pledge`. With no men there: `Move men to {gather} from the Barracks or the map, then pledge them.` `Withdraw my pledge` once he has one.
- `Call it off`, outlined danger, behind a confirm, for the opener and the leader.
- One read a second after `launchAt`, armed and cleared exactly as the Lesche's read is (`KoinonView.tsx:198`): from the payload's own clock, keyed on the payload.

**Barracks.** A pledged row stays under At home with the tag `MUSTER` and the line `Pledged to the koinon's muster.`; Move and Disband are disabled with that line as the reason. `World2Map`'s force picker (1639) leaves pledged rows out. No other map change.

**CSS** in `dashboard.css`, `koinon-*` classes only, beside the one Barracks tag.

### Render tests

- `koinon-view.test.tsx`: no muster shows the form, and the target picker fills from the gathering place chosen; an open muster shows the header, the outlook in both states, the pledges and Your pledge; a member with no men at the gathering place sees the hint and can still pledge hulls; only the opener and the leader see `Call it off`; the last muster renders a won report, a stood-down reason and a called-off line; the launch read is armed from the server clock with the device 10 minutes ahead and cleared by a new payload; no hook-order warning across the states.
- `barracks-panel.test.tsx`: a pledged row shows the tag and the line, with Move and Disband disabled.
- `world2map-cards.test.tsx` or its sibling: the force picker leaves a pledged row out.
- `chronicle-entry.test.tsx`: the three lines, with men only, hulls only, and both.

Gates: `pnpm -r lint`, web tsc, web build, web tests. Then the full `pnpm gate` at HEAD.

Before that gate: tooling prompt 2 (the web suite capped at two workers, `docs/tooling/tooling-prompt-2.md`) must be on `main`. If it is not, STOP and say so; do not run the gate without it. Check the 1-minute load first and wait while it is above 20; report the figure the gate started at. A red caused only by timeouts is a STOP with the log, never a rerun.

Commits: `chronicle: the muster line`, `web: the muster on the Koinon tab`, `web: pledged men in the Barracks and the map picker`.

**STOP 2.** Final report with captures at desktop width and at 390px: the Muster card with no muster, an open muster as a plain member with a pledge made, the same as the opener, a won report, and a pledged row in the Barracks. Wait. Do not push.

## Scope fence

Touch only:

- `docs/koinon/koinon-prompt-3.md`;
- `content/koinon/koinon.json`;
- `packages/shared/src/muster.ts`, `packages/shared/src/koinon.ts` (the content schema), `packages/shared/src/chronicle.ts` (the `koinon_muster` kind only), the package index, and their tests;
- `packages/db/migrations/0064_koinon_musters.sql`, `packages/db/src/schema.ts`, `packages/db/src/chronicle.ts` (the reader branch only);
- `apps/server/src/services/koinonMuster.ts`, `services/koinon.ts` (the view, `removeMember`, `dissolve`, `koinonPendingCount`), `routes/koinon.ts`, `apps/server/src/index.ts` (the hook), and their tests;
- `services/barracks.ts` (the merge skip, the release, the disband refusal, the roster's mission type), `services/mapActions.ts` (the pledged-row refusal and the two exports), `services/mapReach.ts` (the default force), and their tests;
- `apps/web/src/api.ts`, `dashboard/panels/KoinonView.tsx`, `dashboard/panels/BarracksPanel.tsx` (the pledged row), `dashboard/panels/FamilyPanel.tsx` (the renderer), `map/World2Map.tsx` (the one filter at 1639), `dashboard/dashboard.css`, `apps/web/test/`.

Nothing else. In particular:

- No change to `resolveBattle`, the reach rules, the pools, `act`'s or `move`'s behaviour for rows that are not pledged, or the worker.
- No Joint Attack, no holdings from a muster, no scouting muster, no treasury spending on a muster, no map notes, no emblem.
- No balance number in code: the leads live in `koinon.json`, and the raid numbers stay where `act` reads them.

Player-facing copy beyond what is quoted here is new copy: list every string in the report.

## Final report template

As koinon prompt 2's, plus:

```
MUSTER
baseline: <SHA> (admin-units-prompt-1 on main: yes/no)
Phase 0 confirmations: settle with an earlier clock / writes only in requests / no worker writes
migration 0064 applied: throwaway / massalia_test, idempotent rerun clean
Lesche cost: 200 in content; server tests read it from content
deterministic resolve: 30 minutes vs 3 days after launch, identical
shares: the worked case (men, seats, shares, each part, the total)
claim race: 10 runs, one report every run
locked row: act / move / disband / merge / reach force
hook: resolves before the handler; a throw does not fail the request; 60 s backoff; the advisory lock skips a muster being resolved
count: an open muster in koinonPending, cleared by markRead
lock order: every path, player locks before the koinon lock
captures: desktop and 390px, the five views named at STOP 2
NEW PLAYER-FACING COPY: every string not quoted in this prompt, server errors included
RULINGS FOR ARGIRIS: every departure from this prompt, and each of P1 to P12 as built
Committed: <SHA> <subject>, one line per commit, in order
GATE: the load it started at, and the gate's last line at HEAD
```

## STOP 0 ruling

STOP 0 ruling (koinon prompt 3)

Pull main first. If tooling prompt 2 has landed, build on it and report the new baseline.

Confirmation 1: option 1, fixed at the source. One commit, `economy: a settle never moves a marker backwards`, placed right after the docs commit and before the Lesche content commit:
- settleGoods (buildings.ts:502), settleWallet (buildings.ts:594) and settleHoldings (holdings.ts:83): the marker write becomes GREATEST(marker, now), computed in SQL, never in JS.
- The stretch each one banks or charges is never negative. When now is at or before the marker, the step yields nothing, charges nothing and refunds nothing. If the current code already clamps the stretch at zero, say so with the line; if not, clamp it in this commit.
- Tests, against the DB: a settle at T, then a settle at T minus 1 hour, writes nothing and changes no wallet or stock; then a settle at T plus 1 hour banks exactly one hour of goods and income. For holdings, a settle at an earlier clock leaves lastGarrisonedAt where it was.
- Run the full server suite before committing and read its exit code.
- The scope fence widens to those three writes in buildings.ts and holdings.ts and their tests, nothing else in either file.
With this commit in, confirmation 1 counts as satisfied. Report each of the three writes before and after.

Confirmation 2: accepted as reported. POST /characters and the boot-time ensureMilitaryPools do not touch a pledger's state.

Confirmation 3: accepted. The worker's agenda credit can change whether an owner is solvent at the launch settle; that edge stands.

An owner already settled past launchAt fights with his roster as it stands after that settle (his settle at launchAt is then a no-op). That stands too.

Append this ruling verbatim at the end of docs/koinon/koinon-prompt-3.md under "## STOP 0 ruling", inside the docs commit, since nothing is committed yet. Then go on with Phase 1.

Tooling prompt 2 still has to be on main before the Phase 4 gate; that STOP stands.

## STOP 1 ruling

STOP 1 ruling (koinon prompt 3)

Append this ruling verbatim at the end of docs/koinon/koinon-prompt-3.md under "## STOP 1 ruling", as its own commit `docs: koinon prompt 3 STOP 1 ruling`.

Accepted as reported: items 1 to 8, 11 and 12; the outlook's space and hullSpace; an unseen muster in unread; "transports before warships" as the roomier hull first. The step 4 retry path stays untested, but log each retry with the muster id and the attempt number.

Three commits before Phase 4, one item each:

1. `map: a pool write never moves its marker backwards`. writeRegionWarband and writeTownGarrison (mapPools.ts:56, :110) write updated_at as GREATEST(updated_at, now), computed in SQL. Leave the read-time regeneration unchanged: it already writes only when days > 0. Add a DB test: a write at T, then a write at T minus 1 hour, leaves updated_at at T. The fence widens to those two writes and their test.
2. `koinon: forceParts is mapActions' describeForce`. Export describeForce from mapActions.ts, delete the copy in koinonMuster.ts, and change nothing else in mapActions.ts.
3. `barracks: the unpaid-upkeep disband log carries the settle's clock`. The barracks_disband effect_log row takes createdAt from the settle's now. Add a test: a settle at an earlier clock that disbands a row writes its log at that clock.

Then Phase 4. Before its gate:
- `git fetch`. Tooling prompt 2 is now on origin/main (0284ae0); if your fetch does not show it, STOP.
- Rebase the local commits onto origin/main. Verify with `git patch-id` that every rebased commit's diff is unchanged, and report the old and new SHA of each.
- Run the full `pnpm gate` at the new HEAD, starting below a 1-minute load of 20, and report the starting figure. A red caused only by timeouts is a STOP with the log, never a rerun.

STOP 2 as written. Do not push.

## STOP 2 ruling

STOP 2 ruling (koinon prompt 3)

Append this ruling verbatim at the end of docs/koinon/koinon-prompt-3.md under "## STOP 2 ruling", as its own commit `docs: koinon prompt 3 STOP 2 ruling`.

Accepted as reported: items 1 to 7, 10 and 11; P1 to P12 as built; all new copy as listed.

Two commits, one item each:

1. `barracks: the contract-end disband log carries the settle's clock`. The contract-end disband effect_log row takes createdAt from the settle's now, as the unpaid-upkeep one does. Add a test: a settle at an earlier clock that ends a band's contract writes its log at that clock.
2. `web: muster targets nearest first`. The target list orders land targets first by steps, then sea targets by steps, then by name within the same distance. The form opens on the first of them. Update the render test that pins the order.

Then the full `pnpm gate` at HEAD, starting below a 1-minute load of 20, with the starting figure reported. If it ends GATE GREEN at HEAD, tree clean, push without a further STOP:
- plain `git push`, fast-forward only;
- report remote HEAD, the CI run with its Gate step on postgres:16 and its suite counts, the Railway server deploy with migration 0064 confirmed by a read-only read of __massalia_migrations through `railway run --service Postgres --environment production`, the Railway worker deploy, the Pages run, /health, and GET /api/koinon answering 401 without a session;
- read the Railway server log for the first 10 minutes after the deploy and report any line containing "muster";
- then stop the throwaway Postgres on 5433.

If the gate is red, STOP with the log. A red caused only by timeouts is a STOP, never a rerun.

Report every new commit as `Committed: <SHA> <subject>` and quote the gate's last line.
