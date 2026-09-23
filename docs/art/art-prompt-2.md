# Art, prompt 2: Apollonia festival art, The Silver of Artemis scenes, and the ship goods icons

## What this builds

Seven images from `/Users/macbook/Desktop/Updates2` go into the web build.

- Four art files replace existing files of the same name: the Apollonia festival card and the three scene images of The Silver of Artemis. Every reference to them is by path, so there is no code or content change.
- Three new icons give the pentekonter, the trireme and naval supplies real artwork in place of their emoji fallback. That is three new files plus three entries in `RESOURCE_WEBP`.

Line numbers are at 442216e (`content: River Nails, a Shipbuilder story, with its eleven images`).

### Art targets (replace in place, same names)

| Target | Current | Shows in |
|---|---|---|
| `apps/web/public/assets/Apollonia.webp` | WebP 1134×638 | Apollonia festival card, `EVENT_ART["fest-apollo"]` (banners.tsx:11) |
| `apps/web/public/stories/story-artemisia-p1-temple.webp` | WebP 1134×567 | node P1 and the story's offer card in the Court (`StoryOfferCard`, CourtPanel.tsx:463) |
| `apps/web/public/stories/story-artemisia-p6-harbor.webp` | WebP 1134×567 | node P6 |
| `apps/web/public/stories/story-artemisia-p8-grove.webp` | WebP 1134×595 | node P8 |

The paths come from `content/stories/artemisia-silver.json` (version 2). That file does not change, the version does not change, and no reseed is needed.

### Icon targets (new files)

| New file | Good id | Label (buildings.json goodLabels, 597-599) |
|---|---|---|
| `apps/web/public/assets/TRIREME.webp` | `galley` | Trireme |
| `apps/web/public/assets/PENTEKONTER.webp` | `trade-ship` | Pentekonter |
| `apps/web/public/assets/NAVAL SUPPLIES.webp` | `naval-supplies` | Naval Supplies |

`RESOURCE_WEBP` is at `apps/web/src/dashboard/shared.tsx:854`, with its comment at 849-853. `GoodGlyph` is at 879. Every GoodGlyph caller picks up the new art: the Market (including the "Naval & ships" group), the Ledger (LedgerPanel.tsx:504, which currently falls back to ⛵), the resource sheets (sheets.tsx), and the Barracks gear and upkeep rows.

## Phase 0: recon (no copy, no commit)

1. Confirm `git status` is clean. Report HEAD. If HEAD is not 442216e, check that every reference above still holds and report any drift.
2. List `/Users/macbook/Desktop/Updates2` with each file's name, format, pixel size, alpha yes/no and bytes. If Updates2 is a zip, unzip it to a temp dir outside the repo. Ignore `.DS_Store`. Where both a site file and a `- MASTER` file exist for the same image, use the site file. Where only a master exists, encode from the master.
3. Map every source to a target, by file name first. Where the name doesn't settle it, open the image and match it by subject: the Apollo festival scene, then the temple, harbor and grove scenes (compare each with the current repo file). For the ships, the trireme is the larger warship with three banks of oars and a ram, and the pentekonter is the lighter single-bank galley. Naval supplies is the remaining icon.
4. STOP 0 on any of these, with the listing and the problem:
   - the folder does not hold exactly four art images and three icons;
   - a file cannot be placed with confidence;
   - an icon source has no transparency (opaque corners).
5. Name the WebP encoder you will use: `cwebp`, or Python Pillow with WebP support. Install nothing into the repo. If no encoder is available, that is also a STOP 0.

## Encoding rules

**Art.** A source that is already WebP, 1134 px wide and within its size cap is copied as is. Anything else is encoded to WebP, 1134 px wide, with the height taken from the source's aspect ratio, at quality 82 with metadata stripped. Do not crop, stretch or sharpen. If a JPEG source carries an EXIF orientation other than 1, apply it before encoding. Output must be a single frame.

- Size caps: Apollonia at most 250 KB, story scenes at most 200 KB. If a file is over its cap, lower the quality in steps of 4, down to 70 at the lowest, and report the value used.
- The story sheet shows scenes in a 2:1 box (dashboard.css:3790). An aspect ratio other than 2:1 for a scene, or other than 16:9 for Apollonia, is a ruling item. Do not crop to fix it.

