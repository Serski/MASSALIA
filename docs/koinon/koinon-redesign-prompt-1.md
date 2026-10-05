# MASSALIA: Koinon page redesign, prompt 1

Read `AGENTS.md` first. Pull `main` (baseline `f697c4d`, or later). Commit locally only. Do not push. Web changes ship only with a render test.

## What this prompt does

The Koinon page (Politics → Koinon, member view) is a single column of eleven identical cards. This prompt lays it out as a hero strip over a two-column grid, after a design brief from Argiris's design agent (reproduced below). It is a layout change in the client only: no server, API, payload or game-rule change, and nothing a player can do today goes away.

Save this prompt as `docs/koinon/koinon-redesign-prompt-1.md` in the first commit. If `docs/koinon/design/Koinon Page.dc.html` exists, it is the look reference (option 1a): commit it with the prompt if it is untracked. If it does not exist, work from the brief. Where the brief or the mockup differ from the rulings below, the rulings win: the mockup is a look to adapt, not a spec to port.

## Facts from the repo (Phase 0 confirms; stop only on contradiction)

- Everything is in `apps/web/src/dashboard/panels/KoinonView.tsx` (846 lines at `f697c4d`).
  - `KoinonCard` (34) draws every card, with the meander band and the head row; `data-koinon={section}` marks each.
  - The non-member layout runs from about 540: Your invitations, Found a koinon, Koina of the city.
  - The member layout runs from about 600, in this order: header (615), The lead (624, only with `canTakeLead`), Board (634), Muster (674: `MusterOpen` when a muster is open, else the hint, `MusterForm` and `LastMuster`), Treasury (686), Lesche (731), Members (767), Invite (799, leader and vice), Soldiers of the koinon (830, leader only, `MemberSoldiers` per member), Koina of the city, Leave.
  - Helpers to keep: `MemberSoldiers` (64), `MemberRow` (133), `LastMuster` (166), `MusterForm` (196), `YourPledge` (280), `MusterOpen` (385), `KoinaOfTheCity` (116), `awayLine` (27).
- The leader's soldiers come from `api.koinonArmies()` (leader only; anyone else gets 403). It is the only source of men and levy figures on this page.
- Styles: the `koinon-*` rules in `apps/web/src/dashboard/dashboard.css` from about 4180; the narrow-screen block at about 4244.
- Theme tokens in `apps/web/src/styles.css` `:root`: `--accent #b8612f`, `--accent-bright #d6873f`, `--cream #ecdcbd`, `--muted #c9b393`, `--card #17110e`, `--line #3a2417`, `--danger-text #d9909a`. Fonts are Cinzel for headings and Spectral for body.
- Tests: `apps/web/test/koinon-view.test.tsx` pins section order, buttons per role and the Lesche phases.

## The brief (from Argiris's design agent)

