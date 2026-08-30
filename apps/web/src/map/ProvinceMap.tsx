import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ProvinceMap.css";
import { api, apiErrorMessage, streamMap, type MapPolity, type MapState } from "../api.js";

/**
 * Read-only campaign map for the first MASSALIA theatre, with a pan/zoom camera.
 *
 * The full generated terrain remains visible for geographic context, but only
 * the selected Western/Central Mediterranean cells receive borders, ownership,
 * labels and interaction. Everything else sits beneath a permanent campaign-
 * boundary fog. Conquest remains server-owned and disabled while war rules are
 * unfinished.
 *
 * Camera performance: during a drag or pinch the SVG viewBox is written directly
 * through a ref inside requestAnimationFrame — React state is committed only when
 * the gesture ends (that is the only moment the label-threshold layer re-renders).
 */

type DisplayRegion = {
  id: string;
  type: "land" | "sea";
  terrain: string;
  coastal: boolean;
  frontier: boolean;
  colonyCandidate: boolean;
  memberProvinceIds: string[];
  d: string;
};
type RegionData = { width: number; height: number; regions: DisplayRegion[] };
type Town = { name: string; x: number; y: number; polity: string; approx: boolean };
type Ownership = { owner: string | null; controller: string | null };
type Theatre = {
  name: string;
  description: string;
  landDepth: number;
  viewBox: { x: number; y: number; width: number; height: number };
  activeProvinceIds: string[];
  playableLandProvinceIds: string[];
  activeSeaProvinceIds: string[];
  frontierProvinceIds: string[];
  colonyCandidateProvinceIds: string[];
  initialOwners: Record<string, string>;
  activeTownNames: string[];
  displayLandRegionCount: number;
};

type Rect = { x: number; y: number; w: number; h: number };

const UNCLAIMED_COLOR = "#8a8a8a";
const COLONY_COLOR = "#c8ad73";
const FOG_MASK_ID = "massalia-theatre-fog-mask";

// --- Camera tuning ----------------------------------------------------------
// Opening frame width as a fraction of the full theatre width, centred on
// Massalia. 0.45 shows the Gulf of Lion coast from the edge of Iberia to Liguria
// while keeping Massalia central and legible.
const OPENING_FRACTION = 0.45;
// Fully zoomed in shows the theatre at 10x (viewBox is 1/10 of the theatre).
const MAX_ZOOM = 10;
// Zoom (= theatreWidth / cameraWidth) at or beyond which every active town label
// appears; below it only Massalia is named, so the wide frame stays uncluttered.
const LABEL_ZOOM_THRESHOLD = 3;
// Target on-screen pixel sizes for the town markers, held constant across zoom by
// counter-scaling their user-unit size against the current camera width.
const TOWN_LABEL_PX = 12;
const TOWN_DOT_PX = 4;

const STATIC = {
  regions: "/map/regions_px.json",
  rivers: "/map/rivers_px.json",
  terrain: "/map/terrain_px.png",
  towns: "/map/towns_px.json",
  polities: "/map/polities.json",
  theatre: "/map/theatre.json",
};

function ownershipByProvince(state: MapState): Record<string, Ownership> {
  const out: Record<string, Ownership> = {};
  for (const province of state.provinces) {
    out[province.provinceId] = { owner: province.ownerPolityId, controller: province.controllerPolityId };
  }
  return out;
}

function seededOwnership(theatre: Theatre): Record<string, Ownership> {
  return Object.fromEntries(
    theatre.playableLandProvinceIds.map((id) => {
      const owner = theatre.initialOwners[id] ?? null;
      return [id, { owner, controller: owner }];
    }),
  );
}

