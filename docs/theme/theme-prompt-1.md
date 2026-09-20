# Theme, prompt 1: terracotta accent, cream text, flat buttons, square corners

## What this builds

A restyle of the web client, stylesheets and a few inline styles only. The gold accent becomes terracotta, gold headings and text become cream, buttons lose their gradients for a flat fill, and every corner goes square except portraits, crests, dots and the coin. Layout, type, spacing, icons and images do not change. No server, worker, db or content change.

Rulings (Argiris, 20 Sept 2026):

- The accent is `#b8612f` (terracotta) with `#d6873f` for hover and for small accent text. The old accent is `#b58a45` (`--gold`), not the `#c9a54a` the design note guessed; about 200 of its uses are `rgba(181, 138, 69, α)`, so the change is a literal table applied by sed, not a hex find-and-replace.
- Terracotta is never body-sized text: `#b8612f` on the new card colour is 4.26:1. Headings go cream `#ecdcbd`; kickers, labels, links and active tabs that were gold go `#d6873f` (6.6:1); a filled button reads `#0d0a09` on `#b8612f` (4.5:1).
- The danger family moves off terracotta's hue. `#bb6a52` / `#d49a86` sit at hue 14° and would read as the accent after the swap. Danger becomes wine: `#b8434f` for fills and borders, `#d9909a` for text, and danger buttons become outlined, not filled.
- Golds that mean gold stay: the Olympic champion card and badge, and the PALAIOI seat dots. Party colours stay (PALAIOI bronze, DYNATOI blue). The green status family (`#7ea36a` and friends) stays.
- Backgrounds and body text barely move (`#130d0a` → `#0d0a09`, `#1b1511` → `#17110e`, `#ece0cc` → `#ecdcbd`), so only the token lines change; the ~125 dark literals and the parchment literals (`#ece0cc`, `rgba(236, 224, 204, α)`) are left alone.
- Corners: every `border-radius` that is not `50%` becomes `0`, pills included. The two toggle knobs (`50%`) go square with their tracks. Everything else at `50%` stays round, and `.live-pulse`, an 8px dot written as `999px`, joins them at `50%`.
- Gradients go only from buttons and button-like active states. Page vignettes, banners, bars and card washes keep theirs (their gold stops move with the table).
- The old token names (`--gold`, `--gold-bright`, `--bronze`, `--bronze-deep`, `--gold-highlight`, the `--dash-*` and `--lobby-*` colour names) stay as aliases of the new tokens so no `var()` is renamed. The one exception is `--lobby-gold-gradient`, which is deleted with the gradients.

## The tokens

Added to `:root` in `apps/web/src/styles.css`, above the existing five gold lines, which then become the aliases shown:

```css
  /* Theme prompt 1 (Sept 2026): terracotta accent, cream text, square corners.
     The gold names below are aliases kept so nothing needs renaming. */
  --accent: #b8612f;
  --accent-bright: #d6873f;
  --accent-rgb: 184, 97, 47;
  --accent-bright-rgb: 214, 135, 63;
  --cream: #ecdcbd;
  --cream-rgb: 236, 220, 189;
  --muted: #c9b393;
  --muted-rgb: 201, 179, 147;
  --card: #17110e;
  --page: #0d0a09;
  --line: #3a2417;
  --on-accent: #0d0a09;
  --danger: #b8434f;
  --danger-text: #d9909a;
  --danger-rgb: 184, 67, 79;
  --gold: var(--accent);
  --gold-bright: var(--accent-bright);
  --bronze: var(--accent);
  --bronze-deep: var(--line);
  --gold-highlight: var(--cream);
```

Token lines elsewhere:

