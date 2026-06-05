# Massalia Game Fonts

Web fonts live in `apps/web/public/assets/fonts/` and are loaded by the
`@font-face` rules in `apps/web/src/styles.css`.

## Cinzel (display / headings)

- `cinzel.woff2` — a single **variable** font covering the full weight axis
  (`font-weight: 400 900`). Generated from
  `Cinzel/Cinzel-VariableFont_wght.ttf`.

To regenerate after replacing the source TTF:

```bash
python3 -m pip install fonttools brotli
python3 - <<'PY'
from fontTools.ttLib import TTFont
f = TTFont("Cinzel/Cinzel-VariableFont_wght.ttf")
f.flavor = "woff2"
f.save("cinzel.woff2")
PY
```

## Spectral (body text)

- `spectral-300.woff2`
- `spectral-400.woff2`
- `spectral-500.woff2`
- `spectral-600.woff2`
- `spectral-italic-400.woff2`

## Source files & licenses

The upstream Google Fonts downloads (TTF + `OFL.txt`) are kept in the
`Cinzel/` and `Spectral/` subfolders as source. The browser only loads the
`.woff2` files above — the TTFs are not referenced at runtime.

Both families are licensed under the SIL Open Font License (see each
`OFL.txt`), so they are safe to commit and redistribute with the app.
