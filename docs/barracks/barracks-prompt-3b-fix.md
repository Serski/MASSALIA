# MASSALIA — Barracks, prompt 3b-fix: picker footer, base names, upkeep visibility

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push. One phase, one stop.

## Fixes

### 1. The force picker's Go button is unreachable

On a desktop viewport with nine roster rows the sheet in `apps/web/src/map/World2Map.tsx` overflows: the verdict box is the last visible thing and the Go button is below the fold, and the sheet does not scroll. Make the sheet `max-height` bound to the viewport (about 85vh; on phone widths the full height the existing sheets use), the row list the only scrolling region, and a footer pinned at the bottom containing the verdict box and the Go and Close buttons. Rows still training or recovering go to the bottom of the list as now. Verify with 12 rows at 1366×768 and at 390×844.

### 2. Base names

The picker groups rows under "From R060". Use the region's display name from `names2.json` as the map already does elsewhere: "From Massalia", "From Salyes". Fallback to the id only if the name is missing.

### 3. Header refresh after an action

After a successful action the dashboard header still shows the old drachmae. Wire an `onRefresh` out of the map to the dashboard the way the panels already do, and call it after the report sheet's data arrives. No polling.

### 4. Army upkeep is invisible

`GET /api/barracks` gains `upkeep`, computed from the same per-row plan `settleBarracks` uses (extract the per-day demand function so the view and the settle share it; do not duplicate the arithmetic):

```
upkeep: {
  perDay: { drachmae: n, grain: n, oliveoil: n, wine: n, chicken: n, herbal: n },   // zero-valued keys omitted
  rows: { [rowId]: { drachmae: n, grain: n, ... } },
  note: "Shortfalls are bought at the market's seasonal price."
}
```
Only active rows count; a row still training contributes nothing and its entry is absent.

In `BarracksPanel.tsx`:
- Under the ROSTER header, one line: `Your men eat 210 grain, 120 oil and 40 drachmae a day.` built from `perDay`, listing only non-zero goods, using the goods' display names, drachmae last. If the roster is empty or nothing is active, omit the line.
- Each roster row shows its own per-day line under the status, e.g. `2 grain · 1 oil a day per man, 60 grain · 30 oil for the row` for trained, and the band total for bands.
- Training Ground rows keep the per-man figures they already show.

Do not add upkeep to the Ledger in this prompt.

## Gates

`pnpm -r lint`, server tsc, web tsc, web build, server tests, web tests. Add one server test asserting `upkeep.perDay` for a roster of 30 hoplites plus one band equals what `settleBarracks` charges for one day with full stock.

Commits: `map: picker footer and base names`, `barracks: upkeep in the view and roster`.

**STOP.** Report with screenshots of the picker at both viewports if the tooling allows, else describe. Do not push.

## Scope fence

Only `World2Map.tsx`, `World2Map.css`, `AtlasPanel.tsx`, `Dashboard.tsx` (for the refresh hook), `api.ts`, `BarracksPanel.tsx`, `dashboard.css`, `services/barracks.ts`, `routes/barracks.ts`, and their tests. No content, no migration, no map service changes.
