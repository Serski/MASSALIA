# MASSALIA: Barracks spec v1

Status: design, not built. All numbers are v1 placeholders on a shared scale. Scale resource figures to real yields before shipping. Everything here is server-side only; no unit definitions, rosters, pools or market rolls reach the static frontend.

Resource ids in the repo (`content/buildings/buildings.json` vendor list): wheat = `grain`, olive oil = `oliveoil`, wood = `timber`, herbs = `herbal`, and `wine`, `chicken`, `leather`, `iron`, `wool`, `tin`, `horse` as written. All exist already; nothing new to add. The existing `merc.ts` / `contracts.json` / `merc-cards.json` are the Hoplite's personal contract system and are unrelated; the new system uses "units" and "bands" throughout.

## 1. Tab

- Name: **Barracks**
- Position: main UI, immediately before Politics.
- Visible from round start. Locked until `player_characters.militia >= 20` (the repo stat is `militia`). Lock label: "Militia 20 required".
- Sections inside: Levy (manpower pool), Training Ground, Mercenary Market, Roster.

## 2. Levy (manpower pool)

The pool is the player's own oikos manpower. It caps trained units; mercenaries never touch it.

- Starts at 100 men.
- Grows +10 every 4 seasons (one in-game year, 4 real days). No hard cap in v1.
- Growth accrues from round start regardless of when the tab unlocks.
- Recruiting draws men out of the pool. Disbanding returns them. Deaths are permanent.
- Pool is a stored integer, adjusted on recruit (−), disband (+), casualty (−). Growth is applied closed-form on settle: `owed = floor((season − lastGrowthSeason) / 4) * 10`.

## 3. Trained units

Recruited from the Levy. Gear is paid once per man in raw materials, not drachmae, so trained troops are a product of the player's own economy. Training time in seasons. Daily upkeep in wheat and olive oil per man. No drachmae at any point on the trained side.

Gear recipe per man:

| Unit | Wood | Leather | Iron | Tin | Wool | Horse |
|---|---|---|---|---|---|---|
| Peltast | 2 | 1 | 0 | 0 | 0 | 0 |
| Ekdromos | 1 | 1 | 1 | 0 | 0 | 0 |
| Hoplite | 1 | 0 | 1 | 2 | 0 | 0 |
| Hippeis | 0 | 2 | 1 | 0 | 2 | 1 |

Training, upkeep and stats per man:

| Unit | Train (seasons) | Wheat/day | Oil/day | Atk | Def | Msl | Mor | Spd | Space |
|---|---|---|---|---|---|---|---|---|---|
| Peltast | 1 | 1 | 1 | 3 | 2 | 5 | 4 | 8 | 1 |
| Ekdromos | 1 | 1 | 1 | 5 | 4 | 2 | 5 | 6 | 1 |
| Hoplite | 2 | 2 | 1 | 7 | 8 | 0 | 7 | 3 | 1 |
| Hippeis | 2 | 3 | 1 | 6 | 4 | 2 | 6 | 10 | 3 |

Rules:
- Light units need no metal. Heavy line needs tin (bronze). Tin is the intended bottleneck: it comes in through the Trader's long routes, so heavy infantry depends on trade.
- Cavalry needs one horse per man. Horse is a resource produced by the Landowner (pasture or stud building), so cavalry depends on the Landowner the way heavy infantry depends on the Trader. The horse dies with the man; no separate tracking.
- Recipes use existing resource ids. If wool, tin or horse are not yet resources, add them before implementing.
- Minimum 2 seasons of service before disband is allowed.
- Disband returns men to the pool. Materials and horses are not refunded.
- Hippeis wheat includes the horse.
- Losses can be replaced by training more, pool and materials permitting.

## 4. Mercenary market

- Catalogue of 20 band types (section 5).
- Each season the player sees 3 bands, drawn at random from the catalogue excluding bands they already have under contract. Seed the draw on `(playerId, season)` so a refresh or re-login never rerolls.
- Per-player market, not global. Avoids first-come races across timezones.
- Hiring a band removes it from that season's offers.
- No hiring fee. Bands become available immediately, no training.
- Max 2 bands under contract at once (tuning dial).

## 5. Mercenary bands

Bands are 20 to 40 men. Upkeep is per band per day, not per man. Stats are per man; a band fights as its current headcount. Space is per man; cargo for a band is `count × Space`.

