# Landing, prompt 1: the hero without the lion, and the page cut to hero, atlas and CTA

## What this builds

The front page (`apps/web/src/App.tsx`, the `landing-shell` return at 996) loses the hero lion and five sections: What You Do (pillars), Professions (roles), Government (offices), Assembly (parties) and Factions (houses). What stays: the nav with the brand mark and the auth buttons, the hero copy recomposed as one centred column, the Atlas section, the closing CTA and the footer. The profession, house and party detail pages stay at their URLs; nothing links to them from the front page any more.

Rulings (Argiris, 21 Sept 2026):

- No copy changes. Every sentence that stays keeps its words; the stat row keeps its three figures.
- The hero fills the first screen as before (`min-height: calc(100dvh - 74px)`), one column, everything centred: eyebrow, lead, title, subline, logline, the CTA with its note, the stat row. `.hero-copy` caps at 760px and centres; the logline caps at 640px inside it.
- The nav keeps the small lion mark, MASSALIA, and Login / Sign Up (Lobby / Continue playing for a returning session). The four section links go; brand left, actions right.
- Stylesheet rules that only the removed markup used are deleted, by the grep rule in Phase 2, never by guesswork. The detail pages share classes with the landing, so a class still used anywhere in `apps/web/src` keeps its rules.
- The atlas image is re-exported from the map master at 1532×970 so it is sharp at its 766px desktop width. Same file name, no code change.
- The dead `#world`, `#roles` and `#factions` anchors are simply gone; nothing redirects them.

## Phase 0: recon (no code)

At 77154a1, App.tsx is unchanged since c6b2f9e, so its line numbers hold; styles.css moved in the theme batch, so its rules are named by selector. Confirm, and STOP 0 with the mismatch if any is not as described:

- App.tsx: `nav-primary-links` block 1005 to 1010 (four anchors); `hero-art-focus` block 1053 to 1055 (`img.hero-lion`); pillars section 1059 to 1079; roles section 1081 to 1100; atlas section 1102 to 1111; government section 1113 to 1129; parties section 1131 to 1156; houses section 1158 to 1178; closing CTA 1180 to 1190; `const offices` at 111 to 116 read only by the government section; `const palaioi` / `const dynatoi` at 825 to 826 read only by the parties section; `landingStats` at 54; the stat row at 1047 to 1051 reads `professions.length` and `landingStats`.
- styles.css: rules for `.landing-nav`, `.nav-primary-links` (three rules), `.hero-content` (two-column grid, `minmax(0, 0.92fr) minmax(280px, 0.72fr)`), `.hero-copy` (`max-width: 720px`), `.hero-actions`, `.cta-note`, `.stat-row`, `.hero-art-focus`, `.hero-lion`, and the media-query overrides of `.landing-nav` and `.hero-content`. Also the rules for `.pillars-section`, `.pillar-grid`, `.pillar-card`, `.pillar-kicker`, `.roles-section`, `.tile-grid`, `.landing-tile`, `.profession-figure`, `.profession-copy`, `.profession-stat`, `.profession-prompt`, `.hard-mode-badge`, `.government-section` (with `Politics.jpg` as its background), `.office-grid`, `.office-card`, `.office-watermark`, `.parties-section`, `.party-duel`, `.party-card`, `.party-watermark`, `.party-copy`, `.party-script`, `.party-motto`, `.houses-section`, `.houses-heading`, `.alignment-legend`, `.house-tile-grid`, `.house-tile`. List which of these class names still occur in `apps/web/src` outside the blocks being removed (the detail pages use some of them).
- `/Users/macbook/Desktop/MoMass/MAP01 - MASTER.png` exists at 1940×1228 and has the same aspect as the current `MAP01.jpg` (425×269).
- `apps/web/test` has no landing test. `App` renders the landing synchronously at `/` when `hasSessionHint()` is false (App.tsx 840 to 862), so a render test needs no API mock.

## Phase 1: the cut and the hero (one commit)

1. Save this prompt verbatim as `docs/landing/landing-prompt-1.md`.
2. App.tsx: delete the `nav-primary-links` block, the `hero-art-focus` block, and the pillars, roles, government, parties and houses sections. Delete `offices`, `palaioi` and `dynatoi` and any import the deletion leaves unused; `lint` decides. `parties`, `nobleHouses`, `professions`, `Crest` and `DetailLink` stay wherever the detail pages or the stat row still read them.
3. styles.css, the hero only: `.hero-content` becomes one column (`grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center;`), keeping its `min-height` lines and padding; `.hero-copy` gets `max-width: 760px; margin: 0 auto;`; `.hero-logline` gets `max-width: 640px; margin-left: auto; margin-right: auto;`; `.hero-actions`, `.hero-eyebrow` and `.stat-row` centre their contents (`justify-content: center` where they are flex, `margin: 0 auto` where they are block); the 390px media override of `.hero-content` keeps the same one-column shape. `.landing-nav` keeps `justify-content: space-between` with two children. No other rule changes in this commit.
4. `apps/web/test/landing.test.tsx`: `window.history.replaceState({}, "", "/")`, render `<App />`, then assert the `h1` reads Massalia, the button "Start The Game" is present, the heading "Massalia and the Phocaean world" is present, and `queryByText` is null for "Three choices that shape your game", "Eight paths to power", "The seats of government", "Tradition, or reform?" and "Ten Noble Houses"; and `document.querySelector("img.hero-lion")` is null. Plain queries, no delays.
5. `pnpm --filter @massalia/web lint`, `build` and the web suite green.

