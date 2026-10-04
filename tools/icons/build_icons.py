#!/usr/bin/env python3
"""Derive favicon / link-preview assets from existing landing-page assets.

Sources (read only, all under apps/web/public/assets/):
  MASSALIA LION.png     brand mark
  MASSALIA FRONT.jpg    landing hero background
  fonts/Cinzel

Outputs (apps/web/public/):
  favicon.ico           16/32/48 frames — the header `.brand-mark` (styles.css:195):
                        dark disc, 1px gold ring at 38px, lion at 82%
  apple-touch-icon.png  180x180, same mark on an opaque dark square (iOS turns transparency black)
  og-image.jpg          1200x630 link-preview card: the front art under a black fade from the left,
                        brand lockup, eyebrow, lead and h1 in the theme's terracotta and cream

Run from repo root:  python3 tools/icons/build_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "apps/web/public"
LION = PUB / "assets/MASSALIA LION.png"

DARK = (11, 7, 6)          # #0b0706 theme-color / .brand-mark background
RING = (143, 109, 55)      # rgba(181,138,69,.78) composited over the dark background
RING_RATIO = 1 / 38        # 1px ring at the header's 38px mark
LION_RATIO = 0.82          # .brand-mark img { width: 82% }


def lion_square() -> Image.Image:
    im = Image.open(LION).convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())           # trim transparent margin
    s = max(im.size)                                      # pad to square, centred
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq


def brand_mark(size: int, ss: int = 4, ring_color=RING) -> Image.Image:
    """The header medallion at `size` px, transparent outside the disc."""
    S = size * ss
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ring = max(1, round(S * RING_RATIO))
    ImageDraw.Draw(im).ellipse([0, 0, S - 1, S - 1], fill=DARK + (255,), outline=ring_color + (255,), width=ring)
    l = round(S * LION_RATIO)
    lion = lion_square().resize((l, l), Image.LANCZOS)
    im.alpha_composite(lion, ((S - l) // 2, (S - l) // 2))
    im = im.resize((size, size), Image.LANCZOS)
    if size <= 48:                                        # keep the face legible at tab sizes
        im = im.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
    return im


W, H = 1200, 630


def _lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))


def _stops_color(stops, t):
    """stops: [(pos, (r,g,b,a)), ...] sorted by pos; piecewise-linear like CSS."""
    if t <= stops[0][0]:
        return stops[0][1]
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if t <= p1:
            return _lerp(c0, c1, (t - p0) / (p1 - p0) if p1 > p0 else 0)
    return stops[-1][1]


def linear_overlay(stops, horizontal: bool) -> Image.Image:
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    n = W if horizontal else H
    for i in range(n):
        c = _stops_color(stops, i / (n - 1))
        if horizontal:
            d.line([(i, 0), (i, H)], fill=c)
        else:
            d.line([(0, i), (W, i)], fill=c)
    return im


def tracked(draw, xy, text, font, fill, tracking_em):
    x, y = xy
    step = tracking_em * font.size
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + step
    return x


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


def on_dark_square(mark: Image.Image, canvas: int) -> Image.Image:
    out = Image.new("RGBA", (canvas, canvas), DARK + (255,))
    off = (canvas - mark.width) // 2
    out.alpha_composite(mark, (off, off))
    return out.convert("RGB")


def main() -> None:
    frames = [brand_mark(s) for s in (48, 32, 16)]
    frames[0].save(PUB / "favicon.ico", format="ICO", sizes=[(48, 48), (32, 32), (16, 16)], append_images=frames[1:])
    on_dark_square(brand_mark(158, ss=2), 180).save(PUB / "apple-touch-icon.png", optimize=True)
    build_og(PUB / "og-image.jpg")
    for f in ("favicon.ico", "apple-touch-icon.png", "og-image.jpg"):
        print(f, (PUB / f).stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