function regionOwnership(region: DisplayRegion, ownership: Record<string, Ownership>): Ownership & { mixed: boolean } {
  const memberState = region.memberProvinceIds.map((id) => ownership[id] ?? { owner: null, controller: null });
  const choose = (field: "owner" | "controller") => {
    const counts = new Map<string | null, number>();
    for (const state of memberState) counts.set(state[field], (counts.get(state[field]) ?? 0) + 1);
    return [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || String(a).localeCompare(String(b)))[0]?.[0] ?? null;
  };
  return {
    owner: choose("owner"),
    controller: choose("controller"),
    mixed: new Set(memberState.map((state) => `${state.owner ?? ""}|${state.controller ?? ""}`)).size > 1,
  };
}

// Clamp a desired camera into the theatre: width in [theatre/MAX_ZOOM, theatre],
// height derived from the theatre aspect (no distortion), origin kept inside.
function clampCamera(cam: Rect, theatre: Rect): Rect {
  const aspect = theatre.w / theatre.h;
  const w = Math.min(theatre.w, Math.max(theatre.w / MAX_ZOOM, cam.w));
  const h = w / aspect;
  const x = Math.min(theatre.x + theatre.w - w, Math.max(theatre.x, cam.x));
  const y = Math.min(theatre.y + theatre.h - h, Math.max(theatre.y, cam.y));
  return { x, y, w, h };
}

function openingFrame(theatre: Rect, focus: { x: number; y: number } | null): Rect {
  const w = OPENING_FRACTION * theatre.w;
  const h = w / (theatre.w / theatre.h);
  const cx = focus?.x ?? theatre.x + theatre.w / 2;
  const cy = focus?.y ?? theatre.y + theatre.h / 2;
  return clampCamera({ x: cx - w / 2, y: cy - h / 2, w, h }, theatre);
}

// Zoom by `factor` (>1 zooms in) keeping the viewBox point (fx,fy) under the cursor.
function zoomAt(cam: Rect, theatre: Rect, factor: number, fx: number, fy: number): Rect {
  const rx = (fx - cam.x) / cam.w;
  const ry = (fy - cam.y) / cam.h;
  const w = cam.w / factor;
  const h = cam.h / factor;
  return clampCamera({ x: fx - rx * w, y: fy - ry * h, w, h }, theatre);
}

