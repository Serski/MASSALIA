#!/usr/bin/env python3
"""Deterministic generator for the hand-drawn MASSALIA world map ("world2").

Reads three committed source copies under ``tools/map-gen/sources/`` (never the
originals on the Desktop) and emits, into ``apps/web/public/map2/``:

  * ``terrain2.webp``  -- full-resolution terrain underlay (lossy WebP q95)
  * ``world2.json``    -- region geometry, towns, adjacency

Pipeline (all coordinates live in the source 3126x2696 pixel space):

  1. Land mask + town markers from ``MASS_BASE01.psd``.
  2. Black land-walls and blue sea-walls from the flattened ``MASS_BASE01.png``.
  3. Land regions: flood (land minus dilated walls), keep components >= 1500 px,
     then nearest-assign every remaining land pixel so land tiles exactly once.
     Regions whose seed component exceeds 300000 px are typed ``fog`` (exactly 2).
  4. Sea zones: the same on the sea side with the blue walls, threshold 3000 px.
  5. Trace every region to an SVG path (find_contours + approximate_polygon),
     validated with shapely; a failed region is retraced at a finer tolerance.
  6. Adjacency (>= 6 px shared border) within the land partition and within the
     sea partition; a coastal flag from >= 6 px of land/sea contact.
  7. Terrain -> terrain2.webp (copied straight from the terrain PNG, never the PSD).

The run aborts with a report if any validation gate fails. It is fully
deterministic: no randomness, and every ordering has an explicit tiebreak.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from scipy import ndimage
from skimage.measure import approximate_polygon, find_contours
from skimage.segmentation import watershed
from shapely.geometry import Polygon

# --- Paths -------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).resolve().parent / "sources"
PSD_PATH = SRC / "MASS_BASE01.psd"
FLAT_PATH = SRC / "MASS_BASE01.png"
TERRAIN_PATH = SRC / "MASS_BASE01_TERRAIN_25D.png"
OUT_DIR = ROOT / "apps" / "web" / "public" / "map2"
TERRAIN_OUT = OUT_DIR / "terrain2.webp"
JSON_OUT = OUT_DIR / "world2.json"

W, H = 3126, 2696

# --- Tunables (from the task spec) -------------------------------------------
LAND_ALPHA = 60            # land = alpha > 60 of layer "02_land.png"
LAND_MIN_PX = 1500         # min seed-component size for a land region
SEA_MIN_PX = 3000          # min seed-component size for a sea zone
FOG_MIN_PX = 300000        # a land seed component above this is "fog"
BORDER_MIN_PX = 6          # min shared border for adjacency / coastal contact
APPROX_TOL = 1.2           # polygon simplification tolerance, px
RETRACE_TOLS = [0.8, 0.5, 0.3, 0.0]  # finer retraces when shapely rejects a region
COORD_DP = 1               # SVG coordinate decimal places
CHAIKIN_ITERS = 2          # Chaikin corner-cutting smoothing passes per region
ID_MATCH_PX = 5.0          # max centroid drift when inheriting ids from old world2.json

STRUCT4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)  # 4-connectivity

# Explicit town id/display mapping. Keys are PSD layer names.
TOWN_ID_OVERRIDE = {"Olbia": "olbia-provence", "Olbia Sard": "olbia-sardinia"}
TOWN_DISPLAY_OVERRIDE = {
    "Olbia Sard": "Olbia",
    "Argigentum": "Agrigentum",
    "Arriminium": "Ariminum",
    "Logdunum": "Lugdunum",
}


def slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def flatten_over_white(path) -> "Image.Image":
    """Open a raster as RGBA and alpha-composite it over an opaque white
    background, returning an RGB image.

    MASS_BASE01.png is RGBA with large fully-transparent areas whose stored RGB
    is near-black. A plain ``.convert("RGB")`` keeps those invisible near-black
    values, which then read as phantom ink/walls and destroy the drawn regions.
    Compositing over white first makes only *visible* pixels count.
    """
    img = Image.open(str(path)).convert("RGBA")
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    return Image.alpha_composite(background, img).convert("RGB")


# --- Report scaffolding ------------------------------------------------------
REPORT: list[str] = []
FAILURES: list[str] = []


def say(line: str = "") -> None:
    print(line)
    REPORT.append(line)


def fail(line: str) -> None:
    FAILURES.append(line)
    say("GATE FAILED: " + line)


# --- 1. Land mask + towns from the PSD ---------------------------------------
def load_land_and_towns():
    psd = PSDImage.open(str(PSD_PATH))
    if psd.size != (W, H):
        raise SystemExit(f"PSD size {psd.size} != expected {(W, H)}")

    def find_layer(layers, name):
        for layer in layers:
            if layer.name == name:
                return layer
            if layer.is_group():
                hit = find_layer(layer, name)
                if hit is not None:
                    return hit
        return None

    def find_group(layers, name):
        for layer in layers:
            if layer.is_group():
                if layer.name == name:
                    return layer
                hit = find_group(layer, name)
                if hit is not None:
                    return hit
        return None

    land_layer = find_layer(psd, "02_land.png")
    if land_layer is None:
        raise SystemExit('PSD layer "02_land.png" not found')
    comp = np.array(land_layer.composite(viewport=(0, 0, W, H)))
    alpha = comp[..., 3] if comp.shape[-1] == 4 else np.full((H, W), 255, np.uint8)
    land = alpha > LAND_ALPHA

    group = find_group(psd, "TOWN DOTS")
    if group is None:
        raise SystemExit('PSD group "TOWN DOTS" not found')
    shapes = [layer for layer in group if layer.kind == "shape"]

    towns = []
    for layer in shapes:
        left, top, right, bottom = layer.bbox
        cx = (left + right) / 2.0
        cy = (top + bottom) / 2.0
        town_id = TOWN_ID_OVERRIDE.get(layer.name, slugify(layer.name))
        display = TOWN_DISPLAY_OVERRIDE.get(layer.name, layer.name)
        towns.append({"id": town_id, "name": display, "x": cx, "y": cy, "layer": layer.name})
    return land, towns


# --- 2. Walls from the flattened PNG -----------------------------------------
def load_walls():
    flat = np.array(flatten_over_white(FLAT_PATH))
    if flat.shape[:2] != (H, W):
        raise SystemExit(f"Flattened PNG size {flat.shape[:2]} != expected {(H, W)}")
    r = flat[..., 0].astype(int)
    g = flat[..., 1].astype(int)
    b = flat[..., 2].astype(int)
    spread = flat.max(axis=2).astype(int) - flat.min(axis=2).astype(int)
    land_wall = (r < 95) & (g < 95) & (b < 105) & (spread < 40)
    sea_wall = (b > 130) & (b - r > 45) & (b - g > 25) & (r < 160)
    return land_wall, sea_wall


# --- 3/4. Partition a domain into regions ------------------------------------
def partition(domain: np.ndarray, wall: np.ndarray, min_px: int):
    """Return (label image, seed_area per label 1..K) for a boolean domain.

    Flood ``domain`` minus the 1px-dilated walls (4-connectivity), keep
    components >= ``min_px`` as regions, then fill every remaining domain pixel
    so the domain is tiled exactly once. The fill is a marker watershed over the
    distance-to-seed landscape (connectivity 1): each region grows nearest-first
    but stays connected, so walls and slivers never scatter a region across a
    barrier the way a raw Voronoi nearest-assignment does. Isolated landmasses
    with no seed of their own (small offshore islands) are then attached whole to
    the euclidean-nearest region, which the tracer emits as a multi-part path.
    """
    wall_d = ndimage.binary_dilation(wall, STRUCT4, iterations=1)
    seed = domain & ~wall_d
    lbl, n = ndimage.label(seed, structure=STRUCT4)
    if n == 0:
        return np.zeros(domain.shape, dtype=np.int32), {}
    sizes = ndimage.sum(np.ones_like(lbl, dtype=np.int64), lbl, index=np.arange(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= min_px]

    # Relabel kept components to a dense 1..K, ordered by descending seed size so
    # the mapping is stable regardless of scan order.
    keep_sorted = sorted(keep, key=lambda i: (-int(sizes[i - 1]), i))
    remap = np.zeros(n + 1, dtype=np.int32)
    seed_area = {}
    for new_id, old in enumerate(keep_sorted, start=1):
        remap[old] = new_id
        seed_area[new_id] = int(sizes[old - 1])
    seeds = remap[lbl].astype(np.int32)  # 0 where not a kept region

    # Connectivity-preserving nearest fill within the domain.
    dist = ndimage.distance_transform_edt(seeds == 0)
    labels = watershed(dist, markers=seeds, mask=domain, connectivity=1).astype(np.int32)

    # Attach any isolated (seedless) landmass whole to its nearest region.
    unassigned = domain & (labels == 0)
    if unassigned.any():
        ind = ndimage.distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
        nearest = labels[tuple(ind)]
        ulbl, un = ndimage.label(unassigned, structure=STRUCT4)
        for i in range(1, un + 1):
            comp = ulbl == i
            vals = nearest[comp]
            vals = vals[vals > 0]
            if vals.size == 0:
                continue
            labels[comp] = int(np.bincount(vals).argmax())
    return labels, seed_area


# --- 5. Trace a region mask to an SVG path -----------------------------------
def chaikin_closed(ring, iterations: int):
    """Chaikin corner-cutting on a closed ring (open list of unique vertices,
    no closing duplicate). Returns a new open list of smoothed vertices."""
    pts = ring
    for _ in range(iterations):
        n = len(pts)
        out = []
        for i in range(n):
            ax, ay = pts[i]
            bx, by = pts[(i + 1) % n]
            out.append((0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by))
            out.append((0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by))
        pts = out
    return pts


def _ring_to_open(points):
    """Round to COORD_DP, drop consecutive duplicates, and strip a closing
    duplicate. Returns an open list of (x, y) tuples (no repeated first point)."""
    out = []
    for x, y in points:
        p = (round(float(x), COORD_DP), round(float(y), COORD_DP))
        if not out or out[-1] != p:
            out.append(p)
    if len(out) >= 2 and out[0] == out[-1]:
        out.pop()
    return out


def _subpath(open_ring):
    return "M" + " L".join(f"{x},{y}" for x, y in open_ring) + " Z"


def path_vertices_mean(path: str):
    """Mean of every vertex in an SVG path (all sub-rings). Used for id
    inheritance: the pre-smoothing path is generated identically to the old
    world2.json path, so identical geometry yields an identical centroid."""
    xs, ys = [], []
    for sub in path.split("M"):
        sub = sub.strip()
        if not sub:
            continue
        for tok in sub.replace("Z", "").split("L"):
            tok = tok.strip()
            if not tok:
                continue
            x, y = tok.split(",")
            xs.append(float(x))
            ys.append(float(y))
    if not xs:
        return (0.0, 0.0)
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def trace_region(mask: np.ndarray, ox: int, oy: int):
    """Return (svg_path, ok, used_tol, raw_path) for a bbox-cropped region
    ``mask`` whose top-left maps to source pixel (ox, oy).

    Pads the mask so edge-touching regions still close, traces every contour
    ring, simplifies (approximate_polygon), applies a Chaikin corner-cutting
    smoothing pass, and validates the smoothed rings with shapely; retraces at
    finer tolerances if any ring is invalid. ``raw_path`` is the pre-smoothing
    path — generated exactly as the old pipeline did, so it anchors stable ids.
    """
    padded = np.pad(mask.astype(float), 1, mode="constant", constant_values=0)
    contours = find_contours(padded, 0.5)
    if not contours:
        return "", False, None, ""

    def simplify(tol):
        """Simplified open rings at ``tol``, or None if any ring is invalid."""
        rings = []
        for contour in contours:
            approx = approximate_polygon(contour, tolerance=tol) if tol > 0 else contour
            # padded-crop (row, col) -> source (x, y): x = col-1+ox, y = row-1+oy.
            pts = [(round(float(c - 1 + ox), COORD_DP), round(float(r - 1 + oy), COORD_DP)) for r, c in approx]
            if pts and pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) < 3:
                continue
            if Polygon(pts + [pts[0]]).is_empty or not Polygon(pts + [pts[0]]).is_valid:
                return None
            rings.append(pts)
        return rings or None

    tols = [APPROX_TOL] + RETRACE_TOLS

    # Phase A: the pre-smoothing rings at the first valid tolerance. This is
    # exactly what the old pipeline emitted, so its centroid anchors the region's
    # stable id independently of any smoothing retrace below.
    raw_rings = raw_idx = None
    for i, tol in enumerate(tols):
        rings = simplify(tol)
        if rings is not None:
            raw_rings, raw_idx = rings, i
            break
    if raw_rings is None:
        return "", False, None, ""
    raw_path = " ".join(_subpath(ring) for ring in raw_rings)

    # Phase B: Chaikin-smoothed rings, re-validated with shapely. Start from the
    # raw tolerance and only step finer if smoothing breaks validity.
    for i in range(raw_idx, len(tols)):
        rings = raw_rings if i == raw_idx else simplify(tols[i])
        if rings is None:
            continue
        smoothed = []
        smooth_ok = True
        for ring in rings:
            open_ring = _ring_to_open(chaikin_closed(ring, CHAIKIN_ITERS))
            if len(open_ring) < 3 or Polygon(open_ring + [open_ring[0]]).is_empty or not Polygon(open_ring + [open_ring[0]]).is_valid:
                smooth_ok = False
                break
            smoothed.append(open_ring)
        if smooth_ok:
            return " ".join(_subpath(ring) for ring in smoothed), True, tols[i], raw_path

    # Smoothing never validated (extremely rare): keep the valid unsmoothed path.
    return raw_path, True, tols[raw_idx], raw_path


def inherit_region_ids(regions, old_provinces):
    """Give each new region the id of the old region whose centroid it matches
    one-to-one within ID_MATCH_PX, and reuse it. Records problems via fail() and
    returns the maximum matched centroid drift (px)."""
    old = [(p["id"], p["type"], path_vertices_mean(p["path"])) for p in old_provinces]
    if len(regions) != len(old):
        fail(f"region count {len(regions)} != old world2.json {len(old)}; cannot inherit ids one-to-one")
    used: dict = {}
    unmatched = []
    max_drift = 0.0
    for rec in regions:
        nx, ny = path_vertices_mean(rec["raw_path"])
        best_id, best_type, best_d = None, None, None
        for oid, otype, (ox_c, oy_c) in old:
            d = ((nx - ox_c) ** 2 + (ny - oy_c) ** 2) ** 0.5
            if best_d is None or d < best_d:
                best_d, best_id, best_type = d, oid, otype
        if best_d is None or best_d > ID_MATCH_PX:
            unmatched.append((rec, best_id, best_d))
            continue
        if best_id in used:
            fail(f"old id {best_id} matched by two new regions (not one-to-one)")
        used[best_id] = rec
        rec["id"] = best_id
        max_drift = max(max_drift, best_d)
        if best_type != rec["type"]:
            fail(f"region inherited id {best_id} but type {rec['type']} != old {best_type}")
    for rec, bid, bd in unmatched:
        drift = "n/a" if bd is None else f"{bd:.2f}px"
        fail(f"new region {rec['partition']}#{rec['local']} has no old centroid within "
             f"{ID_MATCH_PX}px (nearest {bid} at {drift})")
    for oid, _, _ in old:
        if oid not in used:
            fail(f"old id {oid} not inherited by any new region")
    return max_drift


# --- 6. Adjacency & coastal --------------------------------------------------
def contact_counts(glbl: np.ndarray):
    """Count 4-neighbour pixel-edge contacts between differing nonzero labels.

    Returns dict {(a, b): count} with a < b. Count approximates shared border
    length in pixels."""
    counts: dict[tuple[int, int], int] = {}

    def tally(u, v):
        m = (u != v) & (u != 0) & (v != 0)
        if not m.any():
            return
        a = np.minimum(u[m], v[m])
        b = np.maximum(u[m], v[m])
        keys = a.astype(np.int64) * (1 << 20) + b.astype(np.int64)
        uniq, cnt = np.unique(keys, return_counts=True)
        for k, c in zip(uniq.tolist(), cnt.tolist()):
            pair = (int(k >> 20), int(k & ((1 << 20) - 1)))
            counts[pair] = counts.get(pair, 0) + c

    tally(glbl[:, :-1], glbl[:, 1:])   # horizontal neighbours
    tally(glbl[:-1, :], glbl[1:, :])   # vertical neighbours
    return counts


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    say("=== MASSALIA world2 generator ===")
    say(f"sources: {SRC}")

    # Load the existing world2.json up front (before it is overwritten) so region
    # ids can be inherited from it.
    if not JSON_OUT.exists():
        say("ABORT: existing world2.json not found; id inheritance requires it.")
        return 1
    old_provinces = json.loads(JSON_OUT.read_text())["provinces"]
    say(f"old world2.json: {len(old_provinces)} provinces (for id inheritance)")

    land, towns = load_land_and_towns()
    say(f"land pixels: {int(land.sum())} ({land.sum() / (W * H):.3f} of canvas)")
    say(f"town shapes: {len(towns)}")

    land_wall, sea_wall = load_walls()
    say(f"land-wall pixels: {int(land_wall.sum())}   sea-wall pixels: {int(sea_wall.sum())}")

    # --- Land partition ------------------------------------------------------
    land_lbl, land_seed_area = partition(land, land_wall, LAND_MIN_PX)
    land_ids = sorted(land_seed_area.keys())
    fog_ids = {i for i in land_ids if land_seed_area[i] > FOG_MIN_PX}
    say(f"land seed regions: {len(land_ids)}  (fog among them: {len(fog_ids)})")
    top_sizes = sorted(land_seed_area.values(), reverse=True)[:5]
    say(f"top land seed sizes: {top_sizes}")

    # --- Sea partition -------------------------------------------------------
    sea = ~land
    sea_lbl, sea_seed_area = partition(sea, sea_wall, SEA_MIN_PX)
    sea_ids = sorted(sea_seed_area.keys())
    say(f"sea seed zones: {len(sea_ids)}")

    # --- Assemble region records (local indexing before final R-id order) ----
    regions = []  # {kind: land|sea, local, type, mask-lazy}
    for i in land_ids:
        regions.append({"partition": "land", "local": i,
                        "type": "fog" if i in fog_ids else "land"})
    for i in sea_ids:
        regions.append({"partition": "sea", "local": i, "type": "sea"})

    def region_mask(rec):
        return (land_lbl == rec["local"]) if rec["partition"] == "land" else (sea_lbl == rec["local"])

    # Per-label bounding boxes (fast crop for tracing / connectivity).
    land_bbox = ndimage.find_objects(land_lbl)
    sea_bbox = ndimage.find_objects(sea_lbl)
    # A pixel is sea iff it carries a sea label (land + sea tile the canvas exactly).
    sea_assigned_mask = sea_lbl > 0

    # Areas, centroids, connectivity check, traced paths.
    retraces = []
    for rec in regions:
        sl = (land_bbox if rec["partition"] == "land" else sea_bbox)[rec["local"] - 1]
        oy, ox = sl[0].start, sl[1].start
        sub = region_mask(rec)[sl]
        rec["area"] = int(sub.sum())
        ys, xs = np.nonzero(sub)
        rec["cx"], rec["cy"] = float(xs.mean() + ox), float(ys.mean() + oy)
        comp_lbl, ncc = ndimage.label(sub, structure=STRUCT4)
        rec["components"] = ncc
        path, ok, tol, raw_path = trace_region(sub, ox, oy)
        rec["path"] = path
        rec["raw_path"] = raw_path
        if not ok:
            fail(f"could not trace region {rec['partition']}#{rec['local']} to a valid polygon")
        elif tol != APPROX_TOL:
            retraces.append((rec, tol))
        # Disconnected playable-land gate. A single component is always fine.
        # Extra components are only allowed when they are genuine offshore islands
        # (every pixel bordering the extra component is sea, never other land) —
        # legitimate multi-part membership. A component touching other land would
        # mean the fill split contiguous land, which is the artifact we forbid.
        if rec["type"] == "land" and ncc != 1:
            main = 1 + int(np.argmax([int((comp_lbl == c).sum()) for c in range(1, ncc + 1)]))
            for c in range(1, ncc + 1):
                if c == main:
                    continue
                comp_full = np.zeros((H, W), dtype=bool)
                comp_full[sl] = comp_lbl == c
                ring = ndimage.binary_dilation(comp_full, STRUCT4, 1) & ~comp_full
                # ring must be entirely sea (or canvas edge) for a legitimate island
                if int((ring & ~sea_assigned_mask).sum()) > 0:
                    fail(f"playable land region {rec['partition']}#{rec['local']} has a component "
                         f"joined to other land (fill artifact)")
                    break

    # --- Inherit stable region ids from the existing world2.json --------------
    # Region ids must not change: politics2.json references them. The partition is
    # unchanged, so each new region's pre-smoothing centroid coincides with an old
    # region's; match one-to-one within ID_MATCH_PX and reuse the old id.
    max_drift = inherit_region_ids(regions, old_provinces)
    say(f"id inheritance: {len(regions)} regions matched to old ids, "
        f"max centroid drift {max_drift:.3f}px")

    # Output order: type (land, sea, fog) then centroid (y, x). Ids stay inherited.
    type_rank = {"land": 0, "sea": 1, "fog": 2}
    regions.sort(key=lambda r: (type_rank[r["type"]], round(r["cy"], 3), round(r["cx"], 3), r["partition"], r["local"]))

    # Global label image for adjacency (unique index per region across both partitions).
    gid = {}
    glbl = np.zeros((H, W), dtype=np.int32)
    for k, rec in enumerate(regions, start=1):
        gid[rec["id"]] = k
        glbl[region_mask(rec)] = k
    inv_gid = {v: k for k, v in gid.items()}
    partition_of = {rec["id"]: rec["partition"] for rec in regions}

    counts = contact_counts(glbl)
    neighbors = {rec["id"]: set() for rec in regions}
    coastal = {rec["id"]: False for rec in regions}
    for (a, b), c in counts.items():
        ida, idb = inv_gid[a], inv_gid[b]
        pa, pb = partition_of[ida], partition_of[idb]
        if pa == pb:
            if c >= BORDER_MIN_PX:
                neighbors[ida].add(idb)
                neighbors[idb].add(ida)
        else:  # land partition vs sea partition -> coastline
            if c >= BORDER_MIN_PX:
                land_side = ida if pa == "land" else idb
                sea_side = idb if pa == "land" else ida
                coastal[land_side] = True
                coastal[sea_side] = True

    # --- Town assignment (+ snap) --------------------------------------------
    land_region_at = {}  # local land label -> region id, only for type land
    for rec in regions:
        if rec["partition"] == "land":
            land_region_at[rec["local"]] = rec["id"]
    playable_local = {rec["local"] for rec in regions if rec["type"] == "land"}
    town_of_region: dict[str, list[str]] = {rec["id"]: [] for rec in regions}
    snaps = []

    def nearest_playable_pixel(px, py, radius=BORDER_MIN_PX):
        best = None
        for rr in range(radius + 1):
            y0, y1 = max(0, py - rr), min(H - 1, py + rr)
            x0, x1 = max(0, px - rr), min(W - 1, px + rr)
            window = land_lbl[y0:y1 + 1, x0:x1 + 1]
            ys, xs = np.nonzero(np.isin(window, list(playable_local)))
            if len(xs) == 0:
                continue
            wy, wx = ys + y0, xs + x0
            d2 = (wx - px) ** 2 + (wy - py) ** 2
            j = int(np.argmin(d2))
            return int(wx[j]), int(wy[j])
        return best

    for town in towns:
        px, py = int(round(town["x"])), int(round(town["y"]))
        px = min(max(px, 0), W - 1)
        py = min(max(py, 0), H - 1)
        local = int(land_lbl[py, px])
        on_playable = local in playable_local
        if not on_playable:
            snap = nearest_playable_pixel(px, py, BORDER_MIN_PX)
            if snap is None:
                reason = "sea/fog/wall"
                if local == 0:
                    reason = "wall/sea" if not land[py, px] else "wall"
                elif local not in playable_local:
                    reason = "fog" if land[py, px] else "sea"
                fail(f"town {town['id']} at ({px},{py}) is in {reason} with no land region within "
                     f"{BORDER_MIN_PX}px")
                town["region"] = None
                continue
            sx, sy = snap
            snaps.append({"id": town["id"], "from": [px, py], "to": [sx, sy],
                          "dist": round(((sx - px) ** 2 + (sy - py) ** 2) ** 0.5, 2)})
            local = int(land_lbl[sy, sx])
        region_id = land_region_at[local]
        town["region"] = region_id
        town_of_region[region_id].append(town["id"])

    # --- Validation gates ----------------------------------------------------
    say("")
    say("--- validation gates ---")

    # towns: 105, unique ids, each in exactly one land (playable) region
    ids = [t["id"] for t in towns]
    if len(towns) != 105:
        fail(f"town count {len(towns)} != 105")
    if len(set(ids)) != len(ids):
        dups = sorted({i for i in ids if ids.count(i) > 1})
        fail(f"duplicate town ids: {dups}")
    assigned = [t for t in towns if t.get("region")]
    say(f"towns assigned to a land region: {len(assigned)}/{len(towns)}")
    if len(assigned) != len(towns):
        fail(f"{len(towns) - len(assigned)} town(s) not placed in a land region")
    for t in towns:
        if t.get("region") is None:
            continue
        rtype = next(r["type"] for r in regions if r["id"] == t["region"])
        if rtype != "land":
            fail(f"town {t['id']} assigned to non-land region {t['region']} ({rtype})")
    max_snap = max((s["dist"] for s in snaps), default=0.0)
    say(f"town snaps: {len(snaps)}, max {max_snap}px")
    if max_snap > 7:
        fail(f"town snap distance {max_snap}px exceeds 7px")

    # region-count gates
    n_land = sum(1 for r in regions if r["type"] == "land")
    n_sea = sum(1 for r in regions if r["type"] == "sea")
    n_fog = sum(1 for r in regions if r["type"] == "fog")
    say(f"regions -> land: {n_land}   sea: {n_sea}   fog: {n_fog}")
    if not (130 <= n_land <= 155):
        fail(f"playable land region count {n_land} outside 130..155")
    if not (25 <= n_sea <= 40):
        fail(f"sea zone count {n_sea} outside 25..40")
    if n_fog != 2:
        fail(f"fog region count {n_fog} != 2")

    # playable-land size distribution: no giant slab, sensible typical size
    playable_areas = sorted(r["area"] for r in regions if r["type"] == "land")
    if playable_areas:
        p_max = playable_areas[-1]
        p_min = playable_areas[0]
        p_med = playable_areas[len(playable_areas) // 2]
        say(f"playable land area  max/median/min = {p_max} / {p_med} / {p_min} px")
        if p_max > 90000:
            fail(f"largest playable land region {p_max}px exceeds 90000px")
        if not (6000 <= p_med <= 14000):
            fail(f"playable land median {p_med}px outside 6000..14000")

    # politics2.json integrity: every referenced region still exists as land
    pol_path = OUT_DIR / "politics2.json"
    if pol_path.exists():
        pol = json.loads(pol_path.read_text())
        land_id_set = {rec["id"] for rec in regions if rec["type"] == "land"}
        referenced = sorted(set(pol.get("owners", {}).keys()) | set(pol.get("explicitlyEmpty", [])))
        missing = [r for r in referenced if r not in land_id_set]
        if missing:
            fail(f"politics2.json references regions no longer land after regen: {missing}")
        else:
            say(f"politics2.json: all {len(referenced)} referenced regions still land ✓")
    else:
        say("politics2.json: not present (skipping reference check)")

    # every land & sea pixel assigned exactly once
    land_assigned = (land_lbl > 0)
    if int((land & ~land_assigned).sum()) != 0:
        fail(f"{int((land & ~land_assigned).sum())} land pixels unassigned")
    if int((~land & land_assigned).sum()) != 0:
        fail("land labels leaked onto sea pixels")
    sea_assigned = (sea_lbl > 0)
    if int((sea & ~sea_assigned).sum()) != 0:
        fail(f"{int((sea & ~sea_assigned).sum())} sea pixels unassigned")
    overlap = int((land_assigned & sea_assigned).sum())
    if overlap != 0:
        fail(f"{overlap} pixels claimed by both land and sea")

    # no empty / disconnected playable region (disconnect already gated above)
    for rec in regions:
        if rec["area"] == 0:
            fail(f"region {rec['id']} is empty")

    # --- Terrain -> webp -----------------------------------------------------
    # WORLD2_SKIP_TERRAIN=1 skips the (slow) q95 re-encode during iteration.
    import os
    if os.environ.get("WORLD2_SKIP_TERRAIN") == "1" and TERRAIN_OUT.exists():
        say(f"terrain2.webp: reused existing ({TERRAIN_OUT.stat().st_size / 1024:.1f} KiB)")
    else:
        terrain = flatten_over_white(TERRAIN_PATH)
        # Lossy q95 (method 6): visually clean on the relief, ~5x smaller than lossless.
        terrain.save(str(TERRAIN_OUT), format="WEBP", lossless=False, quality=95, method=6)
        say(f"terrain2.webp: {terrain.size} q95, {TERRAIN_OUT.stat().st_size / 1024:.1f} KiB")

    # --- Emit world2.json ----------------------------------------------------
    out = {
        "width": W,
        "height": H,
        "provinces": [
            {
                "id": rec["id"],
                "type": rec["type"],
                "path": rec["path"],
                "towns": sorted(town_of_region[rec["id"]]),
                "neighbors": sorted(neighbors[rec["id"]]),
                "coastal": bool(coastal[rec["id"]]),
            }
            for rec in regions
        ],
        "towns": [
            {"id": t["id"], "name": t["name"], "x": round(t["x"], 1), "y": round(t["y"], 1)}
            for t in sorted(towns, key=lambda t: t["id"])
        ],
    }
    JSON_OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    jsize = JSON_OUT.stat().st_size
    say(f"world2.json: {len(out['provinces'])} provinces, {len(out['towns'])} towns, "
        f"{jsize / 1024 / 1024:.3f} MiB")
    if jsize > 3.5 * 1024 * 1024:
        fail(f"world2.json {jsize} bytes exceeds 3.5 MB")

    # --- Summary -------------------------------------------------------------
    say("")
    say("--- summary ---")
    for kind in ("land", "sea", "fog"):
        areas = sorted(r["area"] for r in regions if r["type"] == kind)
        if areas:
            med = areas[len(areas) // 2]
            say(f"{kind}: {len(areas)} regions  area min/median/max = "
                f"{areas[0]} / {med} / {areas[-1]} px")
    multipart = [r for r in regions if r["type"] == "land" and r["components"] > 1]
    say(f"multi-part land regions (mainland + offshore islands): {len(multipart)}")
    for r in sorted(multipart, key=lambda r: -r["components"])[:10]:
        say(f"  {r['id']}: {r['components']} parts, {r['area']}px")
    multi_town = [r for r in regions if len(town_of_region[r["id"]]) > 1]
    max_towns = max((len(town_of_region[r["id"]]) for r in regions), default=0)
    say(f"regions with >1 town: {len(multi_town)} (max towns in a region: {max_towns})")
    say(f"town snaps: {len(snaps)}")
    for s in snaps:
        say(f"  snap {s['id']}: {s['from']} -> {s['to']} ({s['dist']}px)")
    say(f"retraces (finer tolerance): {len(retraces)}")
    for rec, tol in retraces:
        say(f"  retrace {rec['id']} at tol {tol}")

    say("")
    if FAILURES:
        say(f"ABORT: {len(FAILURES)} gate(s) failed.")
        for f in FAILURES:
            say("  - " + f)
        return 1
    say("OK: all gates passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
