# Raids 2: the turnout follows the men sent, and a raid can sour a nation

Save this prompt as docs/barracks/raids-prompt-2.md in the first commit.
Repo HEAD when this was drafted: 483d749. No migration. One concern per commit, staged by path. Recon first and STOP only if something below does not match the code; otherwise build straight through to STOP 1. Commits stay local; no push until I say push.

## What it is

Two changes to raids, on top of raids prompt 1. Attack, Scout, moves, regeneration, reversion, tribute and the plunder are untouched.

1. Turnout. A raid now faces between half and all of the men it sends, a whole number rolled once per raid on the battle's own seed. Two bounds hold it to the place: never fewer than one in fifty of the place's warriors or soldiers, never more than one in four, and never more than the pool. An empty pool sends nothing. This replaces the fifth from prompt 1. So 5 men face 2 to 5 and 10 men face 5 to 10 at a 100-man tribe. 50 hoplites at Corsi (96) face at most 24, while 20 peltasts at Carthage (25,500) still face at least 510. The kills still come off the whole pool. A koinon muster rolls the same way on the whole army's men.
2. Grudges. A raid that lands on a place belonging to a nation on the Diplomacy page rolls once: one time in three it lowers that nation's opinion of Massalia by 1 point, clamped at −200. Any raid that fights rolls, won or lost; a landing turned back at sea does not; Scout and Attack do not. A koinon muster rolls once for the whole army. The bar is per world, so every player's raids move it for everyone.

Rulings already made (8 Oct 2026): half to all of the men sent, never fewer than one in fifty, never more than one in four; the turnout note adds what remains ("7 of 96 tribesmen turned out; 89 remain."); a 33% chance of −1 opinion, any raid that lands rolls. Balance stays in content.

Five nations hold their land under a map polity id that differs from their faction id, so a new `polities` list in factions.json maps them: Rome holds `roman_republic`, the Allobroges `allobriges`, the Tarusates `trusates`, the Ilergetae `llergetae`, and the Lacetani both `lacetani` and `lacetanni`. The Gabali hold nothing on the map. Every other faction's land is its own id. Unclaimed land and polities with no faction (the Etruscans, for one) never roll.

## Scope

Three commits; the first also saves this file. Touch only:
- docs/barracks/raids-prompt-2.md (this file)
- content/military/battle.json (the `raid` block only)
- content/diplomacy/factions.json (the five `polities` lists only)
- packages/shared/src/barracks.ts (the `raid` type and schema, `raidTurnout`, a new `raidAngers`)
- packages/shared/src/battle.test.ts
- packages/shared/src/league.ts (the faction schema, `parseFactionsContent`, two new functions)
- packages/shared/src/league.test.ts (the factions describe only)
- apps/server/src/services/factionOpinion.ts (new)
- apps/server/src/services/mapActions.ts
- apps/server/src/services/mapActions.test.ts
- apps/server/src/services/koinonMuster.ts
- apps/server/src/services/koinonMuster.test.ts
- apps/web/src/api.ts (MapActReport and KoinonMusterReport only)
- apps/web/src/map/World2Map.tsx (BattleReport only)
- apps/web/src/dashboard/panels/KoinonView.tsx (the last-muster block only)
- apps/web/test/towns-and-move.test.tsx (the BattleReport cases only)
- apps/web/test/koinon-view.test.tsx (the last-muster case only)

Do not touch: packages/shared/src/battle.ts (the resolver stays pure); the plunder (`raidPlunder`, the spoil, the town multiplier); services/eventEngine.ts, routes/league.ts and DiplomacyView.tsx (they read the bar as they do now); services/mapPools.ts and services/holdings.ts (only call the helpers they export); the Chronicle (lines, kinds, allowlist); the force picker; apps/server/src/routes/map.test.ts (its raid, 40 peltasts against 20, now meets 5 and still wins on every seed); AGENTS.md. No migration. No production write.

## Phase 0: recon (read only)

