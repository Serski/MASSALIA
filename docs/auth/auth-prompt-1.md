Auth, prompt 1: the login card restyled to the pottery mockup
What this builds
The auth panel (the modal opened from the landing nav, and the same panel on `/login` and `/signup`) is restyled to the "Massalia UI Greek pottery redesign" mockup. The gold gradient frame with its rods, finials and corner bosses goes. What remains is a kiln-black card inside a one-pixel terracotta frame, a Greek-key band along the top and bottom edges, the Log In / Sign Up tabs and the close button inside the card, a big faint M behind the fields, square everything. Same markup order, same behaviour, same copy: only the frame, the placement of the tabs and close button, the field glyphs and the stylesheet change.
Two commits, each its own concern:

1. `web: auth panel markup for the pottery card`. `App.tsx` loses the frame ornaments and the field glyphs, the tab toggle moves inside the card, `AuthPanel` gets a named export, and a render test covers the panel in both modes. The prompt copy rides in this commit.
2. `web: auth card styled to the mockup`. The auth block of `styles.css` is replaced by the block given verbatim below, and the two media-query overrides likewise.

The mockup's numbers are already the theme's tokens: card `#17110e` (`--card`), field fill `#0d0a09` (`--page`), field and message borders `#3a2417` (`--line`), fills and the frame `#b8612f` (`--accent`), eyebrow and links `#d6873f` (`--accent-bright`), heading `--cream`, subtitle and tabs `--muted`. Two literals appear that have no token: placeholder and legal-link text in `#8a7458`. Fonts stay the site's Cinzel and Spectral; the mockup's Cormorant is not added.
If `docs/auth/design/Massalia_Login.pdf` is in the tree it is for the eye and rides in commit 1; the numbers in this prompt rule either way.
Commit 1: the markup
All in `apps/web/src/App.tsx`, inside `AuthPanel` (line 125 at db0b5ad; find by name).

* `function AuthPanel(` becomes `export function AuthPanel(`. Nothing else about its props or state changes.
* The two `div.auth-rod` and the four `span.auth-finial` at the top of the returned `.auth-scroll-frame` are deleted.
* The `div.auth-tab-toggle` (`role="tablist"`) moves from before `div.auth-meander-top` to be the first child of `div.auth-card`, unchanged inside.
* The four `div.auth-corner` inside `.auth-card` are deleted.
* The three field glyphs, `<i aria-hidden="true">✉</i>` twice and `<i aria-hidden="true">▣</i>` once, are deleted. The labels, inputs and the visually hidden `<span>` labels stay.
* The close button stays where it is in the tree (inside `.auth-card`, after the tab toggle), same label, same `×`.

The returned tree is then, in order: `.auth-scroll-frame` > `.auth-meander.auth-meander-top`, `.auth-card` ( `.auth-tab-toggle`, `.auth-close` when `onClose` is set, `.auth-card-inner` ), `.auth-meander.auth-meander-bottom`. The `onKeyDown` focus trap and the `ref` stay on `.auth-scroll-frame`; the first focusable element is now the Log In tab, which is fine.
The render test, `apps/web/test/auth-panel.test.tsx`, follows `landing.test.tsx` (jsdom pragma, `cleanup` after each, plain DOM selectors, no API mock: the panel calls nothing on mount). It mounts `AuthPanel` directly, once per mode, with `onModeChange`, `onClose` and `isModal` set:

* login mode: no `.auth-rod`, `.auth-finial` or `.auth-corner` anywhere; exactly two `.auth-meander`; `.auth-card .auth-tab-toggle` exists and its first button carries `active`; `h1#auth-title` reads `Enter the League`; an `input[type="email"]` and an `input[type="password"]`; no `.auth-form i`; the submit button reads `Log in`; a `button.auth-forgot`; the `.auth-switch` button text starts with `Found your legacy`; `.auth-legal-links` has two anchors; `.auth-close` exists.
* signup mode: `h1#auth-title` reads `Join the League`; two checkboxes in `.auth-checks`; the submit reads `Sign up & play free` and is disabled; after `fireEvent.click` on the second checkbox it is enabled.

Keep it under a second: two mounts, no waits.
Commit 2: the stylesheet
`apps/web/src/styles.css`: the auth block, from the `.auth-page-shell` rule (879) through `.auth-legal-links a:hover` (ending before the `/* Soft email-verification banner` comment), is replaced by the block below in full. Rules for the deleted classes (`.auth-rod*`, `.auth-finial*`, `.auth-corner*`, `.auth-form > label > i`) do not come back.

