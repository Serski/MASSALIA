# Landing, prompt 2: hero and atlas copy, polish after the art and landing batches, bcrypt at test cost

## What this builds

Three commits, each its own concern:

1. `landing: hero and atlas copy`. The hero eyebrow gains a word, the subline goes, the logline and the atlas heading and paragraph are replaced with new text. Copy is given verbatim below; nothing else in the copy changes.
2. `web: polish after the art and landing batches`. Five small style fixes the last two STOP 1 reports raised: the CTA note centred on phones, the stat labels centred, a centre-weighted hero overlay for the centred copy, a darker chamber-card overlay, and dimmed art on ended-world cards in the Lobby.
3. `server: bcrypt at cost 4 under NODE_ENV=test`. `session cap on login` has gone red on the first gate run in two batches running, at 30.6 s against a 30 s budget, because it does twelve bcrypt operations at cost 12 while the gate itself loads the machine. Tests hash at cost 4; nothing outside tests can lower the cost.

## The copy (commit 1), verbatim

All in `apps/web/src/App.tsx`, the landing `hero-copy` block and the `atlas-section`. Line numbers moved in the landing batch, so find by class name. Apostrophes follow the file's existing convention (`&apos;` in JSX text).

- `p.hero-eyebrow` text: `Free Browser Strategy Game` → `Free Browser Grand Strategy Game`. The `live-pulse` span before it stays.
- `p.hero-subline` (`Founded by Phocaean Greeks. Ruled by whoever dares.`): the element is removed.
- `p.hero-logline` text becomes:

  Rise in Massalia, the Greek jewel of the western sea. Choose your calling, join a Noble House, and take a side between the old guard and the reformers. Then trade, scheme and marry your way up, raise men and ships, and go to war on land and at sea, until the oligarchy is yours and your dynasty outlives you.

- `h2#atlas-title` becomes: `Massalia and the western sea`
- The paragraph after it (currently beginning `Massalia is the shared arena:`) becomes:

  Enter Massalia in the fourth century BC, while Carthage rules the sea and Rome rises in Italy. Climb the city's oligarchy, or raise men and ships and take what the chamber will not give: raid the coasts, march on your rivals, plant a colony and carve out a kingdom of your own. War is fought on land and at sea, with citizen hoplites and hired spears from Gaul to Numidia. Build a legacy and a family that outlast you.

- `styles.css`: the `.hero-subline` rule is deleted once nothing uses the class (confirm with a grep over `apps/web/src`).
- `apps/web/test/landing.test.tsx`: the atlas assertion changes to `Massalia and the western sea`; add that `Free Browser Grand Strategy Game` is present and `queryByText(/Founded by Phocaean Greeks/)` is null.

## The polish (commit 2)

- `styles.css`, inside the `@media (max-width: 820px)` block where `.hero-actions, .closing-cta` become a stretched column: add `.cta-note { align-self: center; }` so the note's box centres under the full-width CTA.
- `styles.css`, the `.stat-row dt` rule (a flex row): add `justify-content: center;`.
- `styles.css`, `.landing-hero` background: the first gradient, currently `linear-gradient(90deg, rgba(13, 8, 6, 0.9) 0%, rgba(18, 11, 8, 0.78) 42%, rgba(17, 10, 8, 0.18) 72%, rgba(12, 7, 6, 0.76) 100%)` (built for left-aligned copy, clear at 72% where the lion sat), becomes `linear-gradient(90deg, rgba(13, 8, 6, 0.55) 0%, rgba(18, 11, 8, 0.82) 30%, rgba(18, 11, 8, 0.82) 70%, rgba(13, 8, 6, 0.55) 100%)`. The vertical gradient and the image line stay as they are.
- `dashboard/dashboard.css`, `.dashboard-shell .chamber-card`: the overlay `linear-gradient(180deg, rgba(18, 12, 8, 0.84), rgba(12, 8, 6, 0.9))` becomes `linear-gradient(180deg, rgba(14, 9, 7, 0.9), rgba(10, 7, 5, 0.94))`. The border and everything else in the rule stay.
- Lobby ended-world art: in `lobby/LobbyPage.tsx` the ended cards' `<img className="lobby-cal-art" src={CALENDAR_ENDED} …>` gains a second class, `lobby-cal-art-ended`; the announced cards' image is untouched. `lobby/lobby.css` gains, right after `.lobby-cal-art`: `.lobby-cal-art-ended { filter: saturate(0.4) brightness(0.6); }`. Flat, square, no other change.

## The test cost (commit 3)

`apps/server/src/routes/auth.ts` hashes with `bcrypt.hash(password, 12)` in two places (register at 108, password reset at 218 at db0b5ad). Both read one module constant:

```ts
// bcrypt cost. Tests hash at 4 so a suite of logins stays inside its budget on a
// loaded machine; anything else runs at 12. No env var can lower it outside tests.
const BCRYPT_COST = process.env.NODE_ENV === "test" ? 4 : 12;
```

