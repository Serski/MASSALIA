"""Province generator v2 — organic borders via domain-warped Voronoi (raster),
wasteland masking (Germania cut + deep-Africa interior), smaller provinces."""
import json, numpy as np, glob, colorsys
import geopandas as gpd
import shapely
from shapely.geometry import box, MultiPolygon, shape as shp_shape, Point
from shapely.ops import unary_union
from shapely import make_valid
from pyproj import Transformer
from scipy.spatial import cKDTree
from scipy.ndimage import label as ndlabel, distance_transform_edt, zoom, gaussian_filter
from PIL import Image

rng = np.random.default_rng(42)
BBOX = (-11.0, 29.0, 20.0, 52.0)
LCC = "+proj=lcc +lat_1=34 +lat_2=48 +lat_0=41 +lon_0=4 +datum=WGS84 +units=m +no_defs"
N_LAND, N_SEA = 900, 130
GRID_W = 2600
WARP_KM, WARP_SCALE_KM = 13, 85      # border wiggle amplitude / feature size
AFRICA_DEPTH_KM = 220                  # playable coastal strip depth in Africa

clip_geo = box(*BBOX)
parts = []
for f in ('ne/ne_10m_land.geojson', 'ne/ne_10m_minor_islands.geojson'):
    g = gpd.read_file(f)
    g = gpd.clip(g[g.geometry.notna()], clip_geo).to_crs(LCC)
    parts += [make_valid(x.simplify(500)) for x in g.geometry if not x.is_empty]
LAND = make_valid(unary_union(parts))
minx, miny, maxx, maxy = box(*gpd.GeoSeries([clip_geo], crs=4326).to_crs(LCC).total_bounds).bounds
res = (maxx - minx) / GRID_W
GRID_H = int((maxy - miny) / res)
print(f"grid {GRID_W}x{GRID_H}, {res/1000:.1f} km/px")

# rasterize land mask
import rasterio.features
from rasterio.transform import from_origin
T = from_origin(minx, maxy, res, res)
land_mask = rasterio.features.rasterize([(LAND, 1)], out_shape=(GRID_H, GRID_W), transform=T, fill=0).astype(bool)

# --- wasteland masks ---
to_lcc = Transformer.from_crs("EPSG:4326", LCC, always_xy=True)
# Germania cut via lon/lat grid rule: everything NE of the Rhine-Danube line
gy, gx = np.mgrid[0:GRID_H, 0:GRID_W]
PX = minx + (gx + 0.5) * res
PY = maxy - (gy + 0.5) * res
to_geo2 = Transformer.from_crs(LCC, "EPSG:4326", always_xy=True)
LON = np.empty(PX.shape, dtype=np.float32); LAT = np.empty(PY.shape, dtype=np.float32)
fx, fy = PX.ravel(), PY.ravel(); lo_, la_ = LON.ravel(), LAT.ravel()
for i in range(0, fx.size, 800_000):
    a_, b_ = to_geo2.transform(fx[i:i+800_000], fy[i:i+800_000])
    lo_[i:i+800_000] = a_; la_[i:i+800_000] = b_
INBOX = (LON >= BBOX[0]) & (LON <= BBOX[2]) & (LAT >= BBOX[1]) & (LAT <= BBOX[3])
land_mask &= INBOX
germ_mask = (LAT > 47.7) & (LON > 7.0) & land_mask

# deep Africa: the African landmass beyond N km from the sea
sea_mask = INBOX & ~land_mask
dist_to_sea_km = distance_transform_edt(~sea_mask) * res / 1000
lbl, _ = ndlabel(land_mask)
# Africa = component under a deep-Sahara probe point
ax, ay = to_lcc.transform(2.0, 30.0)
pi = np.clip(int((maxy - ay) / res), 0, GRID_H - 1)
pj = np.clip(int((ax - minx) / res), 0, GRID_W - 1)
# probe might sit a px outside land after clipping; walk up until we hit the African landmass
while not land_mask[pi, pj] and pi > 0:
    pi -= 1
africa_id = lbl[pi, pj]
africa_deep = (lbl == africa_id) & (dist_to_sea_km > AFRICA_DEPTH_KM)
waste_mask = (germ_mask | africa_deep) & land_mask
play_mask = land_mask & ~waste_mask
from PIL import Image as _I
dbg = np.zeros((GRID_H, GRID_W, 3), dtype=np.uint8)
dbg[land_mask] = (230,225,210); dbg[~land_mask] = (90,120,170); dbg[waste_mask] = (80,80,80)
_I.fromarray(dbg).resize((1300, int(1300*GRID_H/GRID_W))).save('debug_masks.png')
print("playable px:", play_mask.sum(), "| wasteland px:", waste_mask.sum())