```css
/* Auth card (auth prompt 1, Sept 2026): kiln-black card inside a one-pixel
   terracotta frame, a Greek-key band top and bottom, tabs and close button
   inside the card, square corners throughout. */
.auth-page-shell {
  display: grid;
  min-height: 100%;
  min-height: 100dvh;
  align-items: safe center;
  justify-items: center;
  padding: max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom));
  background:
    linear-gradient(rgba(9, 6, 5, 0.8), rgba(9, 6, 5, 0.88)),
    url("../assets/MASSALIA FRONT.jpg") center / cover no-repeat;
}

.auth-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  align-items: safe center; /* keep the top reachable if the form is taller than the screen */
  justify-items: center;
  padding: max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom));
  overflow: auto;
  overscroll-behavior: contain;
  background: rgba(9, 6, 5, 0.82);
  backdrop-filter: blur(16px);
}

.auth-modal-shell {
  width: min(100%, 520px);
}

.auth-scroll-frame {
  position: relative;
  width: min(100%, 520px);
  padding: 0;
  background: var(--card);
  border: 1px solid var(--accent);
  border-radius: 0;
  box-shadow: 0 34px 84px rgba(0, 0, 0, 0.52);
}

/* Greek key band: one 24x12 tile drawn in the card colour on the accent. */
.auth-meander {
  height: 12px;
  margin: 0;
  border: 0;
  background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='12' viewBox='0 0 24 12'%3E%3Cpath d='M0 1.5H24M0 10.5H24M3 1.5V8.5H19V4.5H8V6.5H15' fill='none' stroke='%2317110e' stroke-width='1.6'/%3E%3C/svg%3E") repeat-x;
}

.auth-card {
  position: relative;
  padding: 0;
  background: var(--card);
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.auth-tab-toggle {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: min(300px, calc(100% - 140px));
  margin: 28px auto 0;
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 0;
}

.auth-tab-toggle button {
  min-height: 44px;
  padding: 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  text-transform: uppercase;
  background: transparent;
  border: 0;
  border-radius: 0;
  cursor: pointer;
}

.auth-tab-toggle button.active {
  color: var(--on-accent);
  background: var(--accent);
}

.auth-close {
  position: absolute;
  top: 28px;
  right: 20px;
  z-index: 3;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--accent-bright);
  font: 400 20px/1 var(--font-body);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 0;
  cursor: pointer;
}

.auth-close:hover,
.auth-close:focus-visible {
  border-color: var(--accent-bright);
}

.auth-card-inner {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 30px 40px;
  overflow: hidden;
  text-align: center;
  background: none;
  border-radius: 0;
}

.auth-card-inner > * {
  position: relative;
  z-index: 1;
}

.auth-card-inner::before {
  position: absolute;
  top: 96px;
  right: 0;
  left: 0;
  z-index: 0;
  content: "M";
  color: rgba(var(--cream-rgb), 0.035);
  font-family: var(--font-display);
  font-size: 340px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  pointer-events: none;
}

.auth-brandline {
  margin: 0;
  color: var(--accent-bright);
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-indent: 0.32em;
  text-transform: uppercase;
}

.auth-card-inner h1 {
  margin: -2px 0 0;
  color: var(--cream);
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.auth-subtitle {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 17px;
  font-style: italic;
}

.auth-social-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.auth-social-row button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  color: var(--cream);
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: var(--page);
  border: 1px solid var(--line);
  border-radius: 0;
  cursor: pointer;
}

.auth-social-row span {
  color: var(--accent-bright);
  font-weight: 700;
}

.auth-divider {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 14px;
  align-items: center;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.auth-divider::before,
.auth-divider::after {
  height: 1px;
  content: "";
  background: var(--line);
}

.auth-form {
  display: grid;
  gap: 12px;
}

.auth-form label {
  position: relative;
  display: grid;
  text-align: left;
}

.auth-form > label > span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.auth-form input[type="email"],
.auth-form input[type="password"] {
  width: 100%;
  min-height: 56px;
  box-sizing: border-box;
  padding: 0 20px;
  color: var(--cream);
  font: 400 18px var(--font-body);
  background: var(--page);
  border: 1px solid var(--line);
  border-radius: 0;
  outline: 0;
}

.auth-form input::placeholder {
  color: #8a7458;
}

.auth-form input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.18);
}

.auth-checks {
  display: grid;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.4;
  text-align: left;
}

.auth-checks label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.auth-checks input {
  margin-top: 4px;
  accent-color: var(--accent);
}

.auth-checks a {
  color: var(--accent-bright);
}

.auth-message {
  margin: 0;
  padding: 10px 14px;
  color: var(--cream);
  font-size: 14px;
  text-align: left;
  background: rgba(var(--accent-rgb), 0.12);
  border: 1px solid var(--line);
  border-radius: 0;
}

.auth-message-success {
  color: var(--accent-bright);
}

.auth-submit {
  width: 100%;
  min-height: 56px;
  margin-top: 9px;
  padding: 0;
  color: var(--on-accent);
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  text-transform: uppercase;
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0;
  box-shadow: none;
  cursor: pointer;
  transition:
    background 180ms ease,
    border-color 180ms ease;
}

.auth-submit:hover,
.auth-submit:focus-visible {
  transform: none;
  filter: none;
  background: var(--accent-bright);
  border-color: var(--accent-bright);
}

.auth-submit:disabled {
  cursor: not-allowed;
  filter: none;
  opacity: 0.45;
}

button.auth-forgot {
  display: block;
  margin: 22px auto 0;
  padding: 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-indent: 0.24em;
  text-transform: uppercase;
  background: transparent;
  border: 0;
  cursor: pointer;
}

button.auth-forgot:hover,
button.auth-forgot:focus-visible {
  color: var(--cream);
}

.auth-forgot-lead {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.45;
}

.auth-switch {
  margin: 8px 0 0;
  color: var(--cream);
  font-size: 17px;
}

.auth-switch button {
  padding: 0;
  color: var(--accent-bright);
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.auth-switch button:hover,
.auth-switch button:focus-visible {
  color: var(--cream);
}

.auth-legal-links {
  margin: 18px 0 0;
  color: #8a7458;
  font-size: 14px;
  letter-spacing: 0.04em;
  text-align: center;
}

.auth-legal-links a {
  color: #8a7458;
  text-decoration: none;
}

.auth-legal-links a:hover {
  color: var(--accent-bright);
}

```

