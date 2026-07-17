import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage, streamMap, type MapChangeType, type MapPolity, type MapState } from "../api.js";

/**
 * MASSALIA province map — live conquest loop.
 *
 * Geometry, terrain, rivers and towns are STATIC files under public/map/ (the
 * bundle's browser assets). Ownership is NOT static: it loads from GET
 * /api/map/state, stays live via the SSE stream (streamMap), and clicks POST a
 * conquest instead of mutating local state (adapted from the reference component).
 */

type Province = {
  id: string;
  type: "land" | "sea" | "wasteland";
  terrain: string;
  coastal: boolean;
  d: string; // prebuilt SVG path in the shared 2400x1991 pixel space
};
type GeoData = { width: number; height: number; provinces: Province[] };
type Town = { name: string; x: number; y: number; polity: string; approx: boolean };
type Ownership = { owner: string | null; controller: string | null };

const UNCLAIMED_COLOR = "#8a8a8a";

const STATIC = {
  provinces: "/map/provinces_px.json",
  rivers: "/map/rivers_px.json",
  terrain: "/map/terrain_px.png",
  towns: "/map/towns_px.json",
};

function ownershipByProvince(state: MapState): Record<string, Ownership> {
  const out: Record<string, Ownership> = {};
  for (const p of state.provinces) out[p.provinceId] = { owner: p.ownerPolityId, controller: p.controllerPolityId };
  return out;
}