# --- seeds in playable land / sea, coastal-weighted ---
def sample_mask(mask, n, coast_boost=None):
    ii, jj = np.nonzero(mask)
    if coast_boost is not None:
        w = 1.0 + 2.2 * np.exp(-coast_boost[ii, jj] / 60.0)
        w /= w.sum()
        idx = rng.choice(len(ii), size=n, replace=False, p=w)
    else:
        idx = rng.choice(len(ii), size=n, replace=False)
    return np.column_stack([jj[idx], ii[idx]]).astype(float)  # (x=col, y=row)

land_seeds = sample_mask(play_mask, N_LAND, coast_boost=dist_to_sea_km)
sea_seeds = sample_mask(sea_mask, N_SEA)

# --- fractal domain warp ---
def fractal(shape, scale_px, octaves=3):
    out = np.zeros(shape, dtype=np.float32)
    amp, sc = 1.0, scale_px
    for _ in range(octaves):
        gw, gh = max(2, int(shape[1] / sc)), max(2, int(shape[0] / sc))
        g = rng.standard_normal((gh, gw)).astype(np.float32)
        out += amp * zoom(g, (shape[0] / gh, shape[1] / gw), order=3)[:shape[0], :shape[1]]
        amp *= 0.5; sc /= 2.1
    return out / np.abs(out).std()

scale_px = WARP_SCALE_KM * 1000 / res
amp_px = WARP_KM * 1000 / res
DX = fractal((GRID_H, GRID_W), scale_px) * amp_px
DY = fractal((GRID_H, GRID_W), scale_px) * amp_px

# --- warped nearest-seed assignment (land & sea separately, 2 Lloyd passes) ---
def assign(seeds, mask):
    ii, jj = np.nonzero(mask)
    q = np.column_stack([jj + DX[ii, jj], ii + DY[ii, jj]])
    _, near = cKDTree(seeds).query(q, workers=-1)
    out = np.full((GRID_H, GRID_W), -1, dtype=np.int32)
    out[ii, jj] = near
    return out

for it in range(2):  # Lloyd on the raster: seeds -> region mean positions
    la = assign(land_seeds, play_mask)
    sa = assign(sea_seeds, sea_mask)
    for seeds, arr, n in ((land_seeds, la, N_LAND), (sea_seeds, sa, N_SEA)):
        ii, jj = np.nonzero(arr >= 0)
        ids = arr[ii, jj]
        sx = np.bincount(ids, weights=jj, minlength=n); sy = np.bincount(ids, weights=ii, minlength=n)
        ct = np.bincount(ids, minlength=n).clip(1)
        seeds[:, 0] = sx / ct; seeds[:, 1] = sy / ct
la = assign(land_seeds, play_mask)
sa = assign(sea_seeds, sea_mask)

# unified id raster: 0 empty, 1..N_LAND land, N_LAND+1.. sea, then wasteland ids
ids = np.zeros((GRID_H, GRID_W), dtype=np.int32)
ids[la >= 0] = la[la >= 0] + 1
ids[sa >= 0] = sa[sa >= 0] + 1 + N_LAND
W_GERM, W_AFR = N_LAND + N_SEA + 1, N_LAND + N_SEA + 2
ids[germ_mask] = W_GERM
ids[africa_deep] = W_AFR

# drop tiny fragments (<6 px) into largest neighbor by dilation vote
from scipy.ndimage import grey_dilation
for _ in range(3):
    counts = np.bincount(ids.ravel())
    tiny = np.isin(ids, np.nonzero((counts > 0) & (counts < 12))[0])
    if not tiny.any(): break
    ids[tiny] = 0
    fill = grey_dilation(ids, size=3)
    ids[tiny] = fill[tiny]

# --- vectorize ---
feats = {}
for geom, val in rasterio.features.shapes(ids, mask=ids > 0, transform=T):
    v = int(val)
    g = make_valid(shp_shape(geom))
    feats.setdefault(v, []).append(g)
provs = {v: make_valid(unary_union(gs)).simplify(res * 1.2) for v, gs in feats.items()}
print("vectorized:", len(provs))