export function ProvinceMap({ enableFullscreen = false }: { enableFullscreen?: boolean } = {}) {
  const [geo, setGeo] = useState<RegionData | null>(null);
  const [theatre, setTheatre] = useState<Theatre | null>(null);
  const [rivers, setRivers] = useState<string[]>([]);
  const [towns, setTowns] = useState<Town[]>([]);
  const [townsLoaded, setTownsLoaded] = useState(false);
  const [polities, setPolities] = useState<Record<string, MapPolity>>({});
  const [own, setOwn] = useState<Record<string, Ownership>>({});
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<DisplayRegion | null>(null);
  const [status, setStatus] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    fetch(STATIC.regions).then((response) => response.json()).then(setGeo).catch(() => setStatus("Failed to load map geometry."));
    fetch(STATIC.rivers).then((response) => response.json()).then((data) => setRivers(data.rivers)).catch(() => {});
    fetch(STATIC.towns)
      .then((response) => response.json())
      .then((data) => setTowns(data.towns))
      .catch(() => {})
      .finally(() => setTownsLoaded(true));
    fetch(STATIC.polities)
      .then((response) => response.json() as Promise<Record<string, { name: string; color: string }>>)
      .then((data) => setPolities(Object.fromEntries(Object.entries(data).map(([id, polity]) => [id, { id, ...polity }]))))
      .catch(() => {});
    fetch(STATIC.theatre)
      .then((response) => response.json() as Promise<Theatre>)
      .then((data) => {
        setTheatre(data);
        setOwn(seededOwnership(data));
      })
      .catch(() => setStatus("Failed to load the campaign theatre."));
  }, []);

  // Database ownership replaces the seed preview when available. The preview
  // remains useful during local art iteration before a database has been seeded.
  useEffect(() => {
    let active = true;
    const applyState = (state: MapState) => {
      setPolities((current) => ({ ...current, ...Object.fromEntries(state.polities.map((polity) => [polity.id, polity])) }));
      setOwn((current) => ({ ...current, ...ownershipByProvince(state) }));
      setTick(state.tick);
      setStatus("");
    };
    api.mapState().then((state) => active && applyState(state)).catch((error) => active && setStatus(`Preview ownership shown · ${apiErrorMessage(error)}`));
    const stop = streamMap({
      onState: (state) => active && applyState(state),
      onChange: (change) => active && setOwn((current) => ({
        ...current,
        [change.provinceId]: { owner: change.ownerPolityId, controller: change.controllerPolityId },
      })),
      onError: () => {},
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  const activeTownNames = useMemo(() => new Set(theatre?.activeTownNames ?? []), [theatre]);

  const land = useMemo(() => geo?.regions.filter((region) => region.type === "land") ?? [], [geo]);
  const sea = useMemo(() => geo?.regions.filter((region) => region.type === "sea") ?? [], [geo]);
  const visibleTowns = useMemo(() => towns.filter((town) => activeTownNames.has(town.name)), [activeTownNames, towns]);
  const massalia = useMemo(() => towns.find((town) => town.name === "Massalia") ?? null, [towns]);

  const theatreRect = useMemo<Rect | null>(
    () => (theatre ? { x: theatre.viewBox.x, y: theatre.viewBox.y, w: theatre.viewBox.width, h: theatre.viewBox.height } : null),
    [theatre],
  );

  // --- Camera plumbing ------------------------------------------------------
  // cameraRef is the live source of truth (written every pointermove frame);
  // `camera` state is the committed value that drives labels + re-renders.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<Rect | null>(null);
  const [camera, setCamera] = useState<Rect | null>(null);
  const [stageWidthPx, setStageWidthPx] = useState(0);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const didInitCamera = useRef(false);
  // Active pointers → their last client position; a pan uses one, a pinch two.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ startCam: Rect; startDist: number; startMid: { x: number; y: number } } | null>(null);
  const lastTapRef = useRef(0);

  const applyViewBox = useCallback((cam: Rect) => {
    svgRef.current?.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
  }, []);

  // Any React render re-asserts the live camera onto the SVG, so a mid-gesture
  // data update (ownership stream) never snaps the viewBox back.
  useLayoutEffect(() => {
    if (cameraRef.current) applyViewBox(cameraRef.current);
  });

  // The opening frame, computed once the theatre + town data have settled.
  useEffect(() => {
    if (didInitCamera.current || !theatreRect || !townsLoaded) return;
    const frame = openingFrame(theatreRect, massalia ? { x: massalia.x, y: massalia.y } : null);
    cameraRef.current = frame;
    setCamera(frame);
    didInitCamera.current = true;
  }, [theatreRect, townsLoaded, massalia]);

  // Track the stage's rendered pixel width so labels can hold a constant on-screen
  // size (fullscreen and card differ; a resize changes it too).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidthPx(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fullscreen, geo, theatre]);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (cameraRef.current) applyViewBox(cameraRef.current);
    });
  }, [applyViewBox]);

  const commitCamera = useCallback(() => {
    if (cameraRef.current) setCamera(cameraRef.current);
  }, []);

  // Discrete camera moves (buttons, keyboard, double-tap) go straight to state.
  const setCameraNow = useCallback((next: Rect) => {
    cameraRef.current = next;
    applyViewBox(next);
    setCamera(next);
  }, [applyViewBox]);

  const clientToViewBox = useCallback((clientX: number, clientY: number, cam: Rect) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 };
    return {
      x: cam.x + ((clientX - rect.left) / rect.width) * cam.w,
      y: cam.y + ((clientY - rect.top) / rect.height) * cam.h,
    };
  }, []);

  const stepZoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    if (!theatreRect || !cameraRef.current) return;
    const cam = cameraRef.current;
    const focal = clientX != null && clientY != null ? clientToViewBox(clientX, clientY, cam) : { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 };
    setCameraNow(zoomAt(cam, theatreRect, factor, focal.x, focal.y));
  }, [clientToViewBox, setCameraNow, theatreRect]);

  const goHome = useCallback(() => {
    if (!theatreRect) return;
    setCameraNow(openingFrame(theatreRect, massalia ? { x: massalia.x, y: massalia.y } : null));
  }, [massalia, setCameraNow, theatreRect]);

  const goFit = useCallback(() => {
    if (!theatreRect) return;
    setCameraNow({ ...theatreRect });
  }, [setCameraNow, theatreRect]);

  // --- Pointer gestures -----------------------------------------------------
  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!theatreRect || !cameraRef.current) return;
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length === 1) {
      // Double-tap / double-click to step in toward the tap.
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
      const [a, b] = points;
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      gestureRef.current = { startCam: { ...cameraRef.current }, startDist: dist, startMid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
    }
  }, [stepZoom, theatreRect]);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!theatreRect || !gestureRef.current || !pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const gesture = gestureRef.current;

    if (points.length === 1) {
      // Pan: translate the start camera by the pointer delta in viewBox units.
      const dxUnits = ((event.clientX - gesture.startMid.x) / rect.width) * gesture.startCam.w;
      const dyUnits = ((event.clientY - gesture.startMid.y) / rect.height) * gesture.startCam.h;
      cameraRef.current = clampCamera({ ...gesture.startCam, x: gesture.startCam.x - dxUnits, y: gesture.startCam.y - dyUnits }, theatreRect);
      scheduleFrame();
    } else if (points.length >= 2) {
      // Pinch: zoom about the two-finger midpoint while panning with it.
      const [a, b] = points;
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      const scale = dist / (gesture.startDist || dist);
      const startW = gesture.startCam.w;
      const aspect = theatreRect.w / theatreRect.h;
      const w = Math.min(theatreRect.w, Math.max(theatreRect.w / MAX_ZOOM, startW / scale));
      const h = w / aspect;
      // Keep the start-midpoint viewBox point under the current midpoint.
      const fx = gesture.startCam.x + ((gesture.startMid.x - rect.left) / rect.width) * gesture.startCam.w;
      const fy = gesture.startCam.y + ((gesture.startMid.y - rect.top) / rect.height) * gesture.startCam.h;
      const midX = (a!.x + b!.x) / 2;
      const midY = (a!.y + b!.y) / 2;
      const x = fx - ((midX - rect.left) / rect.width) * w;
      const y = fy - ((midY - rect.top) / rect.height) * h;
      cameraRef.current = clampCamera({ x, y, w, h }, theatreRect);
      scheduleFrame();
    }
  }, [scheduleFrame, theatreRect]);

  const endPointer = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    try { if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId); } catch { /* best-effort */ }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      draggingRef.current = false;
      gestureRef.current = null;
      commitCamera();
    } else if (pointersRef.current.size === 1 && cameraRef.current) {
      // Second finger lifted mid-pinch → continue as a pan from here.
      const remaining = [...pointersRef.current.values()][0]!;
      gestureRef.current = { startCam: { ...cameraRef.current }, startDist: 0, startMid: { x: remaining.x, y: remaining.y } };
    }
  }, [commitCamera]);

  // Wheel is registered non-passive so preventDefault stops page scroll / browser
  // zoom. Rapid trackpad wheels update the ref + rAF; state commits when they stop.
  const wheelTimer = useRef<number | null>(null);
  const wheelLogicRef = useRef<(event: WheelEvent) => void>(() => {});
  wheelLogicRef.current = (event) => {
    if (!theatreRect || !cameraRef.current) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const focal = clientToViewBox(event.clientX, event.clientY, cameraRef.current);
    cameraRef.current = zoomAt(cameraRef.current, theatreRect, factor, focal.x, focal.y);
    scheduleFrame();
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => commitCamera(), 140);
  };
  const nativeWheelListener = useRef<(event: WheelEvent) => void>((event) => wheelLogicRef.current(event));
  const setSvgElement = useCallback((element: SVGSVGElement | null) => {
    if (svgRef.current) svgRef.current.removeEventListener("wheel", nativeWheelListener.current);
    svgRef.current = element;
    if (element) element.addEventListener("wheel", nativeWheelListener.current, { passive: false });
  }, []);
  useEffect(() => () => {
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!theatreRect || !cameraRef.current) return;
    const cam = cameraRef.current;
    const panStep = cam.w * 0.15;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); stepZoom(1.3); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); stepZoom(1 / 1.3); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, x: cam.x - panStep }, theatreRect)); }
    else if (event.key === "ArrowRight") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, x: cam.x + panStep }, theatreRect)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, y: cam.y - panStep }, theatreRect)); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setCameraNow(clampCamera({ ...cam, y: cam.y + panStep }, theatreRect)); }
  }, [setCameraNow, stepZoom, theatreRect]);

  // Escape exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFullscreen(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  // --- Static map layers (memoised so camera moves never re-create paths) ----
  const staticLayers = useMemo(() => {
    if (!geo) return null;
    return (
      <>
        <defs>
          <mask id={FOG_MASK_ID}>
            <rect width={geo.width} height={geo.height} fill="white" />
            {geo.regions.map((region) => <path key={region.id} d={region.d} fill="black" fillRule="evenodd" stroke="black" strokeWidth={2} />)}
          </mask>
        </defs>

        <image href={STATIC.terrain} width={geo.width} height={geo.height} />
        <g>
          {sea.map((region) => (
            <path
              key={region.id}
              d={region.d}
              fill="transparent"
              fillRule="evenodd"
              stroke="#496d91"
              strokeWidth={0.85}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <g>
          {land.map((region) => {
            const ownership = regionOwnership(region, own);
            const occupied = ownership && ownership.controller !== ownership.owner;
            const colony = !ownership.owner && region.colonyCandidate;
            return (
              <path
                key={region.id}
                data-region={region.id}
                d={region.d}
                fillRule="evenodd"
                fill={ownership?.owner ? (polities[ownership.owner]?.color || UNCLAIMED_COLOR) : colony ? COLONY_COLOR : UNCLAIMED_COLOR}
                fillOpacity={ownership?.owner ? 0.62 : colony ? 0.34 : 0.16}
                stroke={occupied ? (polities[ownership.controller ?? ""]?.color || UNCLAIMED_COLOR) : region.frontier ? "#d2b16f" : "#302d28"}
                strokeWidth={occupied ? 2.1 : region.frontier ? 1.9 : 1.35}
                strokeDasharray={occupied || ownership.mixed ? "5 3" : undefined}
                vectorEffect="non-scaling-stroke"
                style={{ transition: "fill 300ms ease, fill-opacity 300ms ease", cursor: "help" }}
                onMouseEnter={() => { if (!draggingRef.current) setHover(region); }}
                onMouseLeave={() => { if (!draggingRef.current) setHover(null); }}
              />
            );
          })}
        </g>
        <g fill="none" stroke="#4d82b8" strokeWidth={1.1} strokeLinecap="round" opacity={0.95}>
          {rivers.map((river, index) => <path key={index} d={river} />)}
        </g>

        {/* Permanent campaign boundary: retain the selected relief while hiding
            all region borders and gameplay detail beyond the theatre. */}
        <rect width={geo.width} height={geo.height} fill="#000" mask={`url(#${FOG_MASK_ID})`} pointerEvents="none" />
      </>
    );
  }, [geo, land, own, polities, rivers, sea]);

  if (!geo || !theatre || !theatreRect || !camera) {
    return <p style={{ padding: 24, fontFamily: "Spectral, serif" }}>Charting the Mediterranean…</p>;
  }

  const zoom = theatreRect.w / camera.w;
  // Counter-scale the town markers so they hold a constant on-screen size: the
  // user-unit size shrinks as the camera does. Falls back to a zoom-based scale
  // before the stage width is measured.
  const unitPerPx = stageWidthPx > 0 ? camera.w / stageWidthPx : camera.w / theatreRect.w;
  const labelPx = TOWN_LABEL_PX * unitPerPx;
  const dotPx = TOWN_DOT_PX * unitPerPx;
  const labelledTowns = zoom >= LABEL_ZOOM_THRESHOLD ? visibleTowns : visibleTowns.filter((town) => town.name === "Massalia");

  const hoverRegionOwn = hover ? regionOwnership(hover, own) : undefined;
  const hoverDescription = hover
    ? `${hover.id} · ${hover.terrain}${hover.coastal ? " · coastal" : ""} · ${hover.memberProvinceIds.length} districts${
        hoverRegionOwn?.owner ? ` · ${polities[hoverRegionOwn.owner]?.name ?? hoverRegionOwn.owner}` : hover.colonyCandidate ? " · open to colonization" : " · unclaimed"
      }${hoverRegionOwn?.mixed ? " · divided control" : hoverRegionOwn && hoverRegionOwn.controller !== hoverRegionOwn.owner ? ` · occupied by ${polities[hoverRegionOwn.controller ?? ""]?.name ?? hoverRegionOwn.controller}` : ""}`
    : `Three regions inland · ${land.length} larger land regions · tick ${tick}`;

  const map = (
    <div className={`pmap${fullscreen ? " pmap-fullscreen" : ""}`}>
      {fullscreen ? <button type="button" className="pmap-close" onClick={() => setFullscreen(false)}>Close</button> : null}
      <div className="pmap-header">
        <strong>{theatre.name}</strong>
        <span style={{ fontSize: 13 }}>{hoverDescription}</span>
        <span className="pmap-legend">
          <i aria-hidden="true" style={{ width: 12, height: 12, background: COLONY_COLOR, border: "1px solid #5a4a2f", display: "inline-block" }} />
          Open frontier
          <i aria-hidden="true" style={{ width: 12, height: 12, background: "#000", display: "inline-block", marginLeft: 8 }} />
          Beyond the campaign
        </span>
      </div>
      {status ? <div className="pmap-status">{status}</div> : null}

      <div className="pmap-stage" ref={stageRef} style={{ aspectRatio: `${theatreRect.w} / ${theatreRect.h}` }}>
        <svg
          ref={setSvgElement}
          className="pmap-svg"
          viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
          role="img"
          tabIndex={0}
          aria-label={`${theatre.name}: ${theatre.description} Drag to pan, scroll or pinch to zoom.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onKeyDown={onKeyDown}
        >
          {staticLayers}
          <g pointerEvents="none">
            {labelledTowns.map((town) => (
              <g key={town.name}>
                <circle cx={town.x} cy={town.y} r={town.name === "Massalia" ? dotPx * 1.5 : dotPx} fill="#fff" stroke="#3c3c3c" strokeWidth={dotPx * 0.35} />
                <text x={town.x + dotPx * 1.75} y={town.y - dotPx * 1.25} fontSize={town.name === "Massalia" ? labelPx * 1.15 : labelPx} fill="#fff" stroke="#3c3c3c" strokeWidth={labelPx * 0.02} fontWeight="bold">
                  {town.name}
                </text>
              </g>
            ))}
          </g>
        </svg>

        <div className="pmap-controls">
          <button type="button" className="pmap-btn" aria-label="Zoom in" title="Zoom in" onClick={() => stepZoom(1.3)}>+</button>
          <button type="button" className="pmap-btn" aria-label="Zoom out" title="Zoom out" onClick={() => stepZoom(1 / 1.3)}>−</button>
          <button type="button" className="pmap-btn" aria-label="Home" title="Home (Massalia)" onClick={goHome}>⌂</button>
          <button type="button" className="pmap-btn" aria-label="Fit theatre" title="Fit the whole theatre" onClick={goFit}>▣</button>
          {enableFullscreen ? (
            <button type="button" className="pmap-btn" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => setFullscreen((value) => !value)}>⛶</button>
          ) : null}
        </div>
      </div>
    </div>
  );
  return fullscreen ? createPortal(map, document.body) : map;
}