> Redesign the Koinon page so it's no longer a single column of identical cards. Keep the existing palette, fonts, header and sidebar; only change the main content area.
>
> 1. **Hero strip** (full width, top). The only panel with the Greek-key border on top; remove the meander from every other panel. Left: a small orange "KOINON" eyebrow, the koinon name in large Cinzel (~52px), below it "Founded {season, year} · Led by {leader}". Right: 4 stats in a row split by thin vertical rules, each a small uppercase label over a large value: MEMBERS 1 / 8, TREASURY 140 dr (orange), MEN (total men across members), LESCHE ("Not built" / "Building" / "Open").
> 2. **Two-column grid** below (~1.55fr / 1fr, 24px gap, top-aligned).
>    - Left (actions). **Board:** textarea and POST on one row, the 0/300 counter kept; posts below, separated by thin rules, each with a small avatar or initial, a muted "Author · Season, Year" line, the text, and a low-emphasis DELETE on the right. **Muster** (under Board): the description kept; Gathering place / Target / Launch side by side in a 3-column row, each with a small label above; a primary "CALL THE MUSTER" button with a muted note beside it: "{N} men available across members".
>    - Right (reference rail). **Treasury:** the total in the header row on the right; a progress bar "Toward the Lesche · 140 / 200"; one line of Lesche details (capacity 12, 2 days to build, 5 dr/day upkeep); one row with the amount input, GIVE and "BUILD · 200" (disabled until the treasury holds 200); the most recent gift underneath. The separate Lesche card is removed and folded in here. **Members** ("1 of 8" on the right of the header): each row with avatar, name, LEADER tag, "Trader · Dynatoi", and right-aligned "52 men / levy 146"; this replaces the Soldiers card; an inline invite input and INVITE button at the bottom replace the Invite card. **Koina of the city:** compact rows, "Name · Leader" left, "x of 8" right, thin dividers. **LEAVE {KOINON}:** a small, low-emphasis, right-aligned link at the bottom, not a boxed button.
>
> Styling: section titles in orange Cinzel with letter-spacing, followed by a single thin rule in place of the meander. The Muster panel has a slightly warmer border (#6b3a1c); other panels a quieter one (#3a2718). Field labels in small uppercase Cinzel, muted tan. Below ~1100px the right column stacks under the left. Keep all existing functionality and data bindings: a layout change only.

## Rulings (where the brief meets the game's standing rules)

1. **Fonts.** Cinzel for headings and labels, Spectral for body. The brief's "Garamond" means the site's body face, which is Spectral.
2. **Orange text** is `--accent-bright`: the eyebrow, the treasury value, the section titles. `--accent` (terracotta) is a fill and border colour only (the bar fill, the primary button), never text.
3. **Borders.** Quiet panels use `--line` (the brief's #3a2718 is this token). The Muster panel uses a new token `--line-warm: #6b3a1c`, declared once beside the other dashboard tokens, never as a literal in a rule.
4. **Soldiers stay the leader's.** Every men or levy figure comes from the armies payload, which only the leader can read. So:
   - **MEN** in the hero shows for the leader only. Every other member sees three stats.
   - **"{men} men · levy {levy}"** on member rows shows for the leader only.
   - **The muster note** reads `{N} men stand at {gather} across members` for the leader, from the armies payload's at-home rows at the selected gathering place. Other members see no note.
5. **Nothing a player can do today goes away.**
   - **Leader's soldiers and controls.** For the leader, each member row is a `<details>`. The summary is the row as the brief draws it. Opened, it shows the present `MemberSoldiers` content (at home by place, away, in training, the fleet) and the row's leader actions: Make vice / Clear vice, Hand over the lead, Expel, with their confirms. Every other member sees plain rows with no disclosure.
   - **Invites.** The inline invite (leader and vice) keeps its pending list underneath, each with Withdraw.
   - **The Lesche's phases** fold into the Treasury panel.
     - `none`: the progress bar `Toward the Lesche · {min(treasury, cost)} / {cost}`, the one-line details, and `Build · {cost}` for the leader in the give row. The build button is disabled with its reason while short, and keeps its confirm.
     - `building`: the existing `BuildProgress`, with no progress bar and no Build.
     - `open`: the existing open line, with the days covered.
     - `shut`: the existing shut line.
   - **Gifts.** The most recent gift sits under the give row. Below it, an `All gifts` disclosure holds the present Givers totals and the 10 recent gifts.
   - **The lead.** The take-the-lead card stays, as the first panel of the left column, only when `canTakeLead`.
   - **The muster.** The Muster panel keeps everything it shows today. With a muster open, it shows `MusterOpen` (countdown, pledges, your pledge, call off). Without one, it shows the description, the form (now as the 3-column row and the button with its note), and `LastMuster` under it.
6. **The hero.**
   - The eyebrow `Koinon`, set in uppercase by CSS.
   - The name.
   - `Founded {foundedLabel} · Led by {leader}`, with ` · Vice {vice}` when there is one.
   - The stats:
     - MEMBERS `{members} / {cap}`, with the cap from the page as it is now;
     - TREASURY `{treasury} dr`;
     - MEN, leader only, the total across members of home, away and training;
     - LESCHE: `Not built`, `Building`, `Open` or `Shut`.

   The meander band sits on the hero only.
7. **Section titles.** Every other panel's head is the title in `--accent-bright` Cinzel with letter-spacing, followed by one thin `--line` rule. The head's right-hand note (the treasury total, `{n} of {cap}`) stays on the right of that row.
8. **Board posts.** The avatar is the author's initial in a small round badge, since the post payload carries the name only. No server change. Delete is a low-emphasis text button on the right.
9. **Leave.** A text button, right-aligned under the rail, in `--danger-text`, labelled `Leave {koinon name}`, with its existing confirm text unchanged.
10. **The grid.** `1.55fr 1fr`, 24px gap, top-aligned. Below 1100px the rail stacks under the left column. At 390px every row that sits side by side (the three muster fields, the give row, the hero stats) wraps cleanly, and nothing scrolls sideways.
11. **The non-member view** keeps its structure: Your invitations, Found a koinon, Koina of the city. It takes the new section titles and borders only, with no hero.
12. **Copy.** The only new strings are `Koinon` (eyebrow), `Led by`, the four stat labels, `Toward the Lesche`, `All gifts`, the leader's muster note, `Leave {name}` and `dr`. Every other string stays as it is. List any further string in the report.

## Phase 0: recon

Confirm the facts above. Report whether `docs/koinon/design/Koinon Page.dc.html` exists. **STOP 0 only on a contradiction.**

## Phase 1: build

One commit per item. Each commit updates the tests it touches, so the web suite is green at every commit.

1. `docs: koinon redesign prompt 1` (and the mockup file, if present and untracked).
2. `web: koinon section titles, quiet borders and the warm muster border`. This covers `--line-warm`, the title-and-rule head in place of the meander on every panel, and the borders.
3. `web: the koinon hero strip` (ruling 6).
4. `web: the koinon page in two columns`. This covers the grid, the take-the-lead panel, the Board with its one-row form and the post rows, and the Muster panel with its 3-column form and the leader's note.
5. `web: the Lesche folded into the treasury` (ruling 5).
6. `web: members carry their soldiers and the invite`. This covers the member rows, the leader's disclosure with soldiers and actions, and the inline invite with its pending list. The Soldiers and Invite cards go.
7. `web: koina of the city compact, leave as a link`.

### Render tests (`koinon-view.test.tsx`, cheap DOM selectors)

- **The hero:**
  - the leader sees four stats including MEN;
  - a plain member and the vice see three, with no MEN;
  - LESCHE reads each of the four phase words.
- **No card is left behind:**
  - there is no Lesche card, no Soldiers card and no Invite card;
  - the meander appears once, in the hero.
- **The leader's member rows:**
  - opening a row shows the soldiers (an away row and a training row from the mocked armies payload) and the three actions;
  - a plain member's rows have no disclosure and no men figures.
- **Treasury:**
  - phase `none` with 140 of 200: the bar reads `140 / 200`, and Build is disabled with its reason for the leader;
  - at 200, Build is enabled;
  - a plain member sees no Build;
  - `building` shows the build bar;
  - `All gifts` holds the givers and the recent gifts.
- **Muster:** the leader sees the `across members` note with the right count for the chosen gathering place, and a plain member sees no note.
- **Invite and leave:** the inline invite shows for the leader and the vice, with Withdraw on a pending invite; Leave is a text button and keeps its confirm.
- **Non-member:** the view still shows Your invitations, Found a koinon and Koina of the city, with no hero.
- **Hooks:** no hook-order warning across renders.

Gates: `pnpm -r lint`, web tsc, web build, web tests, then the full `pnpm gate` at HEAD. Start the gate below a 1-minute load of 20 and report the figure. A red caused only by timeouts is a STOP with the log, never a rerun.

**STOP 1.** Final report with captures of the Koinon tab, each at desktop width, at about 1000px (stacked) and at 390px:

- as leader (one member row opened, the muster form showing);
- as a plain member;
- as the vice;
- as a non-member.

Wait. Do not push.

## Scope fence

Touch only:

- `docs/koinon/koinon-redesign-prompt-1.md`, and the mockup if present;
- `apps/web/src/dashboard/panels/KoinonView.tsx`;
- `apps/web/src/dashboard/dashboard.css` (the `koinon-*` rules and the one new token);
- `apps/web/test/koinon-view.test.tsx`.

No server, shared, API, payload or content change. No other panel's styles: the Politics tab row, the council and the other tabs are untouched. No new emoji.

## Final report template

```
KOINON REDESIGN
baseline: <SHA>
mockup file: present and committed / not present
captures: leader, member, vice, non-member at desktop, ~1000px and 390px
NEW PLAYER-FACING COPY: every string not quoted in this prompt
RULINGS FOR ARGIRIS: every departure from this prompt or the brief, with the reason
Committed: <SHA> <subject>, one line per commit, in order
GATE: the gate's last line at HEAD, with the starting load
```