# terrain sampling
src = np.asarray(Image.open(glob.glob('/usr/local/lib/python3*/dist-packages/mpl_toolkits/basemap_data/etopo1.jpg')[0]), dtype=np.float32)
SH, SW = src.shape[:2]
to_geo = Transformer.from_crs(LCC, "EPSG:4326", always_xy=True)
def terrain_at(g):
    pts = [g.representative_point()] + [Point(c) for c in np.array(g.centroid.coords)]
    ss = []
    for p in pts:
        lon, lat = to_geo.transform(p.x, p.y)
        r, gg, b = src[int((90-lat)/180*SH) % SH, int((lon+180)/360*SW) % SW]
        ss.append(max(0.0,(r-gg)/55.0) + max(0.0,(min(r,gg,b)-150)/105.0))
    s = float(np.mean(ss))
    return "mountain" if s > 0.75 else ("hills" if s > 0.3 else "flat")

coast_line = LAND.boundary
features = []
for v, g in sorted(provs.items()):
    if v == W_GERM: props = {"id":"W_GERMANIA","type":"wasteland","terrain":"none","coastal":False}
    elif v == W_AFR: props = {"id":"W_SAHARA","type":"wasteland","terrain":"none","coastal":False}
    elif v <= N_LAND:
        props = {"id":f"L{v:04d}","type":"land","terrain":terrain_at(g),
                 "coastal":bool(g.distance(coast_line) < res)}
    else:
        props = {"id":f"S{v-N_LAND:04d}","type":"sea","terrain":"sea","coastal":False}
    features.append((props, g))

# adjacency straight from the raster (exact, fast)
pairs = set()
a, b = ids[:, :-1], ids[:, 1:]
m = (a != b) & (a > 0) & (b > 0)
pairs |= set(map(tuple, np.unique(np.sort(np.column_stack([a[m], b[m]]), axis=1), axis=0)))
a, b = ids[:-1, :], ids[1:, :]
m = (a != b) & (a > 0) & (b > 0)
pairs |= set(map(tuple, np.unique(np.sort(np.column_stack([a[m], b[m]]), axis=1), axis=0)))
id_of = {v: p["id"] for (p, g), v in zip(features, sorted(provs.keys()))}
adj = sorted((id_of[x], id_of[y]) for x, y in pairs)
print("provinces:", len(features), "| adjacencies:", len(adj))

# outputs
gdf = gpd.GeoDataFrame([p for p, _ in features], geometry=[g for _, g in features], crs=LCC).to_crs(4326)
gdf.to_file("provinces.geojson", driver="GeoJSON")
PW = 2400; pscale = PW / (maxx - minx); PH = (maxy - miny) * pscale
def px_path(geom):
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    d = []
    for p in polys:
        for ring in [p.exterior] + list(p.interiors):
            d.append("M" + "L".join(f"{(x-minx)*pscale:.1f},{PH-(y-miny)*pscale:.1f}" for x, y in ring.coords) + "Z")
    return " ".join(d)
px = {"width": PW, "height": round(PH),
      "provinces": [{**p, "d": px_path(g)} for p, g in features]}
json.dump(px, open("provinces_px.json", "w"))
json.dump(adj, open("adjacency.json", "w"))

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{PW}" height="{PH:.0f}" viewBox="0 0 {PW} {PH:.0f}">',
       f'<rect width="{PW}" height="{PH:.0f}" fill="#4a6fa5"/>']
for p in px["provinces"]:
    if p["type"] == "sea":
        svg.append(f'<path d="{p["d"]}" fill="#4a6fa5" stroke="#3d5d8c" stroke-width="0.5"/>')
for p in px["provinces"]:
    if p["type"] == "wasteland":
        svg.append(f'<path d="{p["d"]}" fill="#5b5b5b" stroke="#4c4c4c" stroke-width="0.6"/>')
for p in px["provinces"]:
    if p["type"] == "land":
        r_, g_, b_ = colorsys.hls_to_rgb(rng.random(), rng.uniform(0.74, 0.88), 0.38)
        col = f'#{int(r_*255):02x}{int(g_*255):02x}{int(b_*255):02x}'
        svg.append(f'<path d="{p["d"]}" fill="{col}" stroke="#5a5f66" stroke-width="0.55"/>')
svg.append('</svg>')
open('provinces_preview.svg','w').write("".join(svg))
import cairosvg; cairosvg.svg2png(url='provinces_preview.svg', write_to='preview_prov2.png', output_width=1700)
print("done")