- `dashboard/dashboard.css` `.dashboard-shell` block: `--dash-ink: var(--page)`, `--dash-panel: var(--card)`, `--dash-stone: var(--muted)`, `--dash-parchment: var(--cream)`, `--dash-bad: var(--danger-text)`. `--dash-gold`, `--dash-gold-bright`, `--dash-bronze` already read the root names and stay as written. `--dash-line` is changed by the table (it becomes `rgba(var(--accent-rgb), 0.22)`, which on a card is `#3a2315`, the subtle line).
- `lobby/lobby.css` `.lobby-shell` block: `--lobby-bg: var(--page)`, `--lobby-text: var(--cream)`, `--lobby-heading: var(--cream)`, `--lobby-gold: var(--accent)`, `--lobby-gold-bright: var(--accent-bright)`, `--lobby-bronze: var(--accent)`, `--lobby-gold-highlight: var(--cream)`, `--lobby-on-gold: var(--on-accent)`. `--lobby-line` and `--lobby-divider` change by the table. The three radius tokens change in Phase 3, `--lobby-gold-gradient` in Phase 2.
- `styles.css` `body`: `color: var(--cream)`, `background: var(--page)`.
- `apps/web/index.html:13` `theme-color` → `#0d0a09`.

## The gold table

Applied to all five stylesheets (`styles.css`, `dashboard/dashboard.css`, `lobby/lobby.css`, `characterCreation.css`, `map/World2Map.css`), every occurrence, except the fenced lines below. The five files are all lowercase hex and every rgb triple is spelled with `, ` (comma space) except one `187,106,82` in the danger table, so plain sed applies. Triples inside `rgb(...)` and `rgba(...)` are replaced as triples so the alpha survives; a replacement `rgba(var(--accent-rgb), 0.22)` is valid CSS.

Accent (mid golds):

| old | new |
|---|---|
| `181, 138, 69` | `var(--accent-rgb)` |
| `#b58a45` | `var(--accent)` |
| `210, 165, 92` | `var(--accent-bright-rgb)` |
| `#d2a55c` | `var(--accent-bright)` |
| `#8c6428` | `var(--accent)` |
| `#d1ae63` | `var(--accent-bright)` |
| `#d9b45f` | `var(--accent-bright)` |
| `216, 178, 90` | `var(--accent-rgb)` |
| `#d8b25a` | `var(--accent-bright)` |
| `#e7c66a` | `var(--accent-bright)` |
| `231, 198, 106` | `var(--accent-bright-rgb)` |
| `#e0c574` | `var(--accent-bright)` |
| `#d9bd78` | `var(--cream)` |
| `241, 211, 132` | `var(--accent-bright-rgb)` |
| `236, 215, 160` | `var(--accent-bright-rgb)` |
| `255, 232, 166` | `var(--accent-bright-rgb)` |
| `255, 226, 149` | `var(--accent-bright-rgb)` |
| `255, 242, 202` | `var(--accent-bright-rgb)` |
| `246, 222, 155` | `var(--accent-bright-rgb)` |
| `255, 237, 178` | `var(--accent-bright-rgb)` |
| `255, 236, 165` | `var(--accent-bright-rgb)` |

Cream (light golds used as text):

| old | new |
|---|---|
| `#f1ddb1` | `var(--cream)` |
| `#f1e4cc` | `var(--cream)` |
| `#f2dfb6` | `var(--cream)` |
| `#e4d3b9` | `var(--cream)` |
| `#f6dfab` | `var(--cream)` |
| `#f7e1ad` | `var(--cream)` |
| `#f4e6c8` | `var(--cream)` |
| `232, 211, 162` | `var(--cream-rgb)` |
| `228, 214, 188` | `var(--cream-rgb)` |
| `244, 232, 208` | `var(--cream-rgb)` |
| `241, 221, 177` | `var(--cream-rgb)` |
| `#d8c39a` | `var(--muted)` |
| `#d8c7a2` | `var(--muted)` |
| `214, 198, 170` | `var(--muted-rgb)` |

Not in the table, on purpose: the dark browns (`#3a2c1c`, `rgb(60, 44, 18)`, `rgb(58, 42, 22)`, `rgb(58, 42, 16)`, `rgb(66, 50, 18)`, `rgb(46, 40, 22)`, `#3a2913`, `rgb(126, 82, 38)`, `#5a3f1d`), the parchment literals, and `rgb(255, 244, 199)`, which is only in the `.primary-cta::after` shine deleted in Phase 2.

