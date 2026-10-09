import { useEffect, useState, type CSSProperties } from "react";
import { api, ApiError, type CityView, type CityGroup } from "../../api.js";
import { DashboardCard } from "../shared.js";

// --- League Cities (Atlas Phase 2a) — a Politics tab ------------------------

const CITY_GROUP_META: { id: CityGroup; label: string }[] = [
  { id: "metropolis", label: "Metropolis" },
  { id: "eastern", label: "Eastern Colonies" },
  { id: "western", label: "Western Colonies" },
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
// The League's buildings in a polis (government prompt 2a), one muted line under its row.
const buildingsLineStyle: CSSProperties = { padding: "0 4px 7px", color: "var(--dash-stone-dim)", fontSize: "0.85em", borderBottom: "1px solid var(--dash-line)" };

// "Temple of Artemis · Walls (stands Summer, 292 BC)": the standing ones by name,
// then each one under way with the date it stands.
export function buildingsLine(buildings: CityView["buildings"]): string {
  const list = buildings ?? [];
  const built = list.filter((b) => b.status === "built").map((b) => b.name);
  const underWay = list.filter((b) => b.status === "building").map((b) => `${b.name} (stands ${b.completesLabel ?? "—"})`);
  return [...built, ...underWay].join(" · ");
}

// 1..5 fortification level as filled/empty pips.
function fortPips(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  return "■".repeat(n) + "□".repeat(5 - n);
}

export function CitiesView() {
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
            {inGroup.map((c) => {
              const line = buildingsLine(c.buildings);
              return (
                <div key={c.id}>
                  <div className="atlas-row" style={line ? { ...cityRowStyle, borderBottom: "none" } : cityRowStyle}>
                    <span style={{ color: "var(--dash-parchment)", fontWeight: 600 }}>{c.name}</span>
                    <span style={numCellStyle}>{c.population.toLocaleString()}</span>
                    <span style={numCellStyle}>{c.tax.toLocaleString()}</span>
                    <span style={numCellStyle}>{c.stability}</span>
                    <span style={{ ...numCellStyle, color: "var(--dash-gold-bright)", letterSpacing: "1px" }} title={`${c.fortifications}/5`}>
                      {fortPips(c.fortifications)}
                    </span>
                    <span style={numCellStyle}>{c.garrison.toLocaleString()}</span>
                  </div>
                  {line ? <div className="atlas-row-buildings" style={buildingsLineStyle}>{line}</div> : null}
                </div>
              );
            })}
          </DashboardCard>
        );
      })}
    </>
  );
}
