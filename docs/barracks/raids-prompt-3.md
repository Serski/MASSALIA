# Raids 3: ships sail with the men, another house's holding is off limits, a fight updates your intel, and pools regrow steadily

Save this prompt as docs/barracks/raids-prompt-3.md in the first commit.
Repo HEAD when this was drafted: 23047d4. One migration (0067). One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

Four changes to the map's actions, ahead of raids prompt 4 (the march). Turnout, plunder, the grudge, the battle, Scout's rules, the move times, the recovery clock and every balance number are untouched.

1. Ships go with the men. Today a sea action counts the hulls in stock and never debits them, so the same pentekonters can carry several parties at once, be pledged to a muster while at sea, and be sold at the agora while at sea. From now on the hulls that sail leave their owner's stock when the party sets out and come back when it is home: with the survivors, or on their own at that same instant if nobody survived. After a conquest they sail home at the instant the survivors take the place up. Home is today's recovery clock (`arrivesAt`, 3 hours a step); prompt 4 moves it to the march. A move by sea takes its hulls there and back: twice the crossing. A koinon muster's hulls that sail leave their owners' stock at the launch and come back with the army; pledged hulls that do not sail never leave. While away a hull is not in stock, so it cannot carry another party, be pledged or be sold. The Barracks lists ships at sea under Away · Returning, one row per sailing, with a countdown. The owner's settle brings them home, claim first.
   The automatic fleet (used only when an action names no ships; the map always names them) adds the in-range warships as an escort only for a raid or an attack on a town, where the naval check reads them. Anywhere else they would leave port for nothing.
2. Another house's holding. An attack on a place another house holds is refused at launch: "Another house holds this town." or "Another house holds this land." Raids and scouts there go on as today. Today such an attack meets only the local pool the conquest emptied, wins, and then fails on player_holdings' one-holder key with a 500. A party that finds the place taken when it arrives belongs to prompt 4.
3. A fight updates your intel. A raid or an attack that reaches the place writes what the men saw to the attacker's dynasty intel, the same row a scout writes: the pool as the fight left it (0 after a conquest) and, at a town, its ships, dated the fight. A landing turned back at sea writes the garrison and the ships its report already shows. A koinon muster that fights writes the intel of every member who fought (men in the army or hulls that sailed) and has a dynasty; a muster turned back at sea writes none, since its report shows no garrison. Another house's fight never touches your intel: that is what scouting is for. The map already applies any report's `intel` to its numbers, so the web needs no change for this.
4. Steady regrowth. A pool regrows 5 a day on a steady clock: the part of a day carries over, and a fight below the full count leaves the clock running. The clock starts when a full pool takes its first loss. Today a read that adds days moves the marker to `now` (dropping the part of a day) and every fight moves it to the fight, so a place raided at least once a day never grows back.

Rulings already made (8 Oct 2026): all four, as written above. The two refusal sentences and the wording of the Barracks row are mine and yours to change at STOP 1. No balance number changes.

## Scope

Five commits; the first also saves this file. Touch only:
- docs/barracks/raids-prompt-3.md (this file)
- packages/db/migrations/0067_player_voyages.sql (new)
- packages/db/src/schema.ts (the new table and its kinds only)
- apps/server/src/services/mapPools.ts
- apps/server/src/services/mapPools.test.ts
- apps/server/src/services/holdings.ts (a new `holderOf` only)
- apps/server/src/services/barracks.ts
- apps/server/src/services/mapActions.ts
- apps/server/src/services/koinonMuster.ts
- apps/server/src/services/mapActions.test.ts
- apps/server/src/services/koinonMuster.test.ts
- apps/web/src/api.ts (BarracksView and a new BarracksVoyage only)
- apps/web/src/dashboard/panels/BarracksPanel.tsx (a new `voyageLine` and `VoyageRow`, the `atSea` list beside `away`, the Away section and the fleet comment only)
- apps/web/test/barracks-panel.test.tsx (one new case)

