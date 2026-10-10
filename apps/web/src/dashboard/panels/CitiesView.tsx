import { useEffect, useState, type CSSProperties } from "react";
import { api, ApiError, type CityView, type CityGroup, type LeagueCitiesResponse, type LeagueWorksView } from "../../api.js";
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

// The League's plans (government prompt 3b): the muted lines of the three cards.
const worksNoteStyle: CSSProperties = { margin: "0 0 8px", color: "var(--dash-stone-dim)", fontSize: "0.85em" };
const worksItemStyle: CSSProperties = { padding: "7px 4px", borderBottom: "1px solid var(--dash-line)" };
const worksFactsStyle: CSSProperties = { margin: "2px 0 4px", color: "var(--dash-stone-dim)", fontSize: "0.85em" };
const worksRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, padding: "6px 4px", borderBottom: "1px solid var(--dash-line)" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// "Cities of more than 2,000 people" or "Any city".
export function whereLabel(populationAbove: number | null): string {
  return populationAbove === null ? "Any city" : `Cities of more than ${populationAbove.toLocaleString()} people`;
}

function LeagueWorks({ works }: { works: LeagueWorksView }) {
  // The building docket's projects, city by city, in docket order.
  const byCity: { cityId: string; polis: string; names: string[] }[] = [];
  for (const item of works.projects.items) {
    const last = byCity[byCity.length - 1];
    if (last && last.cityId === item.cityId) last.names.push(item.name);
    else byCity.push({ cityId: item.cityId, polis: item.polis, names: [item.name] });
  }
  const f = works.festivals;
  return (
    <>
      <DashboardCard className="works-buildings">
        <div className="panel-label">The League's buildings</div>
        <p className="works-note" style={worksNoteStyle}>One of each per city. Each Winter the Archons put one project to the chamber; it votes in Spring.</p>
        {works.buildings.map((b) => (
          <div key={b.id} className="works-item" style={worksItemStyle}>
            <span className="dashboard-label">{b.name}</span>
            <p className="works-facts" style={worksFactsStyle}>
              {b.cost.toLocaleString()} dr · built in {b.seasons} seasons · {whereLabel(b.populationAbove)} · {cap(b.partyLean)} lean
            </p>
            {b.effects.length ? <p className="agenda-effects">When it stands: {b.effects.join(" · ")}</p> : null}
          </div>
        ))}
      </DashboardCard>
      <DashboardCard className="works-projects">
        <div className="panel-label">The building docket</div>
        <p className="works-note" style={worksNoteStyle}>
          {works.projects.drafting ? "Open now. The Archons choose one this season; the chamber votes next season." : `Opens ${works.projects.opensLabel}. Shown as it would open today; city sizes change at each new year.`}
        </p>
        {byCity.length === 0 ? (
          <p className="works-note" style={worksNoteStyle}>No project can go on it today.</p>
        ) : (
          byCity.map((row) => (
            <div key={row.cityId} className="works-row" style={worksRowStyle}>
              <span style={{ color: "var(--dash-parchment)", fontWeight: 600 }}>{row.polis}</span>
              <span>{row.names.join(" · ")}</span>
            </div>
          ))
        )}
      </DashboardCard>
      <DashboardCard className="works-festivals">
        <div className="panel-label">The festival docket</div>
        <p className="works-note" style={worksNoteStyle}>
          {f.drafting ? `Open now, for the year ${f.yearLabel}. The Archons choose one this season; the chamber votes next season.` : `Opens ${f.opensLabel}, for the year ${f.yearLabel}. Shown as it would open today.`}
        </p>
        {f.items.length === 0 ? (
          <p className="works-note" style={worksNoteStyle}>No festival can go on it today.</p>
        ) : (
          f.items.map((item) => (
            <div key={item.id} className="works-item" style={worksItemStyle}>
              <span className="dashboard-label">{item.name}</span>
              <p className="works-facts" style={worksFactsStyle}>
                {item.cost.toLocaleString()} dr · {cap(item.partyLean)} lean
              </p>
              {item.effects.length ? <p className="agenda-effects">If it passes: {item.effects.join(" · ")}</p> : null}
            </div>
          ))
        )}
      </DashboardCard>
    </>
  );
}

// 1..5 fortification level as filled/empty pips.
function fortPips(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  return "■".repeat(n) + "□".repeat(5 - n);
}

export function CitiesView() {
  const [data, setData] = useState<LeagueCitiesResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .leagueCities()
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "The cities could not be read."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="dashboard-todo" role="status">{error}</p>;
  if (!data) return <p className="dashboard-todo">Reading the colonies…</p>;
  const cities: CityView[] = data.cities;

  return (
    <>
      {CITY_GROUP_META.map((group) => {
        const inGroup = cities.filter((c) => c.group === group.id);
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
      {data.works ? <LeagueWorks works={data.works} /> : null}
    </>
  );
}