`bcrypt.compare` reads the cost from the hash, so logins against test hashes are fast too. No other hashing site changes; if a grep finds another `bcrypt.hash(` in `apps/server` or `packages`, report it and leave it. Confirm the server suite runs with `NODE_ENV` equal to `test` (vitest sets it when nothing else does; check `process.env.NODE_ENV` from inside `session-cap.test.ts` once, then remove the check).

## Phase 0: recon (no code)

Confirm, and STOP 0 with the mismatch if any is not as described:

- App.tsx: the eyebrow, subline, logline, atlas heading and atlas paragraph carry exactly the current texts quoted above; `hero-subline` occurs nowhere else in `apps/web/src`.
- `styles.css`: `.hero-subline` has one rule; `.landing-hero` background's first gradient is exactly the four-stop line quoted above; `.stat-row dt` is a flex row without `justify-content`; the 820px block holds `.hero-actions, .closing-cta { align-items: stretch; flex-direction: column; }` and no `.cta-note` rule.
- `dashboard.css`: `.chamber-card`'s overlay is exactly the two-stop line quoted above.
- `LobbyPage.tsx`: two `img.lobby-cal-art`, one with `CALENDAR_ANNOUNCED` (announced cards) and one with `CALENDAR_ENDED` (ended cards); `lobby.css` `.lobby-cal-art` has `filter: saturate(0.85)`.
- `auth.ts`: exactly two `bcrypt.hash(password, 12)` calls; `apps/server/vitest.config.ts` has `testTimeout: 30_000`.
- `landing.test.tsx` asserts the atlas heading `Massalia and the Phocaean world`.

## Phases 1 to 3

One commit each, in the order above, the prompt saved verbatim as `docs/landing/landing-prompt-2.md` in commit 1. After each: `pnpm --filter @massalia/web lint` and the web suite green (commits 1 and 2); `pnpm --filter @massalia/server lint` and the server suite green (commit 3).

## Phase 4: gate, browser check, then STOP 1

1. Full gate at HEAD: `DATABASE_URL=…/massalia_test pnpm gate`, ending `GATE GREEN`. Report the server suite's wall time and `session cap on login`'s own time. This run is meant to pass first time; if that test goes red again, it is a STOP item with the log, not a rerun.
2. Browser check as before, captures at 1280px and 390px into the theme-shots folder, prefixed `copy-`: the hero (eyebrow, no subline, the new logline, the overlay), the atlas section, the Lobby worlds list with an ended world, and the Politics chamber card. Note any line that wraps badly, any text that lost its centring, and whether the hero copy reads cleanly over the art at desktop width. Ruling items, not fixes.

Then STOP 1 with the report.

## Scope fence

- Only `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/dashboard/dashboard.css`, `apps/web/src/lobby/LobbyPage.tsx`, `apps/web/src/lobby/lobby.css`, `apps/web/test/landing.test.tsx`, `apps/server/src/routes/auth.ts` and the prompt copy. No content, no worker, no db, no migration, no `index.html`.
- No copy beyond the five items quoted. No new class beyond `lobby-cal-art-ended`. No other rule rewritten.
- Push only as the last paragraph says.

## Push

After GATE GREEN: fast-forward only, plain `git push`, the three commits. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (the server rebuilds with the one-constant change; no migration). Close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.

## Report template

```
Committed: <SHA> landing: hero and atlas copy
Committed: <SHA> web: polish after the art and landing batches
Committed: <SHA> server: bcrypt at cost 4 under NODE_ENV=test
Gate: <last line>, server suite <s>, session cap on login <s>
Phase 0 mismatches: <none, or each>
Other bcrypt.hash sites found: <none, or each, left alone>
Captures: <path per surface, or the STOP>
Ruling for Argiris: <each item from the browser check, each departure from the prompt, with the reason>
Push: <remote HEAD, CI, Pages, Railway>
```

## STOP ruling (21 Sept 2026)

STOP ruling (Argiris, 21 Sept 2026). Save it verbatim at the end of docs/landing/landing-prompt-2.md in commit 4, then proceed.

Commit 4, `test: db hooks and web tests get budgets that survive the gate's own load`. `packages/db/vitest.config.ts` gains `hookTimeout: 30_000` beside its `testTimeout`. The web package's vitest configuration (the `test` block of `apps/web/vite.config.ts`, or `vitest.config.ts` if one exists there) gains `testTimeout: 15_000` and `hookTimeout: 30_000`. No source change. That closes item 1 too: bcfb90b stands as it is, and every commit from here is gated on the exit code.

Commit 5, `landing: atlas copy column widened for the new paragraph`. In `.atlas-section`, `grid-template-columns: minmax(250px, 0.44fr) minmax(420px, 1.1fr)` becomes `minmax(300px, 0.66fr) minmax(420px, 1fr)`. Nothing else in the rule or in the 820px override changes. Report the copy and map widths at 1280px and the heading's line count; the heading should sit on two lines and the paragraph should end above the map's bottom edge. If it does not, report it as a ruling item and do not tune further.

Then the gate at HEAD once, ending GATE GREEN, with the same timings reported; the two atlas captures retaken at both widths; and the push as the prompt says, five commits db0b5ad to HEAD, with the full push and close-out report. If the gate goes red again, STOP with the log, no rerun.
