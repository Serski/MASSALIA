import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forceStats, HOME_POLITY_ID, moveVerdict, renderForce, routeFor, verdictsFor, type CampaignForcePart, type MapActionType } from "@massalia/shared";
import { api, apiBaseUrl, ApiError, type BarracksRosterRow, type BaseView, type MapActReport, type MapActType, type MapMoveReport, type MapReachView, type MoveTargetView, type ReachEntry } from "../api.js";
import { AssetIcon, CULTURE_WEBP, formatClock, formatDuration, marchLine, POLITY_CREST, titleCase, useCountdownSeconds } from "../dashboard/shared.js";
import { mapActionButtons, withReach, type MapActionButton } from "./mapActions.js";

// Attack, Raid and Scout are the actions that resolve (Colonise waits for 3d).
const actionable = (type: MapActionType): type is MapActType => type === "attack" || type === "raid" || type === "scout";
import "./World2Map.css";

const EMPTY_FLEET: MapReachView["fleet"] = { ships: {}, range: 0, space: 0, tiers: [] };

// What the picker acts on: a townless region, a town, or (for a move) one of
// the player's places by base id.
export type PickTarget = { kind: "region" | "town"; id: string; regionId: string; name: string };

// "Held by your house · tribute 120 dr a day", "· garrison too small for
// tribute (30 men needed)", or for a region "· 15 grain, 8 timber a day · +5
// levy a year".
export function holdingLine(b: BaseView): string {
  const h = b.holding;
  if (!h) return "Held by your house — a base for your forces.";
  if (b.townId) {
    if (h.garrison < h.minGarrison) return `Held by your house · garrison too small for tribute (${h.minGarrison} men needed)`;
    return `Held by your house · tribute ${h.perDay.drachmae} dr a day`;
  }
  const goods = [h.perDay.grain ? `${h.perDay.grain} grain` : null, h.perDay.timber ? `${h.perDay.timber} timber` : null].filter(Boolean).join(", ");
  return `Held by your house · ${goods} a day · +${h.levyPerYear} levy a year`;
}

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
// Public town survey (townstats.json): population and walls for every town. No
// military number lives in that file — strength comes from the authenticated
// military read below, and only for what the player is entitled to see.
type TownStats = { population: number; walls: number };
type TownStatsFile = { version: number; towns: Record<string, TownStats> };
// GET /api/map/military: Massalia's live pools ("home", every player) and this
// dynasty's scouting snapshots ("intel", frozen at scoutedGameDate). A target with
// no entry is simply unknown to the player ("No survey yet").
type MilitarySource = "home" | "intel";
type TownMilitaryView = { garrison: number; pentekonters: number; triremes: number; source: MilitarySource; scoutedGameDate?: string };
type RegionMilitaryView = { warband: number; source: MilitarySource; scoutedGameDate?: string };
type MilitaryPayload = { towns: Record<string, TownMilitaryView>; regions: Record<string, RegionMilitaryView> };

type Rect = { x: number; y: number; w: number; h: number };
type Box = { w: number; h: number };

const WORLD_SRC = "/map2/world2.json";
const TERRAIN_SRC = "/map2/terrain2.webp";
const POLITICS_SRC = "/map2/politics2.json";
const NAMES_SRC = "/map2/names2.json";
const TOWNSTATS_SRC = "/map2/townstats.json";
const MILITARY_SRC = `${apiBaseUrl}/api/map/military`;
// Shield colour for regions nobody holds (states with no crest art use their own colour).
const UNCLAIMED_GREY = "#8f8a82";
const OWNER_TINT_OPACITY = 0.5;

// The app's phone breakpoint (matches the dashboard's 620px).
const MOBILE_QUERY = "(max-width: 620px)";

// --- Camera tuning -----------------------------------------------------------
// Opening frame width as a fraction of the full world width, centred on Massalia.
// Desktop 0.42 frames the Gulf of Lion coast; phones open tighter (0.30) since a
// portrait panel is much narrower.
const OPENING_FRACTION_DESKTOP = 0.42;
const OPENING_FRACTION_MOBILE = 0.30;
// Deepest zoom (= worldWidth / cameraWidth). 7.7 is one plus-step short of the
// old 10: the relief holds up here and the visibility windows all complete by 5.4.
const MAX_ZOOM = 7.7;
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
// Zoom throughout = worldWidth / cameraWidth: 1 at world fit, ~2.4 at the desktop
// opening frame, 10 at the deepest zoom.
//
// Realm rims are switched off for performance: the per-polity erode filters
// re-rasterise on every camera change, which is too costly at overview on phones.
// The code stays dormant behind this flag for a possible future baked version
// (pre-rendered rim geometry instead of live filters). When false, nothing
// rim-related mounts and the map DOM carries no <filter> element.
const REALM_RIMS_ENABLED = false;
// Realm rims: each polity's territory reads as one realm with a continuous
// border just inside its outer edge. Built per polity by the erode technique
// (#w2-realm-rim): the polity's regions drawn as one union in the rim tone,
// minus the same union eroded by the rim width, leaves only the rim. The rim's
// screen width scales with zoom — faint at overview, 2.75px once a few realms
// fill the screen — rising linearly in log(zoom) between the two stops.
const RIM_PX_MIN = 0.9;
const RIM_PX_MAX = 2.75;
const RIM_ZOOM_MIN = 1.3;
const RIM_ZOOM_MAX = 3.2;
// The erode radius is a filter attribute in world units. Rewriting it forces the
// filtered groups to re-rasterise, so applyView writes it only when the zoom has
// moved more than this fraction since the last write, or when a gesture settles.
// A pure pan never changes the zoom, so a pan performs zero filter writes.
const RIM_ZOOM_HYSTERESIS = 0.03;
const REALM_RIM_COLOR = "rgb(30, 22, 14)";
const REALM_RIM_OPACITY = 0.75;
// Town markers are hidden at overview and fade in over this zoom window; their
// tap targets are live only while visible (visibility follows the opacity).
const TOWN_FADE_START = 2.6;
const TOWN_FADE_END = 3.4;
// Realm name labels: one per owning polity, at its largest region's centroid,
// sized by the realm's total area (world units, clamped). Invisible at world fit,
// fading in over FADE_IN and back out over FADE_OUT as the camera dives in.
const REALM_LABEL_SCALE = 0.1;
const REALM_LABEL_MIN = 9;
const REALM_LABEL_MAX = 40;
const REALM_LABEL_FADE_IN_START = 1.45;
const REALM_LABEL_FADE_IN_END = 2.1;
const REALM_LABEL_FADE_OUT_START = 3.4;
const REALM_LABEL_FADE_OUT_END = 5.4;
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
// The width is clamped to [fit/MAX_ZOOM, fit] BEFORE the origin is derived from
// it, so a wheel or pinch that runs past the cap leaves the view exactly where it
// is instead of sliding the focal point a little further on every extra tick.
function zoomAt(cam: Rect, world: Rect, factor: number, fx: number, fy: number, aspect: number): Rect {
  const fit = fitFrame(world, aspect);
  const w = Math.min(fit.w, Math.max(fit.w / MAX_ZOOM, cam.w / factor));
  const h = w / aspect;
  const rx = (fx - cam.x) / cam.w;
  const ry = (fy - cam.y) / cam.h;
  return clampCamera({ x: fx - rx * w, y: fy - ry * h, w, h }, world, aspect);
}

