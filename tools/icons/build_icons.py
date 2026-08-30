#!/usr/bin/env python3
"""Derive favicon / link-preview assets from existing landing-page assets.

Sources (read only, all under apps/web/public/assets/):
  MASSALIA LION.png     brand mark
  MASSALIA FRONT.jpg    landing hero background
  fonts/Cinzel, fonts/Spectral

Outputs (apps/web/public/):
  favicon.ico           16/32/48 frames — the header `.brand-mark` (styles.css:195):
                        dark disc, 1px gold ring at 38px, lion at 82%
  apple-touch-icon.png  180x180, same mark on an opaque dark square (iOS turns transparency black)
  og-image.jpg          1200x630 still of the landing hero (`.landing-hero` overlays, brand lockup,
                        eyebrow, lead, h1, subline, `.hero-lion`) for link previews

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


def brand_mark(size: int, ss: int = 4) -> Image.Image:
    """The header medallion at `size` px, transparent outside the disc."""
    S = size * ss
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ring = max(1, round(S * RING_RATIO))
    ImageDraw.Draw(im).ellipse([0, 0, S - 1, S - 1], fill=DARK + (255,), outline=RING + (255,), width=ring)
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


def radial_overlay(cx, cy, inner, outer, color, radius) -> Image.Image:
    """Transparent inside `inner*radius`, ramps to `color` at `outer*radius` (CSS radial-gradient approximation)."""
    g = Image.radial_gradient("L").resize((radius * 2, radius * 2), Image.BILINEAR)
    lo, hi = int(inner * 255), int(outer * 255)
    a = g.point(lambda v: 0 if v <= lo else (color[3] if v >= hi else round(color[3] * (v - lo) / (hi - lo))))
    layer = Image.new("RGBA", (W, H), color[:3] + (0,))
    full = Image.new("L", (W, H), color[3])
    full.paste(a, (cx - radius, cy - radius))
    layer.putalpha(full)
    return layer


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
    spectral_it = ImageFont.truetype(str(fonts / "Spectral/Spectral-Italic.ttf"), 30)

    # background: MASSALIA FRONT.jpg, cover-cropped to 1200x630
    bg = Image.open(pub / "assets/MASSALIA FRONT.jpg").convert("RGB")
    bw, bh = bg.size
    th = round(bw * H / W)
    top = (bh - th) // 2
    im = bg.crop((0, top, bw, top + th)).resize((W, H), Image.LANCZOS).convert("RGBA")

    # .landing-hero overlays (styles.css) — same stops, same order
    im.alpha_composite(linear_overlay([(0.00, (13, 8, 6, 230)), (0.42, (18, 11, 8, 199)), (0.72, (17, 10, 8, 46)), (1.00, (12, 7, 6, 194))], horizontal=True))
    im.alpha_composite(linear_overlay([(0.00, (11, 7, 5, 158)), (0.34, (11, 7, 5, 0)), (1.00, (12, 7, 5, 204))], horizontal=False))
    im.alpha_composite(radial_overlay(int(W * 0.72), int(H * 0.44), 0.20, 0.58, (10, 6, 5, 122), radius=900))
    im.alpha_composite(linear_overlay([(0.62, (19, 13, 10, 0)), (1.00, (19, 13, 10, 255))], horizontal=False))

    # .hero-lion on the right (opacity .9, drop shadow)
    lion = lion_square().resize((330, 330), Image.LANCZOS)
    lx, ly = 830, 170
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sh.paste((0, 0, 0, 140), (lx, ly + 26), lion.getchannel("A"))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(28)))
    lion_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); lion_layer.paste(lion, (lx, ly), lion)
    lion_layer.putalpha(lion_layer.getchannel("A").point(lambda v: round(v * 0.9)))
    im.alpha_composite(lion_layer)

    d = ImageDraw.Draw(im)
    X = 72
    # .brand-lockup: mark + wordmark (gold-bright, ExtraBold, tracking .16em)
    mark = brand_mark(48, ss=2); im.alpha_composite(mark, (X, 44)); d = ImageDraw.Draw(im)
    tracked(d, (X + 64, 50), "MASSALIA", cinzel("ExtraBold", 34), (210, 165, 92, 255), 0.16)

    # .hero-eyebrow: gold dot + text (gold, Bold, tracking .16em)
    y = 200
    d.ellipse([X, y + 8, X + 10, y + 18], fill=(181, 138, 69, 255))
    tracked(d, (X + 22, y), "FREE BROWSER STRATEGY GAME", cinzel("Bold", 19), (181, 138, 69, 255), 0.16)
    # .hero-lead (cream 78%, SemiBold, tracking .18em)
    y += 44
    tracked(d, (X, y), "4TH CENTURY BC · THE LEAGUE OF", cinzel("SemiBold", 25), (236, 224, 204, 199), 0.18)
    # h1 (#f2dfb6, Bold, tracking .08em, text-shadow)
    y += 44
    h1 = cinzel("Bold", 138)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tracked(ImageDraw.Draw(sh), (X, y + 18), "MASSALIA", h1, (0, 0, 0, 143), 0.08)
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(24))); d = ImageDraw.Draw(im)
    tracked(d, (X, y), "MASSALIA", h1, (242, 223, 182, 255), 0.08)
    # .hero-subline (#e4d3b9, Spectral italic)
    y += 172
    d.text((X + 4, y), "Founded by Phocaean Greeks. Ruled by whoever dares.", font=spectral_it, fill=(228, 211, 185, 255))

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