The `.auth-submit` keeps its `primary-cta` class in the markup; the rules above override the landing CTA's 68px height, its hover lift and its clamp so the card's button stays flat and 56px. Nothing in `.primary-cta` itself changes.
Media queries. In the `@media (max-width: 820px)` block, the four auth overrides (`.auth-modal-backdrop, .auth-page-shell`, `.auth-scroll-frame`, `.auth-social-row`, `.auth-tab-toggle`) are replaced by:

```css
  .auth-modal-backdrop,
  .auth-page-shell {
    padding: 14px;
  }

  .auth-tab-toggle {
    width: min(300px, calc(100% - 120px));
  }

```

In the `@media (max-width: 560px)` block, the auth overrides (`.auth-meander`, `.auth-card-inner`, the two inputs, `.auth-tab-toggle button`, the two finial rules) are replaced by:

```css
  .auth-card-inner {
    padding: 26px 20px 24px;
  }

  .auth-card-inner h1 {
    font-size: 27px;
  }

  .auth-card-inner::before {
    top: 84px;
    font-size: 280px;
  }

  .auth-tab-toggle {
    width: calc(100% - 96px);
    margin-left: 20px;
  }

  .auth-tab-toggle button {
    min-height: 42px;
    font-size: 13px;
    letter-spacing: 0.22em;
    text-indent: 0.22em;
  }

  .auth-close {
    top: 26px;
  }

  .auth-form input[type="email"],
  .auth-form input[type="password"] {
    min-height: 50px;
    font-size: 16px;
  }

  .auth-submit {
    min-height: 50px;
    font-size: 16px;
  }

  .auth-switch,
  .auth-switch button {
    font-size: 15px;
  }

```

Nothing else in either media block changes.
Phase 0: recon (no code)
Confirm, and STOP 0 with the mismatch if any is not as described:

* `App.tsx`: `function AuthPanel(` is not exported; its return holds two `auth-rod` divs, four `auth-finial` spans, the `auth-tab-toggle` before `auth-meander-top`, four `auth-corner` divs as the first children of `.auth-card`, and exactly three `<i aria-hidden="true">` glyphs inside `.auth-form` labels; `AuthModal` wraps the panel in `.auth-modal-backdrop > .auth-modal-shell`; `AuthRoutePage` renders it inside `main.landing-shell.auth-page-shell`.
* `styles.css`: the auth block runs from `.auth-page-shell` to `.auth-legal-links a:hover` with `.verify-banner` right after; `:root` defines `--cream-rgb`; the 820px block holds the four auth overrides named above and the 560px block the auth overrides named above; the `.primary-cta` rule has `min-height: 68px` and a hover `transform: translateY(-4px)`.
* No file under `apps/web/test` references an `auth-` class or `AuthPanel`.
* `git grep -n "auth-rod\|auth-finial\|auth-corner"` finds nothing outside `App.tsx` and `styles.css`.