| # | Band | Men | Dr/day | Wine | Chicken | Herbs | Wheat | Atk | Def | Msl | Mor | Spd | Space |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Volcae irregulars | 40 | 40 | 4 | 4 | 2 | 0 | 4 | 2 | 1 | 3 | 6 | 1 |
| 2 | Ligurian light foot | 30 | 45 | 3 | 3 | 2 | 0 | 4 | 4 | 3 | 4 | 7 | 1 |
| 3 | Salluvii warband | 30 | 75 | 4 | 4 | 2 | 0 | 8 | 4 | 0 | 5 | 5 | 1 |
| 4 | Samnite infantry | 30 | 90 | 4 | 4 | 2 | 0 | 6 | 6 | 2 | 6 | 5 | 1 |
| 5 | Lucanian javelinmen | 30 | 60 | 3 | 3 | 2 | 0 | 4 | 3 | 5 | 4 | 7 | 1 |
| 6 | Etruscan hoplites | 20 | 90 | 3 | 3 | 2 | 0 | 6 | 7 | 0 | 6 | 3 | 1 |
| 7 | Syracusan hoplites | 20 | 110 | 3 | 3 | 2 | 0 | 7 | 8 | 0 | 7 | 3 | 1 |
| 8 | Spartan hoplites | 20 | 200 | 4 | 4 | 3 | 0 | 9 | 9 | 0 | 10 | 4 | 1 |
| 9 | Iberian scutarii | 30 | 90 | 4 | 4 | 2 | 0 | 7 | 6 | 2 | 6 | 5 | 1 |
| 10 | Iberian caetrati | 40 | 50 | 4 | 4 | 2 | 0 | 4 | 3 | 4 | 4 | 8 | 1 |
| 11 | Balearic slingers | 20 | 70 | 2 | 2 | 1 | 0 | 2 | 2 | 8 | 4 | 7 | 1 |
| 12 | Rhodian slingers | 20 | 80 | 2 | 2 | 1 | 0 | 2 | 2 | 7 | 5 | 7 | 1 |
| 13 | Cretan archers | 30 | 120 | 3 | 3 | 2 | 0 | 3 | 2 | 9 | 5 | 6 | 1 |
| 14 | Thracian peltasts | 30 | 75 | 3 | 3 | 2 | 0 | 4 | 3 | 6 | 5 | 8 | 1 |
| 15 | Illyrian raiders | 40 | 45 | 4 | 4 | 2 | 0 | 5 | 2 | 3 | 3 | 8 | 1 |
| 16 | Libyan spearmen | 30 | 80 | 3 | 3 | 2 | 0 | 6 | 6 | 0 | 6 | 4 | 1 |
| 17 | Numidian light cavalry | 20 | 100 | 2 | 2 | 1 | 30 | 4 | 2 | 5 | 4 | 10 | 3 |
| 18 | Tarentine cavalry | 20 | 120 | 3 | 3 | 2 | 40 | 5 | 3 | 5 | 5 | 9 | 3 |
| 19 | Gallic noble cavalry | 20 | 150 | 4 | 4 | 2 | 40 | 8 | 5 | 0 | 6 | 8 | 3 |
| 20 | Thessalian cavalry | 20 | 180 | 4 | 4 | 2 | 40 | 8 | 6 | 0 | 7 | 9 | 3 |

Role coverage: 8 line, 5 skirmish, 3 missile, 4 cavalry. Bands bring their own gear and horses; that is part of what the drachmae pays for. Cavalry bands draw wheat for horses; all bands draw wine, chicken and herbs (herbs ties the Priest into the war economy).

## 6. Contracts and renewal

- Contract minimum 2 seasons. `contractEndSeason = recruitedSeason + 2`.
- At contract end, on settle, the band rolls to offer renewal. Default 80%. Volcae, Salluvii, Illyrian 60%. Spartan, Cretan, Rhodian 90%. If the roll fails, the band leaves at the end of that season.
- A renewed contract is another 2 seasons at the same upkeep.
- Mercenary bands never reinforce. Casualties reduce headcount for the life of the contract.
- The player may release a band at any time after the minimum. No refund, nothing returns to the pool.

## 7. Casualties, disband, insolvency

- Casualties from map actions are applied per roster row, proportional to headcount (v1). A row at 0 is deleted.
- Trained deaths reduce the pool permanently. Trained disbands return men to the pool.
- Insolvency runs inside `settleAll` after household charges. Charge order: household pop, then trained units, then mercenaries. On any shortfall, disband from the bottom up until the remainder clears:
  1. Mercenary bands, highest Dr/day first.
  2. Trained units, most expensive to raise first (Hippeis, Hoplite, Ekdromos, Peltast). Men return to the pool.
  3. Existing household eviction order (court NPCs, slaves, freemen, citizens).
- Each disband writes a Chronicle line.

## 8. Space and transport

- Space per man: infantry 1, cavalry 3.
- Ship loading: `sum(count × space)` across embarked rows must be ≤ the ship's cargo. Uses the existing fleet cargo value; no new ship stat.

## 9. Deployment and reach

Every roster row and every ship has a `basedAt`: the Massalia region by default, or a colony the player has founded. All reach is computed from the base.

