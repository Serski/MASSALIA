# Art, prompt 3: the link card redrawn from the new harbour

## What this builds

The link preview card is `apps/web/public/og-image.jpg` (1200×630), read by Discord and other scrapers from `og:image` at `apps/web/index.html:23`. It still shows the old harbour, the gold lettering and the lion medallion, because art prompt 1 left it out (`docs/art/art-prompt-1.md:21`).

This prompt redraws it with `tools/icons/build_icons.py` from the current `MASSALIA FRONT.jpg`, in the old layout and the theme's colours: a black fade from the left, the brand lockup, eyebrow, lead and wordmark on the left, the harbour and the acropolis clear on the right. The image URL gets `?v=2` so scrapers fetch the new file instead of their cached copy.

Two commits (one docs, one card). No server, worker, db, content or migration change. Line numbers are at 7152e21.

## Rulings (4 Oct 2026)

- The card keeps the old layout with a black fade, on the new art, in the theme's terracotta and cream.
- The large lion medallion and the italic subline leave the card. The small lion mark stays in the lockup, with a terracotta ring.
- The eyebrow reads `FREE BROWSER GRAND STRATEGY GAME`, as the live hero does. The lead reads `300 BC · THE LEAGUE OF`.
- `favicon.ico` and `apple-touch-icon.png` do not change.

## Phase 0: recon (nothing written)

1. `git status` clean. Report HEAD. If HEAD is not 7152e21, check that every reference in this prompt still holds and report any drift.
2. Pillow is importable (`python3 -c "import PIL; print(PIL.__version__)"`); report the version.
3. These exist: `apps/web/public/assets/MASSALIA FRONT.jpg` at 1440×810, `apps/web/public/assets/MASSALIA LION.png`, and `Cinzel-Bold.ttf`, `Cinzel-SemiBold.ttf`, `Cinzel-ExtraBold.ttf` under `apps/web/public/assets/fonts/Cinzel/static/`.
4. Record `shasum` of `apps/web/public/favicon.ico`, `apps/web/public/apple-touch-icon.png` and `apps/web/public/og-image.jpg`.

STOP 0 only if the tree is dirty, Pillow is missing, or a file in step 3 is missing or a different size. Otherwise carry on to Phase 1.

## Phase 1: the docs commit

1. Save this prompt verbatim as `docs/art/art-prompt-3.md`.
2. Parked from the economy batch: if this session holds Argiris's STOP 1 ruling of 4 Oct 2026 on `docs/economy/economy-prompt-1.md`, append it verbatim at the end of that file under `## STOP 1 ruling (4 Oct 2026)`, the way `docs/buildings/buildings-prompt-1.md:125` carries its own. If the session does not hold the text, do not reconstruct it: leave the file alone and say so in the report.

Commit: `docs: art prompt 3, and the economy STOP 1 ruling in its prompt copy` (drop the second clause if step 2 was skipped).

## Phase 2: the card (one commit)

### 1. `tools/icons/build_icons.py`

a. `brand_mark` (line 40) takes an optional ring colour, so the favicon path is untouched:

```python
def brand_mark(size: int, ss: int = 4, ring_color=RING) -> Image.Image:
```

and on line 45 `outline=RING + (255,)` becomes `outline=ring_color + (255,)`.

b. Replace the whole of `build_og` (lines 106 to 158) with:

```python
def build_og(out: Path) -> None:
    pub = PUB
    fonts = pub / "assets/fonts"
    cinzel = lambda w, s: ImageFont.truetype(str(fonts / f"Cinzel/static/Cinzel-{w}.ttf"), s)

    PAGE = (13, 10, 9)          # --page #0d0a09
    ACCENT = (184, 97, 47)      # --accent #b8612f (fills and rings)
    BRIGHT = (214, 135, 63)     # --accent-bright #d6873f (small accent text)
    CREAM = (236, 220, 189)     # --cream #ecdcbd

    # background: MASSALIA FRONT.jpg, cover-cropped to 1200x630, anchored to the top edge
    bg = Image.open(pub / "assets/MASSALIA FRONT.jpg").convert("RGB")
    bw, bh = bg.size
    th = round(bw * H / W)
    im = bg.crop((0, 0, bw, th)).resize((W, H), Image.LANCZOS).convert("RGBA")

    # black fade from the left (the harbour stays clear on the right), then a top and bottom vignette
    im.alpha_composite(linear_overlay([(0.00, PAGE + (247,)), (0.40, PAGE + (235,)), (0.62, PAGE + (168,)), (0.80, PAGE + (41,)), (1.00, PAGE + (0,))], horizontal=True))
    im.alpha_composite(linear_overlay([(0.00, PAGE + (107,)), (0.26, PAGE + (0,)), (0.66, PAGE + (0,)), (1.00, PAGE + (219,))], horizontal=False))

    d = ImageDraw.Draw(im)
    X = 72
    # brand lockup: mark with a terracotta ring + wordmark (accent-bright, ExtraBold, tracking .16em)
    mark = brand_mark(48, ss=2, ring_color=ACCENT); im.alpha_composite(mark, (X, 44)); d = ImageDraw.Draw(im)
    tracked(d, (X + 64, 50), "MASSALIA", cinzel("ExtraBold", 34), BRIGHT + (255,), 0.16)

    # eyebrow: terracotta dot + text (accent-bright, Bold, tracking .16em)
    y = 214
    d.ellipse([X, y + 8, X + 10, y + 18], fill=ACCENT + (255,))
    tracked(d, (X + 22, y), "FREE BROWSER GRAND STRATEGY GAME", cinzel("Bold", 19), BRIGHT + (255,), 0.16)
    # lead (cream 80%, SemiBold, tracking .18em)
    y += 44
    tracked(d, (X, y), "300 BC · THE LEAGUE OF", cinzel("SemiBold", 25), CREAM + (205,), 0.18)
    # h1 (cream, Bold, tracking .08em, soft shadow)
    y += 44
    h1 = cinzel("Bold", 124)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tracked(ImageDraw.Draw(sh), (X, y + 14), "MASSALIA", h1, (0, 0, 0, 170), 0.08)
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22))); d = ImageDraw.Draw(im)
    tracked(d, (X, y), "MASSALIA", h1, CREAM + (255,), 0.08)

    im.convert("RGB").save(out, quality=86, optimize=True, progressive=True)
```

