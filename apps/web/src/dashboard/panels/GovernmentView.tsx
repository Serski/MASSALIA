import { leagueUnitsLine, menLabel } from "@massalia/shared";
import type { GovernmentSeatView, GovernmentView as GovernmentData } from "../../api.js";
import { DashboardCard } from "../shared.js";
import { AgendaScopeSection } from "./AgendaSection.js";

// The Government tab (government prompt 1): what a sitting Archon, Ephor or
// Strategos sees. Their seats, the League treasury's books (balance, the tax
// the poleis pay a season, the ledger with its words and game dates) and the
// League docket with the draft and veto controls. The server decides who is a
// member; this renders what it sent. Existing treasury card classes, no new CSS.

const OFFICE_LABEL: Record<GovernmentSeatView["office"], string> = { archon: "Archon", ephor: "Ephor", strategos: "Strategos" };
const SIDE_LABEL: Record<"palaioi" | "dynatoi", string> = { palaioi: "Palaioi", dynatoi: "Dynatoi" };

export function seatLabel(seat: GovernmentSeatView): string {
  return seat.side ? `${OFFICE_LABEL[seat.office]} (${SIDE_LABEL[seat.side]})` : OFFICE_LABEL[seat.office];
}

// "29 pentekonters", "1 trireme".
const hulls = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

type MemberView = Extract<GovernmentData, { member: true }>;

// `onRefresh` reloads this view (PoliticsPanel's own load) and then the dashboard.
export function GovernmentView({ view, onRefresh }: { view: MemberView; onRefresh: () => void }) {
  const { treasury } = view;
  // The League's building projects (government prompt 2a): under way first, then
  // built. An old server sends none.
  const projects = view.projects ?? [];
  const underWay = projects.filter((p) => p.status === "building");
  const built = projects.filter((p) => p.status === "built");
  return (
    <div className="pol-page">
      <DashboardCard className="treasury-card government-seats">
        <div className="event-body">
          <span className="dashboard-label">The Government</span>
          <p className="government-seat-line">You sit as {view.seats.map(seatLabel).join(" and ")}.</p>
        </div>
      </DashboardCard>

      <DashboardCard className="treasury-card government-treasury">
        <div className="event-body">
          <span className="dashboard-label">League treasury</span>
          <p className="treasury-balance">{treasury.balance.toLocaleString()} <span className="treasury-unit">drachmae</span></p>
          <p className="government-tax-line">The poleis pay {treasury.taxPerSeason.toLocaleString()} drachmae a season.</p>
          {treasury.ledger.length > 0 ? (
            <ul className="treasury-ledger">
              {treasury.ledger.map((l, i) => (
                <li key={i}>
                  {/* A row of 0 (an unpaid season, a desertion) shows its words alone: no "+0". */}
                  {l.delta !== 0 ? (
                    <>
                      <span className={l.delta > 0 ? "ledger-pos" : "ledger-neg"}>{l.delta > 0 ? "+" : ""}{l.delta.toLocaleString()}</span>{" "}
                    </>
                  ) : null}
                  <span className="ledger-reason">{l.label} · {l.dateLabel}</span>
                </li>
              ))}
            </ul>
          ) : <p className="dashboard-todo">The books are empty.</p>}
        </div>
      </DashboardCard>

      <DashboardCard className="treasury-card government-projects">
        <div className="event-body">
          <span className="dashboard-label">Projects</span>
          {projects.length === 0 ? <p className="dashboard-todo">No project yet.</p> : null}
          {underWay.length > 0 ? (
            <>
              <p className="government-projects-head">Under way</p>
              <ul className="treasury-ledger government-projects-building">
                {underWay.map((p) => (
                  <li key={`${p.cityId}:${p.buildingId}`}>{p.title} · stands {p.completesLabel}</li>
                ))}
              </ul>
            </>
          ) : null}
          {built.length > 0 ? (
            <>
              <p className="government-projects-head">Built</p>
              <ul className="treasury-ledger government-projects-built">
                {built.map((p) => (
                  <li key={`${p.cityId}:${p.buildingId}`}>{p.title}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </DashboardCard>

      {/* The League's army (government prompt 5a): every member sees the whole of it. An old server sends none. */}
      {view.army ? (
        <DashboardCard className="treasury-card government-army">
          <div className="event-body">
            <span className="dashboard-label">The League's army</span>
            <ul className="treasury-ledger government-army-towns">
              {view.army.towns.map((t) => (
                <li key={t.townId}>{t.name} · {leagueUnitsLine(t.units)}</li>
              ))}
            </ul>
            <p className="government-army-fleet">The fleet at {view.army.fleet.at}: {hulls(view.army.fleet.pentekonters, "pentekonter")}, {hulls(view.army.fleet.triremes, "trireme")}</p>
            {/* "a quarter drachma a man" is league-army.json's upkeepPerManPerSeason, 0.25; a render test fails if the content moves. */}
            <p className="government-army-upkeep">Upkeep: {view.army.upkeepPerSeason.toLocaleString()} drachmae a season, a quarter drachma a man, paid by the treasury</p>
            {view.army.lastDesertion ? (
              <p className="government-army-desertion">Deserted for want of pay: {menLabel(view.army.lastDesertion.men)} · {view.army.lastDesertion.label}</p>
            ) : null}
          </div>
        </DashboardCard>
      ) : null}

      <AgendaScopeSection view={view.league} onRefresh={onRefresh} treasury="none" />
      {view.festival ? <AgendaScopeSection view={view.festival} onRefresh={onRefresh} treasury="none" /> : null}
      {view.war ? <AgendaScopeSection view={view.war} onRefresh={onRefresh} treasury="none" /> : null}
    </div>
  );
}