Inline styles and constants in TSX, by hand:

- `map/World2Map.tsx:119` `SELECT_GOLD = "#d8b56a"` → `"#d6873f"`; `:120` `HOVER_WASH = "#c8ad73"` → `"#d6873f"` (it fills at opacity 0.16).
- `dashboard/panels/CourtPanel.tsx:204` `rgba(181, 138, 69, 0.18)` → `rgba(var(--accent-rgb), 0.18)`.

## The danger table

| old | new | where |
|---|---|---|
| `187, 106, 82` and `187,106,82` | `var(--danger-rgb)` | borders, tints, banners |
| `#bb6a52` | (token line, see above) | `--dash-bad` |
| `#d49a86` | `var(--danger-text)` | text |
| `#c98b6a` | `var(--danger-text)` | `.cs-stat-decay`, `.cs-stat.declining .cs-stat-v` |
| `rgb(201, 139, 106)` (the whole call) | `var(--danger-text)` | `.cs-deceased` |
| `190, 110, 90` | `var(--danger-rgb)` | `.cost-negative` border |
| `212, 154, 134` | `var(--danger-rgb)` | `.tier-step.tier-idle` border |
| `#e0a49a`, `#e0a18c`, `#e0a48e`, `#f0b8a4` | `var(--danger-text)` | text |
| `#c9765a` | `var(--danger)` | `.lobby-btn-danger:hover` border |
| `#8a3f2e` | `var(--danger)` | `.composure-fill.tone-low` stop |
| `#f4e2df`, `#9c3b34`, `#6f261f` | see the danger button rule | `.panel-btn.danger` |

Left alone: the crimson of `.affliction-banner` and `.succession-murder` (`rgb(120, 38, 31)`, `rgb(156, 59, 52)`, `#f0d7d2`, `#e7b6ac`; hue 4°, already distinct), the rose `#b06a72` of `.philia-bar span`, and the dark reddish backgrounds (`rgb(45, 29, 20)`, `rgb(72, 39, 21)`, `rgb(94, 52, 28)`, `rgb(60, 26, 18)`).

`dashboard/panels/DiplomacyView.tsx`: `stanceColor` `-1` → `"#cfa0a5"` (the `<= -2` branch already returns `var(--dash-bad)`); `stanceTint` `<= -2` → `"rgba(184, 67, 79, 0.16)"`, `-1` → `"rgba(184, 67, 79, 0.10)"`. The `0` and positive branches stay.

## Fence: lines that keep their literal

`dashboard/dashboard.css` at c6b2f9e (re-find by selector after Phase 1):

- 3420 `.champion-card`, 3421 `.champion-card .olympic-kicker`, 3426 `.olympic-victory`, 3429 `.olympic-badge.olympic-honor` (the Olympic gold)
- 3445 `.seat-dot.seat-palaioi`, 3450 `.seat-dot.seat-held.seat-palaioi`, 3458 `.legend-dot.seat-palaioi` (party colour)
- 2162 `.align-bar`, 2475 `.panel-banner.banner-cons`, 3180 `.party-pick.cons .party-banner` (Traditionalist bronze; not in either table anyway)
- `dashboard/sheets.tsx:228` and `:232` `#c08a5e` (Traditionalist readout)

Nothing else is fenced. `.treasury-balance`, `.regent-badge`, `.festival-kicker`, `.legend-yours`, `.w2map-held` and the rest follow the accent.

## Phase 0: recon (no code)

Confirm each reference. If any is not as described, STOP 0 with the mismatch before writing anything.

