import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CULTURE_WEBP, POLITY_CREST, titleCase } from "../dashboard/shared.js";
import "./World2Map.css";

/**
 * Standalone hand-drawn world map (the game's Atlas map and the /map route).
 *
 * The shipped terrain export (`terrain2.webp`) is the visible art; the generated
 * region polygons (`world2.json`) sit on top as a transparent interaction layer,
 * tinted by ownership from `politics2.json`. Land and sea zones highlight on hover
 * and select on tap; fog regions are dark and inert.
 *
 * Camera performance: during a drag or pinch the SVG viewBox (and the anchored
 * popover position) are written directly through refs inside requestAnimationFrame,
 * and React state commits only when the gesture ends — so a drag triggers zero
 * React re-renders. The camera's aspect follows the container box, so the map can
 * be a phone-height panel or a wide desktop card without distortion.
 */

type ProvinceType = "land" | "sea" | "fog";
type Province = {
  id: string;
  type: ProvinceType;
  path: string;
  towns: string[];
  neighbors: string[];
  coastal: boolean;
};
type Town = { id: string; name: string; x: number; y: number };
type World = { width: number; height: number; provinces: Province[]; towns: Town[] };

type Polity = { name: string; color: string; culture?: string };
type Politics = {
  version: number;
  polities: Record<string, Polity>;
  owners: Record<string, string>;
  explicitlyEmpty: string[];
};

// Display names for land regions (names2.json) — the R-ids never reach the player.
type Names = { version: number; names: Record<string, string> };
// Town survey numbers (townstats.json, mirrored from content/cities/cities.json).
type TownStats = { population: number; garrison: number; walls: number };
type TownStatsFile = { version: number; towns: Record<string, TownStats> };

type Rect = { x: number; y: number; w: number; h: number };
type Box = { w: number; h: number };

const WORLD_SRC = "/map2/world2.json";
const TERRAIN_SRC = "/map2/terrain2.webp";
const POLITICS_SRC = "/map2/politics2.json";
const NAMES_SRC = "/map2/names2.json";
const TOWNSTATS_SRC = "/map2/townstats.json";
// Shield colour for regions nobody holds (states with no crest art use their own colour).
const UNCLAIMED_GREY = "#8f8a82";
const TOWN_ACTIONS = ["Attack", "Raid", "Scout", "Colonise"] as const;
const OWNER_TINT_OPACITY = 0.5;

// The app's phone breakpoint (matches the dashboard's 620px).
const MOBILE_QUERY = "(max-width: 620px)";

// --- Camera tuning -----------------------------------------------------------
// Opening frame width as a fraction of the full world width, centred on Massalia.
// Desktop 0.42 frames the Gulf of Lion coast; phones open tighter (0.30) since a
// portrait panel is much narrower.
const OPENING_FRACTION_DESKTOP = 0.42;
const OPENING_FRACTION_MOBILE = 0.30;
const MAX_ZOOM = 10;
// Target on-screen px for town markers, held constant across zoom by
// counter-scaling against the current camera width. Towns carry no map label:
// their names live in the popover and town panel.
const TOWN_DOT_PX = 6.4;
// Culture marker size on screen (px), held constant across zoom by counter-scaling.
const CULTURE_ICON_PX = 22;
// A press that moves more than this many screen pixels is a pan, not a tap.
const TAP_SLOP_PX = 6;
// Anchored-popover placement.
const POPOVER_OFFSET = 16;
const POPOVER_PAD = 8;

// Palette.
const SELECT_GOLD = "#d8b56a";
const HOVER_WASH = "#c8ad73";
const SEA_LATTICE = "#4d82b8";
const FOG_DARK = "#0b0a08";
// CK2-style borders. The seam-seal stroke (world units) fattens each owned
// region's fill outward so independently-smoothed neighbours meet with no
// terrain crack; the border stroke is a constant one-screen-pixel dark warm line.
const SEAL_STROKE_WIDTH = 2.5;
const BORDER_COLOR = "rgba(45, 36, 26, 0.55)";
const BORDER_WIDTH = 1;
// Realm rims: each polity's territory reads as one realm with a continuous
// border ~2.75 screen px wide just inside its outer edge. Built per polity by the
// erode technique (#w2-realm-rim): the polity's regions drawn as one union in the
// rim tone, minus the same union eroded by the rim width, leaves only the rim.
// The erode radius is in world units, so applyView rewrites it on every camera
// change to hold the on-screen width (no React involved).
const REALM_RIM_PX = 2.75;
const REALM_RIM_COLOR = "rgb(30, 22, 14)";
const REALM_RIM_OPACITY = 0.75;
// Realm name labels: one per owning polity, at its largest region's centroid,
// sized by the realm's total area (world units, clamped) and faded out between
// these zooms (zoom = worldWidth / cameraWidth) as the camera dives in.
const REALM_LABEL_SCALE = 0.17;
const REALM_LABEL_MIN = 14;
const REALM_LABEL_MAX = 66;
const REALM_LABEL_FADE_START = 3.4;
const REALM_LABEL_FADE_END = 5.4;
const REALM_LABEL_INK = "#1d150e";
const REALM_LABEL_INK_OPACITY = 0.55;
const REALM_LABEL_HALO = "rgba(255, 246, 228, 0.72)";