Commit: `landing: hero without the lion; pillars, professions, government, assembly and houses sections removed`.

## Phase 2: dead stylesheet rules (one commit)

For every class named in the Phase 0 styles.css list plus `.hero-art-focus`, `.hero-lion` and `.nav-primary-links`: grep `apps/web/src` (TSX and TS) for the class name. A rule whose selector contains only classes with zero remaining uses is deleted, including its media-query copies; a rule that contains any class still in use stays untouched. Report the two lists. No rule outside those class names is touched, and no rule is rewritten, only deleted.

Verify: `pnpm --filter @massalia/web build` clean; `grep -c` for each deleted class name over styles.css is zero.

Commit: `landing: drop the stylesheet rules the removed sections used`.

## Phase 3: the atlas image (one commit)

`sips --resampleWidth 1532 "/Users/macbook/Desktop/MoMass/MAP01 - MASTER.png" --setProperty format jpeg --setProperty formatOptions 82 --out apps/web/public/assets/MAP01.jpg`. Confirm 1532×970, JPEG, and report the byte size (it should land under 400 KB; if it is over, formatOptions 75, same size). The master is not copied anywhere else. No code change: the `img` at App.tsx 1109 carries no width or height attributes.

Commit: `art: atlas image at 1532 wide from the map master`.

## Phase 4: gate, browser check, then STOP 1

1. Full gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD, ending `GATE GREEN`.
2. Browser check as before, captures at 1280px and 390px into the theme-shots folder, prefixed `landing-`: the whole front page top to bottom (hero, atlas, closing CTA, footer), the hero alone, the nav with a returning session (Lobby / Continue playing), the auth sheet opened from Sign Up, and the detail pages `/houses/kleitos` and `/professions/trader` to show they still render. Note any element of the removed sections still visible, any text that lost its centring on one width, any nav item out of place, and whether the atlas image is sharp at desktop width. Each is a ruling item, not a fix.

Then STOP 1 with the report.

## Scope fence

- Only `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/public/assets/MAP01.jpg`, `apps/web/test/landing.test.tsx` and the prompt copy. No content, no server, no worker, no db, no migration.
- No copy change, no new section, no new class, no new image beyond the atlas export. `index.html`, `og-image.jpg`, the detail pages and `data/league.ts` are not touched.
- Push only as the last paragraph says.

## Push

After GATE GREEN: fast-forward only, plain `git push`, the three commits. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing in them changed). Close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.

## Report template

```
Committed: <SHA> landing: hero without the lion; pillars, professions, government, assembly and houses sections removed
Committed: <SHA> landing: drop the stylesheet rules the removed sections used
Committed: <SHA> art: atlas image at 1532 wide from the map master
Gate: <last line>
Phase 0 mismatches: <none, or each>
Classes kept because the detail pages use them: <list>
Rules deleted: <count, and the class names>
Atlas image: <WxH, KB>
Captures: <path per surface, or the STOP>
Ruling for Argiris: <each item from the browser check, each departure from the prompt, with the reason>
Push: <remote HEAD, CI, Pages, Railway>
```

## STOP 0 ruling (21 Sept 2026)

STOP 0 ruling (Argiris, 21 Sept 2026). Save it verbatim at the end of docs/landing/landing-prompt-1.md in the Phase 1 commit, then proceed.

1. Nav placement: accepted. `.nav-actions { grid-column-end: -1; }` goes in the Phase 1 commit, and the `.landing-nav` grid rule itself is not touched.

2. Detail-page nav links: the block at App.tsx 640 to 644 is brought into the fence and removed, so the detail pages carry the same nav as the front page: the brand mark and the auth buttons. The brand lockup is the way back; confirm it navigates to `/` on the detail pages as it does on the front page, and STOP if it does not. With that block gone `.nav-primary-links` has no remaining use, so all six of its rules go in Phase 2 under the grep rule. The landing test gains one line: `document.querySelector(".nav-primary-links")` is null.

3. The 820px overrides of `.hero-content`, `.hero-actions` and `.closing-cta` stay untouched, as the agent reads them. No rule for `.pillars-section` exists, so nothing to delete there. `Politics.jpg` leaving the front page is expected; it stays on the chamber card.
