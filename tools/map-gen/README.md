# MASSALIA map bundle

The generated Western Mediterranean source map uses Lambert Conformal Conic projection and a shared 2400 × 1991 pixel coordinate system.

## First campaign theatre

Run:

```sh
node tools/map-gen/build_theatre.mjs
```

This derives `apps/web/public/map/theatre.json` from the full province geometry and adjacency graph. It selects a three-province-deep coastal theatre, connected sea cells, major western/central Mediterranean islands, frontier boundaries, colony candidates and a display viewport. Edit the geographic selection functions in that script when expanding the campaign.

## Browser assets

- `provinces_px.json`: 1,023 land, sea and wasteland SVG paths.
- `rivers_px.json`: 78 river paths.
- `towns_px.json`: 26 towns with pixel and longitude/latitude positions.
- `polities.json`: campaign polity names and colors.
- `terrain_px.png`: hillshaded terrain underlay; macro relief is real and fine ridge detail is procedural.
- `theatre.json`: generated first-theatre mask and preview state.

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
