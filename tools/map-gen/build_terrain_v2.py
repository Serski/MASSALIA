"""Terrain underlay v2: etopo macro-relief + fractal micro-detail + computed hillshade.
Same frame/pixel space as provinces_px.json; overwrites terrain_px.png."""
import json, glob, numpy as np
import geopandas as gpd
import rasterio.features
from shapely.geometry import box
from shapely.ops import unary_union
from shapely import make_valid
from pyproj import Transformer
from scipy.ndimage import map_coordinates, gaussian_filter, zoom
from rasterio.transform import from_origin
from PIL import Image

rng = np.random.default_rng(5)
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

gy, gx = np.mgrid[0:PH, 0:PW]
X = minx + (gx + 0.5) * res; Y = maxy - (gy + 0.5) * res
tr = Transformer.from_crs(LCC, "EPSG:4326", always_xy=True)
lon = np.empty(X.shape); lat = np.empty(Y.shape)
fx, fy = X.ravel(), Y.ravel(); lo_, la_ = lon.ravel(), lat.ravel()
for i in range(0, fx.size, 800_000):
    a, b = tr.transform(fx[i:i+800_000], fy[i:i+800_000])
    lo_[i:i+800_000] = a; la_[i:i+800_000] = b

src = np.asarray(Image.open(glob.glob('/usr/local/lib/python3*/dist-packages/mpl_toolkits/basemap_data/etopo1.jpg')[0]), dtype=np.float32)
SH, SW = src.shape[:2]
coords = np.vstack([((90 - lat) / 180 * SH).ravel(), ((lon + 180) / 360 * SW).ravel()])
R = map_coordinates(src[:,:,0], coords, order=1).reshape(PH, PW)
G = map_coordinates(src[:,:,1], coords, order=1).reshape(PH, PW)
B = map_coordinates(src[:,:,2], coords, order=1).reshape(PH, PW)
R, G, B = [gaussian_filter(c, 2.0) for c in (R, G, B)]

# macro elevation proxy (0..1), smooth
greenness = np.clip((G - np.maximum(R, B)) / 50.0, 0, 1)
brown = np.clip((R - G) / 55.0, 0, 1)
white = np.clip((np.minimum(np.minimum(R, G), B) - 150) / 105.0, 0, 1)
E = np.clip((1 - greenness) * 0.35 + brown * 0.5 + white * 0.7, 0, 1)
E = gaussian_filter(E, 3.0)

# roughness: where the macro relief is textured, detail is allowed
lum = 0.299*R + 0.587*G + 0.114*B
gxl, gyl = np.gradient(gaussian_filter(lum, 5.0))
rough = gaussian_filter(np.hypot(gxl, gyl), 4.0)
rough = np.clip(rough / np.percentile(rough, 98), 0, 1)

# fractal micro-detail
def fractal(shape, scale_px, octaves=5):
    out = np.zeros(shape, np.float32); amp, sc = 1.0, scale_px
    for _ in range(octaves):
        gw, gh = max(2, int(shape[1]/sc)), max(2, int(shape[0]/sc))
        n = rng.standard_normal((gh, gw)).astype(np.float32)
        out += amp * zoom(n, (shape[0]/gh, shape[1]/gw), order=3)[:shape[0], :shape[1]]
        amp *= 0.55; sc /= 2.2
    return out / np.abs(out).std()

D = fractal((PH, PW), 90.0)
H = E + D * (0.03 + 0.16 * rough * (0.3 + E))   # detail amplitude grows with roughness & height

# hillshade from synthetic heightfield (light from NW)
VERT = 900.0
dzdx = np.gradient(H * VERT, axis=1); dzdy = np.gradient(H * VERT, axis=0)
slope = np.arctan(np.hypot(dzdx, dzdy))
aspect = np.arctan2(-dzdx, dzdy)
az, alt = np.radians(315), np.radians(45)
shade = np.clip(np.sin(alt)*np.cos(slope) + np.cos(alt)*np.sin(slope)*np.cos(az - aspect), 0, 1)
shade = 0.55 + 0.45 * shade   # soften

# hypsometric ramp driven by macro E (keeps colors geographic, not noisy)
STOPS = [(0.00, (168, 191, 138)), (0.18, (186, 202, 143)), (0.34, (208, 205, 152)),
         (0.50, (206, 184, 135)), (0.66, (185, 152, 111)), (0.82, (158, 126, 96)),
         (1.00, (222, 214, 205))]
Ei = np.clip(E, 0, 1)
img = np.zeros((PH, PW, 3), np.float32)
for (e0, c0), (e1, c1) in zip(STOPS[:-1], STOPS[1:]):
    m = (Ei >= e0) & (Ei <= e1)
    t = np.where(m, (Ei - e0) / (e1 - e0 + 1e-9), 0)
    for c in range(3):
        img[:,:,c] += np.where(m, (1-t) * c0[c] + t * c1[c], 0)
img *= shade[..., None]

# sea + out-of-frame
T = from_origin(minx, maxy, res, res)
land_mask = rasterio.features.rasterize([(LAND, 1)], out_shape=(PH, PW), transform=T, fill=0).astype(bool)
inbox = (lon >= BBOX[0]) & (lon <= BBOX[2]) & (lat >= BBOX[1]) & (lat <= BBOX[3])
img[~(land_mask & inbox)] = (116, 154, 189)
# subtle coastal shallow-water tint
from scipy.ndimage import distance_transform_edt
d_off = distance_transform_edt(~(land_mask & inbox))
shallow = np.clip(1 - d_off / 10.0, 0, 1)
sea = ~(land_mask & inbox)
for c, v in enumerate((146, 180, 208)):
    img[:,:,c] = np.where(sea, img[:,:,c] * (1 - shallow) + v * shallow, img[:,:,c])

Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('terrain_px.png')
print('terrain_px.png v2 saved')