- `apps/web/src/styles.css`: `:root` at 51 to 58 with exactly `--font-display`, `--font-body`, `--gold #b58a45`, `--gold-bright #d2a55c`, `--bronze #8c6428`, `--bronze-deep #5a3f1d`, `--gold-highlight #d9bd78`; `body` at 69 to 73 (`color: #ece0cc`, `background: #130d0a`); `.live-pulse` at 423 (8px, `border-radius: 999px`); `.primary-cta` at 334, `.primary-cta::after` at 358, `.primary-cta:hover` at 368, `.auth-tab-toggle` at 1446 (`border-radius: 999px`), `.auth-tab-toggle button.active` at 1473, `@keyframes ctaShimmer` at 1947 with its one use at 365.
- `apps/web/src/dashboard/dashboard.css`: the `.dashboard-shell` token block at 1 to 15; `.dashboard-mobile-tabs button.active` at 351; `.dashboard-nav button.active::before` at 359; `.dashboard-primary-button` at 647, its `::after` at 654 and `:hover::after` at 666; `.sheet-btn` at 1902; `.toggle` at 2346 (`border-radius: 12px`), `.toggle.on` at 2359, `.toggle-knob` at 2367 (`border-radius: 50%`); `.set-act.danger` at 2313; `.panel-btn` at 2574, `.panel-btn.ghost` at 2588, `.panel-btn.danger` at 2595, `.panel-btn:not(:disabled):hover` at 3622; the silver block: the comment at 3679, `.panel-btn.silver` at 3682, its hover at 3687, `.silver.is-waiting:disabled` at 3671, `.silver.is-busy:disabled` at 3702; `.panel-btn.is-busy:disabled` at 3638, `.panel-btn.is-waiting:disabled` at 3657; `.composure-fill.tone-low` at 3281; `.philia-bar.estranged span` at 3347.
- `apps/web/src/lobby/lobby.css`: the `.lobby-shell` block at 5 to 22 with `--lobby-radius-panel: 8px`, `--lobby-radius-control: 4px`, `--lobby-radius-pill: 3px`, `--lobby-gold-gradient` at 21; `.lobby-nav-item-active` at 267; `.lobby-btn-primary` at 864 and its hover at 876; `.lobby-btn-danger` at 882 and its hover at 887; `.lobby-header-actions .lobby-nav-active:hover` at 911; `.lobby-toggle` at 918 (`border-radius: 12px`) and `.lobby-toggle-knob` at 940 (`50%`).
- `apps/web/src/characterCreation.css`: `.creation-stepper .active` carries a gold gradient; `.creation-stepper span` is `border-radius: 999px`.
- `apps/web/src/map/World2Map.css`: `.w2map-action` at 371 with `linear-gradient(135deg, var(--dash-gold-bright, #d2a55c), var(--dash-bronze, #8c6428))`; `.w2map-held` at 620.
- Counts across the five stylesheets: `181, 138, 69` 205 times; `236, 224, 204` 85; `210, 165, 92` 13; `187, 106, 82` 20 plus one `187,106,82`; `border-radius` 195 declarations of which 32 are `50%` and 16 are `999px`; no `border-top-left-radius` or other longhand; no uppercase hex.
- TSX: `map/World2Map.tsx:119` to `120`; `dashboard/panels/DiplomacyView.tsx` `stanceColor` at 30 to 36 and `stanceTint` at 39 to 45, inline `borderRadius` at 54 (`1`), 87 (`height / 2`), 292 (`0`), 306 (`20`); `dashboard/shared.tsx:799` `borderRadius: 6`; `dashboard/panels/StandingsPanel.tsx:33` `borderRadius: 6`; `dashboard/panels/CourtPanel.tsx:204` `borderRadius: 3` and the gold rgba border; `dashboard/sheets.tsx:228` and `:232` `#c08a5e`. No `rx=` on any SVG rect in `apps/web/src`.
- `apps/web/index.html:13` `<meta name="theme-color" content="#0b0706" />`.
- `apps/web/test` has 17 suites including `world2map-cards.test.tsx` and `world2map-hooks.test.tsx`.

Also list, in the report, every rule in the five stylesheets whose selector contains `button`, `btn`, `cta`, `.active` or `-active` and whose declarations contain `gradient`, that is not named in Phase 2. Those go in the report as a ruling item and are not changed.

## Phase 1: tokens and the palette (one commit)