Do not touch: packages/shared (reach, verdicts, muster loading, the resolver); content JSON; migration 0064 (applied; its "never moved or debited" comment stays as history); apps/web/src/map/World2Map.tsx (the map, the force picker, the BattleReport); KoinonView; the market, the vendor and admin; the Chronicle (lines, kinds, allowlist); AGENTS.md. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- HEAD 23047d4. packages/db/migrations ends at 0066_referrals.sql, and no `player_voyages` table exists.
- Ships are goods in `resources` (scope player, types `trade-ship` and `galley`), counted whole by `fleetInStock` (apps/server/src/services/barracks.ts:919-939, `Math.floor`). content/buildings/buildings.json lists both under `vendor`, so they can be sold and listed. Nothing debits them: `act` reads the stock at mapActions.ts:313, `move` at :657, a muster through `musterState` (koinonMuster.ts:423-456, each pledge counted as the smaller of the pledge and the stock).
- apps/server/src/services/mapActions.ts: the header says "Ships are counted, never debited or moved." (:45); `MapActInput`'s comment on `ships` (:69-72); `MapActReport.intel` (:106); `characterOf` (:146-150); `assembleFleet`'s comment (:152-154); `act` (:250); the target checks open at :264, and the caller's own holding is refused at :275 (town) and :282 (region); the ships at step 4 (:305-348: the chosen fleet :314-333, the automatic one :334-346 with its escort loop :341-345, `naval` :347); the split (:350-351); `isTown` (:355), the pool (:360), `townFleet` (:361), `character` (:362); `arrivesAt` (:366-368); the scout (:388-430: its game date :391, its two intel upserts :392-403, `intel` :427); the repulse (:431-459, `intel: null` :456); the battle (:460-556: `writeDefender` :475, called at :496, :514 and :519; `intel: null` :551); step 8 (:558-560). `move` (:616): the sea route and its `ships` (:653-663), `arrivesAt` (:664), the split and the march (:666-670).
- apps/server/src/services/koinonMuster.ts: the header's "Pledged hulls are counts in koinon_muster_hulls; ships are never moved." (:58); the import from "./mapActions.js" (:42) and `readTownFleet` among the mapPools imports (:46); `characterIdOf` (:156); `world` (:648); every pledging owner, hull-only ones included (`pledgingOwners` :593-597), locked at :625 and settled at the launch instant at :660-664; `load`, `arrivesAt` and the sailing loop (:707-718); the repulse (:740-742); the pool (:749); `defender` (:788); step 16's `participants` (:817) and its loop; the resolved close (:836).
- apps/server/src/services/barracks.ts: `getOrCreateResource` (:174), `creditResource` (:188), `drainResource` (:201); `BarracksSettle` (:347-362) and `emptySettle` (:364); `settleBarracks` (:403), with the pledge release at :417-441 and the early return at :450; the fleet comment (:915-917); `BarracksView` (:941-960); `barracksView` (:987), with `places` at :1024-1029 and `fleet` at :1030.
- apps/server/src/services/mapPools.ts: `readRegionWarband` (:41) persists `updatedAt: now` (:52); `writeRegionWarband` (:58) writes `GREATEST(updated_at, now)` (:62); `readTownGarrison` (:101, :108) and `writeTownGarrison` (:112, :118) do the same. apps/server/src/services/mapPools.test.ts pins that marker: each of its two cases (:45, :56) writes 10 at T, then 7 an hour earlier (the marker stays at T), then 5 an hour later, and expects the marker at that later write (:53, :64).
- apps/server/src/services/holdings.ts: `listHoldings` (:36-42) reads the caller's own holdings only. player_holdings' primary key is (world_id, region_id, town_id) (packages/db/src/schema.ts:918), so a second house's conquest of a held place throws on insert.
- apps/web/src/map/World2Map.tsx:1135-1143 applies any action report's `intel` to the map's numbers; `BattleReport` (:1904) never reads `intel`. apps/web/src/dashboard/panels/BarracksPanel.tsx: `missionLine` (:96-112), `AwayRow` (:263-287), `away` (:661), the fleet comment (:666), the Away section (:790-798). apps/web/src/api.ts: `BarracksView` (:1746-1769).
- Tests. mapActions.test.ts: `recovered` (:22); `makePlayer` returns `dynastyId` (:49-67); `stock` (:73-74); `warband` (:80), `setWarband` (:81), `setGarrison` (:83); `settle` (:111-115) runs settleBarracks directly; the cases this prompt changes start at :189, :279, :370, :388, :418, :547, :573, :755 and :823. koinonMuster.test.ts: `LAUNCH` (:25); `freshPlayer` (:60-66) makes no dynasty; `ships` (:84); `pledgedHulls` (:515-519); `stockOf` (:526-527); `recovered` (:536); `landRaid` (:538-550); the cases this prompt changes start at :552, :697, :754, :778 and :815.