Confirm each of these. On any mismatch, STOP 0 and report.
- content/military/battle.json:9 is the raid block with `"warbandShare": 0.2` and no `turnout` or `opinion` key.
- packages/shared/src/barracks.ts: the raid type at :45-49 and its schema at :248-268 (`warbandShare` at :251, the object `.strict()`); `seededRoll` at :374; `raidTurnout(raid, pool)` at :378-384; `raidPlunder` at :386-398.
- packages/shared/src/battle.test.ts: :26 pins the raid block; :47-48 reject `warbandShare` 0 and 1.5; :52-57 is the `raidTurnout` case.
- apps/server/src/services/mapActions.ts: `MapActReport` at :74 (the defender's comment at :98-100, `defender` :101, `plunder` :102); `men` at :363 counts the men sent, bands at their headcount; the scout and repulsed reports set `plunder: null` at :419 and :447; the battle seed at :454; `met` at :462-463; the raid branch at :485-495; the report's defender at :536. `regionContentOwner` (:32) and `townContentOwner` (:86) are exported from services/mapPools.ts and both are imported at mapActions.ts:34.
- apps/server/src/services/koinonMuster.ts: imports `townContentOwner` but not `regionContentOwner` at :45; `MusterReport` at :550 (the defender's comment at :569, `defender` :570); `force` at :670 (`force.men`, the army's men) and `isTown` at :672; the stood-down close at :690; `defender` and `plunder` declared at :730-731; repulsed at :736; the seed at :746; `met` at :757; the resolved close at :827.
- content/diplomacy/factions.json has 19 factions; `allobroges` at :244, `tarusates` at :621, `ilergetae` at :668, `lacetani` at :715 and `rome` at :762 carry no `polities` key. The region and town owners in content/map/region-military.json and town-military.json use `allobriges`, `trusates`, `llergetae`, `lacetani` and `lacetanni`, `roman_republic`; Reii is `saluvii`, Thapsus `carthage`, Salyes (R046) `unclaimed`.
- packages/shared/src/league.ts: `factionSchema` at :430-467 is `.strict()`; `parseFactionsContent` at :484-496; `opinionBand` (:308) and `applyOpinion` (:319) clamp to −200..+200.
- apps/server/src/services/eventEngine.ts: `getFactionDefaults` at :56-62 reads and parses factions.json with the repoRoot pattern at :37-41; `change_faction_stance` at :272-275 seeds a missing `faction_relations` row from content (`stance: opinionBand(def.opinion).id`) with `onConflictDoNothing`. `faction_relations` is unique on (world_id, faction_id) (packages/db/src/schema.ts:1168) and references `worlds`, so both suites' `TRUNCATE … worlds CASCADE` clears it.
- apps/web/src/map/World2Map.tsx: `turnout` at :1928, `defenders` at :1929, the enemy row at :1966-1967, the turnout line at :1974, the plunder line at :1976. apps/web/src/dashboard/panels/KoinonView.tsx:207 is the report line. apps/web/src/api.ts: `KoinonMusterReport` at :1424 and `MapActReport` at :1809.
- The map-action suite's world and player ids are random, so a battle's seed changes every run; the muster suite fixes its ids and LAUNCH (koinonMuster.test.ts:25-28, the world uid(1) at :130). Every count below was checked against the real resolver and content on 3000 random seeds, so it holds on either suite.

## Commit 1: the turnout follows the men sent

1. Save this prompt file.
2. content/military/battle.json: in the raid block, `"warbandShare": 0.2` becomes `"turnout": { "floorOneIn": 50, "capOneIn": 4 }`, in the same place.
3. packages/shared/src/barracks.ts:
   - The raid type: `warbandShare: number` becomes `turnout: { floorOneIn: number; capOneIn: number }`, and the comment says a raid faces half to all of the men it sends, never fewer than one in `floorOneIn` of the pool nor more than one in `capOneIn`.
   - The schema: `warbandShare` becomes `turnout: z.object({ floorOneIn: z.number().int().positive(), capOneIn: z.number().int().positive() }).strict()`.
   - `raidTurnout` becomes `raidTurnout(raid: BattleContent["raid"], men: number, pool: number, seed: string): number`: 0 when `pool <= 0` or `men <= 0`; else `lo = Math.max(1, Math.floor(men / 2))`, `rolled = lo + Math.floor(seededRoll([seed, "turnout"]) * (men - lo + 1))`, `floor = Math.ceil(pool / raid.turnout.floorOneIn)`, `cap = Math.max(1, Math.round(pool / raid.turnout.capOneIn))`, and the result is `Math.min(pool, Math.max(floor, Math.min(rolled, cap)))`. Divisions by whole numbers keep it exact: 25,500 / 50 is 510, where 25,500 × 0.02 in floating point is not.
4. apps/server/src/services/mapActions.ts:463 becomes `const met = input.type === "raid" ? raidTurnout(battleC.raid, men, warband, seed) : warband;` with `men` from :363 and `seed` from :454; the comments at :98-100 and :462 say half to all of the men sent, between the floor and the cap. apps/server/src/services/koinonMuster.ts:757 becomes `raidTurnout(battleC.raid, force.men, pool, seed)`, and the comment at :569 says the same.
5. packages/shared/src/battle.test.ts:
   - :26 pins `turnout: { floorOneIn: 50, capOneIn: 4 }` in place of `warbandShare`. :47-48 become rejections of a `turnout` with `floorOneIn` 0, one with `capOneIn` 1.5, and one with an extra key.
   - :53-57 becomes "raidTurnout: half to all of the men sent, between one in fifty and one in four of the pool". On every seed `s0` to `s99`: 40 men against 20 meet 5; 20 against 6000 meet 120; 50 against 3 meet 1; 1 against 100 meets 2; 10 against 0 meet 0; 120 against 33000 meet 660; 50 against 25500 meet 510. Over `s0` to `s399`, 10 men against 100 meet exactly {5: 66, 6: 64, 7: 65, 8: 68, 9: 63, 10: 74} times, and 5 men against 100 meet {2: 98, 3: 97, 4: 96, 5: 109} times (my run, with node's sha256 standing in for `sha256Words`). For pools 0 to 500 and men 1, 5, 20 and 60 on the seed `p<pool>`, the result is never above the pool and, for a pool above 0, never below `Math.ceil(pool / 50)`.
6. apps/server/src/services/mapActions.test.ts:
   - "raid win" (:186): 40 peltasts against 20 meet 5 (a fourth of 20) and kill 4 or 5 on every seed, losing 0 or 1. :188's comment says so; :194 pins `{ start: 20, turnout: 5 }`; :196 becomes `expect([4, 5]).toContain(killed)`; :210 is built from `killed`: ``new RegExp(`^Raided Salyes with 40 peltasts: ${killed} tribesmen slain, (none|1) of ours lost, ${killed * 50} drachmae, ${killed * 5} grain and ${killed * 5} (olive oil|leather|salt|wool) of plunder\\.$`)``.
   - "a small party raids a full warband" (:217): 20 peltasts meet 10 to 20 of 100 and win on every seed, 2 to 5 slain, 0 or 1 lost. :225 pins `start: 100` and a turnout in 10..20; :227 accepts 2 to 5. Rename it "…20 peltasts meet 10 to 20 of 100 and win".
   - "hoplites raid a full warband" (:235): 30 hoplites meet 15 to 25 (half to all, capped at a fourth of 100) and win on every seed, 4 or 5 slain, 0 to 3 lost. :243 pins a turnout in 15..25; :245 accepts 0 to 3. Rename it to match.
   - "too few for the tribe" (:249): at 600 the floor is 12, and 20 peltasts now win there. Move it to `setWarband("R046", 6000, at(9))`: the floor sends 120, and on every seed the party is driven off with 2 or 3 slain and exactly 3 lost. :257 pins `{ start: 6000, turnout: 120 }`; :263 reads `6000 - killed`. Rename it "too few for the tribe: 20 peltasts meet the 120 of 6000 the floor sends, are driven off and take nothing".
   - "town raid" (:536): against Reii's 10, 3 turn out (a fourth of 10, rounded), and on every seed 2 or 3 are slain. :538's comment says so; :543 pins `turnout: 3`; :545 accepts 2 or 3.
   - "attack against a stronger warband" stays as it is (turnout 100).
7. apps/server/src/services/koinonMuster.test.ts:
   - "a land raid of three members" (:552): 120 men against 30 meet 8 (a fourth of 30, rounded), all 8 are slain on every seed, and the army loses 0 to 4 with no row losing more than 2. :586 pins `turnout: 8`; :587 `toBe(8)`.
   - "the altar" (:629): `setWarband(landRegion, 3300)` becomes 33000. Its floor, 660, turns out against 120 hoplites, which is the same fight as before, so the assertions stay (cold 27 to 30, blessed 24 to 26, checked again). The comment at :630-632 says the floor of 33000 turns out.
   - "shares" (:697): by sea, 3 turn out (a fourth of 10) at any walls, 2 or 3 are slain, won on every seed; :698-699's comment says so, :711 pins `turnout: 3`, :712 accepts 2 or 3. By land, the warband regenerated to 15 sends 4 (a fourth of 15, rounded), 2 to 4 are slain, won on every seed; :737-738's comment says so, :747 pins `turnout: 4`, :748 accepts 2 to 4.
   - Unchanged and still green, checked: "claim first" (a fourth of 4 is 1, as before), the two hook cases (3), "by sea: a trireme…" (2), "men gone before launch" (5), "a resolve while another holds…" and "deterministic".

## Commit 2: a raid on a nation's land can sour it

1. content/military/battle.json: the raid block ends with `"opinion": { "chance": 0.33, "loss": 1 }`.
2. packages/shared/src/barracks.ts: the raid type gains `opinion: { chance: number; loss: number }`, the schema `opinion: z.object({ chance: z.number().min(0).max(1), loss: z.number().int().positive() }).strict()`, and `export function raidAngers(raid: BattleContent["raid"], seed: string): boolean` returns `seededRoll([seed, "opinion"]) < raid.opinion.chance`.
3. content/diplomacy/factions.json, after each one's `"governance"`: `allobroges` gets `"polities": ["allobriges"]`, `tarusates` `["trusates"]`, `ilergetae` `["llergetae"]`, `lacetani` `["lacetani", "lacetanni"]` and `rome` `["roman_republic"]`.
4. packages/shared/src/league.ts:
   - `factionSchema` gains `polities: z.array(z.string().min(1)).min(1).optional()`, with a comment: the map polity ids (the `owner` in region-military.json and town-military.json) whose land is this faction's; absent means the faction's own id.
   - `parseFactionsContent` throws `Polity <id> belongs to two factions: <a> and <b>` when one id is claimed twice, counting a faction's own id when it has no `polities`.
   - `export function factionOfPolity(content: FactionsContent, polityId: string | null): FactionDef | null`.
   - `export function raidGrudgeLine(f: Pick<FactionDef, "name" | "group">): string`: `${f.name} will remember this.` for the `major-powers` group, `The ${f.name} will remember this.` for every other.
5. New apps/server/src/services/factionOpinion.ts:
   - The factions content read and parsed once, memoized, as `getFactionDefaults` does at eventEngine.ts:56-62.
   - `export type RaidOpinion = { factionId: string; name: string; from: number; to: number; line: string }`.
   - `export async function raidOpinion(exec, worldId: string, polityId: string | null, seed: string): Promise<RaidOpinion | null>`. It returns null when `factionOfPolity` finds no faction or `raidAngers(getBattleContent().raid, seed)` misses. Otherwise it seeds the faction's row from content as eventEngine.ts:272-275 does, locks it (`SELECT … FOR UPDATE`), and sets `to = applyOpinion(from, -raid.opinion.loss)`. It returns null when `to === from` (already at −200); otherwise it updates `opinion` and `stance: opinionBand(to).id` and returns `{ factionId, name, from, to, line: raidGrudgeLine(faction) }`. It writes no effect_log row of its own: the change rides on the raid's report, which is already stored (the map_action detail, the muster's report).
6. apps/server/src/services/mapActions.ts: `MapActReport` gains `opinion: RaidOpinion | null`; the scout, repulsed and attack reports carry `null`. In the raid branch (:485), after `writeDefender(remaining)` and whether the raid was won or lost: `opinion = await raidOpinion(tx, ctx.worldId, isTown ? await townContentOwner(townId) : await regionContentOwner(regionId), seed)`.
7. apps/server/src/services/koinonMuster.ts: import `regionContentOwner` (:45); `MusterReport` gains `opinion: RaidOpinion | null`, `null` at the stood-down close (:690) and when repulsed. After the battle, won or driven off: `opinion = await raidOpinion(tx, muster.worldId, muster.townId !== null ? await townContentOwner(muster.townId) : await regionContentOwner(muster.regionId), seed)`, carried into the resolved close (:827).
8. Tests:
   - battle.test.ts: the content case pins `opinion: { chance: 0.33, loss: 1 }` and rejects `chance` 1.5 and `loss` 0. `raidAngers` over the seeds `s0` to `s999` hits exactly 314 times (my run).
   - league.test.ts, in the factions describe (:85): on the real file `factionOfPolity` maps `roman_republic` to rome, `allobriges` to allobroges, `trusates` to tarusates, `llergetae` to ilergetae, both `lacetani` and `lacetanni` to lacetani, and `saluvii` to saluvii; `unclaimed`, `etruscans` and null give null. A content where a second faction claims `saluvii` throws. `raidGrudgeLine` gives "Carthage will remember this." and "The Saluvii will remember this."
   - mapActions.test.ts:
     - "raid win": Salyes is unclaimed, so `opinion` is null and the world has no `faction_relations` row.
     - "town raid": Reii is the Saluvii's (start −45). On any seed, either `opinion` is null and no saluvii row exists, or it equals `{ factionId: "saluvii", name: "Saluvii", from: -45, to: -46, line: "The Saluvii will remember this." }` and the row reads opinion −46, stance "unfriendly".
     - "taking a town" (:609, an attack on Reii): `opinion` null and no saluvii row.
     - New, "a raid turned back at sea does not roll": 40 peltasts on 2 pentekonters raid Thapsus (Carthage, fleet naval 8, five seas); the winner is "repulsed", `opinion` null and there is no carthage row.
   - koinonMuster.test.ts, two new cases, each from the suite's reset, one member with 40 peltasts pledged (`pledgedMen(a, "peltast", 40, musterId, 501)`) and `musterRow(k, a, { id, regionId: "R047", townId: "reii" })` at LAUNCH, Reii at its content garrison of 160:
     - With id `uid(900)` the roll hits (0.1013 on my run): `report.opinion` equals the Saluvii object above, and the row reads −46.
     - With id `uid(903)` the roll misses (0.5372): `report.opinion` is null and there is no saluvii row.
     The seed is `sha256("00000000-0000-4000-8000-000000000001|<muster id>|reii|2000-01-11T03:00:00.000Z")`, computed with node's sha256. Both raids are won on every seed (20 to 40 of the 160 turn out), but neither assertion needs the win. If either roll comes out the other way, STOP with both values.

## Commit 3: web: what remains, and the grudge

1. apps/web/src/api.ts: `MapActReport` and `KoinonMusterReport` gain `opinion?: { factionId: string; name: string; from: number; to: number; line: string } | null`. Optional, since a report stored before this change has none.
2. apps/web/src/map/World2Map.tsx, BattleReport only: the turnout line (:1974) becomes `{turnout} of {report.defender.start} {defenders} turned out; {report.defender.end} remain.` (`end` is the whole pool after the kills). After the plunder line (:1976): `{report.opinion ? <p className="w2map-report-note" data-testid="opinion-line">{report.opinion.line}</p> : null}`.
3. apps/web/src/dashboard/panels/KoinonView.tsx: after the report line (:207), `{report.opinion ? <p className="koinon-hint" data-muster-opinion>{report.opinion.line}</p> : null}`.
4. Tests:
   - apps/web/test/towns-and-move.test.tsx: in the town-raid case (:101), :110 reads "2 of 10 soldiers turned out; 8 remain."; the case gains `opinion: { factionId: "saluvii", name: "Saluvii", from: -45, to: -46, line: "The Saluvii will remember this." }` and asserts `getByTestId("opinion-line").textContent`. The taken-town case (:87) asserts no opinion line.
   - apps/web/test/koinon-view.test.tsx: the report at :872 gains the same `opinion`, and its line renders under the report line; the older won report above it shows none.
   - The wording of the remain note and of the grudge line is mine and yours to change at STOP 1.

## Gate and STOP 1

Run `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 3, then `pnpm audit --audit-level=high`. The gate must end `GATE GREEN: HEAD <sha>, tree clean` and the audit must exit 0. A red from a timeout in a suite this diff does not touch is a STOP with the log; never rerun to get a pass. Commit only on a read exit code.

STOP 1. Report:
- Committed: <SHA> <subject>, one line per commit
- Gate: the last line, suite counts; the audit exit code
- Each new or changed test by name, and any count that differs from the ones given above, with the reason
- The BattleReport town-raid case as rendered (enemy row, turnout line, plunder line, grudge line), for ruling
- Any deviation, as a question for a ruling

## Push (only after I reply "push")

Fast-forward only, plain `git push`. Report remote HEAD, the CI run with its Gate and Audit steps, Railway server and worker on the new SHA, Pages green and API health. No migration to confirm.