1. Save this prompt verbatim as `docs/theme/theme-prompt-1.md`.
2. Add the token block to `styles.css` `:root` and turn the five gold lines into the aliases shown. Change the token lines in `dashboard.css` and `lobby.css` as listed, `body` in `styles.css`, and `index.html`.
3. Apply the gold table with sed to the five stylesheets, then restore the fenced lines to their literals (`git diff` on those lines must be empty).
4. The two TSX edits under "Inline styles and constants".
5. `apps/web/test/world2map-cards.test.tsx`: in the townless-region case at 110, after the tap that selects the region, add one plain assertion that a `path[stroke="#d6873f"]` is in the document (the selection outline), using `document.querySelector`, no role query, no delay.
6. Verify: `grep -n` for every old literal in the gold table over the five files finds only the fenced lines; `pnpm --filter @massalia/web lint` and `pnpm --filter @massalia/web build` clean; the web suite green.

Commit: `theme: terracotta accent and cream text on the palette tokens`.

## Phase 2: flat buttons (one commit)

The filled button recipe: `background: var(--accent); color: var(--on-accent); box-shadow: none;` and, where the rule had a border, `border: 1px solid var(--accent)` (keep `border: none` where it was none). Hover: where a hover rule sets a fill, it becomes `background: var(--accent-bright); border-color: var(--accent-bright);`; where hover is a `filter`, the filter stays; hover shadows go, so `.panel-btn:not(:disabled):hover` at 3622 loses its `box-shadow` and keeps its filter. Existing `transform` lines stay. Busy and waiting states keep their `filter` and `transform` and take the flat fill.

Apply it to:

- `styles.css`: `.primary-cta` (drop the gradient, the `rgba(255, 232, 166, …)` border and the whole `box-shadow`); delete `.primary-cta::after` and `@keyframes ctaShimmer`; `.primary-cta:hover` drops its `box-shadow` and takes the bright fill; `.auth-tab-toggle button.active` takes the flat fill and keeps its inset ring.
- `dashboard.css`: `.dashboard-primary-button` (flat fill, `border: 1px solid var(--accent)`, no inset shadow); delete `.dashboard-primary-button::after` and `:hover::after`; `.sheet-btn`, `.panel-btn`, `.panel-btn.is-busy:disabled`, `.panel-btn.is-waiting:disabled` (flat fill); `.toggle.on` (`background: var(--accent)`); `.dashboard-nav button.active::before` (`background: var(--accent)`); `.dashboard-mobile-tabs button.active` (`background: rgba(var(--accent-rgb), 0.16); border-color: var(--accent)`).
- Silver, the secondary and Sell-active fill: `.panel-btn.silver`, `.panel-btn.silver.is-waiting:disabled`, `.panel-btn.silver.is-busy:disabled` become `background: var(--cream); color: var(--on-accent);` with their other lines kept; the hover at 3687 stays a brightness filter; the comment at 3679 is rewritten to say the secondary fill is cream.
- `lobby.css`: `.lobby-btn-primary` (flat fill, `border-color: var(--accent)`, no `box-shadow`), its hover (bright fill, keep the filter), `.lobby-nav-item-active` (`background: var(--accent); border-color: var(--accent)`), `.lobby-header-actions .lobby-nav-active:hover` (`background: var(--accent)`); delete `--lobby-gold-gradient`.
- `characterCreation.css`: `.creation-stepper .active` takes the flat fill.
- `World2Map.css`: `.w2map-action` becomes `background: var(--dash-gold, var(--accent))` (the fallback keeps the dev `/map` route styled).

Verify: `grep -n gradient` over the five files lists no rule on a button, tab, stepper, toggle or nav-active selector. `pnpm --filter @massalia/web lint` clean.

Commit: `theme: buttons and active states take a flat fill`.

## Phase 3: square corners (one commit)

