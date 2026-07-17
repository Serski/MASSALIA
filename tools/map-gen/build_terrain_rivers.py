"""Terrain underlay + rivers registered to provinces_px.json pixel space."""
import json, glob, numpy as np
import geopandas as gpd
import shapely, rasterio.features
from shapely.geometry import box, MultiLineString
from shapely.ops import unary_union
from shapely import make_valid
from pyproj import Transformer
from scipy.ndimage import map_coordinates, gaussian_filter
from rasterio.transform import from_origin
from PIL import Image, ImageEnhance

BBOX = (-11.0, 29.0, 20.0, 52.0)
LCC = "+proj=lcc +lat_1=34 +lat_2=48 +lat_0=41 +lon_0=4 +datum=WGS84 +units=m +no_defs"

px_meta = json.load(open('provinces_px.json'))
PW, PH = px_meta["width"], px_meta["height"]

clip_geo = box(*BBOX)
parts = []
for f in ('ne/ne_10m_land.geojson', 'ne/ne_10m_minor_islands.geojson'):
    g = gpd.read_file(f)
    g = gpd.clip(g[g.geometry.notna()], clip_geo).to_crs(LCC)
    parts += [make_valid(x.simplify(500)) for x in g.geometry if not x.is_empty]
LAND = make_valid(unary_union(parts))
minx, miny, maxx, maxy = box(*gpd.GeoSeries([clip_geo], crs=4326).to_crs(LCC).total_bounds).bounds
res = (maxx - minx) / PW

# ---- terrain underlay: reproject etopo RGB into the frame ----
gy, gx = np.mgrid[0:PH, 0:PW]
X = minx + (gx + 0.5) * res
Y = maxy - (gy + 0.5) * res
tr = Transformer.from_crs(LCC, "EPSG:4326", always_xy=True)
lon = np.empty(X.shape, np.float64); lat = np.empty(Y.shape, np.float64)
fx, fy = X.ravel(), Y.ravel(); lo_, la_ = lon.ravel(), lat.ravel()
for i in range(0, fx.size, 800_000):
    a, b = tr.transform(fx[i:i+800_000], fy[i:i+800_000])
    lo_[i:i+800_000] = a; la_[i:i+800_000] = b

src = np.asarray(Image.open(glob.glob('/usr/local/lib/python3*/dist-packages/mpl_toolkits/basemap_data/etopo1.jpg')[0]), dtype=np.float32)
SH, SW = src.shape[:2]
coords = np.vstack([((90 - lat) / 180 * SH).ravel(), ((lon + 180) / 360 * SW).ravel()])
rgb = np.stack([map_coordinates(src[:,:,c], coords, order=1, mode='nearest').reshape(PH, PW) for c in range(3)], -1)
rgb = gaussian_filter(rgb, (1.2, 1.2, 0))  # soften jpeg blocks

img = Image.fromarray(rgb.astype(np.uint8))
img = ImageEnhance.Color(img).enhance(1.15)
img = ImageEnhance.Brightness(img).enhance(1.06)

# flat sea + inbox mask
T = from_origin(minx, maxy, res, res)
land_mask = rasterio.features.rasterize([(LAND, 1)], out_shape=(PH, PW), transform=T, fill=0).astype(bool)
inbox = (lon >= BBOX[0]) & (lon <= BBOX[2]) & (lat >= BBOX[1]) & (lat <= BBOX[3])
arr = np.asarray(img).copy()
arr[~(land_mask & inbox)] = (116, 154, 189)   # sea / out-of-frame
Image.fromarray(arr).save('terrain_px.png')
print('terrain_px.png', arr.shape)

# ---- rivers in px space ----
riv_parts = []
for f in ('ne/ne_10m_rivers_lake_centerlines.geojson', 'ne/ne_10m_rivers_europe.geojson'):
    g = gpd.read_file(f)
    g = g[g.geometry.notna()]
    if "scalerank" in g.columns:
        g = g[g.scalerank <= 9]
    g = gpd.clip(g, clip_geo).to_crs(LCC)
    g["geometry"] = g.geometry.simplify(400)
    riv_parts += [x for x in g.geometry if not x.is_empty]

def px_line(geom):
    lines = geom.geoms if isinstance(geom, MultiLineString) else [geom]
    return " ".join("M" + "L".join(
        f"{(x-minx)/res:.1f},{(maxy-y)/res:.1f}" for x, y in l.coords) for l in lines)

rivers = [px_line(g) for g in riv_parts]
json.dump({"width": PW, "height": PH, "rivers": rivers}, open('rivers_px.json', 'w'))
print('rivers:', len(rivers))

# ---- composite preview: terrain + 55% province fills + rivers ----
import base64, colorsys, cairosvg
rng = np.random.default_rng(7)
b64 = base64.b64encode(open('terrain_px.png','rb').read()).decode()
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{PW}" height="{PH}" viewBox="0 0 {PW} {PH}">',
       f'<image href="data:image/png;base64,{b64}" width="{PW}" height="{PH}"/>']
for p in px_meta["provinces"]:
    if p["type"] == "wasteland":
        svg.append(f'<path d="{p["d"]}" fill="#3f3f3f" fill-opacity="0.55" stroke="#333" stroke-width="0.5"/>')
    elif p["type"] == "land":
        r_, g_, b_ = colorsys.hls_to_rgb(rng.random(), rng.uniform(0.6, 0.75), 0.45)
        col = f'#{int(r_*255):02x}{int(g_*255):02x}{int(b_*255):02x}'
        svg.append(f'<path d="{p["d"]}" fill="{col}" fill-opacity="0.45" stroke="#f2efe6" stroke-opacity="0.7" stroke-width="0.7"/>')
svg.append('<g fill="none" stroke="#5e8fbf" stroke-width="1.0" stroke-linecap="round" stroke-opacity="0.9">')
for d in rivers:
    svg.append(f'<path d="{d}"/>')
svg.append('</g></svg>')
open('composite.svg','w').write("".join(svg))
cairosvg.svg2png(url='composite.svg', write_to='preview_composite.png', output_width=1700)
print('done')
