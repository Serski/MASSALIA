# MASSALIA — Barracks, prompt 2 of 3: the tab (web client + icons)

Read `AGENTS.md` first. Work in the same local repo. Prompt 1 is merged on `main`; pull before starting. Commit locally only. Do not push.

## What this prompt builds

The Barracks tab in `apps/web`, reading and writing `/api/barracks` from prompt 1, and the unit and band icons. Nothing on the server changes. Deployment and reach (spec section 9) is prompt 3.

Spec: `docs/barracks/barracks-spec-v1.md`, section 1. API shape: the `GET /api/barracks` payload in `docs/barracks/barracks-prompt-1.md`, Phase 4, as implemented in `apps/server/src/routes/barracks.ts`. Read the route file, not the prompt, for the exact field names.

## Rulings this prompt assumes

1. The tab fetches on mount and after each of its own actions, using the POST response payload directly. No interval polling: every GET runs a full settle under the player lock.
2. Icons are binary `.webp` under `apps/web/public/assets/`. The leak guard (`apps/web/test/public-leak-guard.test.ts`) scans text files only, so images are safe. No JSON, JS or other text file describing units or bands may be added under `apps/web/public`.
3. The catalogue and roster render behind the lock. A player below militia 20 sees what the barracks offers and cannot act.
4. No browser storage of any kind. State lives in React state and the server.

## Phase 1: icons

The artwork is in the folder `~/Desktop/Mass unit` on this machine. Do this first and stop.

1. List the folder. For each file, propose which `icon` value in `content/military/units.json` (4) and `content/military/bands.json` (20) it matches, by filename. Present the mapping as a table: source filename → target filename → unit or band label.
2. Where a match is obvious, copy the file to `apps/web/public/assets/<target>` (exact target name from the content file; Linux is case-sensitive). Do not modify the images.
3. Where a match is ambiguous or no file exists for a unit or band, leave it out and say so.
4. Do not commit yet.

**STOP 1.** Report the table and the list of units or bands with no icon. Wait for the mapping to be confirmed or corrected before Phase 2.

## Phase 2: API client, navigation, panel

### 2a. API client, `apps/web/src/api.ts`

Add types `BarracksView`, `BarracksUnit`, `BarracksRosterRow`, `BarracksOffer` matching the server response exactly, and:

- `api.barracks()` → `GET /api/barracks`
- `api.barracksRecruit(unitId, count)` → `POST /api/barracks/recruit`
- `api.barracksHire(bandId)` → `POST /api/barracks/hire`
- `api.barracksDisband(rowId)` → `POST /api/barracks/disband`

All three POSTs resolve to `BarracksView`. Errors surface through the existing `ApiError` path so the panel can show the server's one-line message.

### 2b. Navigation

- `apps/web/src/dashboard/shared.tsx:6-8`: add `"barracks"` to `DashboardSection` and `IconName`.
- `apps/web/src/dashboard/Dashboard.tsx`: insert `{ id: "barracks", label: "Barracks", icon: "barracks" }` into `dashboardNav` immediately before `politics`. Add `"barracks"` to the `mobileMoreNav` filter, before `"politics"`. `mobilePrimaryNav` is unchanged. Register `BarracksPanel` in `panelComponents`, lazy like the others.
- Icon: add a `case "barracks"` to the SVG switch in `shared.tsx` next to `politics`. A Corinthian helmet in profile, or two crossed spears behind a round shield, drawn in the same stroke style and 24-unit viewBox as the existing cases. No fill, no external asset.
- `apps/web/src/dashboard/guideContent.tsx`: add an entry before Politics: icon `barracks`, name `Barracks`, line: `Raise men from your levy or hire bands passing through the city. They eat every day whether they march or not.`

### 2c. Panel, `apps/web/src/dashboard/panels/BarracksPanel.tsx`