const WORLD_ASPECT = (world: Rect) => world.w / world.h;

// The largest camera that fits the world into a container of the given aspect:
// wider-than-world containers fit width (pan vertically), taller ones fit height
// (pan sideways). Both dimensions stay within the world, so the origin clamps
// against a non-negative range.
function fitFrame(world: Rect, aspect: number): Rect {
  const w = aspect >= WORLD_ASPECT(world) ? world.w : world.h * aspect;
  const h = w / aspect;
  const x = world.x + (world.w - w) / 2;
  const y = world.y + (world.h - h) / 2;
  return { x, y, w, h };
}

// Clamp a desired camera into the world at a given container aspect: width in
// [fit/MAX_ZOOM, fit], height from the aspect (no distortion), origin inside.
function clampCamera(cam: Rect, world: Rect, aspect: number): Rect {
  const fit = fitFrame(world, aspect);
  const w = Math.min(fit.w, Math.max(fit.w / MAX_ZOOM, cam.w));
  const h = w / aspect;
  const x = Math.min(world.x + world.w - w, Math.max(world.x, cam.x));
  const y = Math.min(world.y + world.h - h, Math.max(world.y, cam.y));
  return { x, y, w, h };
}

function openingFrame(world: Rect, focus: { x: number; y: number } | null, fraction: number, aspect: number): Rect {
  const w = fraction * world.w;
  const h = w / aspect;
  const cx = focus?.x ?? world.x + world.w / 2;
  const cy = focus?.y ?? world.y + world.h / 2;
  return clampCamera({ x: cx - w / 2, y: cy - h / 2, w, h }, world, aspect);
}

// Zoom by `factor` (>1 zooms in) keeping the viewBox point (fx,fy) fixed on screen.
function zoomAt(cam: Rect, world: Rect, factor: number, fx: number, fy: number, aspect: number): Rect {
  const rx = (fx - cam.x) / cam.w;
  const ry = (fy - cam.y) / cam.h;
  const w = cam.w / factor;
  const h = cam.h / factor;
  return clampCamera({ x: fx - rx * w, y: fy - ry * h, w, h }, world, aspect);
}

// Erode radius (world units) that keeps the realm rim REALM_RIM_PX wide on screen.
function rimRadiusFor(cam: Rect, box: Box): number {
  return REALM_RIM_PX * (cam.w / box.w);
}

// Realm labels are for overview: fully shown up to FADE_START, gone by FADE_END.
function realmLabelOpacityFor(cam: Rect, world: Rect): number {
  const zoom = world.w / cam.w;
  const t = (zoom - REALM_LABEL_FADE_START) / (REALM_LABEL_FADE_END - REALM_LABEL_FADE_START);
  return Math.max(0, Math.min(1, 1 - t));
}

// Mean of every vertex in a region path — used to anchor the popover.
function pathCentroid(path: string): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const sub of path.split("M")) {
    const s = sub.trim();
    if (!s) continue;
    for (const tok of s.replace(/Z/g, "").split("L")) {
      const t = tok.trim();
      if (!t) continue;
      const [x, y] = t.split(",");
      if (x === undefined || y === undefined) continue;
      sx += parseFloat(x);
      sy += parseFloat(y);
      n += 1;
    }
  }
  return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