1. In the five stylesheets, every `border-radius` declaration whose value is not `50%` becomes `border-radius: 0;` (a sed on lines matching `border-radius:` and not `50%`; the `18px 18px 0 0` sheet tops included).
2. `.dashboard-shell .toggle-knob` and `.lobby-toggle-knob`: `50%` → `0`. `.live-pulse` in `styles.css`: `999px` → `50%`.
3. `lobby.css`: `--lobby-radius-panel: 0; --lobby-radius-control: 0; --lobby-radius-pill: 0;`.
4. Inline: `shared.tsx:799` `borderRadius: 6` → `0`; `StandingsPanel.tsx:33` `6` → `0`; `CourtPanel.tsx:204` `3` → `0`; `DiplomacyView.tsx:54` `1` → `0`, `:87` `height / 2` → `0`, `:306` `20` → `0`.
5. Verify: summed over the five files, `grep -c 'border-radius: 50%'` is 31 (32 less the two knobs plus the pulse) and `grep -E 'border-radius:' | grep -v -E ': *(0|50%);'` is empty; `grep -rn borderRadius apps/web/src` shows only `0`.

Commit: `theme: square corners everywhere but portraits, crests and dots`.

## Phase 4: the danger family (one commit)

1. Apply the danger table with sed (both spellings of the triple).
2. Danger buttons become outlined: `.panel-btn.danger` → `color: var(--danger-text); background: transparent; border: 1px solid var(--danger);` and a new `.panel-btn.danger:not(:disabled):hover { background: rgba(var(--danger-rgb), 0.16); }` beside it; `.panel-btn.danger:disabled` unchanged. `.lobby-btn-danger` → `color: var(--danger-text); border-color: var(--danger);` and its hover `color: var(--danger-text); border-color: var(--danger); background: rgba(var(--danger-rgb), 0.16);`. `.set-act.danger` follows the table (`color: var(--danger-text); border-color: rgba(var(--danger-rgb), 0.5)`).
3. Fills that read `var(--dash-bad)` as a background take `var(--danger)` instead, since `--dash-bad` is now the text wine: `.vital-badge` (228 at c6b2f9e), `.dashboard-mobile-tabs .nav-badge` (1578) and `.nav-badge.dot` (1586), `.cs-tab-badge` (1821), `.philia-bar.estranged span` (3347), and the second stop of `.composure-fill.tone-low` (3281). The text uses of `var(--dash-bad)` (`.choice-hint.hint-negative`, `.choice-costs .cost-negative`, `.trend-down`) and `DiplomacyView.tsx` 31 and 123 stay on `var(--dash-bad)`.
4. `DiplomacyView.tsx` `stanceColor` and `stanceTint` as written in the danger table section.
5. Verify: `grep -n` for `#d49a86`, `187, 106, 82`, `187,106,82`, `#c98b6a`, `#e0a49a`, `#e0a18c`, `#e0a48e`, `#f0b8a4`, `#c9765a`, `#8a3f2e`, `#9c3b34`, `#6f261f`, `#f4e2df` over the five files and `apps/web/src` returns nothing.

Commit: `theme: danger goes wine so it stays apart from the terracotta accent`.

## Phase 5: gate, dist check, browser check, then STOP 1

1. Build, then over `apps/web/dist/assets/*.css`: every gold-table and danger-table old literal is absent except the fenced values (`#e7c66a`, `216,178,90`, `#a8783a`, `#c08a5e`, `192,138,94`, as the minifier spells them); no `border-radius` value other than `0` and `50%`; and the minified rules for `.primary-cta`, `.panel-btn`, `.sheet-btn`, `.lobby-btn-primary` and `.w2map-action` contain no `gradient(`. Report the counts.
2. Full gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN`.
3. Browser check, as the buildings batch did it (dev server, logged in, a character with buildings, ships and men): screenshots at desktop and at 390px of the landing page, the auth sheet, character creation (the stepper), the Lobby (worlds list with an ended world, the account panel), and the Dashboard on Court, Ledger (a building row with the build bar), Market (Goods with a Sell button active, the Player market picker open), Politics (the chamber with PALAIOI and DYNATOI dots, the party alignment bar), Family (a philia bar), Barracks (a training row, a danger button), and the Atlas with a region selected and the force picker open. In each, note any element still showing the old gold (`#b58a45` or its tints), any rounded corner that is not a portrait, crest, dot or the coin, any gradient on a button, and any text that has become hard to read. Each such element is a ruling item, not a fix. A screenshot that cannot be taken is a STOP item, not a skipped step.

