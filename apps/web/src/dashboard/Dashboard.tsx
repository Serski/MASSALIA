import { useMemo, useState, type ReactNode } from "react";
import { assetPath, nobleHouses, professions } from "../data/league.js";
import { MapCanvas } from "../map/MapCanvas.js";
import "./dashboard.css";

type DashboardSection = "court" | "holdings" | "politics" | "atlas";

type DashboardNavItem = {
  id: DashboardSection;
  label: string;
  icon: string;
};

type PlayerDashboardState = {
  name: string;
  seasonDay: number;
  gold: number;
  prestige: number;
  influence: number;
  professionSlug: string;
  houseSlug: string;
  classResource: {
    label: string;
    amount: number;
  };
  party: "Palaioi" | "Dynatoi" | "Unaligned";
};

type DigestItem = {
  id: string;
  text: string;
};

type CourtEvent = {
  id: string;
  title: string;
  label: string;
  body: string;
  urgency: "low" | "medium" | "high";
};

type Holding = {
  id: string;
  title: string;
  rank: string;
  benefit: string;
  status: string;
};

const dashboardNav: DashboardNavItem[] = [
  { id: "court", label: "Court", icon: "⚖" },
  { id: "holdings", label: "Holdings", icon: "▦" },
  { id: "politics", label: "Politics", icon: "◆" },
  { id: "atlas", label: "Atlas", icon: "◎" },
];

// TODO: Replace with authenticated player profile/session state once auth is connected.
const placeholderPlayerState: PlayerDashboardState = {
  name: "Pytheas",
  seasonDay: 18,
  gold: 420,
  prestige: 12,
  influence: 7,
  professionSlug: "trader",
  houseSlug: "leonidas",
  classResource: {
    label: "Wine",
    amount: 36,
  },
  party: "Unaligned",
};

// TODO: Replace with real Court decision/event queue from the server event system.
const placeholderDigest: DigestItem[] = [
  { id: "trade", text: "Two harbor offers expired while you were away." },
  { id: "house", text: "House Leonidas gained standing among conservative citizens." },
  { id: "season", text: "Season I advanced by one day." },
];

const placeholderCourtEvents: CourtEvent[] = [
  {
    id: "harbor-dispute",
    title: "Harbor Dispute",
    label: "Decision",
    body: "Merchants ask you to back their petition before the council.",
    urgency: "medium",
  },
  {
    id: "house-summons",
    title: "House Summons",
    label: "House",
    body: "A senior kinsman wants your answer before the next assembly.",
    urgency: "low",
  },
];

// TODO: Replace with player-owned buildings/holdings from profession progression state.
const placeholderHoldings: Holding[] = [
  { id: "trade-post", title: "Trade Post", rank: "@Nautilos Emporos", benefit: "4 Wine/day", status: "Upgrade available" },
  { id: "warehouse", title: "Harbor Warehouse", rank: "Storehouse", benefit: "+10 resource capacity", status: "Operational" },
  { id: "ledger", title: "Account Ledger", rank: "Civic record", benefit: "+2 influence/day", status: "Pending clerk" },
];

function getPlaceholderPlayer() {
  const profession = professions.find((item) => item.slug === placeholderPlayerState.professionSlug) ?? professions[0]!;
  const house = nobleHouses.find((item) => item.slug === placeholderPlayerState.houseSlug) ?? nobleHouses[0]!;
  return { ...placeholderPlayerState, profession, house };
}

function DashboardCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <article className={`dashboard-card${className ? ` ${className}` : ""}`}>{children}</article>;
}

function ListRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="dashboard-list-row">
      <div>{children}</div>
      {action ? <div className="dashboard-row-action">{action}</div> : null}
    </div>
  );
}

function EventCard({ event }: { event: CourtEvent }) {
  return (
    <DashboardCard className={`event-card urgency-${event.urgency}`}>
      <span className="dashboard-label">{event.label}</span>
      <h3>{event.title}</h3>
      <p>{event.body}</p>
      <div className="dashboard-action-row">
        <button className="dashboard-ghost-button" type="button">Review</button>
        <button className="dashboard-primary-button" type="button">Decide</button>
      </div>
    </DashboardCard>
  );
}

function CourtPanel() {
  return (
    <section className="dashboard-panel" aria-labelledby="court-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Home</p>
        <h1 id="court-title">Court</h1>
        <p>Messages, petitions, and decisions waiting for your return.</p>
      </div>
      <div className="dashboard-grid two">
        <DashboardCard>
          <h2>While you were away</h2>
          <div className="dashboard-list">
            {placeholderDigest.map((item) => (
              <ListRow key={item.id}>
                <p>{item.text}</p>
              </ListRow>
            ))}
          </div>
          <p className="dashboard-todo">TODO: digest is placeholder data until the away-summary service exists.</p>
        </DashboardCard>
        <DashboardCard>
          <h2>Decision queue</h2>
          <div className="dashboard-event-stack">
            {placeholderCourtEvents.map((event) => <EventCard event={event} key={event.id} />)}
          </div>
          <p className="dashboard-todo">TODO: Court events are placeholder cards until server event queue integration is connected.</p>
        </DashboardCard>
      </div>
    </section>
  );
}

