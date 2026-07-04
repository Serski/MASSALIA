import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, type StandingsResponse, type StandingsBoard, type StandingRow, type CityView, type CityGroup, type FactionView, type FactionGroup, type FactionCharacterView, type FactionRefView } from "../../api.js";
import { MapCanvas } from "../../map/MapCanvas.js";
import { AssetIcon, DashboardCard, HouseCrest, titleCase } from "../shared.js";
import { BottomSheet } from "../sheets.js";

// Standings board → stat icon. "wealth" has no icon asset (a coin glyph stands in).
const STAT_ICON: Partial<Record<StandingsBoard, string>> = {
  prestige: "PRESTIGE.webp",
  devotion: "DEVOTION.webp",
  militia: "Militia.webp",
  intelligence: "Intrigue.webp",
};
// Only Rome & Carthage have emblems yet; the other factions render text-only.
const FACTION_ICON: Record<string, string> = {
  rome: "rome.webp", carthage: "carthage.webp", syracuse: "syracuse.webp",
  cadurci: "cadurci.webp", ruteni: "ruteni.webp", helvii: "helvii.webp", gabali: "gabali.webp",
  volcae: "volcae.webp", allobroges: "allobroges.webp", cavares: "cavares.webp",
  vocontii: "vocontii.webp", saluvii: "saluvii.webp", veltanii: "veltanii.webp",
  ligurians: "ligurians.webp", ausci: "ausci.webp", convenae: "convenae.webp",
  tarusates: "tarusates.webp", ilergetae: "ilergetae.webp", lacetani: "lacetani.webp",
};
const STANDINGS_BOARD_META: { id: StandingsBoard; label: string }[] = [
  { id: "prestige", label: "Prestige" },
  { id: "wealth", label: "Wealth" },
  { id: "devotion", label: "Devotion" },
  { id: "militia", label: "Militia" },
  { id: "intelligence", label: "Intelligence" },
];

const STANDINGS_PAGE_SIZE = 20;

// Rank-only by design — these rows carry a position, never a stat value.
const standingsRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 12,
  padding: "8px 4px",
  borderBottom: "1px solid var(--dash-line)",
};
const standingsViewerRowStyle: CSSProperties = {
  ...standingsRowStyle,
  background: "var(--dash-panel-soft)",
  borderRadius: 6,
  borderBottom: "1px solid var(--dash-gold)",
};
const standingsRankStyle: CSSProperties = {
  minWidth: 44,
  color: "var(--dash-gold-bright)",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};
const standingsNameStyle: CSSProperties = { flex: 1, color: "var(--dash-parchment)" };
const standingsMetaStyle: CSSProperties = { color: "var(--dash-stone-dim)", fontSize: "0.85em" };
const standingsBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  margin: "10px 0",
  color: "var(--dash-stone)",
};
const standingsPagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  marginTop: 12,
  color: "var(--dash-stone)",
};

function StandingsRowItem({ row }: { row: StandingRow }) {
  return (
    <li className="atlas-row" style={row.isViewer ? standingsViewerRowStyle : standingsRowStyle}>
      <span style={standingsRankStyle}>#{row.rank}</span>
      <span style={standingsNameStyle}>
        <HouseCrest house={row.house} />
        {row.name}
        {row.isViewer ? <strong style={{ color: "var(--dash-gold)" }}> · You</strong> : null}
      </span>
      <span style={standingsMetaStyle}>
        {titleCase(row.house)}
        {row.classId ? ` · ${titleCase(row.classId)}` : ""}
      </span>
    </li>
  );
}

