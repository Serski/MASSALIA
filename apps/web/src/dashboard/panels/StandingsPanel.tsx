import { useEffect, useState, type CSSProperties } from "react";
import { api, ApiError, type StandingsResponse, type StandingsBoard, type StandingRow } from "../../api.js";
import { AssetIcon, DashboardCard, HouseCrest, titleCase } from "../shared.js";
import { PublicProfile, type ProfileTarget } from "../PublicProfile.js";

// Standings board → stat icon. "wealth" has no icon asset (a coin glyph stands in).
const STAT_ICON: Partial<Record<StandingsBoard, string>> = {
  prestige: "PRESTIGE.webp",
  devotion: "DEVOTION.webp",
  militia: "Militia.webp",
  intelligence: "Intrigue.webp",
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

function StandingsRowItem({ row, onOpen }: { row: StandingRow; onOpen: (row: StandingRow) => void }) {
  // A row opens the citizen's public profile — only when the player has a character
  // row (a legacy player with no sheet has no profile to open).
  const clickable = row.characterId !== null;
  return (
    <li
      className={`atlas-row${clickable ? " atlas-row-clickable" : ""}`}
      style={row.isViewer ? standingsViewerRowStyle : standingsRowStyle}
      onClick={clickable ? () => onOpen(row) : undefined}
    >
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
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const openProfile = (row: StandingRow) => {
    if (row.characterId) setProfileTarget({ characterId: row.characterId, isSelf: row.isViewer });
  };

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
              <StandingsRowItem key={row.playerId} row={row} onOpen={openProfile} />
            ))}
          </ol>
        )}
        {viewerRow && !viewerOnPage ? (
          <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            <StandingsRowItem row={viewerRow} onOpen={openProfile} />
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
      <PublicProfile target={profileTarget} onClose={() => setProfileTarget(null)} />
    </>
  );
}

// Standings is its own sidebar panel: the live leaderboards, scrolling like every
// other non-Atlas panel.
export default function StandingsPanel() {
  return (
    <section className="dashboard-panel" aria-label="Standings">
      <StandingsView />
    </section>
  );
}
