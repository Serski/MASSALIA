import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage, streamMap, type MapPolity, type MapState } from "../api.js";

/**
 * Read-only campaign map for the first MASSALIA theatre.
 *
 * The full generated terrain remains visible for geographic context, but only
 * the selected Western/Central Mediterranean cells receive borders, ownership,
 * labels and interaction. Everything else sits beneath a permanent campaign-
 * boundary fog. Conquest remains server-owned and disabled while war rules are
 * unfinished.
 */

type Province = {
  id: string;
  type: "land" | "sea" | "wasteland";
  terrain: string;
  coastal: boolean;
  d: string;
};
type GeoData = { width: number; height: number; provinces: Province[] };
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
};

const UNCLAIMED_COLOR = "#8a8a8a";
const COLONY_COLOR = "#c8ad73";
const FOG_MASK_ID = "massalia-theatre-fog-mask";

const STATIC = {
  provinces: "/map/provinces_px.json",
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

export function ProvinceMap() {
  const [geo, setGeo] = useState<GeoData | null>(null);
  const [theatre, setTheatre] = useState<Theatre | null>(null);
  const [rivers, setRivers] = useState<string[]>([]);
  const [towns, setTowns] = useState<Town[]>([]);
  const [polities, setPolities] = useState<Record<string, MapPolity>>({});
  const [own, setOwn] = useState<Record<string, Ownership>>({});
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<Province | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetch(STATIC.provinces).then((response) => response.json()).then(setGeo).catch(() => setStatus("Failed to load map geometry."));
    fetch(STATIC.rivers).then((response) => response.json()).then((data) => setRivers(data.rivers)).catch(() => {});
    fetch(STATIC.towns).then((response) => response.json()).then((data) => setTowns(data.towns)).catch(() => {});
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

  const activeIds = useMemo(() => new Set(theatre?.activeProvinceIds ?? []), [theatre]);
  const playableLandIds = useMemo(() => new Set(theatre?.playableLandProvinceIds ?? []), [theatre]);
  const activeSeaIds = useMemo(() => new Set(theatre?.activeSeaProvinceIds ?? []), [theatre]);
  const frontierIds = useMemo(() => new Set(theatre?.frontierProvinceIds ?? []), [theatre]);
  const colonyIds = useMemo(() => new Set(theatre?.colonyCandidateProvinceIds ?? []), [theatre]);
  const activeTownNames = useMemo(() => new Set(theatre?.activeTownNames ?? []), [theatre]);

  const activeProvinces = useMemo(() => geo?.provinces.filter((province) => activeIds.has(province.id)) ?? [], [activeIds, geo]);
  const land = useMemo(() => geo?.provinces.filter((province) => province.type === "land" && playableLandIds.has(province.id)) ?? [], [geo, playableLandIds]);
  const sea = useMemo(() => geo?.provinces.filter((province) => province.type === "sea" && activeSeaIds.has(province.id)) ?? [], [activeSeaIds, geo]);
  const waste = useMemo(() => geo?.provinces.filter((province) => province.type === "wasteland" && activeIds.has(province.id)) ?? [], [activeIds, geo]);
  const visibleTowns = useMemo(() => towns.filter((town) => activeTownNames.has(town.name)), [activeTownNames, towns]);

  if (!geo || !theatre) return <p style={{ padding: 24, fontFamily: "Spectral, serif" }}>Charting the Mediterranean…</p>;

  const colorOf = (polityId: string | null) => (polityId && polities[polityId]?.color) || UNCLAIMED_COLOR;
  const hoverOwn = hover ? own[hover.id] : undefined;
  const hoverDescription = hover
    ? `${hover.id} · ${hover.terrain}${hover.coastal ? " · coastal" : ""}${
        hoverOwn?.owner ? ` · ${polities[hoverOwn.owner]?.name ?? hoverOwn.owner}` : colonyIds.has(hover.id) ? " · open to colonization" : " · unclaimed"
      }${hoverOwn && hoverOwn.controller !== hoverOwn.owner ? ` · occupied by ${polities[hoverOwn.controller ?? ""]?.name ?? hoverOwn.controller}` : ""}`
    : `Three provinces inland · ${land.length} land provinces · tick ${tick}`;

  return (
    <div style={{ padding: 12, fontFamily: "Spectral, serif" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 8, color: "var(--dash-stone, #d7ccb7)" }}>
        <strong>{theatre.name}</strong>
        <span style={{ fontSize: 13 }}>{hoverDescription}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <i aria-hidden="true" style={{ width: 12, height: 12, background: COLONY_COLOR, border: "1px solid #5a4a2f", display: "inline-block" }} />
          Open frontier
          <i aria-hidden="true" style={{ width: 12, height: 12, background: "#18201f", opacity: 0.8, display: "inline-block", marginLeft: 8 }} />
          Beyond the campaign
        </span>
      </div>
      {status ? <div style={{ marginBottom: 8, fontSize: 12, color: "var(--dash-gold-bright, #d1ae63)" }}>{status}</div> : null}

      <svg
        viewBox={`${theatre.viewBox.x} ${theatre.viewBox.y} ${theatre.viewBox.width} ${theatre.viewBox.height}`}
        role="img"
        aria-label={`${theatre.name}: ${theatre.description}`}
        style={{ width: "100%", display: "block", overflow: "hidden", background: "#749ab9", borderRadius: 6 }}
      >
        <defs>
          <mask id={FOG_MASK_ID}>
            <rect width={geo.width} height={geo.height} fill="white" />
            {activeProvinces.map((province) => <path key={province.id} d={province.d} fill="black" stroke="black" strokeWidth={2} />)}
          </mask>
        </defs>

        <image href={STATIC.terrain} width={geo.width} height={geo.height} />
        <g>
          {sea.map((province) => <path key={province.id} d={province.d} fill="transparent" stroke="#5d84a8" strokeWidth={0.45} />)}
        </g>
        <g>
          {waste.map((province) => <path key={province.id} d={province.d} fill="#5b5b5b" stroke="#4c4c4c" strokeWidth={0.5} />)}
        </g>
        <g>
          {land.map((province) => {
            const ownership = own[province.id];
            const occupied = ownership && ownership.controller !== ownership.owner;
            const colony = !ownership?.owner && colonyIds.has(province.id);
            return (
              <path
                key={province.id}
                data-province={province.id}
                d={province.d}
                fill={ownership?.owner ? colorOf(ownership.owner) : colony ? COLONY_COLOR : UNCLAIMED_COLOR}
                fillOpacity={ownership?.owner ? 0.62 : colony ? 0.34 : 0.16}
                stroke={occupied ? colorOf(ownership.controller) : frontierIds.has(province.id) ? "#c7ab72" : "#5a5f66"}
                strokeWidth={occupied ? 1.6 : frontierIds.has(province.id) ? 1.0 : 0.58}
                strokeDasharray={occupied ? "4 3" : undefined}
                style={{ transition: "fill 300ms ease, fill-opacity 300ms ease", cursor: "help" }}
                onMouseEnter={() => setHover(province)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </g>
        <g fill="none" stroke="#4d82b8" strokeWidth={1.1} strokeLinecap="round" opacity={0.95}>
          {rivers.map((river, index) => <path key={index} d={river} />)}
        </g>

        {/* Permanent campaign boundary: retain realistic relief while removing
            province borders and gameplay detail beyond the selected theatre. */}
        <rect
          width={geo.width}
          height={geo.height}
          fill="#111a1b"
          opacity={0.76}
          mask={`url(#${FOG_MASK_ID})`}
          pointerEvents="none"
        />

        <g pointerEvents="none">
          {visibleTowns.map((town) => (
            <g key={town.name}>
              <circle cx={town.x} cy={town.y} r={town.name === "Massalia" ? 6 : 4} fill="#fff" stroke="#3c3c3c" strokeWidth={1.4} />
              <text x={town.x + 7} y={town.y - 5} fontSize={13} fill="#fff" stroke="#3c3c3c" strokeWidth={0.3} fontWeight="bold">
                {town.name}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