function zoomOf(cam: Rect, world: Rect): number {
  return world.w / cam.w;
}

// 0 at or before `from`, 1 at or after `to`, linear between.
function ramp(value: number, from: number, to: number): number {
  return Math.max(0, Math.min(1, (value - from) / (to - from)));
}

// On-screen rim width for a zoom: RIM_PX_MIN up to RIM_ZOOM_MIN, RIM_PX_MAX from
// RIM_ZOOM_MAX, linear in log(zoom) between.
function rimPxFor(zoom: number): number {
  const t = ramp(Math.log(zoom), Math.log(RIM_ZOOM_MIN), Math.log(RIM_ZOOM_MAX));
  return RIM_PX_MIN + t * (RIM_PX_MAX - RIM_PX_MIN);
}

// Erode radius (world units) that puts rimPxFor(zoom) pixels on screen: exact, so
// the rim never wobbles when it is (re)written mid-pinch or at gesture end.
function rimRadiusFor(cam: Rect, box: Box, world: Rect): number {
  return rimPxFor(zoomOf(cam, world)) * (cam.w / box.w);
}

// Realm labels: fade in past world fit, fade back out once a region fills the screen.
function realmLabelOpacityFor(cam: Rect, world: Rect): number {
  const zoom = zoomOf(cam, world);
  return Math.min(
    ramp(zoom, REALM_LABEL_FADE_IN_START, REALM_LABEL_FADE_IN_END),
    1 - ramp(zoom, REALM_LABEL_FADE_OUT_START, REALM_LABEL_FADE_OUT_END),
  );
}