// A region path ("M x,y L x,y … Z" sub-paths) as rings of points.
function pathRings(path: string): { x: number; y: number }[][] {
  const rings: { x: number; y: number }[][] = [];
  for (const sub of path.split("M")) {
    const s = sub.trim();
    if (!s) continue;
    const ring: { x: number; y: number }[] = [];
    for (const tok of s.replace(/Z/g, "").split("L")) {
      const t = tok.trim();
      if (!t) continue;
      const [x, y] = t.split(",");
      if (x === undefined || y === undefined) continue;
      ring.push({ x: parseFloat(x), y: parseFloat(y) });
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// Shoelace area (absolute) and area-weighted centroid of one ring.
function ringMetrics(ring: { x: number; y: number }[]): { area: number; x: number; y: number } {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const cross = p.x * q.y - q.x * p.y;
    twiceArea += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-6) return { area: 0, x: ring[0]!.x, y: ring[0]!.y };
  return { area: Math.abs(twiceArea) / 2, x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

// A region's total area and the centroid of its largest ring (the label anchor).
function regionMetrics(path: string): { area: number; x: number; y: number } {
  let area = 0;
  let largest: { area: number; x: number; y: number } | null = null;
  for (const ring of pathRings(path)) {
    const m = ringMetrics(ring);
    area += m.area;
    if (!largest || m.area > largest.area) largest = m;
  }
  return { area, x: largest?.x ?? 0, y: largest?.y ?? 0 };
}

// The owning state's crest: its faction emblem from POLITY_CREST (the same art the
// Diplomacy list uses; Massalia's lion lives there too), else a simple shield in
// the polity colour, neutral grey when the region is unclaimed.
function StateCrest({ polityId, color }: { polityId: string | null; color: string }) {
  const crest = polityId ? POLITY_CREST[polityId] : undefined;
  if (crest) {
    return <img className="w2map-crest" src={crest} alt="" width={44} height={44} />;
  }
  return (
    <svg className="w2map-crest" viewBox="0 0 24 28" width={44} height={44} aria-hidden="true">
      <path
        d="M12 1.5 L22 5 V13 C22 19.6 17.6 24.6 12 26.6 C6.4 24.6 2 19.6 2 13 V5 Z"
        fill={color}
        stroke="rgba(0, 0, 0, 0.55)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path d="M12 4.2 L19.4 6.8 V12.6 C19.4 15.2 18.4 17.6 16.8 19.6 C13.2 16.6 12.4 10.8 12 4.2 Z" fill="rgba(255, 255, 255, 0.14)" />
    </svg>
  );
}

// 1..5 wall level as filled/empty pips (matches the Cities table).
function wallPips(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  return "■".repeat(n) + "□".repeat(5 - n);
}

export function World2Map({ fill = false }: { fill?: boolean } = {}) {
  const [world, setWorld] = useState<World | null>(null);
  const [politics, setPolitics] = useState<Politics | null>(null);
  const [status, setStatus] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // A selected town swaps the region panel for the town panel (same anchor logic).
  const [selectedTown, setSelectedTown] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [townStats, setTownStats] = useState<Record<string, TownStats>>({});
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(MOBILE_QUERY).matches : false,
  );

  useEffect(() => {
    fetch(WORLD_SRC)
      .then((response) => response.json() as Promise<World>)
      .then(setWorld)
      .catch(() => setStatus("Failed to load the world map."));
    // Politics are cosmetic; a load failure leaves the map untinted, not broken.
    fetch(POLITICS_SRC)
      .then((response) => response.json() as Promise<Politics>)
      .then(setPolitics)
      .catch(() => {});
    // Names and town surveys are cosmetic too: missing files degrade to fallbacks.
    fetch(NAMES_SRC)
      .then((response) => response.json() as Promise<Names>)
      .then((file) => setNames(file.names ?? {}))
      .catch(() => {});
    fetch(TOWNSTATS_SRC)
      .then((response) => response.json() as Promise<TownStatsFile>)
      .then((file) => setTownStats(file.towns ?? {}))
      .catch(() => {});
  }, []);

  const worldRect = useMemo<Rect | null>(
    () => (world ? { x: 0, y: 0, w: world.width, h: world.height } : null),
    [world],
  );
  const massalia = useMemo(() => world?.towns.find((town) => town.name === "Massalia") ?? null, [world]);
  const townsById = useMemo(() => new Map((world?.towns ?? []).map((town) => [town.id, town])), [world]);
  const provincesById = useMemo(() => new Map((world?.provinces ?? []).map((province) => [province.id, province])), [world]);
  // Town id -> the region that holds it (a tapped town also selects its region).
  const townRegionById = useMemo(() => {
    const out = new Map<string, string>();
    for (const province of world?.provinces ?? []) for (const townId of province.towns) out.set(townId, province.id);
    return out;
  }, [world]);
  const centroidById = useMemo(
    () => new Map((world?.provinces ?? []).map((province) => [province.id, pathCentroid(province.path)])),
    [world],
  );

  const land = useMemo(() => world?.provinces.filter((p) => p.type === "land") ?? [], [world]);
  const seaZones = useMemo(() => world?.provinces.filter((p) => p.type === "sea") ?? [], [world]);
  const fog = useMemo(() => world?.provinces.filter((p) => p.type === "fog") ?? [], [world]);

  // Realms: one entry per polity that holds land (Unclaimed excluded) — its
  // regions, total area, and the centroid of its largest region. Drives the rim
  // layer and the name labels; stable across camera moves.
  const realms = useMemo(() => {
    const out: { id: string; name: string; regions: Province[]; area: number; x: number; y: number }[] = [];
    if (!world || !politics) return out;
    const byPolity = new Map<string, Province[]>();
    for (const province of land) {
      const owner = politics.owners[province.id];
      if (!owner || owner === "unclaimed" || !politics.polities[owner]) continue;
      const list = byPolity.get(owner) ?? [];
      list.push(province);
      byPolity.set(owner, list);
    }
    for (const [id, regions] of byPolity) {
      let area = 0;
      let largest = { area: -1, x: 0, y: 0 };
      for (const province of regions) {
        const m = regionMetrics(province.path);
        area += m.area;
        if (m.area > largest.area) largest = m;
      }
      out.push({ id, name: politics.polities[id]!.name, regions, area, x: largest.x, y: largest.y });
    }
    return out;
  }, [world, land, politics]);

  // Town id -> culture icon URL, for towns whose region has a culture-bearing
  // owner. Stable across camera moves (depends only on world + politics).
  const townCultureIcon = useMemo(() => {
    const out = new Map<string, string>();
    if (!world || !politics) return out;
    for (const province of world.provinces) {
      const owner = politics.owners[province.id];
      const culture = owner ? politics.polities[owner]?.culture : undefined;
      const icon = culture ? CULTURE_WEBP[culture] : undefined;
      if (!icon) continue;
      for (const townId of province.towns) out.set(townId, icon);
    }
    return out;
  }, [world, politics]);

  // --- Camera plumbing ------------------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Imperative hooks for the camera-dependent bits of the static scene: the rim
  // erode radius (world units per screen px) and the realm-label fade.
  const rimRadiusRef = useRef<SVGFEMorphologyElement | null>(null);
  const labelsRef = useRef<SVGGElement | null>(null);
  const cameraRef = useRef<Rect | null>(null);
  const [camera, setCamera] = useState<Rect | null>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const boxRef = useRef<Box>({ w: 0, h: 0 });
  const aspectRef = useRef<number>(1);
  const isMobileRef = useRef(isMobile);
  const selectedCentroidRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const downPointRef = useRef<{ x: number; y: number } | null>(null);
  const didInitCamera = useRef(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ startCam: Rect; startDist: number; startMid: { x: number; y: number } } | null>(null);
  const lastTapRef = useRef(0);

  isMobileRef.current = isMobile;
  const currentAspect = useCallback(() => {
    const b = boxRef.current;
    return b.w > 0 && b.h > 0 ? b.w / b.h : worldRect ? WORLD_ASPECT(worldRect) : 1;
  }, [worldRect]);

  // Project the selected region's centroid to a clamped popover position. Runs
  // imperatively (no React) so the popover tracks the viewBox during a drag.
  const positionPopover = useCallback((cam: Rect) => {
    const el = popoverRef.current;
    const centroid = selectedCentroidRef.current;
    const b = boxRef.current;
    if (!el || !centroid || isMobileRef.current || b.w === 0 || b.h === 0) return;
    const sx = ((centroid.x - cam.x) / cam.w) * b.w;
    const sy = ((centroid.y - cam.y) / cam.h) * b.h;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    // Beside the point (right if there's room, else left); vertically centred.
    let left = sx + POPOVER_OFFSET;
    if (left + pw > b.w - POPOVER_PAD) left = sx - POPOVER_OFFSET - pw;
    let top = sy - ph / 2;
    left = Math.max(POPOVER_PAD, Math.min(b.w - pw - POPOVER_PAD, left));
    top = Math.max(POPOVER_PAD, Math.min(b.h - ph - POPOVER_PAD, top));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, []);

  const applyView = useCallback((cam: Rect) => {
    svgRef.current?.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    const b = boxRef.current;
    if (rimRadiusRef.current && b.w > 0) rimRadiusRef.current.setAttribute("radius", String(rimRadiusFor(cam, b)));
    if (labelsRef.current && worldRect) labelsRef.current.style.opacity = String(realmLabelOpacityFor(cam, worldRect));
    positionPopover(cam);
  }, [positionPopover, worldRect]);

  // Any React render re-asserts the live camera onto the SVG + popover.
  useLayoutEffect(() => {
    if (cameraRef.current) applyView(cameraRef.current);
  });

  // The opening frame, computed once the world data + container box have settled.
  useEffect(() => {
    if (didInitCamera.current || !worldRect || !world || box.w === 0 || box.h === 0) return;
    const fraction = isMobile ? OPENING_FRACTION_MOBILE : OPENING_FRACTION_DESKTOP;
    const frame = openingFrame(worldRect, massalia ? { x: massalia.x, y: massalia.y } : null, fraction, currentAspect());
    cameraRef.current = frame;
    setCamera(frame);
    didInitCamera.current = true;
  }, [worldRect, world, massalia, box, isMobile, currentAspect]);

  // Track the stage's actual box; re-derive the aspect and re-clamp the camera on
  // every resize / orientation change so nothing distorts or jumps.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      boxRef.current = { w, h };
      aspectRef.current = w / h;
      setBox({ w, h });
      if (cameraRef.current && worldRect) {
        const cam = cameraRef.current;
        const cx = cam.x + cam.w / 2;
        const cy = cam.y + cam.h / 2;
        const next = clampCamera({ x: cx - cam.w / 2, y: cy - cam.w / (2 * aspectRef.current), w: cam.w, h: cam.w / aspectRef.current }, worldRect, aspectRef.current);
        cameraRef.current = next;
        setCamera(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, [world, worldRect]);

  // React to the phone breakpoint.
  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (cameraRef.current) applyView(cameraRef.current);
    });
  }, [applyView]);

  const commitCamera = useCallback(() => {
    if (cameraRef.current) setCamera(cameraRef.current);
  }, []);

  const setCameraNow = useCallback((next: Rect) => {
    cameraRef.current = next;
    applyView(next);
    setCamera(next);
  }, [applyView]);

  const clientToViewBox = useCallback((clientX: number, clientY: number, cam: Rect) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 };
    return {
      x: cam.x + ((clientX - rect.left) / rect.width) * cam.w,
      y: cam.y + ((clientY - rect.top) / rect.height) * cam.h,
    };
  }, []);

  const stepZoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    if (!worldRect || !cameraRef.current) return;
    const cam = cameraRef.current;
    const focal = clientX != null && clientY != null ? clientToViewBox(clientX, clientY, cam) : { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 };
    setCameraNow(zoomAt(cam, worldRect, factor, focal.x, focal.y, currentAspect()));
  }, [clientToViewBox, setCameraNow, worldRect, currentAspect]);

  const goHome = useCallback(() => {
    if (!worldRect) return;
    const fraction = isMobileRef.current ? OPENING_FRACTION_MOBILE : OPENING_FRACTION_DESKTOP;
    setCameraNow(openingFrame(worldRect, massalia ? { x: massalia.x, y: massalia.y } : null, fraction, currentAspect()));
  }, [massalia, setCameraNow, worldRect, currentAspect]);

  const goFit = useCallback(() => {
    if (!worldRect) return;
    setCameraNow(fitFrame(worldRect, currentAspect()));
  }, [setCameraNow, worldRect, currentAspect]);

  // --- Pointer gestures -----------------------------------------------------
  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!worldRect || !cameraRef.current) return;
    event.stopPropagation();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length === 1) {
      movedRef.current = false;
      downPointRef.current = { x: event.clientX, y: event.clientY };
      const now = event.timeStamp;
      if (now - lastTapRef.current < 300) {
        stepZoom(1.8, event.clientX, event.clientY);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
      draggingRef.current = true;
      gestureRef.current = { startCam: { ...cameraRef.current }, startDist: 0, startMid: { x: event.clientX, y: event.clientY } };
    } else if (points.length === 2) {
      movedRef.current = true; // a two-finger gesture is never a tap
      const [a, b] = points;
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      gestureRef.current = { startCam: { ...cameraRef.current }, startDist: dist, startMid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
    }
  }, [stepZoom, worldRect]);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!worldRect || !gestureRef.current || !pointersRef.current.has(event.pointerId)) return;
    event.stopPropagation();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const gesture = gestureRef.current;
    const aspect = currentAspect();

    if (points.length === 1) {
      const down = downPointRef.current;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP_PX) movedRef.current = true;
      const dxUnits = ((event.clientX - gesture.startMid.x) / rect.width) * gesture.startCam.w;
      const dyUnits = ((event.clientY - gesture.startMid.y) / rect.height) * gesture.startCam.h;
      cameraRef.current = clampCamera({ ...gesture.startCam, x: gesture.startCam.x - dxUnits, y: gesture.startCam.y - dyUnits }, worldRect, aspect);
      scheduleFrame();
    } else if (points.length >= 2) {
      const [a, b] = points;
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      const scale = dist / (gesture.startDist || dist);
      const fit = fitFrame(worldRect, aspect);
      const w = Math.min(fit.w, Math.max(fit.w / MAX_ZOOM, gesture.startCam.w / scale));
      const h = w / aspect;
      const fx = gesture.startCam.x + ((gesture.startMid.x - rect.left) / rect.width) * gesture.startCam.w;
      const fy = gesture.startCam.y + ((gesture.startMid.y - rect.top) / rect.height) * gesture.startCam.h;
      const midX = (a!.x + b!.x) / 2;
      const midY = (a!.y + b!.y) / 2;
      const x = fx - ((midX - rect.left) / rect.width) * w;
      const y = fy - ((midY - rect.top) / rect.height) * h;
      cameraRef.current = clampCamera({ x, y, w, h }, worldRect, aspect);
      scheduleFrame();
    }
  }, [scheduleFrame, worldRect, currentAspect]);

  const endPointer = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    try { if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId); } catch { /* best-effort */ }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      draggingRef.current = false;
      gestureRef.current = null;
      commitCamera();
      // A tap (no meaningful pan movement) selects the region under the pointer;
      // an empty tap clears the selection. elementFromPoint is capture-proof.
      if (!movedRef.current) {
        const el = document.elementFromPoint(event.clientX, event.clientY) as Element | null;
        const hit = el?.closest("[data-town], [data-rid]") ?? null;
        const townId = hit?.getAttribute("data-town") ?? null;
        if (townId) {
          setSelected(townRegionById.get(townId) ?? null);
          setSelectedTown(townId);
        } else {
          setSelected(hit?.getAttribute("data-rid") ?? null);
          setSelectedTown(null);
        }
      }
    } else if (pointersRef.current.size === 1 && cameraRef.current) {
      const remaining = [...pointersRef.current.values()][0]!;
      gestureRef.current = { startCam: { ...cameraRef.current }, startDist: 0, startMid: { x: remaining.x, y: remaining.y } };
      movedRef.current = true; // dropping from a pinch to a pan is never a tap
    }
  }, [commitCamera, townRegionById]);

  // Wheel is registered non-passive on the map container so preventDefault stops
  // the page behind it from scrolling; stopPropagation keeps it off the dashboard.
  const wheelTimer = useRef<number | null>(null);
  const wheelLogicRef = useRef<(event: WheelEvent) => void>(() => {});
  wheelLogicRef.current = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!worldRect || !cameraRef.current) return;
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const focal = clientToViewBox(event.clientX, event.clientY, cameraRef.current);
    cameraRef.current = zoomAt(cameraRef.current, worldRect, factor, focal.x, focal.y, currentAspect());
    scheduleFrame();
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => commitCamera(), 140);
  };
  const nativeWheelListener = useRef<(event: WheelEvent) => void>((event) => wheelLogicRef.current(event));
  const setStageElement = useCallback((element: HTMLDivElement | null) => {
    if (stageRef.current) stageRef.current.removeEventListener("wheel", nativeWheelListener.current);
    stageRef.current = element;
    if (element) element.addEventListener("wheel", nativeWheelListener.current, { passive: false });
  }, []);
  useEffect(() => () => {
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!worldRect || !cameraRef.current) return;
    const cam = cameraRef.current;
    const aspect = currentAspect();
    const panStep = cam.w * 0.15;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); stepZoom(1.3); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); stepZoom(1 / 1.3); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, x: cam.x - panStep }, worldRect, aspect)); }
    else if (event.key === "ArrowRight") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, x: cam.x + panStep }, worldRect, aspect)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, y: cam.y - panStep }, worldRect, aspect)); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, y: cam.y + panStep }, worldRect, aspect)); }
    else if (event.key === "Escape") { setSelected(null); setSelectedTown(null); }
  }, [setCameraNow, stepZoom, worldRect, currentAspect]);

  // Region hover (desktop). Selection is handled in endPointer via a tap hit-test.
  const onRegionEnter = useCallback((id: string) => { if (!draggingRef.current) setHover(id); }, []);
  const onRegionLeave = useCallback((id: string) => { setHover((current) => (current === id ? null : current)); }, []);

  // Keep the panel's anchor (the open town, else the selected region's centroid)
  // in a ref for imperative tracking during camera moves.
  useEffect(() => {
    const town = selectedTown ? townsById.get(selectedTown) ?? null : null;
    selectedCentroidRef.current = town ? { x: town.x, y: town.y } : selected ? centroidById.get(selected) ?? null : null;
    if (cameraRef.current) positionPopover(cameraRef.current);
  }, [selected, selectedTown, centroidById, townsById, positionPopover]);

  // --- Static map layers (memoised so camera moves never re-create paths) ----
  const staticLayers = useMemo(() => {
    if (!world) return null;
    return (
      <>
        <image href={TERRAIN_SRC} width={world.width} height={world.height} />

        {/* Sea zones: hairline lattice-blue boundaries at low opacity. */}
        <g>
          {seaZones.map((province) => (
            <path
              key={province.id}
              data-rid={province.id}
              d={province.path}
              fill="transparent"
              fillRule="evenodd"
              stroke={SEA_LATTICE}
              strokeOpacity={0.5}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => onRegionEnter(province.id)}
              onMouseLeave={() => onRegionLeave(province.id)}
            />
          ))}
        </g>

        {/* Seam-seal: owned land filled AND stroked in the polity colour so
            independently-smoothed neighbours overlap with no terrain crack.
            Unowned regions are skipped — the terrain shows through anyway. */}
        <g pointerEvents="none">
          {land.map((province) => {
            const polityId = politics?.owners[province.id];
            const color = polityId ? politics?.polities[polityId]?.color : undefined;
            if (!color) return null;
            return (
              <path
                key={province.id}
                d={province.path}
                fill={color}
                fillOpacity={OWNER_TINT_OPACITY}
                stroke={color}
                strokeOpacity={OWNER_TINT_OPACITY}
                strokeWidth={SEAL_STROKE_WIDTH}
                strokeLinejoin="round"
                fillRule="evenodd"
              />
            );
          })}
        </g>

        {/* CK2-style borders: every land region outlined in a constant
            one-screen-pixel dark warm line. Sea keeps its hairline (above). */}
        <g pointerEvents="none">
          {land.map((province) => (
            <path
              key={province.id}
              d={province.path}
              fill="none"
              fillRule="evenodd"
              stroke={BORDER_COLOR}
              strokeWidth={BORDER_WIDTH}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        {/* Realm rims: per polity, its regions as one union in the rim tone (seam-
            sealed like the tint), run through #w2-realm-rim so only the outer rim
            survives. Internal region lines keep the hairline above; unowned and
            unclaimed land carries no rim. Group opacity applies after the filter. */}
        <g pointerEvents="none" opacity={REALM_RIM_OPACITY}>
          {realms.map((realm) => (
            <g key={realm.id} filter="url(#w2-realm-rim)" fill={REALM_RIM_COLOR} stroke={REALM_RIM_COLOR} strokeWidth={SEAL_STROKE_WIDTH} strokeLinejoin="round">
              {realm.regions.map((province) => (
                <path key={province.id} d={province.path} fillRule="evenodd" />
              ))}
            </g>
          ))}
        </g>

        {/* Land regions: an invisible interaction layer with a hover wash. */}
        <g>
          {land.map((province) => (
            <path
              key={province.id}
              data-rid={province.id}
              d={province.path}
              fillRule="evenodd"
              fill={HOVER_WASH}
              fillOpacity={hover === province.id ? 0.16 : 0}
              stroke="none"
              style={{ cursor: "pointer", transition: "fill-opacity 120ms ease" }}
              onMouseEnter={() => onRegionEnter(province.id)}
              onMouseLeave={() => onRegionLeave(province.id)}
            />
          ))}
        </g>

        {/* Fog: dark and inert. */}
        <g pointerEvents="none">
          {fog.map((province) => (
            <path key={province.id} d={province.path} fill={FOG_DARK} fillOpacity={0.72} fillRule="evenodd" />
          ))}
        </g>
      </>
    );
  }, [world, land, seaZones, fog, hover, politics, realms, onRegionEnter, onRegionLeave]);

  // The world must load before we can render anything, but the stage renders as
  // soon as the world is ready (even before the camera) so its box gets measured
  // — the opening-frame effect needs that box, so the camera depends on it.
  if (!world || !worldRect) {
    return <p style={{ padding: 24, fontFamily: "Spectral, serif" }}>Charting the known world…</p>;
  }

  const unitPerPx = camera ? (box.w > 0 ? camera.w / box.w : camera.w / worldRect.w) : 0;
  const dotPx = TOWN_DOT_PX * unitPerPx;
  const iconPx = CULTURE_ICON_PX * unitPerPx;
  // Initial values for the rim radius and label fade; applyView keeps them live.
  const rimRadius = camera && box.w > 0 ? rimRadiusFor(camera, box) : 0;
  const realmLabelOpacity = camera ? realmLabelOpacityFor(camera, worldRect) : 1;

  const selectedProvince = selected ? provincesById.get(selected) ?? null : null;
  const selectedOwnerId = selectedProvince ? politics?.owners[selectedProvince.id] ?? null : null;
  const selectedOwner = selectedOwnerId ? politics?.polities[selectedOwnerId] ?? null : null;
  const selectedTownObj = selectedTown ? townsById.get(selectedTown) ?? null : null;
  const stateName = selectedOwner?.name ?? "Unclaimed";
  const stateColor = selectedOwner?.color ?? UNCLAIMED_GREY;
  const cultureIcon = selectedOwner?.culture ? CULTURE_WEBP[selectedOwner.culture] : undefined;
  // Land regions are named in names2.json; sea zones read as open water. The id
  // itself is never shown: it rides along on the dialog as data-region only
  // (not data-rid, so the map's tap hit-test can never match the dialog).
  const regionName = selectedProvince
    ? selectedProvince.type === "land"
      ? names[selectedProvince.id] ?? "Uncharted land"
      : selectedProvince.type === "sea"
        ? "Open sea"
        : "Beyond the known world"
    : "";
  const terrain = selectedProvince
    ? `${titleCase(selectedProvince.type)}${selectedProvince.coastal ? " · Coastal" : ""}`
    : "";
  const closeInfo = () => {
    setSelected(null);
    setSelectedTown(null);
  };

  const regionBody = selectedProvince ? (
    <>
      <button type="button" className="w2map-info-close" onClick={closeInfo} aria-label="Close">Close</button>
      <div className="w2map-info-body">
        <div className="w2map-state">
          <StateCrest polityId={selectedOwnerId} color={stateColor} />
          <div className="w2map-state-text">
            <h2 className="w2map-state-name">
              {stateName}
              {cultureIcon ? <img className="w2map-owner-icon" src={cultureIcon} alt="" width={16} height={16} /> : null}
            </h2>
            <p className="w2map-region-name">{regionName}</p>
          </div>
        </div>
        <div className="w2map-info-label">Culture</div>
        <div className="w2map-info-row">{selectedOwner?.culture ? titleCase(selectedOwner.culture) : "—"}</div>
        <div className="w2map-info-label">Terrain</div>
        <div className="w2map-info-row">{terrain}</div>
        <div className="w2map-info-label">Towns</div>
        {selectedProvince.towns.length ? (
          <ul className="w2map-info-towns">
            {selectedProvince.towns.map((townId) => (
              <li key={townId}>
                <button type="button" className="w2map-town-chip" onClick={() => setSelectedTown(townId)}>
                  {townsById.get(townId)?.name ?? "Unnamed town"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="w2map-info-empty">No towns in this region.</p>
        )}
      </div>
    </>
  ) : null;

  // The town panel: survey rows from townstats.json (Massalian towns), "No survey
  // yet" elsewhere, and the four action buttons — rendered in the game's button
  // style but inert until a later pass wires them up.
  const stats = selectedTownObj ? townStats[selectedTownObj.id] : undefined;
  const townBody = selectedTownObj ? (
    <>
      <button type="button" className="w2map-info-close" onClick={closeInfo} aria-label="Close">Close</button>
      <div className="w2map-info-body">
        <button type="button" className="w2map-back" onClick={() => setSelectedTown(null)}>
          ‹ {regionName}
        </button>
        <div className="w2map-state w2map-state-town">
          <StateCrest polityId={selectedOwnerId} color={stateColor} />
          <div className="w2map-state-text">
            <h2 className="w2map-state-name">{selectedTownObj.name}</h2>
            <p className="w2map-region-name">{stateName} · {regionName}</p>
          </div>
        </div>
        <div className="w2map-info-label">Survey</div>
        <dl className="w2map-stats">
          <div className="w2map-stat">
            <dt>Population</dt>
            <dd>{stats ? stats.population.toLocaleString() : <span className="w2map-stat-none">No survey yet</span>}</dd>
          </div>
          <div className="w2map-stat">
            <dt>Garrison</dt>
            <dd>{stats ? stats.garrison.toLocaleString() : <span className="w2map-stat-none">No survey yet</span>}</dd>
          </div>
          <div className="w2map-stat">
            <dt>Walls</dt>
            <dd>
              {stats ? (
                <>
                  <span className="w2map-stat-pips" aria-hidden="true">{wallPips(stats.walls)}</span> Level {stats.walls}
                </>
              ) : (
                <span className="w2map-stat-none">No survey yet</span>
              )}
            </dd>
          </div>
        </dl>
        <div className="w2map-info-label">Actions</div>
        <div className="w2map-actions">
          {TOWN_ACTIONS.map((action) => (
            <button key={action} type="button" className="w2map-action" disabled aria-disabled="true" title="Not yet available">
              {action}
            </button>
          ))}
        </div>
      </div>
    </>
  ) : null;

  return (
    <div className={fill ? "w2map w2map-fill" : "w2map"}>
      {status ? <div className="w2map-status">{status}</div> : null}

      <div
        className="w2map-stage"
        ref={setStageElement}
        style={fill || isMobile ? undefined : { aspectRatio: `${worldRect.w} / ${worldRect.h}` }}
      >
        {camera ? (
          <svg
            ref={svgRef}
            className="w2map-svg"
            viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
            role="img"
            tabIndex={0}
            aria-label="The hand-drawn world map. Drag to pan, scroll or pinch to zoom, tap a region to inspect it."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onKeyDown={onKeyDown}
          >
            <defs>
              {/* Realm rim = union minus its erosion (see REALM_RIM_PX). The default
                  bbox filter region suffices: erosion never grows the shape. */}
              <filter id="w2-realm-rim" colorInterpolationFilters="sRGB">
                <feMorphology ref={rimRadiusRef} in="SourceAlpha" operator="erode" radius={rimRadius} result="inner" />
                <feComposite in="SourceGraphic" in2="inner" operator="out" />
              </filter>
            </defs>

            {staticLayers}

            {/* Selected region: gold outline on top of everything. */}
            {selectedProvince ? (
              <path
                d={selectedProvince.path}
                fill={SELECT_GOLD}
                fillOpacity={0.14}
                fillRule="evenodd"
                stroke={SELECT_GOLD}
                strokeWidth={2.4}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ) : null}

            {/* Realm name labels: one per owning polity at its largest region's
                centroid, sized by realm area. Uppercase dark ink with a light halo,
                inert, and faded imperatively in applyView as the camera dives in. */}
            <g ref={labelsRef} className="w2map-realm-labels" pointerEvents="none" style={{ opacity: realmLabelOpacity }}>
              {realms.map((realm) => {
                const size = Math.max(REALM_LABEL_MIN, Math.min(REALM_LABEL_MAX, REALM_LABEL_SCALE * Math.sqrt(realm.area)));
                return (
                  <text
                    key={realm.id}
                    x={realm.x}
                    y={realm.y}
                    fontSize={size}
                    fontWeight={700}
                    letterSpacing={size * 0.12}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={REALM_LABEL_INK}
                    fillOpacity={REALM_LABEL_INK_OPACITY}
                    stroke={REALM_LABEL_HALO}
                    strokeWidth={size * 0.14}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {realm.name.toUpperCase()}
                  </text>
                );
              })}
            </g>

            {/* Town markers: culture icon when the town's region has a culture-
                bearing owner, else the plain dot. No name labels on the map (names
                live in the popover and town panel). Markers are tappable (data-town;
                the tap hit-test in endPointer checks them first). Same layer as
                before, so it commits at gesture end (no re-renders mid-drag). */}
            <g pointerEvents="none">
              {world.towns.map((town) => {
                const icon = townCultureIcon.get(town.id);
                const isMassalia = town.name === "Massalia";
                return (
                  <g key={town.id} data-town={town.id}>
                    {icon ? (
                      <image href={icon} x={town.x - iconPx / 2} y={town.y - iconPx / 2} width={iconPx} height={iconPx} preserveAspectRatio="xMidYMid meet" pointerEvents="visiblePainted" style={{ cursor: "pointer" }} />
                    ) : (
                      <circle cx={town.x} cy={town.y} r={isMassalia ? dotPx * 1.5 : dotPx} fill="#fff" stroke="#3c3c3c" strokeWidth={dotPx * 0.35} pointerEvents="visiblePainted" style={{ cursor: "pointer" }} />
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        ) : (
          <p style={{ padding: 24, fontFamily: "Spectral, serif", color: "#33271c" }}>Charting the known world…</p>
        )}

        {/* Region info: an anchored popover on desktop, a bottom sheet on phones.
            Same content; the popover position is set imperatively in positionPopover. */}
        {camera && selectedProvince ? (
          <div
            ref={popoverRef}
            className={isMobile ? "w2map-sheet" : "w2map-popover"}
            role="dialog"
            aria-label={selectedTownObj ? selectedTownObj.name : `${stateName} — ${regionName}`}
            data-region={selectedProvince.id}
            data-town-id={selectedTownObj?.id}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {townBody ?? regionBody}
          </div>
        ) : null}

        <div className="w2map-controls">
          <button type="button" className="w2map-btn" aria-label="Zoom in" title="Zoom in" onClick={() => stepZoom(1.3)}>+</button>
          <button type="button" className="w2map-btn" aria-label="Zoom out" title="Zoom out" onClick={() => stepZoom(1 / 1.3)}>−</button>
          <button type="button" className="w2map-btn" aria-label="Home" title="Home (Massalia)" onClick={goHome}>⌂</button>
          <button type="button" className="w2map-btn" aria-label="Fit world" title="Fit the whole world" onClick={goFit}>▣</button>
        </div>
      </div>
    </div>
  );
}
