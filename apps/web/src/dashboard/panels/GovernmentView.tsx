import { leagueUnitsLine, menLabel } from "@massalia/shared";
import type { GovernmentArmyOrder, GovernmentArmyParty, GovernmentArmyView, GovernmentSeatView, GovernmentView as GovernmentData } from "../../api.js";
import { DashboardCard, formatClock, useCountdownSeconds } from "../shared.js";
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

// The League's army since it takes orders (government prompt 5b): a party on
// the road, hulls at sea, an order and who gave it.
// "40 peltasts from Massalia to raid Reii", "30 hoplites, 10 ekdromoi moving
// from Massalia to Arelate", "5 hippeis returning from Salyes to Massalia".
export function partyLine(p: GovernmentArmyParty): string {
  const force = leagueUnitsLine(p.units);
  if (p.returning) return `${force} returning from ${p.from} to ${p.to}`;
  if (p.kind === "move") return `${force} moving from ${p.from} to ${p.to}`;
  return `${force} from ${p.from} to ${p.kind} ${p.to}`;
}
const ORDER_WORDS: Record<GovernmentArmyOrder["kind"], string> = { move: "Move to", scout: "Scout of", raid: "Raid on", attack: "Attack on" };
// "Seskios, Archon (Dynatoi) · Raid on Reii from Massalia · 40 peltasts · Spring, 293 BC",
// with "· naval supplies 28 dr" before the date when the voyage cost the treasury.
export function orderLine(o: GovernmentArmyOrder): string {
  const seat = seatLabel({ office: o.office, side: o.side === "palaioi" || o.side === "dynatoi" ? o.side : null });
  const supplies = o.suppliesCost > 0 ? ` · naval supplies ${o.suppliesCost.toLocaleString()} dr` : "";
  return `${o.by}, ${seat} · ${ORDER_WORDS[o.kind]} ${o.to} from ${o.from} · ${leagueUnitsLine(o.units)}${supplies} · ${o.dateLabel}`;
}
// What the League last saw of a place: "Aleria · garrison 150 · 4 pentekonters,
// 4 triremes · Winter, 300 BC", "Salyes · warband 100 · Winter, 300 BC".
type Sighting = NonNullable<GovernmentArmyView["sightings"]>[number];
export function sightingLine(s: Sighting): string {
  if (!s.town) return `${s.name} · warband ${s.men.toLocaleString()} · ${s.asOf}`;
  const ships = [s.pentekonters > 0 ? hulls(s.pentekonters, "pentekonter") : null, s.triremes > 0 ? hulls(s.triremes, "trireme") : null].filter(Boolean).join(", ") || "no ships";
  return `${s.name} · garrison ${s.men.toLocaleString()} · ${ships} · ${s.asOf}`;
}
type AtSea = NonNullable<GovernmentArmyView["fleet"]["atSea"]>[number];
// "2 pentekonters", "2 pentekonters, 1 trireme".
const hullsAtSea = (v: AtSea) => [v.pentekonters > 0 ? hulls(v.pentekonters, "pentekonter") : null, v.triremes > 0 ? hulls(v.triremes, "trireme") : null].filter(Boolean).join(", ");

function PartyRow({ party }: { party: GovernmentArmyParty }) {
  const left = useCountdownSeconds(party.arrivesAt);
  return <li>{partyLine(party)} · arriving in {formatClock(left)}</li>;
}
function SeaRow({ voyage }: { voyage: AtSea }) {
  const left = useCountdownSeconds(voyage.returnsAt);
  return <li>{hullsAtSea(voyage)} at sea for {voyage.to} · back in {formatClock(left)}</li>;
}

type MemberView = Extract<GovernmentData, { member: true }>;