// Town markers: hidden at overview, fading up over the town window.
function townOpacityFor(cam: Rect, world: Rect): number {
  return ramp(zoomOf(cam, world), TOWN_FADE_START, TOWN_FADE_END);
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

// `refreshToken`: any value whose identity changes when the player's state was
// refreshed (the dashboard passes its player object), so reach is refetched
// after the barracks changes without polling.
// `onRefresh`: the dashboard's state refresh, called after an action's data
// arrives so the header (drachmae) follows the report without polling.
export function World2Map({ fill = false, refreshToken, onRefresh }: { fill?: boolean; refreshToken?: unknown; onRefresh?: () => void } = {}) {
  const [world, setWorld] = useState<World | null>(null);
  const [politics, setPolitics] = useState<Politics | null>(null);
  const [status, setStatus] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // A selected town swaps the region panel for the town panel (same anchor logic).
  const [selectedTown, setSelectedTown] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [townStats, setTownStats] = useState<Record<string, TownStats>>({});
  const [military, setMilitary] = useState<MilitaryPayload>({ towns: {}, regions: {} });
  // Reach per land region (null until fetched, or when not signed in): gates the
  // Attack / Raid / Colonise buttons beyond the legality matrix.
  const [reach, setReach] = useState<Record<string, ReachEntry> | null>(null);
  const [reachBases, setReachBases] = useState<MapReachView["bases"]>([]);
  // The campaign calendar and the server clock offset it is read against.
  const [campaign, setCampaign] = useState<MapReachView["campaign"] | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  // The winter countdown, on the server clock (the reopening instant shifted by
  // the payload's clock offset). Declared with the other hooks, above the
  // early return below, so the hook order never changes between renders.
  const winterClosed = campaign !== null && !campaign.open;
  const opensOnDevice = winterClosed && campaign.opensAt ? new Date(Date.parse(campaign.opensAt) - clockOffset).toISOString() : null;
  const winterLeft = useCountdownSeconds(opensOnDevice);
  const [reachFleet, setReachFleet] = useState<MapReachView["fleet"]>(EMPTY_FLEET);
  // Every place the player may move men to, with its steps from each base.
  const [moveTargets, setMoveTargets] = useState<MoveTargetView[]>([]);
  // The force picker (Attack / Raid / Scout on a region or a town, or a move to
  // one of the player's places), the roster it lists, and the report after an
  // action. Whole rows or part of a trained row.
  const [picker, setPicker] = useState<{ type: MapActType | "move"; target: PickTarget } | null>(null);
  const [roster, setRoster] = useState<BarracksRosterRow[] | null>(null);
  const [report, setReport] = useState<MapActReport | MapMoveReport | null>(null);
  // The player's men in the selected place (a town when one is open, else the
  // region): those standing there and any party heading there, with a countdown
  // to the earliest arrival (server clock). At zero the roster is refetched once
  // so the settle can land them.
  const placeId = selectedTown ?? selected;
  const menHere = useMemo(() => {
    const rows = roster ?? [];
    const garrison = placeId ? rows.filter((r) => r.basedAt === placeId && r.movingTo === null && r.active) : [];
    const heading = placeId ? rows.filter((r) => r.movingTo === placeId) : [];
    const arrivals = heading.map((r) => r.arrivesAt).filter((a): a is string => a !== null).sort();
    return { garrison, heading, earliest: arrivals[0] ?? null };
  }, [roster, placeId]);
  const menLeft = useCountdownSeconds(menHere.earliest ? new Date(Date.parse(menHere.earliest) - clockOffset).toISOString() : null);
  const rosterRefetched = useRef(new Set<string>());
  useEffect(() => {
    if (!menHere.earliest || menLeft > 0) return;
    const key = `${placeId}:${menHere.earliest}`;
    if (rosterRefetched.current.has(key)) return;
    rosterRefetched.current.add(key);
    api
      .barracks()
      .then((view) => setRoster(view.roster))
      .catch(() => {});
  }, [menHere.earliest, menLeft, placeId]);
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
    // Military entitlements, fetched once per map load. Not signed in (or the API
    // unreachable) simply leaves every strength row at "No survey yet".
    fetch(MILITARY_SRC, { credentials: "include" })
      .then((response) => (response.ok ? (response.json() as Promise<MilitaryPayload>) : null))
      .then((payload) => {
        if (payload) setMilitary({ towns: payload.towns ?? {}, regions: payload.regions ?? {} });
      })
      .catch(() => {});
  }, []);

  // Reach: fetched when the map opens and again whenever the dashboard refreshes
  // the player (a barracks change). Not signed in leaves the matrix's verdicts.
  useEffect(() => {
    let cancelled = false;
    api
      .barracks()
      .then((view) => {
        if (!cancelled) setRoster(view.roster);
      })
      .catch(() => {});
    api
      .mapReach()
      .then((view) => {
        if (cancelled) return;
        setReach(view.reach ?? {});
        setReachBases(view.bases ?? []);
        setReachFleet(view.fleet ?? EMPTY_FLEET);
        setMoveTargets(view.moveTargets ?? []);
        setCampaign(view.campaign ?? null);
        setClockOffset(view.now ? Date.parse(view.now) - Date.now() : 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // Regions the player holds render as Massalia's own (colour, crest, and the
  // legality matrix's home rule), with a note in the panel. Nothing else on the
  // map knows the player, so the holding rides on the polity layer. A held town
  // is the player's too, but its region is not: only the town panel changes.
  const isHolding = (b: BaseView) => b.kind === "colony" || b.kind === "conquest";
  const heldRegions = useMemo(() => new Map(reachBases.filter((b) => isHolding(b) && b.townId === null).map((b) => [b.regionId, b])), [reachBases]);
  const heldTowns = useMemo(() => new Map(reachBases.filter((b) => isHolding(b) && b.townId !== null).map((b) => [b.townId!, b])), [reachBases]);
  const held = useMemo(() => new Set(heldRegions.keys()), [heldRegions]);
  const moveTargetById = useMemo(() => new Map(moveTargets.map((t) => [t.id, t])), [moveTargets]);
  const politicsView = useMemo<Politics | null>(() => {
    if (!politics || held.size === 0) return politics;
    const owners = { ...politics.owners };
    for (const id of held) owners[id] = HOME_POLITY_ID;
    return { ...politics, owners };
  }, [politics, held]);

  // Display names for every place a picker or a mission line may mention:
  // regions from the names file, towns from the world file, and whatever the
  // reach payload named.
  const placeNames = useMemo(() => {
    const out: Record<string, string> = { ...names };
    for (const t of world?.towns ?? []) out[t.id] = t.name;
    for (const b of reachBases) out[b.id] = b.name;
    for (const t of moveTargets) out[t.id] = t.name;
    return out;
  }, [names, world, reachBases, moveTargets]);

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
    if (!world || !politicsView) return out;
    const byPolity = new Map<string, Province[]>();
    for (const province of land) {
      const owner = politicsView.owners[province.id];
      if (!owner || owner === "unclaimed" || !politicsView.polities[owner]) continue;
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
      out.push({ id, name: politicsView.polities[id]!.name, regions, area, x: largest.x, y: largest.y });
    }
    return out;
  }, [world, land, politicsView]);

  // Town id -> culture icon URL, for towns whose region has a culture-bearing
  // owner. Stable across camera moves (depends only on world + politics).
  const townCultureIcon = useMemo(() => {
    const out = new Map<string, string>();
    if (!world || !politicsView) return out;
    for (const province of world.provinces) {
      const owner = politicsView.owners[province.id];
      const culture = owner ? politicsView.polities[owner]?.culture : undefined;
      const icon = culture ? CULTURE_WEBP[culture] : undefined;
      if (!icon) continue;
      for (const townId of province.towns) out.set(townId, icon);
    }
    return out;
  }, [world, politicsView]);

  // --- Camera plumbing ------------------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Imperative hooks for the camera-dependent bits of the scene: the rim erode
  // radius, the realm-label fade and the town-marker fade. The "last written"
  // refs let applyView skip redundant writes (a pan changes none of them).
  const rimRadiusRef = useRef<SVGFEMorphologyElement | null>(null);
  const rimZoomRef = useRef<number | null>(null);
  const labelsRef = useRef<SVGGElement | null>(null);
  const lastLabelOpacityRef = useRef<number | null>(null);
  const townsRef = useRef<SVGGElement | null>(null);
  const lastTownOpacityRef = useRef<number | null>(null);
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

  // Push a camera onto the scene without React. Every call writes the viewBox;
  // the filter radius is written only when the zoom moved past the hysteresis
  // (or `settle` is set at gesture end / on commit), and the two fades only when
  // their value changed — so a pure pan touches the viewBox and popover alone.
  const applyView = useCallback((cam: Rect, settle = false) => {
    svgRef.current?.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    if (worldRect) {
      const zoom = zoomOf(cam, worldRect);
      const b = boxRef.current;
      if (REALM_RIMS_ENABLED && rimRadiusRef.current && b.w > 0) {
        const last = rimZoomRef.current;
        if (settle || last === null || Math.abs(zoom / last - 1) > RIM_ZOOM_HYSTERESIS) {
          rimRadiusRef.current.setAttribute("radius", String(rimRadiusFor(cam, b, worldRect)));
          rimZoomRef.current = zoom;
        }
      }
      const labelOpacity = realmLabelOpacityFor(cam, worldRect);
      if (labelsRef.current && labelOpacity !== lastLabelOpacityRef.current) {
        labelsRef.current.style.opacity = String(labelOpacity);
        lastLabelOpacityRef.current = labelOpacity;
      }
      const townOpacity = townOpacityFor(cam, worldRect);
      if (townsRef.current && townOpacity !== lastTownOpacityRef.current) {
        townsRef.current.style.opacity = String(townOpacity);
        townsRef.current.style.visibility = townOpacity > 0 ? "visible" : "hidden";
        lastTownOpacityRef.current = townOpacity;
      }
    }
    positionPopover(cam);
  }, [positionPopover, worldRect]);

  // Any React render re-asserts the live camera onto the SVG + popover. Renders
  // happen at commit points (gesture end), so this is where the rim settles exactly.
  useLayoutEffect(() => {
    if (cameraRef.current) applyView(cameraRef.current, true);
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
    applyView(next, true);
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
            const polityId = politicsView?.owners[province.id];
            const color = polityId ? politicsView?.polities[polityId]?.color : undefined;
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

        {/* Realm rims (dormant unless REALM_RIMS_ENABLED): per polity, its regions
            as one union in the rim tone (seam-sealed like the tint), run through
            #w2-realm-rim so only the outer rim survives. Internal region lines keep
            the hairline above; unowned and unclaimed land carries no rim. Group
            opacity applies after the filter. */}
        {REALM_RIMS_ENABLED ? (
          <g pointerEvents="none" opacity={REALM_RIM_OPACITY}>
            {realms.map((realm) => (
              <g key={realm.id} filter="url(#w2-realm-rim)" fill={REALM_RIM_COLOR} stroke={REALM_RIM_COLOR} strokeWidth={SEAL_STROKE_WIDTH} strokeLinejoin="round">
                {realm.regions.map((province) => (
                  <path key={province.id} d={province.path} fillRule="evenodd" />
                ))}
              </g>
            ))}
          </g>
        ) : null}

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
  }, [world, land, seaZones, fog, hover, politicsView, realms, onRegionEnter, onRegionLeave]);

  // The world must load before we can render anything, but the stage renders as
  // soon as the world is ready (even before the camera) so its box gets measured
  // — the opening-frame effect needs that box, so the camera depends on it.
  if (!world || !worldRect) {
    return <p style={{ padding: 24, fontFamily: "Spectral, serif" }}>Charting the known world…</p>;
  }

  const unitPerPx = camera ? (box.w > 0 ? camera.w / box.w : camera.w / worldRect.w) : 0;
  const dotPx = TOWN_DOT_PX * unitPerPx;
  const iconPx = CULTURE_ICON_PX * unitPerPx;
  // Render-time values for the rim radius and the two fades (exact at every
  // commit); applyView keeps them live between commits.
  const rimRadius = REALM_RIMS_ENABLED && camera && box.w > 0 ? rimRadiusFor(camera, box, worldRect) : 0;
  const realmLabelOpacity = camera ? realmLabelOpacityFor(camera, worldRect) : 0;
  const townOpacity = camera ? townOpacityFor(camera, worldRect) : 0;

  const selectedProvince = selected ? provincesById.get(selected) ?? null : null;
  const selectedOwnerId = selectedProvince ? politicsView?.owners[selectedProvince.id] ?? null : null;
  const selectedOwner = selectedOwnerId ? politicsView?.polities[selectedOwnerId] ?? null : null;
  const selectedHeld = selectedProvince ? held.has(selectedProvince.id) : false;
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
  const regionMil = selectedProvince ? military.regions[selectedProvince.id] : undefined;
  // Reach for the open target: a town resolves to its region through world2.json.
  const regionReach = selectedProvince ? reach?.[selectedProvince.id] : undefined;
  const townReach = selectedTown ? reach?.[townRegionById.get(selectedTown) ?? ""] : undefined;
  // Winter: Attack, Raid and Scout wait for spring. The countdown hook itself
  // runs above the "Charting the known world" early return (every hook must run
  // on every render); only the line is built here.
  const winterLine = winterClosed ? `The passes are closed until spring. Opens in ${formatDuration(winterLeft)}` : null;
  const withWinter = (actions: { buttons: MapActionButton[]; caption: string | null }) => {
    if (!winterLine) return actions;
    const buttons = actions.buttons.map((b) => (b.enabled && actionable(b.type) ? { ...b, enabled: false, title: winterLine } : b));
    return { buttons, caption: buttons.some((b) => b.title === winterLine) ? winterLine : actions.caption };
  };
  const regionActions = selectedProvince
    ? withWinter(withReach(mapActionButtons({ kind: "region", hasTown: selectedProvince.towns.length > 0, ownerId: selectedOwnerId }), regionReach))
    : null;
  // "Your garrison: 30 hoplites · Your men: 20 peltasts returning in 02:14:07".
  const forceParts = (rows: BarracksRosterRow[]): CampaignForcePart[] => {
    const merged = new Map<string, CampaignForcePart>();
    for (const r of rows) {
      const key = `${r.source}:${r.unitId}`;
      const m = merged.get(key);
      if (m) m.count += r.count;
      else merged.set(key, r.source === "trained" ? { count: r.count, label: r.label, plural: r.plural, source: "trained" } : { count: r.count, label: r.label, source: "band" });
    }
    return [...merged.values()];
  };
  const yourMenLine = (() => {
    const parts: string[] = [];
    if (menHere.garrison.length > 0) parts.push(`Your garrison: ${renderForce(forceParts(menHere.garrison))}`);
    if (menHere.heading.length > 0) {
      const returning = menHere.heading.every((r) => r.basedAt === r.movingTo);
      parts.push(`Your men: ${renderForce(forceParts(menHere.heading))} ${returning ? "returning" : "arriving"} in ${formatClock(menLeft)}`);
    }
    return parts.length ? parts.join(" · ") : null;
  })();

  // Attack / Raid / Scout on a region or a town, or a move to one of the
  // player's places, open the force picker; the roster is fetched fresh each
  // time (the Barracks may have changed).
  const openPicker = (type: MapActType | "move", target: PickTarget) => {
    setPicker({ type, target });
    setRoster(null);
    api
      .barracks()
      .then((view) => setRoster(view.roster))
      .catch(() => setRoster([]));
  };
  const onActed = (res: { report: MapActReport | MapMoveReport; reach: MapReachView; roster: BarracksRosterRow[] }) => {
    setReach(res.reach.reach ?? {});
    setReachBases(res.reach.bases ?? []);
    setReachFleet(res.reach.fleet ?? EMPTY_FLEET);
    setMoveTargets(res.reach.moveTargets ?? []);
    setCampaign(res.reach.campaign ?? null);
    setClockOffset(res.reach.now ? Date.parse(res.reach.now) - Date.now() : 0);
    setRoster(res.roster);
    if (res.report.type !== "move" && res.report.intel) {
      const intel = res.report.intel;
      if (res.report.townId) {
        const townId = res.report.townId;
        setMilitary((m) => ({ ...m, towns: { ...m.towns, [townId]: { garrison: intel.warband, pentekonters: intel.pentekonters ?? 0, triremes: intel.triremes ?? 0, source: "intel", scoutedGameDate: intel.scoutedGameDate } } }));
      } else {
        const regionId = res.report.regionId;
        setMilitary((m) => ({ ...m, regions: { ...m.regions, [regionId]: { warband: intel.warband, source: "intel", scoutedGameDate: intel.scoutedGameDate } } }));
      }
    }
    setPicker(null);
    setReport(res.report);
    onRefresh?.();
  };

  // A held town answers as Massalia's own in its panel (crest, name and the
  // legality matrix), while its region keeps its owner.
  const selectedTownHeld = selectedTown ? heldTowns.get(selectedTown) ?? null : null;
  const townOwnerId = selectedTownHeld ? HOME_POLITY_ID : selectedOwnerId;
  const townActions = selectedTown ? withWinter(withReach(mapActionButtons({ kind: "town", hasTown: true, ownerId: townOwnerId }), townReach)) : null;
  // "Your men here: 20 hoplites" on a place of ours, "Your garrison" on a held region.
  const menLabel = selectedTown || !selectedHeld ? "Your men here" : "Your garrison";
  const yourMenHere = yourMenLine?.replace("Your garrison", menLabel) ?? null;
  // SEND MEN HERE replaces the attack row on any place the player may move men to.
  const moveTargetHere = placeId ? moveTargetById.get(placeId) ?? null : null;
  const sendMenHere = moveTargetHere ? (
    <div className="w2map-actions">
      <button type="button" className="w2map-action w2map-action-move" onClick={() => openPicker("move", { kind: moveTargetHere.townId ? "town" : "region", id: moveTargetHere.id, regionId: moveTargetHere.regionId, name: moveTargetHere.name })}>
        Send men here
      </button>
    </div>
  ) : null;
  const heldLine = (b: BaseView | null) => (b?.holding ? holdingLine(b) : null);

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
        {selectedProvince.type === "land" && selectedProvince.towns.length === 0 ? (
          <>
            <div className="w2map-info-label">Warband</div>
            <div className="w2map-info-row">
              {regionMil ? regionMil.warband.toLocaleString() : <span className="w2map-stat-none">No survey yet</span>}
              {regionMil?.source === "intel" ? <span className="w2map-stat-asof">as of {regionMil.scoutedGameDate}</span> : null}
            </div>
          </>
        ) : null}
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
        {selectedProvince.type === "land" ? (
          <>
            {yourMenHere ? <p className="w2map-your-men">{yourMenHere}</p> : null}
            {selectedHeld ? <p className="w2map-held">{heldLine(heldRegions.get(selectedProvince.id) ?? null) ?? "Held by your house — a base for your forces."}</p> : null}
            <div className="w2map-info-label">Actions</div>
            {sendMenHere ?? (
              <div className="w2map-actions">
                {regionActions!.buttons.map((b) => (
                  <button
                    key={b.type}
                    type="button"
                    className="w2map-action"
                    disabled={!b.enabled}
                    aria-disabled={!b.enabled}
                    title={b.title}
                    onClick={b.enabled && actionable(b.type) && selectedProvince.towns.length === 0 ? () => openPicker(b.type as MapActType, { kind: "region", id: selectedProvince.id, regionId: selectedProvince.id, name: regionName }) : undefined}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            {!sendMenHere && isMobile && regionActions!.caption ? <p className="w2map-action-why">{regionActions!.caption}</p> : null}
          </>
        ) : null}
      </div>
    </>
  ) : null;

  // The town panel: the public survey, the intel block, the player's men and
  // holding, and the actions (or SEND MEN HERE on a place of the player's).
  const townBody = selectedTownObj ? (
    <TownPanel
      town={selectedTownObj}
      regionName={regionName}
      stateName={selectedTownHeld ? (politicsView?.polities[HOME_POLITY_ID]?.name ?? "Massalia") : stateName}
      ownerId={townOwnerId}
      color={selectedTownHeld ? politicsView?.polities[HOME_POLITY_ID]?.color ?? stateColor : stateColor}
      stats={townStats[selectedTownObj.id]}
      mil={military.towns[selectedTownObj.id]}
      held={selectedTownHeld}
      yourMen={yourMenHere}
      actions={townActions!}
      canSendMen={sendMenHere !== null}
      isMobile={isMobile}
      onClose={closeInfo}
      onBack={() => setSelectedTown(null)}
      onAction={(type) => openPicker(type, { kind: "town", id: selectedTownObj.id, regionId: townRegionById.get(selectedTownObj.id) ?? "", name: selectedTownObj.name })}
      onSendMen={() => moveTargetHere && openPicker("move", { kind: "town", id: moveTargetHere.id, regionId: moveTargetHere.regionId, name: moveTargetHere.name })}
    />
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
            {/* Realm rim filter (dormant unless REALM_RIMS_ENABLED): rim = union
                minus its erosion (see RIM_PX_*). The filter region hugs each
                group's bbox (objectBoundingBox units, a hair of slack for
                anti-aliasing): erosion never grows the shape. */}
            {REALM_RIMS_ENABLED ? (
              <defs>
                <filter id="w2-realm-rim" filterUnits="objectBoundingBox" x="-1%" y="-1%" width="102%" height="102%" colorInterpolationFilters="sRGB">
                  <feMorphology ref={rimRadiusRef} in="SourceAlpha" operator="erode" radius={rimRadius} result="inner" />
                  <feComposite in="SourceGraphic" in2="inner" operator="out" />
                </filter>
              </defs>
            ) : null}

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
                live in the popover and town panel). Hidden at overview: the group
                fades up over the town window (applyView writes opacity, and
                visibility so hidden markers take no taps). Markers are tappable
                (data-town; the tap hit-test in endPointer checks them first). */}
            <g ref={townsRef} className="w2map-town-markers" pointerEvents="none" style={{ opacity: townOpacity, visibility: townOpacity > 0 ? "visible" : "hidden" }}>
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

        {picker && world ? (
          <ForcePicker
            type={picker.type}
            target={picker.target}
            names={placeNames}
            entry={reach?.[picker.target.regionId]}
            moveTargets={moveTargets}
            fleet={reachFleet}
            roster={roster}
            onClose={() => setPicker(null)}
            onActed={onActed}
          />
        ) : null}
        {report ? <BattleReport report={report} onClose={() => setReport(null)} /> : null}

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

// ---------------------------------------------------------------------------
// The town panel: "Walls 2 · Population 4,000" from the public survey (every
// town), garrison and fleet only when the player is entitled to them (home or
// intel) with "No survey yet" otherwise, the player's men standing there, the
// holding line for a held town, and the actions — Attack, Raid and Scout open
// the picker; on a place of the player's, SEND MEN HERE replaces the row.
// ---------------------------------------------------------------------------

export function TownPanel({
  town,
  regionName,
  stateName,
  ownerId,
  color,
  stats,
  mil,
  held,
  yourMen,
  actions,
  canSendMen,
  isMobile,
  onClose,
  onBack,
  onAction,
  onSendMen,
}: {
  town: { id: string; name: string };
  regionName: string;
  stateName: string;
  ownerId: string | null;
  color: string;
  stats: TownStats | undefined;
  mil: TownMilitaryView | undefined;
  held: BaseView | null;
  yourMen: string | null;
  actions: { buttons: MapActionButton[]; caption: string | null };
  canSendMen: boolean;
  isMobile: boolean;
  onClose: () => void;
  onBack: () => void;
  onAction: (type: MapActType) => void;
  onSendMen: () => void;
}) {
  return (
    <>
      <button type="button" className="w2map-info-close" onClick={onClose} aria-label="Close">Close</button>
      <div className="w2map-info-body">
        <button type="button" className="w2map-back" onClick={onBack}>
          ‹ {regionName}
        </button>
        <div className="w2map-state w2map-state-town">
          <StateCrest polityId={ownerId} color={color} />
          <div className="w2map-state-text">
            <h2 className="w2map-state-name">{town.name}</h2>
            <p className="w2map-region-name">{stateName} · {regionName}</p>
          </div>
        </div>
        <div className="w2map-info-label">Survey</div>
        <p className="w2map-survey-line" data-testid="town-survey">
          {stats ? (
            <>
              <span className="w2map-stat-pips" aria-hidden="true">{wallPips(stats.walls)}</span> Walls {stats.walls} · Population {stats.population.toLocaleString()}
            </>
          ) : (
            "No survey of the walls or the people."
          )}
        </p>
        <dl className="w2map-stats" data-testid="town-intel">
          <div className="w2map-stat">
            <dt>Garrison</dt>
            <dd>{mil ? mil.garrison.toLocaleString() : <span className="w2map-stat-none">No survey yet</span>}</dd>
          </div>
          <div className="w2map-stat">
            <dt>Fleet</dt>
            <dd>
              {mil ? (
                <>
                  {mil.pentekonters.toLocaleString()} pentekonters · {mil.triremes.toLocaleString()} triremes
                </>
              ) : (
                <span className="w2map-stat-none">No survey yet</span>
              )}
            </dd>
          </div>
        </dl>
        {mil?.source === "intel" ? <p className="w2map-stat-asof">as of {mil.scoutedGameDate}</p> : null}
        {yourMen ? <p className="w2map-your-men">{yourMen}</p> : null}
        {held ? <p className="w2map-held">{holdingLine(held)}</p> : null}
        <div className="w2map-info-label">Actions</div>
        {canSendMen ? (
          <div className="w2map-actions">
            <button type="button" className="w2map-action w2map-action-move" onClick={onSendMen}>Send men here</button>
          </div>
        ) : (
          <div className="w2map-actions">
            {actions.buttons.map((b) => (
              <button
                key={b.type}
                type="button"
                className="w2map-action"
                disabled={!b.enabled}
                aria-disabled={!b.enabled}
                title={b.title}
                onClick={b.enabled && actionable(b.type) ? () => onAction(b.type as MapActType) : undefined}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
        {!canSendMen && isMobile && actions.caption ? <p className="w2map-action-why">{actions.caption}</p> : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Force picker: the player's roster rows grouped by base, whole rows or part of
// a trained row, with a live verdict for this action on this target — the
// shared reach rule run against the steps the server reported and the fleet in
// stock. For a move the target is one of the player's places (moveTargets), the
// verdict is the move rule, and a destination selector may be shown (the
// Barracks opens it that way, with one row pre-ticked). One component, mounted
// from the map and from the Barracks. The server stays authoritative: its 409
// lands in the sheet as is.
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<MapActType | "move", string> = { attack: "Attack", raid: "Raid", scout: "Scout", move: "Send men to" };
const FAST_SPD = 6;
// "1 pentekonter and 2 triremes" from ship counts by id and the display names
// ships.json gives them (the id when a name is missing).
export const shipsText = (ships: Record<string, number>, labels: Record<string, string> | undefined, sep = " and ") =>
  Object.entries(ships)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${n} ${(labels?.[id] ?? id).toLowerCase()}${n === 1 ? "" : "s"}`)
    .join(sep);
// Travel for a move, mirroring battle.json's move block (the server decides;
// these only label the picker).
const MOVE_MINUTES_PER_STEP = 30;
const MOVE_MINUTES_WITHIN = 10;

export type PickerReport = MapActReport | MapMoveReport;
export type PickerResult = { report: PickerReport; reach: MapReachView; roster: BarracksRosterRow[] };

// A roster icon the way the Barracks roster shows it: the unit's or band's
// artwork, an emoji when the file is missing.
function RowIcon({ file, source }: { file: string; source: BarracksRosterRow["source"] }) {
  return <AssetIcon file={file} alt="" className="asset-icon w2map-pick-icon" fallback={<span aria-hidden="true">{source === "band" ? "⚔️" : "🛡️"}</span>} />;
}

function RecoveringRow({ row, names }: { row: BarracksRosterRow; names: Record<string, string> }) {
  const left = useCountdownSeconds(row.arrivesAt);
  return (
    <li className="w2map-pick-row dim">
      <span className="w2map-pick-check">
        <RowIcon file={row.icon} source={row.source} />
        <span className="w2map-pick-label">{row.label} · {row.count}</span>
      </span>
      <span className="w2map-pick-note">{marchLine(row, names, left) ?? `recovering · ${formatDuration(left)}`}</span>
    </li>
  );
}

// The travel a move takes from one base, from its steps: within one region,
// one land step, or the seas crossed.
function moveTravel(steps: { landSteps: number | null; seaSteps: number | null } | undefined): { route: "within" | "land" | "sea"; steps: number; minutes: number } | null {
  if (!steps) return null;
  if (steps.landSteps === 0) return { route: "within", steps: 0, minutes: MOVE_MINUTES_WITHIN };
  if (steps.landSteps === 1) return { route: "land", steps: 1, minutes: MOVE_MINUTES_PER_STEP };
  if (steps.seaSteps !== null) return { route: "sea", steps: steps.seaSteps, minutes: steps.seaSteps * MOVE_MINUTES_PER_STEP };
  return null;
}
const travelClock = (minutes: number) => formatClock(minutes * 60);

export function ForcePicker({
  type,
  target,
  names,
  entry,
  moveTargets = [],
  destinations = false,
  preselect = [],
  fleet,
  roster,
  onClose,
  onActed,
}: {
  type: MapActType | "move";
  /** the region or town acted on; for a move, the destination (by base id) */
  target: PickTarget;
  names: Record<string, string>;
  /** the reach entry for the target's region (actions only) */
  entry?: ReachEntry | undefined;
  /** every place the player may move men to (moves only) */
  moveTargets?: MoveTargetView[];
  /** show a destination selector over moveTargets (the Barracks' way in) */
  destinations?: boolean;
  /** row ids ticked at their full count when the picker opens */
  preselect?: string[];
  fleet: MapReachView["fleet"];
  roster: BarracksRosterRow[] | null;
  onClose: () => void;
  onActed: (res: PickerResult) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect));
  // How many men of a trained row march (default the whole row); bands go whole.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Shown once a tick in a second base has cleared the first.
  const [switched, setSwitched] = useState(false);
  // The destination of a move, when a selector is shown.
  const [destId, setDestId] = useState(target.id);
  const isMove = type === "move";
  const dest = isMove ? (moveTargets.find((t) => t.id === destId) ?? null) : null;
  const targetName = isMove ? (dest?.name ?? names[destId] ?? destId) : target.name;

  const rows = roster ?? [];
  const eligible = rows.filter((r) => r.active && r.movingTo === null);
  const byBase = new Map<string, BarracksRosterRow[]>();
  for (const r of eligible) byBase.set(r.basedAt, [...(byBase.get(r.basedAt) ?? []), r]);
  // Rows still training are not listed at all; rows recovering stay, greyed.
  const others = rows.filter((r) => r.active && r.movingTo !== null);
  const selected = eligible.filter((r) => picked.has(r.id));
  const base = selected[0]?.basedAt ?? null;
  const sentOf = (r: BarracksRosterRow) => (r.source === "band" ? r.count : Math.min(r.count, Math.max(1, counts[r.id] ?? r.count)));
  const fleetStats = { range: fleet.range, space: fleet.space, tiers: fleet.tiers };
  const verdictOf = (steps: { landSteps: number | null; seaSteps: number | null }, force: ReturnType<typeof forceStats>) => {
    if (isMove) return moveVerdict(steps, force, fleetStats);
    const v = verdictsFor(steps, force, fleetStats);
    return type === "attack" ? v.attack : v.raid;
  };

  // The steps from one base alone: for an action the reach entry's byBase (an
  // older payload without it falls back to the record's own steps); for a move
  // the destination's byBase. And whether any force at all could reach the
  // target from there: one fast man in one hull's space, so a base greys only
  // for reasons no selection could mend (no base within reach, the fleet's
  // range, no hulls at all). For a move the destination itself is no origin.
  const stepsFrom = (baseId: string) => (isMove ? dest?.byBase?.[baseId] : (entry?.byBase?.[baseId] ?? entry));
  const baseVerdict = (baseId: string): { ok: boolean; reason?: string } => {
    if (isMove && baseId === destId) return { ok: false, reason: "The men already stand there." };
    const steps = stepsFrom(baseId);
    if (!steps) return { ok: false, reason: isMove ? "Men may only be sent to Massalia's own ground or a holding of yours." : "That land cannot be reached." };
    return verdictOf(steps, forceStats([{ spd: FAST_SPD, space: 1, count: 1 }]));
  };

  const force = forceStats(selected.map((r) => ({ spd: r.stats.spd ?? 0, space: r.stats.space ?? 1, count: sentOf(r) })));
  const steps = base === null ? (isMove ? undefined : entry) : stepsFrom(base);
  let verdict = steps ? verdictOf(steps, force) : { ok: false, reason: isMove ? "Choose the rows that march." : "That land cannot be reached." };
  if (base !== null && isMove && base === destId) verdict = { ok: false, reason: "The men already stand there." };
  if (verdict.ok && type === "scout" && !selected.some((r) => (r.stats.spd ?? 0) >= FAST_SPD)) verdict = { ok: false, reason: `A scouting party needs a man at Spd ${FAST_SPD} or more.` };
  const route = steps && selected.length > 0 ? (isMove ? moveTravel(steps) : routeFor(type === "attack" ? "attack" : "raid", steps, force)) : null;

  // A force marches from one base: ticking a row in a second base clears the first.
  const toggle = (r: BarracksRosterRow) =>
    setPicked((prev) => {
      if (prev.has(r.id)) {
        const next = new Set(prev);
        next.delete(r.id);
        return next;
      }
      const rowsOfBase = new Set(eligible.filter((x) => x.basedAt === r.basedAt).map((x) => x.id));
      const sameBase = [...prev].every((id) => rowsOfBase.has(id));
      if (!sameBase) setSwitched(true);
      return new Set([...(sameBase ? prev : []), r.id]);
    });

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const sent = selected.map((r) => ({ rowId: r.id, count: sentOf(r) }));
      const res = isMove ? await api.mapMove(destId, sent) : await api.mapAct(type, target.kind === "town" ? { townId: target.id } : { regionId: target.id }, sent);
      onActed(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
    }
  };

  // The destination selector: every place the player may move men to, with the
  // travel from the ticked base (or the nearest base when none is ticked);
  // unreachable ones greyed with the reason.
  const destinationOptions = destinations
    ? moveTargets.map((t) => {
        const from = base ?? Object.keys(t.byBase).find((b) => b !== t.id) ?? null;
        const s = from ? t.byBase[from] : undefined;
        const travel = from === t.id ? null : moveTravel(s);
        const v = from ? (from === t.id ? { ok: false, reason: "The men already stand there." } : (s ? moveVerdict(s, force.men > 0 ? force : forceStats([{ spd: FAST_SPD, space: 1, count: 1 }]), fleetStats) : { ok: false, reason: "No base within reach." })) : { ok: true };
        const note = v.ok && travel ? travelClock(travel.minutes) : (v.reason ?? "Out of reach");
        return { id: t.id, name: t.name, ok: v.ok && travel !== null, note };
      })
    : [];

  return (
    <div className="w2map-modal" role="dialog" aria-label={`${ACTION_LABEL[type]} ${targetName}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="w2map-modal-card">
        <button type="button" className="w2map-info-close" onClick={onClose} aria-label="Close">Close</button>
        <div className="w2map-modal-head">
          <div className="w2map-info-label">{ACTION_LABEL[type]} · {targetName}</div>
          {destinations ? (
            <label className="w2map-pick-dest">
              <span>Destination</span>
              <select value={destId} disabled={busy} onChange={(e) => setDestId(e.target.value)} aria-label="Destination">
                {destinationOptions.map((o) => (
                  <option key={o.id} value={o.id} disabled={!o.ok}>
                    {o.name} · {o.note}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="w2map-pick-scroll">
          {roster === null ? (
            <p className="w2map-info-empty">Mustering…</p>
          ) : eligible.length === 0 ? (
            <p className="w2map-info-empty">No men under arms.</p>
          ) : (
            [...byBase.entries()].map(([baseId, list]) => {
              const cannot = baseVerdict(baseId);
              const unreachable = !cannot.ok;
              return (
                <div key={baseId} className={`w2map-pick-group${unreachable ? " unreachable" : ""}`} data-base={baseId}>
                  <p className="w2map-pick-base">From {names[baseId] ?? baseId}</p>
                  {unreachable ? <p className="w2map-pick-why">{cannot.reason}</p> : null}
                  <ul className="w2map-pick-list">
                    {list.map((r) => {
                      const otherBase = base !== null && base !== baseId;
                      return (
                        <li key={r.id} className={`w2map-pick-row${unreachable || otherBase ? " dim" : ""}`} title={unreachable ? cannot.reason : otherBase ? "A force marches from one base." : undefined}>
                          <span className="w2map-pick-check">
                            <input type="checkbox" checked={picked.has(r.id)} disabled={unreachable || busy} onChange={() => toggle(r)} aria-label={`${r.label}, ${r.count}`} />
                            <RowIcon file={r.icon} source={r.source} />
                            <span className="w2map-pick-label">{r.label} · {r.count}</span>
                            {r.source === "trained" ? (
                              <input
                                type="number"
                                className="w2map-pick-count"
                                min={1}
                                max={r.count}
                                value={sentOf(r)}
                                disabled={unreachable || busy || !picked.has(r.id)}
                                onChange={(e) => setCounts((prev) => ({ ...prev, [r.id]: Math.min(r.count, Math.max(1, parseInt(e.target.value, 10) || 1)) }))}
                                aria-label={`men from ${r.label}`}
                              />
                            ) : null}
                          </span>
                          <span className="w2map-pick-note">
                            Atk {r.stats.atk ?? 0} · Def {r.stats.def ?? 0} · Msl {r.stats.msl ?? 0} · Mor {r.stats.mor ?? 0} · Spd {r.stats.spd ?? 0} · Space {r.stats.space ?? 1}
                            {r.source === "band" ? " · A band marches as one." : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
          {switched ? <p className="w2map-pick-why">A force marches from one base.</p> : null}
          {others.length > 0 ? (
            <ul className="w2map-pick-list">
              {others.map((r) => (
                <RecoveringRow key={r.id} row={r} names={names} />
              ))}
            </ul>
          ) : null}
        </div>
        <div className="w2map-modal-footer">
          <div className={`w2map-verdict${verdict.ok ? " ok" : ""}`}>
            {selected.length === 0 ? (
              <span>Choose the rows that march.</span>
            ) : (
              <>
                <span>{force.men} men · space {force.space}{force.fast ? " · fast" : ""}</span>
                {route ? (
                  <span>
                    {route.route === "within"
                      ? "within the region"
                      : route.route === "land"
                        ? `by land · ${route.steps} step${route.steps === 1 ? "" : "s"}`
                        : `by sea · ${route.steps} sea${route.steps === 1 ? "" : "s"} · space ${force.space} of ${fleet.space} aboard${shipsText(fleet.ships, fleet.labels, " · ") ? ` · ${shipsText(fleet.ships, fleet.labels, " · ")}` : ""}`}
                    {isMove && "minutes" in route ? ` · arrives in ${travelClock(route.minutes)}` : ""}
                  </span>
                ) : null}
                <span>{verdict.ok ? (isMove ? "Ready to march." : "Within reach.") : verdict.reason}</span>
              </>
            )}
          </div>
          {error ? <p className="w2map-action-why" role="alert">{error}</p> : null}
          <div className="w2map-actions">
            <button type="button" className="w2map-action" disabled={busy || selected.length === 0 || !verdict.ok} onClick={go}>
              {busy ? "…" : "Go"}
            </button>
            <button type="button" className="w2map-action ghost" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The report after an action: the outcome line, for a town the walls line and
// (by sea) the fleet line, both sides row by row, plunder or conquest, and the
// recovery time. Scout shows the intel line. A move is one line.
const townFleetText = (f: { pentekonters: number; triremes: number }) => {
  const parts: string[] = [];
  if (f.pentekonters > 0) parts.push(`${f.pentekonters} pentekonter${f.pentekonters === 1 ? "" : "s"}`);
  if (f.triremes > 0) parts.push(`${f.triremes} trireme${f.triremes === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" and ") : "no ships";
};

export function BattleReport({ report, onClose }: { report: PickerReport; onClose: () => void }) {
  if (report.type === "move") {
    return (
      <div className="w2map-modal" role="dialog" aria-label={`March to ${report.townName ?? report.regionName}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="w2map-modal-card">
          <button type="button" className="w2map-info-close" onClick={onClose} aria-label="Close">Close</button>
          <div className="w2map-info-body">
            <div className="w2map-info-label">March · {report.townName ?? report.regionName}</div>
            <p className="w2map-report-line">{report.line}</p>
            <div className="w2map-actions">
              <button type="button" className="w2map-action" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const hours = report.recoveryHours;
  const sailed = shipsText(report.ships, report.shipLabels);
  const place = report.townName ?? report.regionName;
  const fleet = report.fleet;
  return (
    <div className="w2map-modal" role="dialog" aria-label={`${ACTION_LABEL[report.type]} ${place}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="w2map-modal-card">
        <button type="button" className="w2map-info-close" onClick={onClose} aria-label="Close">Close</button>
        <div className="w2map-info-body">
          <div className="w2map-info-label">{ACTION_LABEL[report.type]} · {place}</div>
          <p className="w2map-report-line">{report.line}</p>
          {report.town && report.type !== "scout" ? (
            <p className="w2map-report-note" data-testid="walls-line">Walls {report.town.walls}, garrison defends at {report.town.garrisonDef}</p>
          ) : null}
          {fleet ? (
            <p className="w2map-report-note" data-testid="fleet-line">
              Your {shipsText(fleet.ships, report.shipLabels) || "ships"} against {townFleetText(fleet.defender)}: the landing {fleet.held ? "held" : "was driven off"}
            </p>
          ) : null}
          {report.type !== "scout" && report.winner !== "repulsed" ? (
            <table className="w2map-report-table">
              <thead>
                <tr><th>Rows</th><th>Start</th><th>End</th></tr>
              </thead>
              <tbody>
                {report.attacker.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="w2map-pick-check">
                        <RowIcon file={r.icon} source="trained" />
                        <span>{r.label}{r.broke ? " (broke)" : ""}</span>
                      </span>
                    </td>
                    <td>{r.start}</td>
                    <td>{r.end}</td>
                  </tr>
                ))}
                {report.defender ? <tr className="w2map-report-enemy"><td>{report.defender.label}</td><td>{report.defender.start}</td><td>{report.defender.end}</td></tr> : null}
              </tbody>
            </table>
          ) : null}
          {report.plunder ? <p className="w2map-report-note">Plunder: {report.plunder.drachmae} drachmae, {report.plunder.grain} grain.</p> : null}
          {report.conquest ? <p className="w2map-report-note">{place} is yours. The survivors hold it.</p> : null}
          {report.rounds > 0 ? <p className="w2map-report-note">{report.rounds} round{report.rounds === 1 ? "" : "s"} fought{sailed ? ` · sailed with ${sailed}` : ""}.</p> : null}
          <p className="w2map-report-note">The party {report.destination === (report.townId ?? report.regionId) ? "settles in" : "returns"} in {hours}h.</p>
          <div className="w2map-actions">
            <button type="button" className="w2map-action" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
