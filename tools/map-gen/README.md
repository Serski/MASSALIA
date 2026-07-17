# MASSALIA map system — complete bundle

Generated with Claude (claude.ai), July 2026. Western Mediterranean frame,
Lambert Conformal Conic (+proj=lcc +lat_1=34 +lat_2=48 +lat_0=41 +lon_0=4).
All pixel-space files share one 2400x1991 coordinate system.

## Browser assets -> web app public/map/
- provinces_px.json   730 provinces (land/sea/wasteland) as SVG path strings
- rivers_px.json      78 river paths, same pixel space
- towns_px.json       26 towns (px + lon/lat). approx:true = fictional town,
                      position estimated from the demo map — CORRECT BEFORE SEEDING
- polities.json       18 polities with demo-map colors ("elisyces" was unlabeled
                      on the demo map; rename freely)
- terrain_px.png      hillshaded terrain underlay (macro relief is real,
                      fine ridge detail is procedural)

## Seed data -> db package seed-data/map/
- provinces.geojson   same provinces in WGS84 with terrain/coastal attributes
- adjacency.json      3,064 border pairs (province graph for conquest/movement)
- owners_seed.json    79 provinces -> polity, campaign start (Gulf of Galates
                      region only; auto-assigned, tribal borders need hand-tuning)

## Reference component
- ProvinceMap.tsx     React/SVG map: terrain + provinces + rivers + towns,
                      seeded ownership, click-to-conquer demo. Adapt to repo
                      conventions; replace static-json ownership with API.

## Generators -> tools/map-gen/ (Python: geopandas shapely pyproj rasterio
   scipy pillow cairosvg; data from Natural Earth GitHub mirror + basemap-data)
- build_provinces2.py     provinces/adjacency (density, warp, wastelands = config)
- build_terrain_rivers.py rivers + flat terrain variant
- build_terrain_v2.py     hillshaded terrain (palette in STOPS, relief in VERT)
- seed_demo_nations.py    polities/towns/ownership from the demo map

Data sources: Natural Earth (public domain), aourednik/historical-basemaps,
NOAA ETOPO1 via basemap-data (public domain). No attribution required;
crediting Natural Earth is good practice.
