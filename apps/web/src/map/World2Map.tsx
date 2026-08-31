import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CULTURE_WEBP } from "../dashboard/shared.js";
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

type Rect = { x: number; y: number; w: number; h: number };
type Box = { w: number; h: number };

const WORLD_SRC = "/map2/world2.json";
const TERRAIN_SRC = "/map2/terrain2.webp";
const POLITICS_SRC = "/map2/politics2.json";
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
// Zoom (= worldWidth / cameraWidth) at or beyond which every town label appears;
// below it only Massalia is named. Lowered one step (from 3) so names show as
// soon as a region is framed.
const LABEL_ZOOM_THRESHOLD = 2.3;
// Target on-screen px for town markers (~1.6x the previous 4 / 12), held constant
// across zoom by counter-scaling against the current camera width.
const TOWN_LABEL_PX = 19;
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

export function World2Map({ fill = false }: { fill?: boolean } = {}) {
  const [world, setWorld] = useState<World | null>(null);
  const [politics, setPolitics] = useState<Politics | null>(null);
  const [status, setStatus] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
  }, []);

  const worldRect = useMemo<Rect | null>(
    () => (world ? { x: 0, y: 0, w: world.width, h: world.height } : null),
    [world],
  );
  const massalia = useMemo(() => world?.towns.find((town) => town.name === "Massalia") ?? null, [world]);
  const townsById = useMemo(() => new Map((world?.towns ?? []).map((town) => [town.id, town])), [world]);
  const provincesById = useMemo(() => new Map((world?.provinces ?? []).map((province) => [province.id, province])), [world]);
  const centroidById = useMemo(
    () => new Map((world?.provinces ?? []).map((province) => [province.id, pathCentroid(province.path)])),
    [world],
  );

  const land = useMemo(() => world?.provinces.filter((p) => p.type === "land") ?? [], [world]);
  const seaZones = useMemo(() => world?.provinces.filter((p) => p.type === "sea") ?? [], [world]);
  const fog = useMemo(() => world?.provinces.filter((p) => p.type === "fog") ?? [], [world]);

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
    positionPopover(cam);
  }, [positionPopover]);

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
        const rid = el?.closest("[data-rid]")?.getAttribute("data-rid") ?? null;
        setSelected(rid);
      }
    } else if (pointersRef.current.size === 1 && cameraRef.current) {
      const remaining = [...pointersRef.current.values()][0]!;
      gestureRef.current = { startCam: { ...cameraRef.current }, startDist: 0, startMid: { x: remaining.x, y: remaining.y } };
      movedRef.current = true; // dropping from a pinch to a pan is never a tap
    }
  }, [commitCamera]);

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
    else if (event.key === "Escape") { setSelected(null); }
  }, [setCameraNow, stepZoom, worldRect, currentAspect]);

  // Region hover (desktop). Selection is handled in endPointer via a tap hit-test.
  const onRegionEnter = useCallback((id: string) => { if (!draggingRef.current) setHover(id); }, []);
  const onRegionLeave = useCallback((id: string) => { setHover((current) => (current === id ? null : current)); }, []);

  // Keep the selected region's anchor centroid in a ref for imperative tracking.
  useEffect(() => {
    selectedCentroidRef.current = selected ? centroidById.get(selected) ?? null : null;
    if (cameraRef.current) positionPopover(cameraRef.current);
  }, [selected, centroidById, positionPopover]);

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
  }, [world, land, seaZones, fog, hover, politics, onRegionEnter, onRegionLeave]);

  // The world must load before we can render anything, but the stage renders as
  // soon as the world is ready (even before the camera) so its box gets measured
  // — the opening-frame effect needs that box, so the camera depends on it.
  if (!world || !worldRect) {
    return <p style={{ padding: 24, fontFamily: "Spectral, serif" }}>Charting the known world…</p>;
  }

  const zoom = camera ? worldRect.w / camera.w : 0;
  const unitPerPx = camera ? (box.w > 0 ? camera.w / box.w : camera.w / worldRect.w) : 0;
  const labelPx = TOWN_LABEL_PX * unitPerPx;
  const dotPx = TOWN_DOT_PX * unitPerPx;
  const iconPx = CULTURE_ICON_PX * unitPerPx;
  const labelledTowns = zoom >= LABEL_ZOOM_THRESHOLD ? world.towns : world.towns.filter((town) => town.name === "Massalia");

  const selectedProvince = selected ? provincesById.get(selected) ?? null : null;
  const selectedOwnerId = selectedProvince ? politics?.owners[selectedProvince.id] : undefined;
  const selectedOwner = selectedOwnerId ? politics?.polities[selectedOwnerId] ?? null : null;

  const infoBody = selectedProvince ? (
    <>
      <button type="button" className="w2map-info-close" onClick={() => setSelected(null)} aria-label="Close">Close</button>
      <div className="w2map-info-body">
        <h2 className="w2map-info-title">{selectedProvince.id}</h2>
        <p className="w2map-info-sub">Region name comes later.</p>
        <div className="w2map-info-label">Owner</div>
        {selectedOwner ? (
          <div className="w2map-info-owner">
            {selectedOwner.culture && CULTURE_WEBP[selectedOwner.culture] ? (
              <img className="w2map-owner-icon" src={CULTURE_WEBP[selectedOwner.culture]} alt="" width={16} height={16} />
            ) : null}
            <span className="w2map-owner-chip" style={{ background: selectedOwner.color }} aria-hidden="true" />
            {selectedOwner.name}
          </div>
        ) : (
          <p className="w2map-info-empty">Unclaimed</p>
        )}
        <div className="w2map-info-label">Type</div>
        <div style={{ fontSize: 13, textTransform: "capitalize" }}>
          {selectedProvince.type}{selectedProvince.coastal ? " · coastal" : ""}
        </div>
        <div className="w2map-info-label">Towns</div>
        {selectedProvince.towns.length ? (
          <ul className="w2map-info-towns">
            {selectedProvince.towns.map((townId) => (
              <li key={townId}>{townsById.get(townId)?.name ?? townId}</li>
            ))}
          </ul>
        ) : (
          <p className="w2map-info-empty">No towns in this region.</p>
        )}
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

            {/* Town markers + labels: culture icon when the town's region has a
                culture-bearing owner, else the plain dot. Same layer as before,
                so it commits at gesture end (no re-renders mid-drag). */}
            <g pointerEvents="none">
              {labelledTowns.map((town) => {
                const icon = townCultureIcon.get(town.id);
                const isMassalia = town.name === "Massalia";
                const markerHalf = icon ? iconPx / 2 : isMassalia ? dotPx * 1.5 : dotPx;
                return (
                  <g key={town.id}>
                    {icon ? (
                      <image href={icon} x={town.x - iconPx / 2} y={town.y - iconPx / 2} width={iconPx} height={iconPx} preserveAspectRatio="xMidYMid meet" />
                    ) : (
                      <circle cx={town.x} cy={town.y} r={isMassalia ? dotPx * 1.5 : dotPx} fill="#fff" stroke="#3c3c3c" strokeWidth={dotPx * 0.35} />
                    )}
                    <text x={town.x + markerHalf + labelPx * 0.25} y={town.y - dotPx * 1.25} fontSize={isMassalia ? labelPx * 1.15 : labelPx} fill="#fff" stroke="#3c3c3c" strokeWidth={labelPx * 0.02} fontWeight="bold">
                      {town.name}
                    </text>
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
            aria-label={`Region ${selectedProvince.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {infoBody}
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
