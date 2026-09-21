# MASSALIA mobile layout prompt 1
Save this file verbatim as `docs/mobile/mobile-prompt-1.md` in commit 1.
Base: remote HEAD d9931ef. Two commits, local only. No push in this prompt.

## Scope fence
May change: `apps/web/src/CharacterCreation.tsx`, `apps/web/src/characterCreation.css`,
`apps/web/src/dashboard/dashboard.css`, new `apps/web/test/creation-layout.test.tsx`, this docs file.
Must not change: `Dashboard.tsx`, `styles.css`, any copy, any colour, radius or gradient,
anything at 900px and up on creation or 481px and up on the dashboard, server, shared, db,
content, worker. No migration. The scroll-to-top effect at `CharacterCreation.tsx:371-373` stays.
Any deviation is reported as a ruling request, not decided.

## Phase 0: recon, write nothing
Confirm HEAD d9931ef, tree clean, and these lines:
- `characterCreation.css:72-77` `.creation-summary` carries `order: -1` (line 75)
- `characterCreation.css:582-587` the 900px block gives `.creation-summary` `order: 0` (line 585)
- `CharacterCreation.tsx:479-485` `<SummaryCard … />` sits before `<section className="creation-panel">` (486); the panel closes at 643, the layout at 644
- `dashboard.css:1223-1229` `.topbar-actions` has `flex-wrap: wrap` (1225) inside the `@media (max-width: 980px)` block opening at 1172; `.avatar-btn` at 1235-1238
If anything differs, STOP 0 and report. If all match, go on without stopping.

## Phase 1, commit 1: `creation: the step comes before the recap on a single column`
1. Move the `<SummaryCard … />` element, props unchanged, to directly after the panel's
   closing `</section>` and before the layout's closing `</section>`.
2. `characterCreation.css`: delete `order: -1;` from `.creation-summary` (line 75). In the
   900px block replace `order: 0;` with `grid-row: 1;`.
3. New `apps/web/test/creation-layout.test.tsx`: mock `../src/api.js` the way
   `creation-verify.test.tsx` does (`ageConfig`, `me`), render `CharacterCreation`, wait for
   `.creation-panel h1`, then assert: the h1 reads "Choose your calling";
   `panel.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING` is truthy;
   `.creation-summary` still renders with "Unnamed". Plain DOM selectors, no role queries,
   no wizard walk. It must fail before step 1 and pass after.
Expected in a browser at 393x734 on `/create`: heading top 606 before, 156 after; first
class card 728 before, 278 after; after Continue, scrollY 0 and heading top 156 on step 2.
At 1280x800 panel (top 133, left 64) and recap (top 133, left 876) unchanged.

## Phase 2, commit 2: `dashboard: purse, inventory and portrait share one row on phones`
`dashboard.css` only.
1. In the 980px block: `.topbar-actions` `flex-wrap: nowrap;` and add `flex: 0 0 auto;` to `.avatar-btn`.
2. Directly after the closing brace of that 980px block, add:

```css
@media (max-width: 480px) {
  /* Phones: the purse stacks its label under the number, as the Inventory chip
     stacks its two lines, so both chips and the portrait hold one row. */
  .dashboard-shell .topbar-vital{ padding: 7px 10px; }
  .dashboard-shell .topbar-vital:has(> .vital-v){
    display: inline-grid;
    grid-template-columns: auto auto;
    grid-template-areas: "ic v" "ic k";
    gap: 2px 9px;
    align-items: center;
  }
  .dashboard-shell .topbar-vital:has(> .vital-v) > .vital-ic{ grid-area: ic; }
  .dashboard-shell .topbar-vital:has(> .vital-v) > .vital-v{ grid-area: v; text-align: left; }
  .dashboard-shell .topbar-vital:has(> .vital-v) > .vital-meta{ grid-area: k; }
  .dashboard-shell .avatar-btn{ padding: 4px 0 4px 10px; }
}

@media (max-width: 340px) {
  .dashboard-shell .inventory-vital > .vital-ic{ display: none; }
}
```

The label stays in the DOM, so the button's accessible name is unchanged. `:has()` is
already in this stylesheet (accepted 18 Sept).
Verification is in a real browser: jsdom has no layout and vitest does not load the
stylesheet, so no render test can see this commit, and no component changes. Use the
running app logged in, or a throwaway page outside the repo holding the header markup
from `Dashboard.tsx:228` onward with `styles.css`, `dashboard.css` and the fonts. Nothing
of it is committed. At widths 320, 360, 375, 393, 430, 480, 481, 768, 980 and purses
743, 2,743 and 1,250,000 (edit `.vital-v` text for the large one) run:

```js
(() => { const k=[...document.querySelector('.topbar-actions').children].map(e=>e.getBoundingClientRect());
  const m=k.map(r=>r.top+r.height/2);
  return { oneRow: Math.max(...m)-Math.min(...m) <= 2, overflowX: document.documentElement.scrollWidth - innerWidth }; })()
```

Every cell must read `{ oneRow: true, overflowX: 0 }`. Reference child widths: before at
393 with 2,743 `[155.8, 130.1, 61]`, wrapped; after at 480 and under `[107.8, 126.1, 55]`;
at 320 `[107.8, 97.1, 55]`; at 481 and up identical to before.

## STOP 1: report, nothing pushed
Gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after commit 2, ending
`GATE GREEN: HEAD <sha>, tree clean`. A red from a timeout in a suite this diff does not
touch is a STOP with the log, never a rerun to pass.
Report:
- Committed: <SHA> creation
- Committed: <SHA> dashboard
- Gate line and suite counts
- The creation numbers at 393 and 1280, before and after
- The full width by purse table for the header
- Captures: creation step 1 and step 3 at 393, creation at 1280, header at 320, 393, 430, 768, 1280
- Any horizontal overflow you see elsewhere at these widths: report it, do not fix it
- Deviations, each as a ruling request
