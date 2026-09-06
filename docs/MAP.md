# The world 2 map

The Atlas shows one hand-drawn map of the western and central Mediterranean, its hinterlands and the Atlantic coasts: **world 2**. It is read-only today — every strength number is served by the API to those entitled to it, and the action row is inert until the war rules exist.

## Regions and polities

- **Geometry** — `tools/map-gen/build_world2.py` derives `apps/web/public/map2/world2.json` (region paths, towns, adjacency, coastal flags) and `terrain2.webp` deterministically from the committed Photoshop sources in `tools/map-gen/sources/`. The PSD is the source of truth: edit it, rebuild, never hand-edit `world2.json`. The build aborts if the town/region counts, exact tiling, connectivity or output size gates fail.
- **Regions** — 175 in all: 140 land (`R001`…`R140`), 33 sea, 2 permanent fog. Region ids are internal; the client shows the names from `names2.json`. 91 land regions hold a town, 49 are townless.
- **Towns** — 105 named towns with pixel positions. `townstats.json` carries the public survey fields for each (population, walls) and nothing else.
- **Polities** — `politics2.json` lists 77 polities (name, colour, culture: Gaulish, Iberian, Greek, Italic, Punic) including `massalia` and `unclaimed`, plus `owners`: region id → polity id. Massalia holds 5 regions; 10 named land regions are `unclaimed` (the four ownerless ones were normalised to it). A polity is a *realm* in the UI when it holds land; Unclaimed is excluded from that list.

## Military pools

Strength lives server-side only (migration `0049_military_pools.sql`, `packages/db/src/military.ts`):

| Table | Per | Columns |
| --- | --- | --- |
| `town_military` | world × town (105 rows) | `garrison`, `pentekonters`, `triremes` |
| `region_military` | world × townless region (49 rows) | `warband` |
| `town_intel` | world × dynasty × town | the same numbers as **scouted**, plus `scouted_at` and `scouted_game_date` |
| `region_intel` | world × dynasty × region | `warband` as scouted, plus the same stamps |

Pools are seeded from `content/map/town-military.json` and `region-military.json` (which also carry each target's owner) at `db:seed` and backfilled at every server boot with `ON CONFLICT DO NOTHING`, so live pools are never overwritten by content. Intel rows are frozen snapshots, never live pointers.

**The authenticated read.** `GET /api/map/military` (cookie session required; not behind `MAP_MUTATIONS_ENABLED`) returns only what the requester may see: the live pools of everything Massalia owns as `home`, visible to every player, and the requester's own dynasty's intel snapshots as `intel` with the game date they were scouted. Anything else is absent, and the map shows "No survey yet". The client fetches it once with credentials; intel rows render "as of ‹game date›".

**Leak guard.** No military key may ship under `apps/web/public`; `apps/web/test/public-leak-guard.test.ts` scans every text asset for `garrison`, `pentekonters`, `triremes` and `warband`.

## Crests

`POLITY_CREST` in `apps/web/src/dashboard/shared.tsx` maps a `politics2.json` polity id to its emblem under `apps/web/public/assets/<faction>.webp`; Massalia keeps the lion mark. The same table feeds the map popover and the Diplomacy list so they cannot drift. A few ids are spelt differently from their asset (`gabati`→`gabali`, `allobriges`→`allobroges`, `trusates`→`tarusates`, `llergetae`→`ilergetae`, `roman_republic`→`rome`). A polity absent from the table falls back to a colour shield on the map and shows no emblem in Diplomacy; Unclaimed land is neutral grey. Crests exist for the Mediterranean powers, the Italian realms, the Gaulish, Iberian and British tribes, Epirus, Sparta, the Illyrians and the North African kingdoms.

## The action matrix

`allowedMapActions()` in `packages/shared/src/mapActions.ts` is the one legality table, pure and DB-free, used by the client to grey buttons and — when actions arrive — by the server to validate them identically:

| Target | Attack | Raid | Scout | Colonise |
| --- | --- | --- | --- | --- |
| Town | yes | yes | yes | no |
| Townless region | yes | yes | yes | yes |
| Anything Massalia owns | no | no | no | no |

Both the town and region panels render the same Attack / Raid / Scout / Colonise row. Every button is **inert**: no handler is wired, and a disallowed button is greyed with the reason in its title. Nothing on the map mutates state; the legacy province-state mutation route stays disabled while `MAP_MUTATIONS_ENABLED` is `false`.

## What Scout will be

Scout is the first action to land. It will write a dated snapshot of the target's current pool into `town_intel` or `region_intel` for the acting dynasty (`scouted_game_date` = the game date of the survey), so the numbers a player sees are what their people last saw, not a live feed. Its cost, cooldown and detection are unspecified; the legality half already exists in the matrix and the storage half in the intel tables. Raid, attack and colonise follow the same shape and wait on the war rules.

## Legacy

The 1,023-cell ProvinceMap and its `/api/world` stream are retired. `apps/web/src/map/ProvinceMap.tsx`, its renderer stack and `apps/web/public/map/*` are unmounted leftovers pending deletion; `/api/map/state` and `/api/map/stream` still serve that mesh's ownership tables and are not used by world 2.