function StandingsView() {
  const [data, setData] = useState<StandingsResponse | null>(null);
  const [error, setError] = useState("");
  const [board, setBoard] = useState<StandingsBoard>("prestige");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .standings()
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "The standings could not be read."));
    return () => {
      cancelled = true;
    };
  }, []);

  // Switching boards resets to the first page (ranks are independent per board).
  useEffect(() => {
    setPage(0);
  }, [board]);

  if (error) return <p className="dashboard-todo" role="status">{error}</p>;
  if (!data) return <p className="dashboard-todo">Reading the standings…</p>;

  const rows = data.boards[board];
  const pageCount = Math.max(1, Math.ceil(rows.length / STANDINGS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * STANDINGS_PAGE_SIZE;
  const pageRows = rows.slice(start, start + STANDINGS_PAGE_SIZE);
  const viewerRow = rows.find((r) => r.isViewer) ?? null;
  const viewerOnPage = viewerRow !== null && viewerRow.rank - 1 >= start && viewerRow.rank - 1 < start + STANDINGS_PAGE_SIZE;
  const boardLabel = STANDINGS_BOARD_META.find((b) => b.id === board)!.label;
  const jumpToViewer = () => {
    if (viewerRow) setPage(Math.floor((viewerRow.rank - 1) / STANDINGS_PAGE_SIZE));
  };

  return (
    <>
      <div className="cs-tabs" role="tablist" aria-label="Leaderboards">
        {STANDINGS_BOARD_META.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={board === b.id}
            className={`cs-tab${board === b.id ? " on" : ""}`}
            onClick={() => setBoard(b.id)}
          >
            {STAT_ICON[b.id] ? (
              <AssetIcon file={STAT_ICON[b.id]!} alt="" className="asset-icon stat-tab-icon" />
            ) : (
              <span className="stat-tab-icon stat-tab-coin" aria-hidden="true">🪙</span>
            )}
            {b.label}
          </button>
        ))}
      </div>

      {viewerRow ? (
        <div style={standingsBarStyle}>
          <span>
            You rank <strong style={{ color: "var(--dash-gold-bright)" }}>#{viewerRow.rank}</strong> of {rows.length} in {boardLabel}.
          </span>
          {!viewerOnPage ? (
            <button type="button" className="panel-btn ghost" onClick={jumpToViewer}>
              Jump to my rank
            </button>
          ) : null}
        </div>
      ) : null}

      <DashboardCard>
        {rows.length === 0 ? (
          <p className="dashboard-todo">No players are ranked yet.</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {pageRows.map((row) => (
              <StandingsRowItem key={row.playerId} row={row} />
            ))}
          </ol>
        )}
        {viewerRow && !viewerOnPage ? (
          <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            <StandingsRowItem row={viewerRow} />
          </ol>
        ) : null}
      </DashboardCard>

      {pageCount > 1 ? (
        <div style={standingsPagerStyle}>
          <button type="button" className="panel-btn ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            Prev
          </button>
          <span>
            Page {safePage + 1} of {pageCount}
          </span>
          <button type="button" className="panel-btn ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}

// --- League Cities & Diplomacy (Atlas Phase 2a) ----------------------------

const CITY_GROUP_META: { id: CityGroup; label: string }[] = [
  { id: "metropolis", label: "Metropolis" },
  { id: "eastern", label: "Eastern Colonies" },
  { id: "western", label: "Western Colonies" },
];

const FACTION_GROUP_META: { id: FactionGroup; label: string }[] = [
  { id: "gauls", label: "Gauls" },
  { id: "celto-ligurian", label: "Celto-Ligurian" },
  { id: "ligurian", label: "Ligurian" },
  { id: "aquitani", label: "Aquitani" },
  { id: "iberian", label: "Iberian" },
  { id: "major-powers", label: "Major Powers" },
];

const cityRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 0.8fr 0.7fr 0.9fr 0.9fr 0.9fr",
  gap: 8,
  alignItems: "center",
  padding: "7px 4px",
  borderBottom: "1px solid var(--dash-line)",
};
const cityHeadStyle: CSSProperties = {
  ...cityRowStyle,
  color: "var(--dash-stone-dim)",
  fontSize: "0.78em",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const numCellStyle: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--dash-parchment)" };

// 1..5 fortification level as filled/empty pips.
function fortPips(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  return "■".repeat(n) + "□".repeat(5 - n);
}

function CitiesView() {
  const [data, setData] = useState<CityView[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .leagueCities()
      .then((res) => !cancelled && setData(res.cities))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "The cities could not be read."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="dashboard-todo" role="status">{error}</p>;
  if (!data) return <p className="dashboard-todo">Reading the colonies…</p>;

  return (
    <>
      {CITY_GROUP_META.map((group) => {
        const inGroup = data.filter((c) => c.group === group.id);
        if (inGroup.length === 0) return null;
        return (
          <DashboardCard key={group.id}>
            <div className="panel-label">{group.label}</div>
            <div style={cityHeadStyle}>
              <span>City</span>
              <span style={{ textAlign: "right" }}>Pop.</span>
              <span style={{ textAlign: "right" }}>Tax</span>
              <span style={{ textAlign: "right" }}>Stability</span>
              <span style={{ textAlign: "right" }}>Forts</span>
              <span style={{ textAlign: "right" }}>Garrison</span>
            </div>
            {inGroup.map((c) => (
              <div key={c.id} className="atlas-row" style={cityRowStyle}>
                <span style={{ color: "var(--dash-parchment)", fontWeight: 600 }}>{c.name}</span>
                <span style={numCellStyle}>{c.population.toLocaleString()}</span>
                <span style={numCellStyle}>{c.tax.toLocaleString()}</span>
                <span style={numCellStyle}>{c.stability}</span>
                <span style={{ ...numCellStyle, color: "var(--dash-gold)", letterSpacing: "1px" }} title={`${c.fortifications}/5`}>
                  {fortPips(c.fortifications)}
                </span>
                <span style={numCellStyle}>{c.garrison.toLocaleString()}</span>
              </div>
            ))}
          </DashboardCard>
        );
      })}
    </>
  );
}

// Colour a relation by its display band's −2..+2 value (hostile → cordial).
function stanceColor(value: number): string {
  if (value <= -2) return "var(--dash-bad)";
  if (value === -1) return "#c98b6a";
  if (value === 0) return "var(--dash-stone)";
  if (value === 1) return "#9bb87a";
  return "var(--dash-good)";
}

// Faint stance-tinted background for the list pill, matching stanceColor's bands.
function stanceTint(value: number): string {
  if (value <= -2) return "rgba(187, 106, 82, 0.16)";
  if (value === -1) return "rgba(201, 139, 106, 0.14)";
  if (value === 0) return "rgba(184, 168, 144, 0.10)";
  if (value === 1) return "rgba(155, 184, 122, 0.14)";
  return "rgba(126, 163, 106, 0.16)";
}

// Compact ±4-pip relation meter: pips fill from the centre outward toward the
// opinion's sign, one pip per 50 points (mirrors OpinionBar's ±200 scale).
function PipMeter({ opinion, color }: { opinion: number; color: string }) {
  const filled = Math.min(4, Math.round(Math.abs(opinion) / 50));
  const neg = opinion < 0;
  const pos = opinion > 0;
  const pip = (on: boolean, key: string) => (
    <span key={key} style={{ width: 6, height: 11, borderRadius: 1, background: on ? color : "var(--dash-line)" }} />
  );
  return (
    <span aria-hidden="true" className="dl-pips" style={{ display: "flex", alignItems: "center", gap: 3, flex: "0 0 auto" }}>
      {[4, 3, 2, 1].map((rank) => pip(neg && rank <= filled, `l${rank}`))}
      <span style={{ width: 1, height: 14, background: "var(--dash-stone-dim)", margin: "0 2px" }} />
      {[1, 2, 3, 4].map((rank) => pip(pos && rank <= filled, `r${rank}`))}
    </span>
  );
}

// A status badge (At War / Allied / Vassal) shown only when the flag is set.
function StatusBadge({ label, title, color }: { label: string; title: string; color: string }) {
  return (
    <span
      title={title}
      style={{ marginLeft: 8, fontSize: "0.72em", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.03em" }}
    >
      {label}
    </span>
  );
}

// The −200..+200 opinion bar: a track with a centre (zero) marker and a fill that
// runs from the centre toward the current opinion, coloured by the display band.
// `height` lets the detail panel reuse the exact same treatment, just bigger.
function OpinionBar({ opinion, color, height = 8 }: { opinion: number; color: string; height?: number }) {
  const clamped = Math.max(-200, Math.min(200, opinion));
  const pct = (clamped / 200) * 50; // ±50% from centre
  const left = clamped >= 0 ? 50 : 50 + pct;
  const width = Math.abs(pct);
  return (
    <div
      style={{ position: "relative", flex: 1, height, borderRadius: height / 2, background: "var(--dash-line)", overflow: "hidden" }}
      aria-hidden="true"
    >
      <div style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, background: color }} />
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--dash-stone-dim)" }} />
    </div>
  );
}

// The list row, as a button — clicking/tapping opens the faction's detail panel.
// A flex roster row (emblem · name/ruler · spacer · pip meter · stance pill);
// resets native button chrome but keeps the .atlas-row hover.
const factionButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px 10px 0",
  width: "100%",
  minWidth: 0,
  textAlign: "left",
  font: "inherit",
  color: "inherit",
  background: "none",
  border: "none",
  borderBottom: "1px solid var(--dash-line)",
  cursor: "pointer",
};

// Signed opinion value, e.g. "+45" / "−137" (en-dash for the minus to match copy).
function signedOpinion(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function FactionStatusBadges({ faction }: { faction: FactionView }) {
  return (
    <>
      {faction.atWar ? <StatusBadge label="⚔ War" title="At war with Massalia" color="var(--dash-bad)" /> : null}
      {faction.allied ? <StatusBadge label="🤝 Allied" title="Allied with Massalia" color="var(--dash-good)" /> : null}
      {faction.vassal ? <StatusBadge label="⛓ Vassal" title="Vassal of Massalia" color="var(--dash-gold-bright)" /> : null}
    </>
  );
}

// Small uppercase section heading inside the detail panel.
function PanelSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: "var(--dash-gold)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.72em", fontWeight: 700, margin: "0 0 4px" }}>
      {children}
    </div>
  );
}