Then STOP 1 with the report.

## Scope fence

- Only `apps/web/src/**/*.css`, the five TSX files named (`World2Map.tsx`, `DiplomacyView.tsx`, `CourtPanel.tsx`, `shared.tsx`, `StandingsPanel.tsx`), `apps/web/index.html`, `apps/web/test/world2map-cards.test.tsx`, and the prompt copy. `sheets.tsx` is not touched. No other package. No content, no server, no worker, no db, no migration.
- No image, icon, SVG asset, font, layout, spacing or type change. No selector renamed, no rule deleted except the five named (the two `::after` shines, the `:hover::after`, the keyframes, `--lobby-gold-gradient`), no new class beyond the one danger hover rule.
- No colour outside the two tables and the token block. A gold-looking literal the tables miss is reported, not mapped.
- The parchment literals, the dark browns and the greens are not touched.
- Commits stay local. No push under this prompt.

## Report template

```
Committed: <SHA> theme: terracotta accent and cream text on the palette tokens
Committed: <SHA> theme: buttons and active states take a flat fill
Committed: <SHA> theme: square corners everywhere but portraits, crests and dots
Committed: <SHA> theme: danger goes wine so it stays apart from the terracotta accent
Gate: <last line>
Phase 0 mismatches: <none, or each>
Gradient buttons not named in Phase 2: <none, or selector and file>
Old literals left in dist beyond the fence: <none, or each>
Radius values in dist other than 0 and 50%: <none, or each>
Screenshots: <path per surface, or the STOP>
Ruling for Argiris: <each element noted in the browser check, each departure from the prompt, with the reason>
```

## STOP 0 ruling (20 Sept 2026)

STOP 0 ruling (Argiris, 20 Sept 2026). Save it verbatim at the end of the prompt copy in the Phase 1 commit, then proceed to Phase 1.

1. `.lobby-toggle.on` (lobby.css:931) takes `background: var(--accent)`, as `.toggle.on` does in dashboard.css. It joins the Phase 2 list.

2. The shared rule at dashboard.css:350 to 356 is changed as one rule for both navs: the gradient wash becomes `background: rgba(var(--accent-rgb), 0.16); border-color: var(--accent);` and its `color` goes cream through the table. No split, no new rule. The lobby rule at 909 to 916 is read the same way: all three selectors, `.lobby-nav-active`, `.lobby-header-actions .lobby-nav-active` and its `:hover`, take `background: var(--accent)`.

3. The table applies to `.align-bar`. Its midpoint becomes `rgba(var(--accent-rgb), 0.25)`; the `#c08a5e` stop is in no table and stays, with `var(--dash-ref)` at the other end. The fence entry for line 2162 is withdrawn and the Phase 5 dist allowance is unchanged. `.closing-cta` is a section, not a button, and stays as it is.

## STOP 1 ruling (20 Sept 2026)

STOP 1 ruling (Argiris, 20 Sept 2026). Save it verbatim at the end of docs/theme/theme-prompt-1.md in the first of the two commits below, then proceed.

Item 3, accent text goes bright (commit 5, `theme: accent text goes bright`). Terracotta is a fill and border colour, never a text colour. In the five stylesheets, every declaration of the property `color` (the property itself, not `border-color`, `background-color` or `accent-color`) whose value reads `--gold`, `--dash-gold`, `--lobby-gold`, `--bronze`, `--dash-bronze`, `--lobby-bronze` or `--accent` moves to the bright name of its family: `--gold` → `--gold-bright`, `--dash-gold` → `--dash-gold-bright`, `--lobby-gold` → `--lobby-gold-bright`, the three bronzes and `--accent` → `--accent-bright`. A fallback inside the `var()` moves with it, so `var(--dash-gold, var(--accent))` becomes `var(--dash-gold-bright, var(--accent-bright))`. Counted at c6b2f9e that is 34 declarations: 7 in styles.css, 17 in dashboard.css, 4 in lobby.css, 3 in characterCreation.css, 3 in World2Map.css, four of them mid-line in one-line rules. Three inline styles move the same way, to `"var(--dash-gold-bright)"`: `dashboard/panels/CitiesView.tsx:75`, `DiplomacyView.tsx:133`, `StandingsPanel.tsx:75`; CitiesView.tsx is added to the fence for that one line. `fill` and `stroke` do not move. Verify: the grep for a `color` declaration on any of those seven names over the five files and `apps/web/src` returns nothing.