c. Delete `radial_overlay` (lines 85 to 94); it has no caller left. `_lerp`, `_stops_color`, `linear_overlay`, `tracked`, `lion_square`, `on_dark_square` and `main` stay as they are.

d. The docstring's og-image entry (lines 13 and 14) becomes:

```
  og-image.jpg          1200x630 link-preview card: the front art under a black fade from the left,
                        brand lockup, eyebrow, lead and h1 in the theme's terracotta and cream
```

and on line 7 `fonts/Cinzel, fonts/Spectral` becomes `fonts/Cinzel`, since the subline was Spectral's only use.

### 2. Build the card

1. From the repo root: `python3 tools/icons/build_icons.py`.
2. The run also rewrites `favicon.ico` and `apple-touch-icon.png`, and a different Pillow version changes their bytes. Restore both: `git checkout -- apps/web/public/favicon.ico apps/web/public/apple-touch-icon.png`. Their `shasum` must equal Phase 0's.
3. `og-image.jpg` is a 1200×630 JPEG. Report its byte size beside the old one.

### 3. `apps/web/index.html`

- Line 23: the `og:image` content becomes `https://playmassalia.com/og-image.jpg?v=2`.
- Line 26: the `og:image:alt` content becomes `The harbour of Massalia below its acropolis`.
- Nothing else in the file changes: the title, the description, `og:description`, the width and height tags and the CSP stay.

### 4. Commit

`git status` shows exactly three modified files: `tools/icons/build_icons.py`, `apps/web/public/og-image.jpg`, `apps/web/index.html`. Nothing added, nothing deleted, no `__pycache__`.

Commit: `art: the link card redrawn from the new harbour`.

## Phase 3: gate and look, then STOP 1

1. Full gate: `DATABASE_URL=…/massalia_test pnpm gate` at HEAD after the last commit, ending `GATE GREEN: HEAD <sha>, tree clean`.
2. Build check: `apps/web/dist/og-image.jpg` is byte-identical to `apps/web/public/og-image.jpg` (`cmp`), and `apps/web/dist/index.html` carries the `?v=2` URL and the new alt text.
3. Open `apps/web/public/og-image.jpg` and check it against this list. Anything off is a ruling item, not a fix.
   - Left side near black, with the sail faintly visible behind the text.
   - Top left: the lion mark in a terracotta ring, then `MASSALIA` in the bright terracotta.
   - The eyebrow in the bright terracotta with a terracotta dot, the lead in cream, the large `MASSALIA` in cream ending near x=804 and readable to its last letter.
   - Right side in full colour and undimmed: the acropolis, the quay, the second ship, the rowing boat.
   - No large lion medallion, no italic subline, no gold lettering.
4. Open the file for Argiris too (`open apps/web/public/og-image.jpg`).

Then STOP 1 with the report. Nothing is pushed.

## Push (only on Argiris's word after STOP 1)

Fast-forward only, plain `git push`, the two commits. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing in them changed). Once Pages is green:

- `curl -s https://playmassalia.com/og-image.jpg | shasum` equals the repo file's `shasum`.
- `curl -s https://playmassalia.com/ | grep 'og:image'` shows the `?v=2` URL and the new alt text.

Close-out: nothing left running, tree clean at remote HEAD.

## Scope fence

- Only `tools/icons/build_icons.py`, `apps/web/public/og-image.jpg`, `apps/web/index.html` (lines 23 and 26), this prompt's copy, and `docs/economy/economy-prompt-1.md` for the appended ruling.
- Nothing under `apps/web/src`. No CSS, no TSX, no landing copy: the hero's own lead line at `App.tsx:969` stays as it is.
- `favicon.ico`, `apple-touch-icon.png`, `MASSALIA FRONT.jpg`, `MASSALIA LION.png` and every other asset stay byte-identical.
- The meta description and `og:description` are not touched.
- No new file in the repo except the prompt copy. No file rename.
- Any departure from this prompt is a "Ruling for Argiris" item in the report, never settled silently.

## Report template

```
Committed: <SHA> docs: art prompt 3, and the economy STOP 1 ruling in its prompt copy
Committed: <SHA> art: the link card redrawn from the new harbour
Phase 0: <HEAD, Pillow version, the three shasums>
Economy ruling: <appended verbatim | not held in this session, file untouched>
Card: <old KB → new KB, 1200×630, each line of the Phase 3 checklist yes/no>
Icons: <favicon.ico and apple-touch-icon.png restored, shasums equal Phase 0>
Build check: <dist/og-image.jpg cmp, dist/index.html og:image and alt>
Gate: <the gate's last line>
Ruling for Argiris: <each item with the reason, or "none">
Push: <not pushed | remote HEAD, CI, Pages, Railway, live shasum, live og:image>
```

END OF PROMPT