Phases 1 and 2
One commit each, in the order above, the prompt saved verbatim as `docs/auth/auth-prompt-1.md` in commit 1 (with the mockup PDF beside it under `docs/auth/design/` if it is in the tree). After each: `pnpm --filter @massalia/web lint`, `pnpm --filter @massalia/web exec tsc --noEmit`, and the web suite green.
Phase 3: gate, browser check, scan, then STOP 1

1. Full gate at HEAD: `DATABASE_URL=…/massalia_test pnpm gate`, ending `GATE GREEN`. A red from a timeout in a suite the diff does not touch is a STOP item with the log, not a rerun.
2. Browser check on the dev server, logged out, captures at 1280px and 390px into the theme-shots folder prefixed `auth-`: the modal opened from the landing nav in login mode, in signup mode with both checks unticked and the submit disabled, the forgot sub-view, a login attempt with a wrong password (the `.auth-message`), and the `/login` route page. Note whether the heading sits on one line at both widths, whether the tabs and the close button share a row at 390px without touching, whether the signup submit's label fits its button at 390px, and whether the meander bands tile cleanly to the frame's edges. Ruling items, not fixes.
3. Computed-style scan of every element inside `.auth-scroll-frame`, as the theme prompt did it: report every element whose text colour is `#b8612f`, every `background-image` that is a gradient, and every non-zero `border-radius`. All three lists must be empty.

Then STOP 1 with the report. Push only when Argiris says so.
Scope fence

* Only `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/test/auth-panel.test.tsx`, the prompt copy and the mockup PDF. No `dashboard.css`, no lobby, no `legal.tsx`, no `index.html`, no server, no content, no migration.
* No copy change: every string the panel shows today is shown after, in the same place.
* No new class. No change to the `.primary-cta` rule, to `SOCIAL_LOGIN_ENABLED` or to the social row's markup.
* The background stays `MASSALIA FRONT.jpg`; a dedicated auth harbour, if one is generated, is a later one-file commit.
* Push only as the last paragraph says.

Push
After the STOP 1 ruling: fast-forward only, plain `git push`, the two commits. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing server-side changes; no migration). Close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.
Report template

```
Committed: <SHA> web: auth panel markup for the pottery card
Committed: <SHA> web: auth card styled to the mockup
Gate: GATE GREEN at <SHA>, <wall time>, suite counts <shared/server/db/web/worker>
Captures: <path per surface, or the STOP>
Scan: accent text <n>, gradients <n>, radii <n> (each must be 0)
Deviations: <none, or one line each>
Ruling items: <none, or one line each>

```

STOP 1 ruling (Argiris, 22 Sept 2026). Save it verbatim at the end of docs/auth/auth-prompt-1.md in commit 3, then proceed.
Commit 3, `web: auth frame polish after STOP 1`, three changes in `styles.css`:

* Item 1: `.auth-card`'s `padding: 0` becomes `padding: 28px 0 0`, and `.auth-tab-toggle`'s `margin: 28px auto 0` becomes `margin: 0 auto`. In the 560px block the `.auth-close { top: 26px; }` override is deleted; the base `top: 28px` holds at both widths, so the close button's top edge sits on the tab toggle's top edge. The 560px `.auth-tab-toggle { width: calc(100% - 96px); margin-left: 20px; }` override stays and still wins over the auto.
* Item 2: in `.auth-meander`, the `repeat-x` at the end of the `background` shorthand becomes `round`. The tile stretches under two percent at either width and the band ends on a whole key.
* Item 3: `.auth-scroll-frame` gains `box-sizing: border-box;`, so the frame is 520 wide inside the 520 shell and 362 inside 362.

Commit 4, `web: reset page loses its field glyphs`. The fence widens to `ResetPasswordPage` in `App.tsx`: its two `<i aria-hidden="true">▣</i>` are deleted, the same treatment the panel got in commit 1. Then `git grep -n '<i aria-hidden' apps/web/src/App.tsx` must find nothing; if it finds one inside any other `.auth-form` (the verify page, say), delete it in the same commit and name it in the report. No test for the reset page.
Item 5: noted, nothing to do. Stopping the dev servers and the throwaway Postgres early is accepted; bring them back for the gate.
Then: the gate at HEAD after commit 4, ending GATE GREEN, no rerun on a red; the scan again on the login modal and the reset page at both widths, all three counts still 0; retakes into theme-shots prefixed `auth-`: the login modal at 1280 and 390 (the close button on the tab row, the band ending on a whole key, the frame flush with the shell) and the reset page (`?reset=` with any token string, the form before submission) at 1280 and 390; and the push as the prompt says, four commits 2c5d328 to HEAD, fast-forward only, with the full push and close-out report: remote HEAD, the CI run and its Gate step, the Pages run, the Railway server and worker deploys, dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.