**Icons.** Output is 128×128 lossless WebP with alpha (`cwebp -lossless` or Pillow `lossless=True`), matching the existing RESOURCE_WEBP files. Downscale with Lanczos. A non-square source is fitted inside 128×128 and centred on a transparent canvas, never stretched.

## Commit 1: `art: new Apollonia festival art and The Silver of Artemis scenes`

1. Save this prompt verbatim as `docs/art/art-prompt-2.md`.
2. Write the four art files over their namesakes. `git status` must then show exactly four modified binaries plus the prompt copy, with nothing added and nothing deleted.
3. Build, and confirm each of the four lands in `apps/web/dist` byte-identical to what you wrote (`cmp`).

## Commit 2: `web: artwork for the pentekonter, trireme and naval supplies goods`

1. Add the three icon files under the exact names in the table. Case and spaces matter: Linux is case-sensitive, and `assetIconUrl` encodes the spaces.
2. `RESOURCE_WEBP` gains three entries: `galley: "TRIREME.webp"`, `"trade-ship": "PENTEKONTER.webp"` and `"naval-supplies": "NAVAL SUPPLIES.webp"`. Place them in file-name order, as the table already is.
3. In the comment above it, remove the sentence saying the ship goods have no artwork and fall through to their emoji. Leave the rest of the comment as it is.
4. Leave these unchanged: the emoji fallbacks (they still cover a missing file), the CSS (`.good-glyph` already sizes the icons) and `GOOD_ICON`.
5. With a one-off script that is not committed, confirm every value in `RESOURCE_WEBP` and `POP_WEBP` exists under `apps/web/public/assets` with exact case.

## Gate, browser check and STOP 1

1. Run the full gate at HEAD after commit 2: `DATABASE_URL=…/massalia_test pnpm gate`. It must end `GATE GREEN … tree clean`.
2. Browser check with the dev servers running and logged in, capturing at 1280 px and 390 px. Save the captures outside the repo, for example in `/tmp/art2-shots`.
   - Open the four art URLs directly: `/assets/Apollonia.webp` and the three `/stories/story-artemisia-*.webp`.
   - If the Apollonia festival card or the Silver of Artemis offer card can be raised in the dev world without new code, capture them. Otherwise say they were checked by URL only.
   - Capture the Market's "Naval & ships" group, and the Ledger and resource sheet rows holding any of the three goods. If the dev character holds none of them, seed stock with a dev-only SQL insert against the local database (never production) and say so.
3. Note these as ruling items only, not fixes:
   - the Barracks fleet rows (BarracksPanel.tsx:671-685) and the map popover fleet text still show ships without an icon;
   - any aspect-ratio mismatch from the encoding rules;
   - any capture where an icon reads badly at 22 px.

Then STOP 1 with the report. No push.

## Scope fence

- Only the seven files named, the three `RESOURCE_WEBP` entries and the one comment sentence. No other TSX, no CSS, no content JSON, no story version bump, no server, no worker, no db, no migration.
- Nothing else from Updates2 enters the repo: no masters, no sidecars, no `.DS_Store`. Nothing in Updates2 is moved, renamed or deleted.
- No image editing beyond the resize and encode rules above.

## Push (only when Argiris replies PUSH)

1. Fast-forward only, plain `git push`, the two commits.
2. Report the remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing in them changed).
3. Confirm with `curl -sI` that `https://playmassalia.com/assets/Apollonia.webp`, `https://playmassalia.com/stories/story-artemisia-p1-temple.webp` and `https://playmassalia.com/assets/TRIREME.webp` serve the new byte sizes. Pages caches for about 10 minutes, so retry once after that if a size is stale.
4. Close-out: dev servers and any throwaway Postgres stopped, tree clean at remote HEAD.

## Report template

```
Committed: <SHA> art: new Apollonia festival art and The Silver of Artemis scenes
Committed: <SHA> web: artwork for the pentekonter, trireme and naval supplies goods
Gate: <the gate's last line>
Art: <target <- source, copied or encoded (encoder, quality), pixel size, bytes new / old, for all four>
Icons: <target <- source, 128x128 lossless alpha, bytes, for all three>
Captures: <list, and which checks were by URL only>
Rulings for Argiris: <each with the reason, or "none">
```