export function ProvinceMap() {
  // Static geometry (loaded once from public/map/).
  const [geo, setGeo] = useState<GeoData | null>(null);
  const [rivers, setRivers] = useState<string[]>([]);
  const [towns, setTowns] = useState<Town[]>([]);

  // Live ownership (from the API + realtime stream).
  const [polities, setPolities] = useState<Record<string, MapPolity>>({});
  const [own, setOwn] = useState<Record<string, Ownership>>({});
  const [tick, setTick] = useState<number>(0);

  // Interaction.
  const [brush, setBrush] = useState<string>("massalia");
  const [changeType, setChangeType] = useState<MapChangeType>("annex");
  const [hover, setHover] = useState<Province | null>(null);
  const [status, setStatus] = useState<string>("");

  // Static assets.
  useEffect(() => {
    fetch(STATIC.provinces).then((r) => r.json()).then(setGeo).catch(() => setStatus("Failed to load map geometry."));
    fetch(STATIC.rivers).then((r) => r.json()).then((d) => setRivers(d.rivers)).catch(() => {});
    fetch(STATIC.towns).then((r) => r.json()).then((d) => setTowns(d.towns)).catch(() => {});
  }, []);

  // Ownership: initial snapshot, then live changes. streamMap fires onState once
  // (full snapshot) and onChange per conquest; the REST call gives an instant paint.
  useEffect(() => {
    let active = true;
    const applyState = (s: MapState) => {
      setPolities(Object.fromEntries(s.polities.map((p) => [p.id, p])));
      setOwn(ownershipByProvince(s));
      setTick(s.tick);
    };
    api.mapState().then((s) => active && applyState(s)).catch((e) => active && setStatus(apiErrorMessage(e)));
    const stop = streamMap({
      onState: (s) => active && applyState(s),
      onChange: (c) => active && setOwn((prev) => ({ ...prev, [c.provinceId]: { owner: c.ownerPolityId, controller: c.controllerPolityId } })),
      onError: () => active && setStatus("Realtime stream disconnected."),
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  const land = useMemo(() => geo?.provinces.filter((p) => p.type === "land") ?? [], [geo]);
  const sea = useMemo(() => geo?.provinces.filter((p) => p.type === "sea") ?? [], [geo]);
  const waste = useMemo(() => geo?.provinces.filter((p) => p.type === "wasteland") ?? [], [geo]);

  const colorOf = (polityId: string | null) => (polityId && polities[polityId]?.color) || UNCLAIMED_COLOR;

  const conquer = (id: string) => {
    setStatus(`${changeType === "annex" ? "Annexing" : "Occupying"} ${id} as ${polities[brush]?.name ?? brush}…`);
    api
      .conquerProvince(id, brush, changeType)
      // The SSE 'change' event repaints; also apply the returned change immediately.
      .then((res) => {
        setOwn((prev) => ({ ...prev, [id]: { owner: res.change.ownerPolityId, controller: res.change.controllerPolityId } }));
        setStatus(`${polities[brush]?.name ?? brush} ${changeType === "annex" ? "annexed" : "occupies"} ${id}.`);
      })
      .catch((e) => setStatus(apiErrorMessage(e)));
  };

  if (!geo) return <p style={{ padding: 24, fontFamily: "Spectral, serif" }}>Loading map…</p>;

  const hoverOwn = hover ? own[hover.id] : undefined;

  return (
    <div style={{ padding: 12, fontFamily: "Spectral, serif" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
        {Object.values(polities).map((p) => (
          <button
            key={p.id}
            onClick={() => setBrush(p.id)}
            style={{
              padding: "4px 10px",
              background: p.color,
              color: "#fff",
              textShadow: "0 1px 2px rgba(0,0,0,.6)",
              border: brush === p.id ? "2px solid #111" : "1px solid #999",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {p.name}
          </button>
        ))}
        <span style={{ display: "inline-flex", marginLeft: 12, border: "1px solid #999", borderRadius: 4, overflow: "hidden" }}>
          {(["annex", "occupy"] as const).map((ct) => (
            <button
              key={ct}
              onClick={() => setChangeType(ct)}
              style={{
                padding: "4px 12px",
                background: changeType === ct ? "#2f2a24" : "#efe9dd",
                color: changeType === ct ? "#fff" : "#2f2a24",
                border: "none",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {ct}
            </button>
          ))}
        </span>
        <span style={{ marginLeft: 12, fontSize: 13, color: "#333" }}>
          {hover
            ? `${hover.id} · ${hover.terrain}${hover.coastal ? " · coastal" : ""}${
                hoverOwn?.owner ? ` · ${polities[hoverOwn.owner]?.name ?? hoverOwn.owner}` : " · unclaimed"
              }${hoverOwn && hoverOwn.controller !== hoverOwn.owner ? ` (occupied by ${polities[hoverOwn.controller ?? ""]?.name ?? hoverOwn.controller})` : ""}`
            : `tick ${tick}`}
        </span>
      </div>
      {status && <div style={{ marginBottom: 8, fontSize: 13, color: "#7a5c1e" }}>{status}</div>}

      <svg viewBox={`0 0 ${geo.width} ${geo.height}`} style={{ width: "100%", background: "#749ab9", borderRadius: 6 }}>
        <image href={STATIC.terrain} width={geo.width} height={geo.height} />
        <g>
          {sea.map((p) => (
            <path key={p.id} d={p.d} fill="transparent" stroke="#5d84a8" strokeWidth={0.4} />
          ))}
        </g>
        <g>
          {waste.map((p) => (
            <path key={p.id} d={p.d} fill="#5b5b5b" stroke="#4c4c4c" strokeWidth={0.5} />
          ))}
        </g>
        <g>
          {land.map((p) => {
            const o = own[p.id];
            const occupied = o && o.controller !== o.owner;
            return (
              <path
                key={p.id}
                data-province={p.id}
                d={p.d}
                fill={colorOf(o?.owner ?? null)}
                fillOpacity={o?.owner ? 0.62 : 0.12}
                // Occupied provinces (controller != owner) get a bold dashed border in
                // the occupier's color — the war/peace distinction, made visible.
                stroke={occupied ? colorOf(o?.controller ?? null) : "#5a5f66"}
                strokeWidth={occupied ? 1.6 : 0.6}
                strokeDasharray={occupied ? "4 3" : undefined}
                style={{ transition: "fill 300ms ease, fill-opacity 300ms ease", cursor: "pointer" }}
                onClick={() => conquer(p.id)}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </g>
        <g fill="none" stroke="#4d82b8" strokeWidth={1.1} strokeLinecap="round" opacity={0.95}>
          {rivers.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g>
          {towns.map((t) => (
            <g key={t.name}>
              <circle cx={t.x} cy={t.y} r={t.name === "Massalia" ? 6 : 4} fill="#fff" stroke="#3c3c3c" strokeWidth={1.4} />
              <text x={t.x + 7} y={t.y - 5} fontSize={13} fill="#fff" stroke="#3c3c3c" strokeWidth={0.3} fontWeight="bold">
                {t.name}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