Items 1, 2, 6, 9, 10 and 11 (commit 6, `theme: STOP 1 fixes`):
1. `.nav-signup` (styles.css:242) takes the Phase 2 recipe: `background: var(--accent); color: var(--on-accent); border-color: var(--accent);` and its hover rule, if one exists, the bright fill.
2. `.cs-deceased` becomes `color: var(--danger-text)`, no alpha.
6. `.composure-fill.tone-low` reads `linear-gradient(90deg, var(--danger), var(--dash-bad))`, dark to light like its two siblings.
9. `.auth-tab-toggle button.active` loses its whole `box-shadow`, the blue inset ring and the drop shadow. The flat fill alone marks the active tab.
10. `.lobby-btn-danger` takes `background: transparent`; its hover keeps the wine tint.
11. The comment at dashboard.css:3679 to 3681 is rewritten in one place to say: the secondary Sell buttons are a flat cream fill with dark text; the is-busy and is-waiting companions live with the in-flight rules above.

Accepted as they stand, no change: item 4, everything at 50% stays round, as Phase 3 says; item 5, pre-existing; item 7, the phone override at 1560 stays; item 8, the stepper bar takes only the fill; item 12, the Messapi polity colour is map data and stays.

Then: the gate at HEAD after commit 6, ending GATE GREEN; the computed-style scan again on every surface, and it must report zero text in #b8612f and zero gradients on buttons, the Sign up button included; the captures retaken for landing, auth-sheet, lobby-worlds, court, ledger, barracks, atlas-force-picker and character-sheet-alignment at both widths.

Push. Fast-forward only, plain `git push`, the six commits ca3df1c to the new HEAD. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (they rebuild on any push; nothing in them changed, no migration). Then the close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD, and a short handoff with the six `Committed:` lines, the gate line and the two scan counts.

## STOP 2 ruling (20 Sept 2026)

STOP 2 ruling (Argiris, 20 Sept 2026). Save it verbatim at the end of docs/theme/theme-prompt-1.md in the commit below, then proceed.

Commit 7, `theme: STOP 2 fixes`:
1. `.barracks-sep` (dashboard.css:4098 at c6b2f9e) becomes `color: var(--dash-stone-dim)`. It is the only `color` declaration in the five stylesheets that reads a line token.
2. `a.lobby-nav-item` (lobby.css:245) flattens to `background: var(--lobby-panel)`. The nav items are button-like, so the sheen goes with the other gradients.
3. `.placeholder-note, .back-link` (styles.css:1269) becomes `color: var(--accent-bright)`. It is the only `color` declaration in the five stylesheets on the accent triple; verify that grep returns nothing after the change.
4. The comment over `.panel-btn.silver:disabled` (the block above dashboard.css:3695) is rewritten too, so no comment in the file says a button keeps or stays a gradient. `grep -n gradient` over the five stylesheets should then match no comment about a button.

Then: the gate at HEAD after commit 7, ending GATE GREEN; the scan again on Barracks, the Lobby (worlds and account) and one faction placeholder page, at both widths, and it must report zero text in #b8612f and zero gradients on buttons and nav links; retakes of barracks and lobby-worlds at both widths into theme-shots.

Push, as ruled at STOP 1: fast-forward only, plain `git push`, the seven commits ca3df1c to the new HEAD. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing in them changed, no migration). Then the close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD, and a short handoff with the seven `Committed:` lines, the gate line and the two scan counts.
