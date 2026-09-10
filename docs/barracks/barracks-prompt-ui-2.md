# MASSALIA — Barracks, prompt ui-2: the Barracks panel redesign

Read `AGENTS.md` first. Pull `main`. Commit locally only. Do not push.

## The reference

`docs/barracks/design/Barracks_dc.html` (with its `support.js`) is the design for the Barracks panel. It is a Claude Design document: read its HTML source for structure, hierarchy, spacing, copy and the sample data in the script at the bottom; you do not need to render it. Match its layout and information design. Use the app's existing fonts, colours and `dashboard.css` tokens rather than copying the mockup's inline styles, since the mockup's palette is the app's own.

What the mockup changes, in order down the page:

1. **Header** `BARRACKS · <calendar date>` (the mockup shows the season index; use the same date string the top bar shows, e.g. `SPRING, 277 BC`).
2. **Summary strip**, three cells: `LEVY  121 of 323 under arms`, `COME OF AGE  +10 each year`, `DAILY UPKEEP  200 grain · 114 oil · 7 wine · 7 chicken · 4 herbs · 130 dr`.
3. **Two columns** on desktop, one on phones:
   - Left, **AT HOME** with a men count, split into `LEVY · n men` (trained rows) and `MERCENARIES · n men` (bands). Each row: icon, `Name · count` (or `26 of 30`), the upkeep line, the service line, `DISBAND`.
   - Right, **AWAY · RETURNING** with a men count: each row `Name · count`, time left, a mission line (`Raiding Salyes`, `Scouting Salyes`, `Marching on Salyes`, `Returning from Salyes`), a progress bar, and a kind tag (`RAID`, `SCOUT`, `ATTACK`, `MOVE`). Then **IN TRAINING** with a men count: `Name · count`, time left, a progress bar, `CANCEL`.
4. **TRAINING GROUND**: one card per unit: icon, name, role tag; six stat chips `ATK DEF MSL MOR SPD SPC`; a `GEAR | UPKEEP | TRAINS` line; a quantity stepper (`−`, number input, `+`) and `RECRUIT n`.
5. **MERCENARY MARKET**: header `Three bands in the city · 2 of 2 under contract`; one card per offer: icon, name, `20 MEN · LINE`, stat chips, `UPKEEP | CONTRACT`, then `● HIRED`, or `HIRE`, or the cap caption `Two bands is all the city will feed.`
6. The lock banner from prompt 2 stays above everything when the gate is not met.

## Phase 1: server

### 1a. Mission on moving rows

Migration `packages/db/migrations/0056_unit_mission.sql`, idempotent, one transaction, 0049-style header:

```sql
ALTER TABLE player_units ADD COLUMN IF NOT EXISTS mission jsonb;
```

Mirror in Drizzle typed as `{ kind: "scout" | "raid" | "attack" | "move"; regionId: string; departedAt: string } | null`. `act` sets it on every participating row when it sets `moving_to`/`arrives_at`; the arrival step in `settleBarracks` clears it. Rows already moving in production have no mission and render as `Returning` with no region.

### 1b. Cancel training

`POST /api/barracks/cancel` `{ rowId }`: the row belongs to the player, is trained, and `ready_at` is still in the future, else 409. Under the lock after `settleAll`: return `count` men to the levy, return the gear (`gear × count` per good, relative and guarded, same rows `recruitUnits` debits), delete the row, `effect_log` `barracks_cancel`. Returns the full barracks view like the other POSTs. Test: men and gear come back exactly; a ready row is refused.

### 1c. View additions

`GET /api/barracks`:
- `summary: { underArms, levyMen, growthPerYear, seasonsPerYear }` where `underArms` is the sum of trained rows' counts (all states) and the strip renders `underArms of (underArms + levyMen)`.
- roster rows gain `plural` (from content; band rows carry their label) and `mission`.
- `now` is already there; the client computes progress as `(now − departedAt) / (arrivesAt − departedAt)` for away rows and `(now − createdAt) / (readyAt − createdAt)` for training rows, so rows also gain `createdAt`.
- Remove the client-side plural table once `plural` arrives.

Gates: `pnpm -r lint`, server tsc, server, db and shared tests.

Commits: `barracks: unit mission and cancel`, `barracks: view summary, plural, createdAt`.

**STOP 1.** Report and wait.

## Phase 2: client

Rebuild `apps/web/src/dashboard/panels/BarracksPanel.tsx` to the mockup. Rules:

- Existing behaviour is preserved: fetch on mount and after actions, no polling; every countdown on the server clock offset; a countdown reaching zero refetches once; inline errors under the row that failed; the disband confirm idiom; the lock banner; `onRefresh` after actions.
- The quantity stepper replaces the count input: `−` and `+` bound to 1 and the levy, typing allowed, `RECRUIT n` shows the number.
- Progress bars are pure CSS on a percentage; no animation library.
- Phone widths: the two columns stack, At Home first; cards are full width; stat chips wrap.
- New CSS goes in `dashboard.css` under the existing `/* Barracks */` block; extend, do not fork the panel's styles into a new file.
- Render tests are mandatory for this change (see `principles`: web changes ship only with a render test). `apps/web/test/barracks-panel.test.tsx` mounts the panel with a payload covering: locked; unlocked with home rows of both kinds, an away row with a mission, an away row without one, a training row, offers with hired, open and capped states; and re-renders after a mock cancel and a mock recruit. Assert the section counts, the mission lines, the stepper bounds and that no hook count changes between renders.
- Use the summary strip's upkeep line from the `upkeep.perDay` payload the panel already reads; drop the old "Your men eat…" sentence.

Gates: `pnpm -r lint`, web tsc, web build, web tests, plus the server suite from Phase 1.

Commit: `barracks: panel redesign`.

**STOP 2.** Report with the render test output. Do not push.

## Scope fence

`packages/db` (migration and schema), `apps/server/src/services/barracks.ts`, `mapActions.ts` (mission write only), `routes/barracks.ts`, their tests; `apps/web/src/api.ts`, `dashboard/panels/BarracksPanel.tsx`, `dashboard/dashboard.css`, `dashboard/shared.tsx` (only to remove the plural table), and the new test. Nothing in the map beyond the mission write, no content changes.
