# Art, prompt 1: replace the front, panel, festival, politics and atlas artwork

## What this builds

Nine image files in `apps/web/public/assets/` are replaced by new versions of the same name, format and pixel size, produced outside the repo. No code, CSS, content, server, worker or db change. Every reference is by path, so the swap is one commit.

The source folder is `/Users/macbook/Desktop/MoMass`. Only the nine site-ready files below are copied. The `- MASTER.png` files beside them are not copied, not committed, not moved.

| file | format | size | where it shows |
|---|---|---|---|
| `MASSALIA FRONT.jpg` | JPEG | 1440×810 | landing hero background (styles.css:125), auth and legal page backgrounds (styles.css:1236, 1348), Lobby background (lobby.css:42, `center 30%`) |
| `Court.webp` | WebP | 1134×638 | Court panel banner (CourtPanel.tsx:503), Lobby hero fallback and calendar-ended art (lobby/art.ts:17, 25) |
| `Ledger.webp` | WebP | 1134×638 | Ledger panel banner (LedgerPanel.tsx:741), Lobby guides thumb (art.ts:28) |
| `Market.webp` | WebP | 1134×638 | Market panel banner (MarketPanel.tsx:400) |
| `Family.webp` | WebP | 1134×638 | Family panel banner (FamilyPanel.tsx:504) |
| `Politics.jpg` | JPEG | 1672×941 | landing parties section background (styles.css:525), Politics chamber card background (dashboard.css:3441) |
| `Dionysia.webp` | WebP | 1134×638 | festival banner `fest-dionysia` (banners.tsx:9) |
| `Artemisia.webp` | WebP | 1134×638 | festival banner `fest-artemisia` (banners.tsx:10) |
| `MAP01.jpg` | JPEG | 425×269 | landing atlas section image (App.tsx:1109) |

Line numbers are at df3a562. `Apollonia.webp`, `Olympic.webp`, `massalia-hero.jpg`, `MASSALIA LION.png`, `og-image.jpg` and everything else in the folder stay as they are.

## Phase 0: recon (no copy, no commit)

1. Confirm the nine files exist in `/Users/macbook/Desktop/MoMass` under exactly those names, and for each report format, pixel size and byte size (`sips -g format -g pixelWidth -g pixelHeight` and `stat -f %z`), beside the same three figures for the current repo file. Any name, format or pixel-size difference from the table is STOP 0. Confirm no EXIF orientation other than 1 on the two JPEGs, and that each WebP is a single still frame.
2. Byte-size rule: a new file may be larger than the old one. If one is more than twice its current size or over 600 KB, re-encode it at the same pixel size (JPEG quality 82, WebP quality 82) and report both sizes; do not resize, crop or sharpen anything.
3. `git status` clean at df3a562 before anything is copied.

## Phase 1: the swap (one commit)

1. Save this prompt verbatim as `docs/art/art-prompt-1.md`.
2. Copy the nine files over their namesakes in `apps/web/public/assets/`. `git status` must then show exactly those nine modified binaries plus the prompt copy, nothing added, nothing deleted.
3. Build, and confirm each of the nine lands in `dist/assets/` byte-identical to the source (`cmp`).

Commit: `art: replace the front, panel, festival, politics and atlas artwork`.

## Phase 2: gate and browser check, then STOP 1

1. Full gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD, ending `GATE GREEN`.
2. Browser check as the theme batch did it (dev server, logged in), captures at 1280px and 390px into the theme-shots folder: the landing hero, the landing parties section, the landing atlas section, the auth sheet, the Lobby worlds list (background and the hero fallback art), the Lobby guides thumb, the Dashboard on Court, Ledger, Market and Family (the banner of each), and Politics with the chamber card. For the two festivals, open `/assets/Dionysia.webp` and `/assets/Artemisia.webp` directly in the browser and capture them; if a festival card can be raised in the dev world without new code, capture that too, otherwise say the banners were checked by URL only.
3. In each capture, note where the crop cuts the subject badly (the `center 30%` Lobby crop and the `cover` hero crop are the ones to watch), and where a dimming overlay now hides or over-brightens the art. Each is a ruling item, not a fix; nothing in CSS changes under this prompt.

Then STOP 1 with the report.

## Scope fence

- Only the nine files named, in place, same names. No CSS, no TSX, no content, no server, no worker, no db, no migration, no rename.
- No file added to the repo except the prompt copy. No master file, no sidecar, no `.DS_Store`.
- No edit to any image beyond the re-encode rule in Phase 0.
- Push only as the last paragraph says.

## Push

After GATE GREEN: fast-forward only, plain `git push`, the one commit. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing in them changed). Then confirm `https://playmassalia.com/assets/MASSALIA%20FRONT.jpg` serves the new byte size. Close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.

## Report template

```
Committed: <SHA> art: replace the front, panel, festival, politics and atlas artwork
Gate: <last line>
Phase 0: <nine rows: name, format, WxH, old KB → new KB, re-encoded yes/no>
Captures: <path per surface, or the STOP>
Ruling for Argiris: <each crop or overlay problem, each departure from the prompt, with the reason>
Push: <remote HEAD, CI, Pages, Railway, live byte size>
```
