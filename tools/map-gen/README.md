# MASSALIA map bundle

The generated Western Mediterranean source map uses Lambert Conformal Conic projection and a shared 2400 × 1991 pixel coordinate system.

## Hand-drawn world map (world2)

`build_world2.py` derives the hand-drawn world map from the three committed
Photoshop source copies in `sources/` (never the Desktop originals), all in the
same 3126 × 2696 pixel space:

- `sources/MASS_BASE01.psd` — art layers plus the 105 named town shapes and the `02_land.png` land layer.
- `sources/MASS_BASE01.png` — flattened export of the drawn region borders (black), sea lattice (blue) and coastline.
- `sources/MASS_BASE01_TERRAIN.png` — art-only export that ships verbatim as the terrain underlay.

It emits `apps/web/public/map2/terrain2.webp` (lossless, full resolution) and
`apps/web/public/map2/world2.json` (region geometry, towns, adjacency), and is
deterministic — the same sources always produce the same outputs. It aborts with
a report if any validation gate fails (town/region counts, exact tiling, no
disconnected playable region, output size).

Set up a virtualenv and run it with:

```sh
python3 -m venv .venv-world2
.venv-world2/bin/pip install -r tools/map-gen/requirements-world2.txt
.venv-world2/bin/python tools/map-gen/build_world2.py
```

## First campaign theatre

Run:

```sh
node tools/map-gen/build_theatre.mjs
```

This derives `apps/web/public/map/theatre.json` and `regions_px.json` from the full province geometry and adjacency graph. It selects a coastal theatre approximately three large regions deep, merges connected fine cells into larger land and sea regions, includes the major western/central Mediterranean islands, and generates frontier boundaries, colony candidates and a display viewport. Edit the geographic selection and region-size constants in that script when expanding the campaign.

## Browser assets

- `provinces_px.json`: 1,023 land, sea and wasteland SVG paths.
- `regions_px.json`: generated larger SVG regions with their underlying province IDs.
- `rivers_px.json`: 78 river paths.
- `towns_px.json`: 26 towns with pixel and longitude/latitude positions.
- `polities.json`: campaign polity names and colors.
- `terrain_px.png`: hillshaded terrain underlay; macro relief is real and fine ridge detail is procedural.
- `theatre.json`: generated first-theatre selection and preview state.

## Database seed data

- `provinces.geojson`: the same 1,023 provinces in WGS84.
- `adjacency.json`: province-border graph used for depth, movement and expansion.
- `owners_seed.json`: initial polity ownership assignments.

The complete geometry stays in the database as reference data. Only active-theatre land receives mutable per-world state when `seedMap.ts` is run.

## Source generators

The Python generation scripts use geopandas, Shapely, pyproj, rasterio, SciPy, Pillow and CairoSVG:

- `build_provinces2.py`: provinces and adjacency.
- `build_terrain_rivers.py`: rivers and flat terrain variant.
- `build_terrain_v2.py`: hillshaded terrain.
- `seed_demo_nations.py`: polity, town and ownership seed data.

Sources include Natural Earth, historical basemaps and NOAA ETOPO1. Natural Earth is public domain; attribution is still appreciated.