// `onRefresh` reloads this view (PoliticsPanel's own load) and then the dashboard.
export function GovernmentView({ view, onRefresh }: { view: MemberView; onRefresh: () => void }) {
  const { treasury } = view;
  // The League's building projects (government prompt 2a): under way first, then
  // built. An old server sends none.
  const projects = view.projects ?? [];
  const underWay = projects.filter((p) => p.status === "building");
  const built = projects.filter((p) => p.status === "built");
  // The army beyond its home towns (government prompt 5b). An older server sends none of it.
  const holdings = view.army?.holdings ?? [];
  const parties = view.army?.parties ?? [];
  const atSea = view.army?.fleet.atSea ?? [];
  const orders = view.army?.orders ?? [];
  const reports = view.army?.reports ?? [];
  const sightings = view.army?.sightings ?? [];
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

      {/* The League's army (government prompt 5a): every member sees the whole of it. An old server sends none.
          Since it takes orders (5b) a town's men are those standing in it, and its holdings, its parties on
          the road, its hulls at sea, the latest orders and the latest reports follow. */}
      {view.army ? (
        <DashboardCard className="treasury-card government-army">
          <div className="event-body">
            <span className="dashboard-label">The League's army</span>
            <ul className="treasury-ledger government-army-towns">
              {view.army.towns.map((t) => (
                <li key={t.townId}>{t.name} · {leagueUnitsLine(t.units)}</li>
              ))}
            </ul>
            {holdings.length > 0 ? (
              <>
                <p className="government-projects-head">Holdings</p>
                <ul className="treasury-ledger government-army-holdings">
                  {holdings.map((h) => (
                    <li key={h.id}>{h.name} · {leagueUnitsLine(h.units)}{h.men < h.minGarrison ? ` · garrison too small for tribute (${menLabel(h.minGarrison)} needed)` : ""}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {parties.length > 0 ? (
              <>
                <p className="government-projects-head">On the road</p>
                <ul className="treasury-ledger government-army-parties">
                  {parties.map((p, i) => (
                    <PartyRow key={`${p.kind}:${p.from}:${p.to}:${p.arrivesAt}:${i}`} party={p} />
                  ))}
                </ul>
              </>
            ) : null}
            <p className="government-army-fleet">The fleet at {view.army.fleet.at}: {hulls(view.army.fleet.pentekonters, "pentekonter")}, {hulls(view.army.fleet.triremes, "trireme")}</p>
            {atSea.length > 0 ? (
              <ul className="treasury-ledger government-army-sea">
                {atSea.map((v, i) => (
                  <SeaRow key={`${v.to}:${v.returnsAt}:${i}`} voyage={v} />
                ))}
              </ul>
            ) : null}
            {/* "a quarter drachma a man" is league-army.json's upkeepPerManPerSeason, 0.25; a render test fails if the content moves. */}
            <p className="government-army-upkeep">Upkeep: {view.army.upkeepPerSeason.toLocaleString()} drachmae a season, a quarter drachma a man, paid by the treasury</p>
            {view.army.lastDesertion ? (
              <p className="government-army-desertion">Deserted for want of pay: {menLabel(view.army.lastDesertion.men)} · {view.army.lastDesertion.label}</p>
            ) : null}
            {orders.length > 0 ? (
              <>
                <p className="government-projects-head">Orders</p>
                <ul className="treasury-ledger government-army-orders">
                  {orders.map((o) => (
                    <li key={o.id}>{orderLine(o)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {reports.length > 0 ? (
              <>
                <p className="government-projects-head">Reports</p>
                <ul className="treasury-ledger government-army-reports">
                  {reports.map((r) => (
                    <li key={r.id}>{r.line} · {r.dateLabel}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {/* What the League's parties last saw: the League's alone, for every member (ruling 1 at STOP 1). */}
            {sightings.length > 0 ? (
              <>
                <p className="government-projects-head">Sightings</p>
                <ul className="treasury-ledger government-army-sightings">
                  {sightings.map((s) => (
                    <li key={s.id}>{sightingLine(s)}</li>
                  ))}
                </ul>
              </>
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
