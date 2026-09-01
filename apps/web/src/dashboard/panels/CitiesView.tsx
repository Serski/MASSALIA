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