function HoldingsPanel() {
  const player = getPlaceholderPlayer();
  return (
    <section className="dashboard-panel" aria-labelledby="holdings-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">{player.profession.name}</p>
        <h1 id="holdings-title">Holdings</h1>
        <p>Your profession buildings, upgrades, and daily production.</p>
      </div>
      <DashboardCard>
        <h2>Upgrade list</h2>
        <div className="dashboard-list">
          {placeholderHoldings.map((holding) => (
            <ListRow
              key={holding.id}
              action={<button className="dashboard-primary-button" type="button">Upgrade</button>}
            >
              <strong>{holding.title}</strong>
              <span>{holding.rank}</span>
              <p>{holding.benefit} · {holding.status}</p>
            </ListRow>
          ))}
        </div>
        <p className="dashboard-todo">TODO: holdings are placeholder rows until profession building state exists.</p>
      </DashboardCard>
    </section>
  );
}

function PoliticsPanel() {
  const player = getPlaceholderPlayer();
  const palaioi = "Palaioi";
  const dynatoi = "Dynatoi";
  return (
    <section className="dashboard-panel" aria-labelledby="politics-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Assembly</p>
        <h1 id="politics-title">Politics</h1>
        <p>Party allegiance, House standing, and offices in play.</p>
      </div>
      <div className="dashboard-grid three">
        <DashboardCard>
          <h2>Party allegiance</h2>
          <p>{player.party === "Unaligned" ? "Chosen in-game through a narrated event." : player.party}</p>
          <div className="party-choice-row">
            <span>{palaioi}</span>
            <span>{dynatoi}</span>
          </div>
        </DashboardCard>
        <DashboardCard>
          <h2>House standing</h2>
          <strong>{player.house.name}</strong>
          <p>{player.house.stance}</p>
          <p className="party-motto">"{player.house.motto}"</p>
        </DashboardCard>
        <DashboardCard>
          <h2>Offices & elections</h2>
          <div className="dashboard-list compact">
            <ListRow><strong>Archon seats</strong><p>2 contested</p></ListRow>
            <ListRow><strong>Council petitions</strong><p>3 awaiting support</p></ListRow>
            <ListRow><strong>Next assembly</strong><p>Day 21</p></ListRow>
          </div>
          <p className="dashboard-todo">TODO: offices/elections are placeholder data until political state exists.</p>
        </DashboardCard>
      </div>
    </section>
  );
}

function AtlasPanel() {
  return (
    <section className="dashboard-panel atlas-dashboard-panel" aria-labelledby="atlas-dashboard-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">League map</p>
        <h1 id="atlas-dashboard-title">Atlas</h1>
        <p>The existing campaign map, embedded as the Atlas tab.</p>
      </div>
      <DashboardCard className="dashboard-map-card">
        <MapCanvas />
      </DashboardCard>
    </section>
  );
}

const panelComponents: Record<DashboardSection, () => ReactNode> = {
  court: CourtPanel,
  holdings: HoldingsPanel,
  politics: PoliticsPanel,
  atlas: AtlasPanel,
};

export function Dashboard({ onExit }: { onExit: () => void }) {
  const [activeSection, setActiveSection] = useState<DashboardSection>("court");
  const player = useMemo(getPlaceholderPlayer, []);
  const ActivePanel = panelComponents[activeSection];
  const courtBadgeCount = placeholderCourtEvents.length;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <button className="dashboard-brand" type="button" onClick={() => setActiveSection("court")}>
          <span className="brand-mark" aria-hidden="true">
            <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </span>
          <span>MASSALIA</span>
        </button>
        <div className="season-strip">Season I · Day {player.seasonDay}</div>
        <div className="resource-pill-row" aria-label="Player resources">
          <span>Gold {player.gold}</span>
          <span>{player.classResource.label} {player.classResource.amount}</span>
          <span>Prestige {player.prestige}</span>
          <span>Influence {player.influence}</span>
        </div>
        <div className="dashboard-player-chip">
          <span className="dashboard-avatar" aria-hidden="true">{player.name[0]}</span>
          <div>
            <strong>{player.name}</strong>
            <span>{player.profession.rank} · {player.profession.name}</span>
          </div>
        </div>
      </header>

      <div className="dashboard-body">
        <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
          <nav className="dashboard-nav">
            {dashboardNav.map((item) => (
              <button
                className={activeSection === item.id ? "active" : ""}
                type="button"
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.id === "court" && courtBadgeCount ? <strong className="nav-badge">{courtBadgeCount}</strong> : null}
              </button>
            ))}
          </nav>
          <div className="dashboard-sidebar-bottom">
            <a className="discord-link" href="#discord">Discord</a>
            <DashboardCard className="house-standing-card">
              <span className="dashboard-label">Your House</span>
              <strong>{player.house.name}</strong>
              <p>{player.house.stance}</p>
              <p className="dashboard-todo">TODO: House standing score awaits backend state.</p>
            </DashboardCard>
            <button className="dashboard-ghost-button" type="button" onClick={onExit}>Campaigns</button>
          </div>
        </aside>

        <section className="dashboard-content" aria-live="polite">
          <ActivePanel />
        </section>
      </div>

      <nav className="dashboard-mobile-tabs" aria-label="Dashboard tabs">
        {dashboardNav.map((item) => (
          <button
            className={activeSection === item.id ? "active" : ""}
            type="button"
            key={item.id}
            onClick={() => setActiveSection(item.id)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
            {item.id === "court" && courtBadgeCount ? <strong className="nav-badge">{courtBadgeCount}</strong> : null}
          </button>
        ))}
      </nav>
    </main>
  );
}
