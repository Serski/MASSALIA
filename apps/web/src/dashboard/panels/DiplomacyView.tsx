import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, type FactionView, type FactionGroup, type FactionCharacterView, type FactionRefView } from "../../api.js";
import { AssetIcon, DashboardCard, StatPips } from "../shared.js";
import { BottomSheet } from "../sheets.js";

// --- League Diplomacy (Atlas Phase 2a) — a Politics tab ---------------------

// Only Rome & Carthage have emblems yet; the other factions render text-only.
const FACTION_ICON: Record<string, string> = {
  rome: "rome.webp", carthage: "carthage.webp", syracuse: "syracuse.webp",
  cadurci: "cadurci.webp", ruteni: "ruteni.webp", helvii: "helvii.webp", gabali: "gabali.webp",
  volcae: "volcae.webp", allobroges: "allobroges.webp", cavares: "cavares.webp",
  vocontii: "vocontii.webp", saluvii: "saluvii.webp", veltanii: "veltanii.webp",
  ligurians: "ligurians.webp", ausci: "ausci.webp", convenae: "convenae.webp",
  tarusates: "tarusates.webp", ilergetae: "ilergetae.webp", lacetani: "lacetani.webp",
};
const FACTION_GROUP_META: { id: FactionGroup; label: string }[] = [
  { id: "gauls", label: "Gauls" },
  { id: "celto-ligurian", label: "Celto-Ligurian" },
  { id: "ligurian", label: "Ligurian" },
  { id: "aquitani", label: "Aquitani" },
  { id: "iberian", label: "Iberian" },
  { id: "major-powers", label: "Major Powers" },
];
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
        <StatPips stats={char} />
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

export function DiplomacyView() {
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