// Stat icon files for the leadership pills (mirrors STAT_ICON without widening its
// StandingsBoard key type — these four are the only stats a CharacterBlock shows).
const STAT_PIP_ICON: Record<"prestige" | "devotion" | "militia" | "intelligence", string> = {
  prestige: "PRESTIGE.webp", devotion: "DEVOTION.webp", militia: "Militia.webp", intelligence: "Intrigue.webp",
};

// One leadership stat: icon + value, icon-only with the name in title/alt for a11y.
function StatPip({ stat, value }: { stat: "prestige" | "devotion" | "militia" | "intelligence"; value: number }) {
  const label = stat.charAt(0).toUpperCase() + stat.slice(1);
  const icon = STAT_PIP_ICON[stat];
  return (
    <span title={label} style={{ display: "inline-flex", gap: 5, alignItems: "center", padding: "2px 8px", borderRadius: 6, background: "var(--dash-panel-soft)", fontSize: "0.78em" }}>
      {icon ? <AssetIcon file={icon} alt={label} className="asset-icon stat-pip-icon" /> : <span style={{ color: "var(--dash-stone-dim)" }}>{label}</span>}
      <span style={{ color: "var(--dash-parchment)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

// A ruler / heir / war-chief: framed portrait + name + role-relative descriptor +
// live age + 4 stats. The portrait file is <factionId>_<roleKey>.webp under
// assets/portraits/diplomacy; AssetIcon hides gracefully when one is missing
// (e.g. factions whose art has not landed), so the row simply renders text-only.
function CharacterBlock({
  factionId,
  roleKey,
  role,
  secondary,
  char,
}: {
  factionId: string;
  roleKey: "ruler" | "heir" | "warchief";
  role: string;
  secondary: string;
  char: FactionCharacterView;
}) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid var(--dash-line)" }}>
      <AssetIcon
        file={`portraits/diplomacy/${factionId}_${roleKey}.webp`}
        alt={char.name}
        className="asset-icon faction-portrait"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span>
            <span style={{ color: "var(--dash-gold-bright)", fontWeight: 700 }}>{char.name}</span>
            <span style={{ color: "var(--dash-stone-dim)", fontSize: "0.85em" }}> · {secondary}</span>
          </span>
          <span style={{ color: "var(--dash-stone-dim)", fontSize: "0.8em", whiteSpace: "nowrap" }}>
            {role} · age {char.age}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <StatPip stat="prestige" value={char.prestige} />
          <StatPip stat="devotion" value={char.devotion} />
          <StatPip stat="militia" value={char.militia} />
          <StatPip stat="intelligence" value={char.intelligence} />
        </div>
      </div>
    </div>
  );
}

// Rivals / Allies as a comma-separated name list, or "None".
function FactionRefList({ label, refs }: { label: string; refs: FactionRefView[] }) {
  return (
    <div style={{ marginTop: 6 }}>
      <span style={{ color: "var(--dash-stone-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.72em", fontWeight: 700, marginRight: 8 }}>{label}</span>
      <span style={{ color: "var(--dash-parchment)" }}>{refs.length ? refs.map((r) => r.name).join(", ") : "None"}</span>
    </div>
  );
}

// Capitalise a relationship descriptor (e.g. "son" → "Son") for display.
function relLabel(rel: string): string {
  return rel.charAt(0).toUpperCase() + rel.slice(1);
}

// Read-only detail panel (Diplomacy D2 + D3): name, group, durable lore blurb, a
// larger opinion bar, band label + signed value, status badges, and — new in D3 —
// the faction's ruler / heir / war-chief (with live age + stats) or its council
// label, plus rival/ally name lists. Reuses the BottomSheet modal (Escape /
// backdrop-tap / focus-trap / mobile bottom-sheet). Display only — no actions (D4).
function FactionDetail({ faction, onClose }: { faction: FactionView | null; onClose: () => void }) {
  const groupLabel = faction ? FACTION_GROUP_META.find((g) => g.id === faction.group)?.label ?? faction.group : "";
  const color = faction ? stanceColor(faction.bandValue) : "var(--dash-stone)";
  return (
    <BottomSheet open={!!faction} onClose={onClose} labelledBy="faction-detail-title" title={faction?.name}>
      {faction ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            {FACTION_ICON[faction.id] ? <AssetIcon file={FACTION_ICON[faction.id]!} alt="" className="asset-icon faction-icon" /> : null}
            <span style={{ color: "var(--dash-stone-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.78em", fontWeight: 700 }}>
              {groupLabel}
            </span>
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <FactionStatusBadges faction={faction} />
            </span>
          </div>

          <p style={{ color: "var(--dash-parchment)", lineHeight: 1.55, margin: "0 0 18px" }}>{faction.blurb}</p>

          <OpinionBar opinion={faction.opinion} color={color} height={14} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: "var(--dash-stone-dim)", fontSize: "0.72em", fontVariantNumeric: "tabular-nums" }}>
            <span>−200</span>
            <span>0</span>
            <span>+200</span>
          </div>
          <div style={{ marginTop: 12, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {faction.bandLabel}
            <span style={{ marginLeft: 8, color: "var(--dash-stone-dim)", fontVariantNumeric: "tabular-nums" }}>{signedOpinion(faction.opinion)}</span>
          </div>

          {faction.governance === "institutional" ? (
            <div style={{ marginTop: 20 }}>
              <PanelSectionLabel>Government</PanelSectionLabel>
              <p style={{ color: "var(--dash-parchment)", margin: 0 }}>{faction.institutionLabel}</p>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <PanelSectionLabel>Leadership</PanelSectionLabel>
              {faction.ruler ? <CharacterBlock factionId={faction.id} roleKey="ruler" role="Ruler" secondary={faction.ruler.title} char={faction.ruler} /> : null}
              {faction.heir ? <CharacterBlock factionId={faction.id} roleKey="heir" role="Heir" secondary={relLabel(faction.heir.rel)} char={faction.heir} /> : null}
              {faction.warChief ? <CharacterBlock factionId={faction.id} roleKey="warchief" role="War-chief" secondary={faction.warChief.title} char={faction.warChief} /> : null}
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <PanelSectionLabel>Relations</PanelSectionLabel>
            <FactionRefList label="Rivals" refs={faction.rivals} />
            <FactionRefList label="Allies" refs={faction.allies} />
          </div>
        </>
      ) : null}
    </BottomSheet>
  );
}

function DiplomacyView() {
  const [data, setData] = useState<FactionView[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FactionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .diplomacy()
      .then((res) => !cancelled && setData(res.factions))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Diplomacy could not be read."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="dashboard-todo" role="status">{error}</p>;
  if (!data) return <p className="dashboard-todo">Reading the embassies…</p>;

  return (
    <>
      {FACTION_GROUP_META.map((group) => {
        const inGroup = data.filter((f) => f.group === group.id);
        if (inGroup.length === 0) return null;
        return (
          <DashboardCard key={group.id}>
            <div className="panel-label">{group.label}</div>
            {inGroup.map((f) => {
              const color = stanceColor(f.bandValue);
              return (
                <button
                  key={f.id}
                  type="button"
                  className="atlas-row"
                  style={factionButtonStyle}
                  onClick={() => setSelected(f)}
                  aria-label={`${f.name} — ${f.bandLabel}, opinion ${signedOpinion(f.opinion)}. Open details.`}
                >
                  <span aria-hidden="true" style={{ width: 3, alignSelf: "stretch", background: color, borderRadius: 0 }} />
                  {FACTION_ICON[f.id] ? <AssetIcon file={FACTION_ICON[f.id]!} alt="" className="asset-icon faction-emblem" /> : <span className="faction-emblem" aria-hidden="true" />}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, color: "var(--dash-parchment)", fontFamily: "var(--font-display)", fontSize: "1.05rem", lineHeight: 1.15 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{f.name}</span>
                      <FactionStatusBadges faction={f} />
                    </span>
                    {(f.ruler?.name ?? f.institutionLabel) ? (
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dash-stone-dim)", fontSize: "0.8em", marginTop: 2 }}>
                        {f.ruler?.name ?? f.institutionLabel}
                      </span>
                    ) : null}
                  </span>
                  <PipMeter opinion={f.opinion} color={color} />
                  <span style={{ background: stanceTint(f.bandValue), color, fontWeight: 700, fontSize: "0.8em", textTransform: "uppercase", letterSpacing: "0.04em", padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap", flex: "0 0 auto" }}>
                    {f.bandLabel}
                    <span style={{ marginLeft: 6, color: "var(--dash-stone-dim)", fontVariantNumeric: "tabular-nums" }}>{signedOpinion(f.opinion)}</span>
                  </span>
                </button>
              );
            })}
          </DashboardCard>
        );
      })}
      <FactionDetail faction={selected} onClose={() => setSelected(null)} />
    </>
  );
}

export default function AtlasPanel() {
  // Atlas is a sub-tabbed container. Map is the existing campaign map; Standings
  // is the live leaderboards; Cities and Diplomacy are live world-state readouts.
  const [tab, setTab] = useState<"map" | "standings" | "cities" | "diplomacy">("map");
  return (
    <section className="dashboard-panel atlas-dashboard-panel" aria-labelledby="atlas-dashboard-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">League map</p>
        <h1 id="atlas-dashboard-title">Atlas</h1>
        <p>The campaign map, the city standings, and the wider world to come.</p>
      </div>

      <div className="cs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "map"} className={`cs-tab${tab === "map" ? " on" : ""}`} onClick={() => setTab("map")}>
          Map
        </button>
        <button type="button" role="tab" aria-selected={tab === "standings"} className={`cs-tab${tab === "standings" ? " on" : ""}`} onClick={() => setTab("standings")}>
          Standings
        </button>
        <button type="button" role="tab" aria-selected={tab === "cities"} className={`cs-tab${tab === "cities" ? " on" : ""}`} onClick={() => setTab("cities")}>
          Cities
        </button>
        <button type="button" role="tab" aria-selected={tab === "diplomacy"} className={`cs-tab${tab === "diplomacy" ? " on" : ""}`} onClick={() => setTab("diplomacy")}>
          Diplomacy
        </button>
      </div>

      {tab === "map" ? (
        <DashboardCard className="dashboard-map-card">
          <MapCanvas />
        </DashboardCard>
      ) : tab === "standings" ? (
        <StandingsView />
      ) : tab === "cities" ? (
        <CitiesView />
      ) : (
        <DiplomacyView />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top-bar + slide-up sheets (Inventory / Character) ported from the v8 mockup.
// ---------------------------------------------------------------------------
