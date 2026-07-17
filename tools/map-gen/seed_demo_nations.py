"""Seed MASSALIA demo-map polities + towns into the province dataset.
Real oppida use known coordinates; fictional towns are estimated from the
demo map's placement and flagged approx:true for Argiris to correct."""
import json, numpy as np
import geopandas as gpd
from pyproj import Transformer

LCC = "+proj=lcc +lat_1=34 +lat_2=48 +lat_0=41 +lon_0=4 +datum=WGS84 +units=m +no_defs"
to_lcc = Transformer.from_crs("EPSG:4326", LCC, always_xy=True)

POLITIES = {  # id: (display name, color from demo map palette, anchor lon, lat)
 "massalia":   ("Massalia",   "#d4a24a", 5.37, 43.30),
 "saluvii":    ("Saluvii",    "#6b4f5b", 5.60, 43.65),
 "ligurians":  ("Ligurians",  "#7d5a6b", 8.30, 44.30),
 "elisyces":   ("Elisyces",   "#75566b", 2.95, 43.15),   # purple enclave at Montlares/Pech Maho (unlabeled on demo map — rename freely)
 "volcae":     ("Volcae",     "#3e5e3a", 2.20, 43.55),
 "cavares":    ("Cavares",    "#57764d", 4.85, 44.15),
 "vocontii":   ("Vocontii",   "#42603d", 5.45, 44.45),
 "helvii":     ("Helvii",     "#5d7a52", 4.40, 44.70),
 "allobriges": ("Allobriges", "#68855c", 5.95, 45.30),
 "veltanii":   ("Veltanii",   "#4c6b45", 3.90, 44.80),
 "gabati":     ("Gabati",     "#5a7850", 3.60, 44.25),
 "ruteni":     ("Ruteni",     "#637f56", 2.60, 44.35),
 "cadurci":    ("Cadurci",    "#6e8a60", 1.90, 44.70),
 "trusates":   ("Trusates",   "#607c54", 0.55, 44.05),
 "ausci":      ("Ausci",      "#6a865c", 0.60, 43.60),
 "convenae":   ("Convenae",   "#597550", 0.60, 43.10),
 "llergetae":  ("Llergetae",  "#7a8a55", 1.00, 41.80),
 "lacetani":   ("Lacetani",   "#84925e", 1.80, 41.95),
}

TOWNS = [  # name, lon, lat, polity, approx
 ("Massalia", 5.37, 43.30, "massalia", False),
 ("Arelate", 4.63, 43.68, "massalia", False),
 ("Agathe", 3.46, 43.31, "massalia", False),
 ("Olbia", 6.13, 43.09, "massalia", False),
 ("Athinopolis", 6.55, 43.28, "massalia", True),
 ("Antipolis", 7.13, 43.58, "massalia", False),
 ("Nikaia", 7.27, 43.70, "massalia", False),
 ("Monoikos", 7.42, 43.73, "massalia", False),
 ("Rhoda", 3.18, 42.26, "massalia", False),
 ("Emporion", 3.12, 42.13, "massalia", False),
 ("Philonis", 2.82, 41.68, "massalia", True),
 ("Aleria", 9.51, 42.10, "massalia", False),
 ("Herouxopolis", 9.35, 42.95, "massalia", True),
 ("Entermont", 5.44, 43.55, "saluvii", False),
 ("Stalia", 8.55, 44.33, "ligurians", True),
 ("Montlares", 3.00, 43.21, "elisyces", False),
 ("Pechmaho", 2.98, 43.03, "elisyces", False),
 ("Nemausus", 4.36, 43.84, "volcae", False),
 ("Mailhac", 2.83, 43.30, "volcae", False),
 ("Carsac", 2.32, 43.19, "volcae", False),
 ("Tolosa", 1.44, 43.60, "volcae", False),
 ("Albi", 2.15, 43.93, "volcae", False),
 ("Vaison", 5.07, 44.24, "cavares", False),
 ("Velleron", 4.96, 43.96, "cavares", False),
 ("Arnaud", 5.50, 44.42, "vocontii", True),
 ("Ramasse", 3.55, 44.32, "gabati", True),
]

REGION = (-0.6, 41.2, 10.2, 45.6)  # demo map's coverage; outside stays unclaimed
COAST_STRIP_KM = 34                 # Massaliote/Elisyces enclaves hug their towns

geo = gpd.read_file('provinces.geojson')
land = geo[geo["type"] == "land"].to_crs(LCC)
cent = land.geometry.representative_point()
cx, cy = np.array([p.x for p in cent]), np.array([p.y for p in cent])

anchors = {k: to_lcc.transform(v[2], v[3]) for k, v in POLITIES.items()}
town_pts = {"massalia": [], "elisyces": []}
for n, lon, lat, pol, ap in TOWNS:
    if pol in town_pts:
        town_pts[pol].append(to_lcc.transform(lon, lat))

# region mask in geo coords
g4326 = geo[geo["type"] == "land"]
c4326 = g4326.geometry.representative_point()
in_region = np.array([(REGION[0] <= p.x <= REGION[2]) and (REGION[1] <= p.y <= REGION[3]) for p in c4326])

owners = {}
tribe_ids = [k for k in POLITIES if k not in ("massalia", "elisyces")]
A = np.array([anchors[k] for k in tribe_ids])
for i, pid in enumerate(land["id"].values):
    if not in_region[i]:
        continue
    lonlat = c4326.iloc[i]
    corsica = lonlat.x > 8.4 and lonlat.y < 43.4
    p = np.array([cx[i], cy[i]])
    # coastal-enclave polities claim provinces near their towns first
    claimed = None
    for pol, pts in town_pts.items():
        if pts and min(np.hypot(*(np.array(pts) - p).T)) < COAST_STRIP_KM * 1000:
            claimed = pol; break
    if claimed is None:
        if corsica:
            continue  # Corsica stays unclaimed except Massaliote enclaves
        claimed = tribe_ids[int(np.argmin(np.hypot(*(A - p).T)))]
    owners[pid] = claimed

json.dump({k: {"name": v[0], "color": v[1]} for k, v in POLITIES.items()},
          open('polities.json', 'w'), indent=1)
json.dump(owners, open('owners_seed.json', 'w'))

# towns in px space
px_meta = json.load(open('provinces_px.json'))
PW, PH = px_meta["width"], px_meta["height"]
import shapely
from shapely.geometry import box
BBOX = (-11.0, 29.0, 20.0, 52.0)
minx, miny, maxx, maxy = box(*gpd.GeoSeries([box(*BBOX)], crs=4326).to_crs(LCC).total_bounds).bounds
res = (maxx - minx) / PW
towns_out = []
for n, lon, lat, pol, ap in TOWNS:
    x, y = to_lcc.transform(lon, lat)
    towns_out.append({"name": n, "lon": lon, "lat": lat, "polity": pol, "approx": ap,
                      "x": round((x - minx) / res, 1), "y": round((maxy - y) / res, 1)})
json.dump({"width": PW, "height": PH, "towns": towns_out}, open('towns_px.json', 'w'), indent=1)
from collections import Counter
print("owned provinces:", len(owners), Counter(owners.values()).most_common(6))
print("towns:", len(towns_out))