## Commit 1: pools regrow on a steady clock

1. Save this prompt file.
2. apps/server/src/services/mapPools.ts:
   - The header (:5-11) and the read's comment (:37-40): a pool regrows `regen.warbandPerDay` / `regen.garrisonPerDay` per whole day on a steady clock. `updated_at` is the regrowth marker: a read that adds whole days moves it by exactly those days, so the part of a day carries over; a write onto a pool below its content value leaves it where it is; a write onto a full pool (at or above its content value) starts it at the write, which is what a full pool's first loss does.
   - `readRegionWarband` (:52) and `readTownGarrison` (:108) persist `updatedAt: new Date(row.updatedAt.getTime() + days * MS_PER_DAY)` in place of `now`.
   - `writeRegionWarband` reads `const base = await regionBaseWarband(regionId)` and sets `updatedAt` to ``sql`CASE WHEN ${regionMilitary.warband} >= ${base} THEN GREATEST(${regionMilitary.updatedAt}, ${now.toISOString()}::timestamptz) ELSE ${regionMilitary.updatedAt} END` `` (an UPDATE reads the old row's values). The insert fallback stays: a fresh row's clock starts at the write. `writeTownGarrison` does the same with `await townBaseGarrison(townId)`; its `townRow` call still inserts the content row first, so a first write on a fresh town also starts the clock at the write. The comment at :56-57 says the marker moves only on a write onto a full pool, and never backwards.
3. apps/server/src/services/mapPools.test.ts: the 5 written an hour later is below the full count, so the marker now stays at T (:53 and :64 expect T). Each case then writes the content value at that later instant (`await m.mapPools.regionBaseWarband(regionId)`, 400 for R001; `await m.mapPools.townBaseGarrison(townId)`, 100 for abdera), which leaves the marker at T, and one less an hour after that, which moves it to that write: a full pool's first loss starts the clock. Both names end "…; a later write below the full count leaves it there, and the first loss of a full pool starts it". The never-backwards half stays as it is.
4. apps/server/src/services/mapActions.test.ts, a helper beside `warband` (:80): `marker(regionId)`, the region row's `updatedAt`.
   - :418-426 becomes "regrowth: 5 a day on a steady clock; the part of a day carries over, a fight below the full count leaves the clock running, and a full pool's first loss starts it" (R046, content 100): `setWarband("R046", 50, at(9))`; reads give 50 at 9.5, 60 at 11, 65 at 12.5 with `marker` at(12), and 70 at 13 (the old marker, 12.5, gave 65); `setWarband("R046", 60, at(13.5))` leaves `marker` at(13); 65 at 14 (the old rule restarted at 13.5 and gave 60); 100 at 40; `setWarband("R046", 90, at(40.5))` sets `marker` to at(40.5); 90 at 41 and 95 at 41.5.
   - :755-762 becomes the same for a garrison (reii, content 160): `setGarrison("reii", 100, at(9))`; 100 at 9.5, 110 at 11, 115 at 12.5, 120 at 13; `setGarrison("reii", 110, at(13.5))`; 115 at 14; 160 at 40.
   - Every other case is unchanged and still green, checked: the scout reads 100 from a fresh row; a reverted holding writes the content value back; koinonMuster.test.ts's `setWarband` writes its row directly at at(-HOUR), so "shares" still reads 15 at a launch 25 hours on, one whole day.

## Commit 2: an attack on another house's holding is refused at launch

1. apps/server/src/services/holdings.ts: `export async function holderOf(exec: Exec, worldId: string, regionId: string, townId: string): Promise<string | null>`, the `owner_player_id` of the holding at (world, region, town), `townId` being "" for a region holding; null when nobody holds it.
2. apps/server/src/services/mapActions.ts, in `act`'s target checks:
   - After :275: `if (input.type === "attack" && (await holderOf(tx, ctx.worldId, regionId, townId)) !== null) return fail(409, "Another house holds this town.");` The caller's own holding was refused on the line above, so any holder here is another house.
   - After :282: the same with `""` and "Another house holds this land."
   - The comment that opens step 1 (:264) says an attack on another house's holding is refused (raids prompt 3), and a raid or a scout there is not.
3. mapActions.test.ts, a new case after "attack against a stronger warband" (:303): "another house's holding: an attack is refused at launch and nothing moves; a raid there still goes". Player A holds R046 (`insertConquest(db, a.ctx, "R046", "unclaimed", at(8))`) and Reii (`insertTownConquest(db, a.ctx, "R047", "reii", "saluvii", at(8))`). Player B has 30 hoplites at Massalia: his attack on R046 answers `{ ok: false, code: 409, error: "Another house holds this land." }`, his attack on Reii `{ ok: false, code: 409, error: "Another house holds this town." }`; his row still stands at R060, whole and not moving; A still holds both places. Then `setWarband("R046", 100, at(9))`, and B's raid on R046 is ok, of type raid.

## Commit 3: a fight writes what the men saw to the dynasty's intel

1. apps/server/src/services/mapActions.ts:
   - `export async function writeIntel(exec: DbTx, worldId: string, dynastyId: string, seen: { regionId: string; townId: string | null; pool: number; fleet: { pentekonters: number; triremes: number } | null; at: Date; gameDate: string }): Promise<void>`. For a town it upserts `townIntel` on (world, dynasty, town) with `garrison: pool`, the fleet's two counts (0 when null), `scoutedAt: at`, `scoutedGameDate: gameDate`; for a region it upserts `regionIntel` on (world, dynasty, region) with `warband: pool`, `scoutedAt`, `scoutedGameDate`. The scout's two upserts (:392-403) become one call with `pool: warband, fleet: townFleet`, writing the same rows as today.
   - The game date moves from the scout branch (:391) to step 5, beside `arrivesAt`, so every branch can read it.
   - The repulse (:431-459): when `character.dynastyId`, `writeIntel` with the pool as it stood (`warband`) and `townFleet`; `intel` (:456) becomes `{ warband, ...(townFleet ?? {}), scoutedGameDate }`.
   - The battle: once the pool is written (after the branch that ends at :520), `const end = conquest !== null ? 0 : remaining`; when `character.dynastyId`, `writeIntel` with `pool: end, fleet: townFleet`; `intel` (:551) becomes `{ warband: end, ...(townFleet ?? {}), scoutedGameDate }`.
   - The comment on `MapActReport.intel` (:106): what the men saw, a scout's snapshot or the place as a fight left it, also written to the dynasty's intel.
2. apps/server/src/services/koinonMuster.ts:
   - Import `writeIntel` from "./mapActions.js" (:42). Beside `characterIdOf` (:156), `dynastyIdOf(exec, playerId)`: the character's `dynastyId`, or null.
   - With the other lets of the resolve (:728-738), `let seen: { pool: number; fleet: { pentekonters: number; triremes: number } | null } | null = null;`. After the battle, once `defender` is set (:788): `seen = { pool: remaining, fleet: muster.townId !== null ? await readTownFleet(tx, muster.worldId, muster.townId, launchAt) : null }`. A repulse leaves it null.
   - In step 16's loop over `participants` (:817): when `seen`, read the participant's `dynastyIdOf`, and when he has one, `writeIntel(tx, muster.worldId, dynastyId, { regionId: muster.regionId, townId: muster.townId, pool: seen.pool, fleet: seen.fleet, at: launchAt, gameDate: formatGameDate(gameDate(launchAt.getTime(), world.startedAt.getTime())) })`.
3. mapActions.test.ts:
   - "raid win" (:189) also takes `dynastyId`: `r.report.intel` equals `{ warband: 20 - killed, scoutedGameDate: expect.any(String) }`, and the dynasty's R046 row reads `{ warband: 20 - killed, scoutedAt: at(9), scoutedGameDate: r.report.intel!.scoutedGameDate }`.
   - "attack win" (:279): warband 0 in the report's intel and in the row.
   - "town raid" (:547): the report's intel is `{ warband: 10 - killed, pentekonters: 0, triremes: 0, scoutedGameDate: expect.any(String) }` and the Reii row `{ garrison: 10 - killed, pentekonters: 0, triremes: 0 }`.
   - "sea assault" (:573): after the repulse at 9, the report's intel is `{ warband: 10, pentekonters: 4, triremes: 4, scoutedGameDate: expect.any(String) }` and the Aleria row `{ garrison: 10, pentekonters: 4, triremes: 4, scoutedAt: at(9) }`; after the landing at 10 that takes the town, the row reads `{ garrison: 0, pentekonters: 4, triremes: 4, scoutedAt: at(10) }`.
   - New, after "hoplites raid a full warband" (:244): "the number a scout wrote follows the fight: the raider's intel reads what is left, another house's stays as it scouted". `setWarband("R046", 100, at(9))`; players A and B each scout R046 at 9 with 10 peltasts, and both rows read 100; A raids with 30 hoplites at 9.5, slaying 4 or 5 on every seed. A's report intel reads `warband: 100 - killed` and A's row `{ warband: 100 - killed, scoutedAt: at(9.5) }`; B's row still reads `{ warband: 100, scoutedAt: at(9) }`.
4. koinonMuster.test.ts, a new case after "a land raid of three members" (:552): "the fight writes the intel of every member who fought and has a dynasty, dated the launch". `landRaid()`, then give Kallias (`a`) a dynasty: insert a `dynasties` row as mapActions.test.ts:53 does, with `foundingPlayerId: a`, and set his character's `dynastyId`. Resolved at LAUNCH, `region_intel` holds exactly one row, `{ dynastyId, regionId: landRegion, warband: 30 - report.killed, scoutedAt: LAUNCH }` (22 on every seed: all 8 who turn out are slain). Nikias and Deon have no dynasty and write nothing.

## Commit 4: the hulls that sail are away until the party is home

1. packages/db/migrations/0067_player_voyages.sql, in 0064's style:
   ```sql
   -- Hulls at sea (raids prompt 3). The ships that carry men leave their owner's
   -- stock when they sail and come home at returns_at: with the party, or on their
   -- own if nobody survived. One row per sailing per owner: the hulls by ship id
   -- (whole counts), what took them out (a scout, raid, attack or move; a koinon
   -- muster is a raid with its muster_id) and where. The owner's settle credits
   -- them back once returns_at has passed and stamps returned_at, claim first;
   -- the row stays as the record. Idempotent, one transaction.
   CREATE TABLE IF NOT EXISTS player_voyages (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     world_id uuid NOT NULL REFERENCES worlds(id),
     owner_player_id uuid NOT NULL REFERENCES players(id),
     ships jsonb NOT NULL,
     kind text NOT NULL CHECK (kind IN ('scout', 'raid', 'attack', 'move')),
     region_id text NOT NULL,
     town_id text,
     muster_id uuid REFERENCES koinon_musters(id),
     sailed_at timestamptz NOT NULL,
     returns_at timestamptz NOT NULL,
     returned_at timestamptz
   );
   CREATE INDEX IF NOT EXISTS player_voyages_away_idx ON player_voyages (owner_player_id, returns_at) WHERE returned_at IS NULL;
   ```
2. packages/db/src/schema.ts, after `koinonMusterHulls` (:1080-1089): `export const VOYAGE_KINDS = ["scout", "raid", "attack", "move"] as const`, `VoyageKind`, and `playerVoyages` matching the SQL (`ships` as `jsonb("ships").$type<Record<string, number>>()`, the check named `player_voyages_kind_check`, the partial index written the way `koinon_musters_due_idx` is).
3. apps/server/src/services/barracks.ts:
   - `export type VoyagePlan = { kind: VoyageKind; regionId: string; townId: string | null; musterId?: string | null; sailedAt: Date; returnsAt: Date }` and `export async function sailHulls(exec: Exec, owner: Pick<ActingContext, "playerId" | "worldId">, ships: Record<string, number>, plan: VoyagePlan): Promise<void>`. Counts below 1 are dropped; with nothing left it writes nothing. Each ship id is drawn with `drainResource` on its `getOrCreateResource` row: the draw is computed in SQL, as AGENTS.md asks, and since every caller chose its counts from `Math.floor` of the stock it read under the same owner's lock, it takes the whole count. A false return throws. Then it inserts one `player_voyages` row.
   - In `settleBarracks`, a new step 1c after the pledge release (:441) and before the marker's early return (:450), so a player whose men all fell still gets his ships back: claim every voyage of this player and world with `returned_at` null and `returns_at <= now` (`UPDATE … SET returned_at = now … RETURNING id, ships, returns_at`), sort them by `returns_at` then id, and credit each ship count with `creditResource` on its `getOrCreateResource` row. `BarracksSettle` gains `shipsHome: { voyageId: string; ships: Record<string, number> }[]` in that order, and `emptySettle` gives `[]`.
   - `export type VoyageView = { id: string; ships: { id: string; label: string; count: number }[]; kind: VoyageKind; musterId: string | null; regionId: string; townId: string | null; sailedAt: string; returnsAt: string }` and `shipsAtSea(exec, ctx)`: the player's voyages with `returned_at` null, by `returns_at` then id, each ship in ships.json order with its label (counts below 1, and ids the content no longer has, left out of the view).
   - `BarracksView` gains `atSea: VoyageView[]`. `barracksView` fills it after its settle and adds each voyage's region and town to `places`. The fleet comment (:915-917) says ships at sea are not in stock.
4. apps/server/src/services/mapActions.ts:
   - Step 4's automatic escort loop (:341-345) runs only when `townId !== null && input.type !== "scout"`; its comment (:307-309) says why: only a raid or an attack on a town meets the town's fleet.
   - Step 8b, after :560: `if (route === "sea") await sailHulls(tx, ctx, sailing, { kind: input.type, regionId, townId, sailedAt: now, returnsAt: arrivesAt });`. Every branch reaches it: a scout, a repulse, a win, a loss, a party that fell to a man, a conquest.
   - `move`, after the march (:670): `if (route === "sea") await sailHulls(tx, ctx, ships, { kind: "move", regionId: target.regionId, townId: target.townId, sailedAt: now, returnsAt: new Date(arrivesAt.getTime() + minutes * 60_000) });`, there and back.
   - The header (:45) and `assembleFleet`'s comment (:152-154) say the hulls that sail leave stock until the party is home. `MapActInput`'s comment on `ships` (:69-72) says the automatic crossing adds in-range warships as escort only for a raid or an attack on a town.
5. apps/server/src/services/koinonMuster.ts, step 10b after the sailing loop (:715-718): for each owner in `load.sailing`, in ascending id order, his counts by ship id, then `sailHulls(tx, { playerId: ownerId, worldId: muster.worldId }, counts, { kind: "raid", musterId: muster.id, regionId: muster.regionId, townId: muster.townId, sailedAt: launchAt, returnsAt: arrivesAt })`. Every owner there is locked (:625) and was settled at the launch instant (:660-664), so ships of his that were home by then are in stock. A stand-down and a muster by land sail nothing. The header (:58) says the hulls that sail leave their owners' stock from the launch until the army is home.
6. mapActions.test.ts, with a `voyages(ctx)` helper beside `stock` (the player's rows, by `sailedAt` then id):
   - "a sea target without enough hulls…" (:370) becomes "…; with hulls the raid sails, and the hulls are out of stock until the party is home". :383-385 become: stock 0 trade-ships and 0 galleys; one voyage `{ ships: { "trade-ship": 1, galley: 5 }, kind: "raid", regionId: "R078", townId: null, musterId: null, sailedAt: at(9), returnsAt: recovered(at(9), 2), returnedAt: null }`; `(await m.barracks.barracksView(ctx, at(9.1))).atSea` equals `[{ id: <that voyage>, ships: [{ id: "trade-ship", label: "Pentekonter", count: 1 }, { id: "galley", label: "Trireme", count: 5 }], kind: "raid", musterId: null, regionId: "R078", townId: null, sailedAt: at(9).toISOString(), returnsAt: recovered(at(9), 2).toISOString() }]`; a settle one minute before `recovered(at(9), 2)` gives `shipsHome` `[]`; the settle at that instant gives `[{ voyageId, ships: { "trade-ship": 1, galley: 5 } }]`, stock 1 and 5, and `returnedAt` that instant; a settle at 10 gives `[]` and the stock stays.
   - "a chosen fleet" (:388): :404 becomes stock 0 trade-ships and 1 galley (the second trireme stayed in port). After the settle at 10 (:407) the stock reads 2 and 2, and the rest of the case runs as before.
   - "sea assault" (:573): after the repulse, 0 trade-ships and one voyage `{ kind: "attack", townId: "aleria", ships: { "trade-ship": 2 }, returnsAt: recovered(at(9), 2) }`. After the landing at 10, 0 trade-ships and 0 galleys (the escort sailed too) and a second voyage `{ ships: { "trade-ship": 2, galley: 5 }, returnsAt: recovered(at(10), 2) }`. The case's settles at 10 (:603) and 11 (:615) bring each home before the next sailing.
   - "move refusals" (:823): :838 becomes 0 trade-ships and one voyage `{ kind: "move", regionId: "R065", townId: "emporion", ships: { "trade-ship": 2 }, sailedAt: at(9), returnsAt: new Date(at(9).getTime() + 60 * 60_000) }`. After :840, a settle 59 minutes after at(9) brings nothing home; one at 60 minutes brings both.
   - New, after "a chosen fleet": "hulls at sea carry no second party until they are home". One pentekonter, `setWarband("R078", 10, at(9))`, 20 peltasts and 20 hoplites at Massalia (two units, so the settle does not merge them). The peltasts' raid on R078 sails. The hoplites' raid then answers `{ ok: false, code: 409, error: "Beyond the fleet's range (2 seas, fleet reaches 0)." }` (the reach reads an empty port, and range comes before hulls), and their row stays home. At `recovered(at(9), 2)` the hoplites' raid sails on the same hull: `report.ships` is `{ "trade-ship": 1 }`.
   - New: "a party that falls to a man still brings its hulls home, on the party's clock". One pentekonter, `setWarband("R078", 6000, at(9))`, 5 hoplites: the floor sends 120 and all 5 fall on every seed (checked on 3000 random seeds with the real resolver). The winner is "defender" with 5 lost, the player has no rows left, the stock is 0 with one voyage returning at `recovered(at(9), 2)`, and the settle at that instant brings it home: stock 1.
7. koinonMuster.test.ts, with a `voyagesOf(playerId)` helper beside `stockOf`:
   - "shares" (:697): the comment at :730 ("His ships are counted, never moved.") says his two hulls sailed and are at sea; :732 becomes `"0"`, and the ship owner has one voyage `{ ships: { "trade-ship": 2 }, kind: "raid", musterId: bySea, regionId: seaTown.regionId, townId: seaTown.townId, sailedAt: LAUNCH, returnsAt: recovered(seaTown.steps), returnedAt: null }`; the soldier has none. Assert that `recovered(seaTown.steps)` is no later than at(DAY) (seven seas at most, so at(23 hours)). The land resolve at at(DAY) (:745) settles the ship owner at its launch, so afterwards his stock reads `"2"` again and the voyage's `returnedAt` is at(DAY).
   - "by sea: a trireme…" (:754): the transporter's trade-ship stock is `"0"` with one voyage `{ ships: { "trade-ship": 1 }, musterId }`; the escort's galley stays `"1"` and he has no voyage.
   - "by sea: space short…" (:778): after the stand-down the ship owner still has `"1"` and no voyage; after the repulse he has `"0"` and one voyage `{ ships: { "trade-ship": 2 }, returnsAt: home }` (`home` from :806).
   - "stands down with no men pledged…" (:815): the member's pentekonter stays `"1"`, and there are no voyages at all.

## Commit 5: web: ships at sea in the Barracks

1. apps/web/src/api.ts: `export type BarracksVoyage = { id: string; ships: { id: string; label: string; count: number }[]; kind: "scout" | "raid" | "attack" | "move"; musterId: string | null; regionId: string; townId: string | null; sailedAt: string; returnsAt: string }`, and `BarracksView` gains `atSea?: BarracksVoyage[]` (optional: an older payload has none).
2. apps/web/src/dashboard/panels/BarracksPanel.tsx:
   - Beside `missionLine` (:96-112), `voyageLine(v, names)`: "The koinon's raid on <place>" for a muster, else "Raid on", "Scouting", "Attack on" or "Carrying men to" followed by the place (the town's name when there is one, else the region's).
   - After `AwayRow` (:263-287), `VoyageRow({ voyage, names, offset, serverNowMs, onZero })` in AwayRow's markup: `className="barracks-row barracks-away barracks-voyage"` and `data-voyage={voyage.id}`; the name "Pentekonter · 2, Trireme · 1" (each ship as `label · count`, joined by ", ") with the clock to `returnsAt` on the right; `voyageLine` under it; a ProgressBar from `sailedAt` to `returnsAt`, tone "away"; the tag "AT SEA". At zero it calls ``onZero(`${voyage.id}:sea:${voyage.returnsAt}`)`` once, as AwayRow does, so the panel refetches and the settle brings the ships home.
   - `const atSea = view.atSea ?? []` beside `away` (:661). In the Away section (:790-798) the empty line shows only when both are empty, and the VoyageRows follow the AwayRows. The fleet comment (:666) says ships at sea are listed under Away.
3. apps/web/test/barracks-panel.test.tsx, a new case: "ships at sea: one row per sailing under Away · Returning, with the hulls, what took them out, the clock, a bar and the AT SEA tag". Two voyages over `roster: [homeLevy]`: `voy-1`, a raid on R046 with 2 pentekonters and 1 trireme, sailed at `NOW - H`, back at `NOW + 2 * H`; `voy-2`, the same with `musterId: "m-1"` and 1 pentekonter. The away section has two `.barracks-voyage` rows. voy-1 reads "Pentekonter · 2, Trireme · 1" and "Raid on Salyes", shows a clock matching `/0(1:59:5\d|2:00:00)/`, the tag "AT SEA" and a bar at width 33%; voy-2 reads "The koinon's raid on Salyes"; "No one on the march." is absent; there are no hook warnings. A second mount of the default payload has no `.barracks-voyage`, and its away rows are still the two at :131.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 5, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- Each new or changed test by name, and anything that came out differently from this prompt, with the reason
- The two refusal sentences, and the AT SEA row as rendered (name, line, tag), for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, migration 0067 in `__massalia_migrations` on production (a select through `railway run --service Postgres --environment production`), Pages green and API health.