Build with the existing primitives from `shared.tsx` (`DashboardCard`, `PanelRow`, `PanelBanner`, `AssetIcon`, `assetIconUrl`) and the same CSS. Mirror the pops hire and dismiss UI (grep `PopGlyph` and `hirePops` in `sheets.tsx` and `MarketPanel.tsx`) for buttons, count inputs, confirmations and error display. New CSS goes in `dashboard.css` under one `/* Barracks */` block; keep it small.

Layout, top to bottom:

**Lock banner** (only when `gate.met` is false), a `PanelBanner`: `The barracks admit men of militia 20. You stand at {current}.` Every action button below is disabled while locked, with the same reason on hover or tap.

**Levy** card: `Your oikos can field {levy.men} men. Ten more come of age each year.` If the roster has trained rows, add `{n} under arms.`

**Training Ground** card: one row per unit from `units`, in catalogue order. Each row: icon (via `AssetIcon`, emoji fallback `🛡️`), label, role, then a compact line for the gear recipe using the existing good artwork (`GOOD_WEBP` or whatever the resource icon map in `shared.tsx` is called) with quantities, then `Upkeep {grain} grain, {oliveoil} oil a day`, then the stats as one line `Atk 7 · Def 8 · Msl 0 · Mor 7 · Spd 3 · Space 1`, then `Trains in {trainSeasons} season(s)`. A count input (default 1, min 1) and a `Recruit` button. On error, show the server message inline under the row (levy short, materials short with the shortfall list, gate).

**Mercenary Market** card: header `Three bands are in the city this season. {activeBands} of {config.maxActiveBands} under contract.` One row per offer: icon (fallback `⚔️`), label, `{men} men`, role, `Upkeep {drachmae} dr, {wine} wine, {chicken} chicken, {herbal} herbs a day` (add `{grain} grain` when present), the stats line, `Contract {termSeasons} seasons`, and a `Hire` button. A hired offer renders with the button replaced by `Hired`. When `activeBands >= maxActiveBands`, buttons disable with `Two bands is all the city will feed.`

**Roster** card: one row per roster row, trained first then bands, each with icon, label, `{count} of {startCount}` (or just `{count}` when equal), a status: trained and not active → `Training, ready season {readyAtSeason}`; trained and active → `Ready`; band → `Contract ends season {contractEndSeason}`; and a `Disband` button enabled only when `canDisband`, disabled otherwise with `Two seasons' service first.` Disband asks for confirmation the same way pop dismissal does. Empty roster: `No men under arms.`

Behaviour:
- Fetch on mount. Show the panel's usual loading and error states.
- After any successful POST, replace the view with the response and call `onRefresh()` so the header stats and drachmae update.
- Season numbers in status lines are the server's `season` index; also show the delta where it helps (`ready in 2 seasons`).
- No optimistic updates. The server is authoritative.

### 2d. Gates

```
pnpm -r lint
pnpm --filter @massalia/web exec tsc -p tsconfig.json --noEmit
pnpm --filter @massalia/web build
pnpm --filter @massalia/web test
```

The leak guard must still pass (3/3).

Commits, one each: `barracks: unit and band icons`, `barracks: api client and nav`, `barracks: Barracks panel`.

**STOP 2.** Report and wait. Do not push.

## Scope fence

Do not modify:
- anything under `apps/server`, `packages/`, or `content/`
- `apps/web/src/map/**`, `apps/web/public/map2/**`
- existing panels other than the three-line nav and registry edits in `Dashboard.tsx` and the type, icon and `guideContent` additions listed above
- no new files under `apps/web/public` other than the `.webp` icons

## Final report template

```
COMMITS
<sha> <message>

FILES
created: …
modified: … (file:lines)

ICONS
copied: … (source → target)
missing: … (unit or band with no file)

GATES
lint: …
tsc: …
build: …
web tests: … (leak guard …)

DEVIATIONS FROM THIS PROMPT
…

OPEN QUESTIONS
…
```