Land:
- Attack, Raid and Scout by land may target only regions adjacent to the base region (1 land step; a town in a base's own region counts as adjacent). No ships involved. There is no longer a two-step rule for fast parties: Spd is used by the battle resolver and by the scout requirement (a scouting party needs a man at Spd ≥ 6), not by reach.
- Inland regions are reachable only by land from a base. Reaching the Gaulish interior means founding a coastal colony first.

Sea:
- A force embarks on a fleet. `Σ (count × Space)` across embarked rows must be ≤ `Σ cargo` across the fleet's ships. Uses the existing ship cargo value, no new stat.
- Each ship type has a `range` in sea regions. Fleet range is the lowest range of any ship in it.
- Pentekonter: range 7, carries the troops. Trireme: range 4, carries little but fights. (Historically the trireme beached nightly and carried no supplies; the pentekonter was the Phocaean long-range hull. If the existing trireme cargo value is large, add a `troopSpace` override rather than letting it carry a phalanx.)
- A sea attack may target any coastal region whose adjacent sea region is within fleet range of the base's port. If the target has a fleet, existing naval resolution runs first; ships do not otherwise take part in the land fight.
- After a Raid or Attack the force and its ships return to base automatically.

Holdings as bases:
- A holding is any region the player controls outside Massalia: a colony founded by Colonise, or a region seized by a successful Attack. Both are bases and follow the same rules.
- Rows and ships can be relocated to a holding. By land, a relocation is allowed to an adjacent holding. By sea, the cargo rule applies. A relocation is a map action with no combat, same timing as existing actions.
- Rows based at a holding are its garrison. They defend it against NPC warbands and other players through the same resolver, and Attack and Raid reach is then computed from the holding. Conquer the region next to Massalia and the next ring inland opens; chain conquest is intended.
- A holding with no rows based in it for a full season reverts to its previous owner, or to NPC control if it had none. Depth costs garrisons.
- Upkeep for rows based at a holding is still charged from the player's stock on settle. No supply lines in v1.

## 10. What the resolver reads

Combat resolution is a separate spec. The stat contract for it:

- Army strength per stat = `Σ (count × stat)` across rows.
- Phase order: missile (Msl vs Def), melee (Atk vs Def), morale check, then Spd decides disengage and pursuit.
- Morale v1: a row breaks when cumulative losses exceed `Mor × 5%` of its starting headcount (Mor 4 breaks at 20%, Mor 10 at 50%).
- Skirmish behaviour is derived, not stored: a row with Msl ≥ 4 and Spd higher than the enemy's slowest line row shoots and refuses melee.

## 11. Data model

```
roster_row {
  id, playerId, unitId,
  source: 'trained' | 'merc',
  count, startCount,
  recruitedSeason,
  readyAtSeason,        // trained only; row is inactive until season >= readyAtSeason
  contractEndSeason,    // merc only
  basedAt,              // regionId: Massalia or a player colony
  movingTo,             // regionId while relocating, else null
  arrivesAtSeason       // relocation completes on settle when season >= arrivesAtSeason
}

ship {
  id, playerId, type,   // 'pentekonter' | 'trireme'
  range,                // sea regions: pentekonter 7, trireme 4
  cargo,                // existing value; troopSpace override optional
  basedAt, movingTo, arrivesAtSeason
}

levy {
  playerId, men, lastGrowthSeason
}

merc_market {
  playerId, season, offers: [bandId, bandId, bandId], hired: [bandId]
}
```

Settle steps, all closed-form on login:
1. Levy growth owed since `lastGrowthSeason`.
2. Activate trained rows where `season >= readyAtSeason`.
2b. Complete relocations where `season >= arrivesAtSeason`: set `basedAt = movingTo`, clear `movingTo`.
3. Charge upkeep for every active row for the elapsed days.
4. Insolvency cascade (section 7).
5. Contract ends and renewal rolls for merc rows where `season >= contractEndSeason`.
6. Roll this season's market offers if not already rolled.

No tick, no queue worker.

## 12. Tuning dials, in order of reach

1. Max concurrent merc bands (2).
2. Levy growth (+10 / 4 seasons) and whether to hard-cap the pool.
3. Merc Dr/day scale.
4. Gear recipes, tin quantity on Hoplite first.
5. Trained wheat and oil per man.
6. Renewal percentages.
7. Morale break multiplier (5% per Mor point).
8. Ship ranges (7 / 4) and the Spd ≥ 6 threshold for 2-step Raids.
9. Reversion delay for an ungarrisoned holding (1 season).

## 13. Open questions

- Private barracks upgrade (prestige + silver, inside the tab: faster training, +1 merc slot, faster levy growth). Dropped from this draft; add back if the levy alone under-constrains.
- Should the pool count growth from round start or from tab unlock. Spec says round start; revisit if late unlockers arrive with 250 men.
- Casualty weighting by role (line takes more than missile and cavalry) once the resolver exists.
- A successful Attack seizes the region and it becomes a holding (section 9). What that means for a town versus a townless region (tribute, population, buildings) follows the existing action result and needs its own ruling.
- Whether Massalia itself can be attacked by other players. Spec assumes no: home rows are never a garrison target.
