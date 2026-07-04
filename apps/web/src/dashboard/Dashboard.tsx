import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type PlayerState } from "../api.js";
import { assetPath, nobleHouses, professions, type House } from "../data/league.js";
import { DashboardCard, type DashboardSection, type IconName, MoreIcon, type PanelProps, type PlayerDashboardState, type PlayerDashboardView, SvgIcon, playerFromState } from "./shared.js";
import { AvatarImage, CharacterSheet, InventorySheet, type InventoryTab } from "./sheets.js";
import { SuccessionScreen } from "./SuccessionScreen.js";
import "./dashboard.css";
import CourtPanel from "./panels/CourtPanel.js";
import LedgerPanel from "./panels/LedgerPanel.js";
import MarketPanel from "./panels/MarketPanel.js";
import FamilyPanel from "./panels/FamilyPanel.js";
import PoliticsPanel from "./panels/PoliticsPanel.js";
import AtlasPanel from "./panels/AtlasPanel.js";

type DashboardNavItem = {
  id: DashboardSection;
  label: string;
  icon: IconName;
  badge?: number;
};

const placeholderFamilyEventCount = 1;

const dashboardNav: DashboardNavItem[] = [
  { id: "court", label: "Court", icon: "court" },
  { id: "ledger", label: "Ledger", icon: "ledger" },
  { id: "market", label: "Market", icon: "market" },
  { id: "family", label: "Family", icon: "family", badge: placeholderFamilyEventCount },
  { id: "politics", label: "Politics", icon: "politics" },
  { id: "atlas", label: "Atlas", icon: "atlas" },
];

const mobilePrimaryNav: DashboardNavItem[] = dashboardNav.filter((item) =>
  ["court", "ledger", "market", "family"].includes(item.id),
);

const mobileMoreNav: DashboardNavItem[] = dashboardNav.filter((item) =>
  ["politics", "atlas"].includes(item.id),
);

// TODO: Replace with authenticated player profile/session state once auth is connected.
const placeholderPlayerState: PlayerDashboardState = {
  name: "Pytheas",
  email: "pytheas@example.com",
  newsletterOptIn: false,
  gameDateLabel: "Winter, 300 BC",
  seasonName: "Winter",
  seasonEndsIn: 182,
  drachmae: 420,
  prestige: 12,
  influence: 7,
  professionSlug: "trader",
  houseSlug: "leonidas",
  classResource: {
    type: "wine",
    label: "Wine",
    amount: 36,
  },
  party: "Unaligned",
  ideology: 0,
  censured: false,
  censureExpiresAt: null,
  composure: 70,
  withdrawn: false,
  stats: { prestige: 12, devotion: 0, militia: 0, intelligence: 0 },
  balances: {},
  currentAge: 30,
  lifeStage: "Prime",
  deceased: false,
  decaying: [],
  festival: null,
  olympiad: null,
  manumission: null,
};

function getPlaceholderPlayer(): PlayerDashboardView {
  const profession = professions.find((item) => item.slug === placeholderPlayerState.professionSlug) ?? professions[0]!;
  const house = nobleHouses.find((item) => item.slug === placeholderPlayerState.houseSlug) ?? nobleHouses[0]!;
  return { ...placeholderPlayerState, profession, house };
}

// Clock-strip season icon, keyed by season name. Falls back to Winter for any
// unexpected value (e.g. a frontend/backend deploy-window skew).
const SEASON_ICONS: Record<string, string> = {
  Winter: assetPath("assets/seasons/winter.webp"),
  Spring: assetPath("assets/seasons/spring.webp"),
  Summer: assetPath("assets/seasons/summer.webp"),
  Autumn: assetPath("assets/seasons/autumn.webp"),
};

function seasonIcon(seasonName: string): string {
  return SEASON_ICONS[seasonName] ?? SEASON_ICONS.Winter!;
}

// TODO: real "new items" badge once the items system exists. 0 = nothing to show.
const PLACEHOLDER_NEW_ITEM_COUNT = 0;
const panelComponents: Record<DashboardSection, (props: PanelProps) => ReactNode> = {
  court: CourtPanel,
  ledger: LedgerPanel,
  market: MarketPanel,
  family: FamilyPanel,
  politics: PoliticsPanel,
  atlas: AtlasPanel,
};

export function Dashboard({ onRequireLogin, onRequireCharacter }: { onExit: () => void; onRequireLogin: () => void; onRequireCharacter: () => void }) {
  const [activeSection, setActiveSection] = useState<DashboardSection>("court");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState<"inventory" | "character" | null>(null);
  // Which Inventory tab to open on: the drachmae pill opens Economy, the inventory
  // button opens Resources (default).
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>("resources");
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [courtRemaining, setCourtRemaining] = useState(0);
  const [loadError, setLoadError] = useState("");
  const player = useMemo(() => playerState ? playerFromState(playerState) : getPlaceholderPlayer(), [playerState]);
  const closeSheet = useCallback(() => setActiveSheet(null), []);
  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Clears the local session token (in api.logout) and routes back to login.
      onRequireLogin();
    }
  }, [onRequireLogin]);
  const ActivePanel = panelComponents[activeSection];
  const courtBadgeCount = courtRemaining;
  const isMoreActive = mobileMoreNav.some((item) => item.id === activeSection);
  const hiddenBadgeCount = mobileMoreNav.reduce((total, item) => total + (item.badge ?? 0), 0);

  const selectMobileSection = (section: DashboardSection) => {
    setActiveSection(section);
    setIsMoreOpen(false);
  };

  // Re-pull /me/state. Used on mount and after real mutations (party join/leave).
  const refreshState = useCallback(() => {
    api.state()
      .then((state) => setPlayerState(state))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          onRequireLogin();
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          onRequireCharacter();
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Unable to load dashboard state.");
      });
    // Court nav badge = unresolved decisions in today's curated set.
    api.dailyEvents()
      .then((set) => setCourtRemaining(set.remaining))
      .catch(() => setCourtRemaining(0));
  }, [onRequireCharacter, onRequireLogin]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  // A death opens a blocking Succession screen until the player picks an heir.
  if (playerState?.succession?.pending) {
    return <SuccessionScreen succession={playerState.succession} onResolved={refreshState} />;
  }

  const regent = playerState?.character.regent ?? null;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <button className="dashboard-brand" type="button" onClick={() => setActiveSection("court")}>
          <span className="brand-mark" aria-hidden="true">
            <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </span>
          <span>MASSALIA</span>
        </button>
        <div className="season-strip">
          <span className="season-live">
            <span className="season-pulse" aria-hidden="true" />
            <img className="season-icon" src={seasonIcon(player.seasonName)} alt={player.seasonName} width={20} height={20} />
            <span>{player.gameDateLabel}</span>
          </span>
          <strong>· ends in {player.seasonEndsIn} days</strong>
          {regent ? (
            <span
              className="regent-badge"
              title={`Regent — barred from elected office (${regent.barredOffices.join(", ")}); holds the seat in trust`}
            >
              👑 Regent for {regent.wardName} · of age in {regent.wardComingOfAgeInYears}y
            </span>
          ) : null}
        </div>
        <div className="topbar-actions">
          <button
            className="topbar-vital"
            type="button"
            onClick={() => {
              setInventoryTab("economy");
              setActiveSheet("inventory");
            }}
            title="Open your economy — income & expenses per day"
          >
            <span className="vital-ic" aria-hidden="true">🪙</span>
            <span className="vital-v">{player.drachmae.toLocaleString()}</span>
            <span className="vital-meta">
              <span className="vital-k">Drachmae</span>
            </span>
          </button>
          <button
            className="topbar-vital inventory-vital"
            type="button"
            onClick={() => {
              setInventoryTab("resources");
              setActiveSheet("inventory");
            }}
            title="Open your inventory"
          >
            <span className="vital-ic" aria-hidden="true">🏺</span>
            <span className="vital-meta">
              <span className="vital-k strong">Inventory</span>
              <span className="vital-d dim">res · items · units</span>
            </span>
            {/* TODO: new-items badge placeholder until the items system exists. */}
            {PLACEHOLDER_NEW_ITEM_COUNT > 0 ? <span className="vital-badge">{PLACEHOLDER_NEW_ITEM_COUNT}</span> : null}
          </button>
          <button className="topbar-logout" type="button" onClick={handleLogout}>
            <span aria-hidden="true">⎋</span> Log out
          </button>
          <button
            className="avatar-btn"
            type="button"
            onClick={() => setActiveSheet("character")}
            title="Open your character"
          >
            <span className="avatar-av" aria-hidden="true"><AvatarImage player={player} /></span>
            <span className="avatar-text">
              <span className="avatar-nm">{player.name}</span>
              <span className="avatar-sb">{player.profession.rank} · {player.profession.name}</span>
            </span>
          </button>
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
                <SvgIcon icon={item.icon} />
                {item.label}
                {item.id === "court" && courtBadgeCount ? <strong className="nav-badge">{courtBadgeCount}</strong> : null}
                {item.badge ? <strong className="nav-badge subtle">{item.badge}</strong> : null}
              </button>
            ))}
          </nav>
          <div className="dashboard-sidebar-bottom">
            <a className="discord-link" href="#discord">Discord</a>
            <DashboardCard className="house-standing-card">
              <span className="dashboard-label">Your House</span>
              <strong>{player.house.name}</strong>
              <p>{player.house.stance}</p>
              <div className="house-meter" aria-label="House standing placeholder">
                <span style={{ width: "62%" }} />
              </div>
              <p className="dashboard-todo">TODO: House standing score awaits backend state.</p>
            </DashboardCard>
          </div>
        </aside>

        <section className="dashboard-content" aria-live="polite">
          {loadError ? (
            <section className="dashboard-panel">
              <DashboardCard>
                <h2>Unable to load the game</h2>
                <p>{loadError}</p>
              </DashboardCard>
            </section>
          ) : playerState ? (
            <ActivePanel player={player} onRefresh={refreshState} />
          ) : (
            <section className="dashboard-panel">
              <DashboardCard>
                <h2>Loading your league state</h2>
                <p>Fetching your character, resources, and active season.</p>
              </DashboardCard>
            </section>
          )}
        </section>
      </div>

      <nav className="dashboard-mobile-tabs" aria-label="Dashboard tabs">
        {mobilePrimaryNav.map((item) => (
          <button
            className={activeSection === item.id ? "active" : ""}
            type="button"
            key={item.id}
            onClick={() => selectMobileSection(item.id)}
          >
            <SvgIcon icon={item.icon} />
            <span>{item.label}</span>
            {item.id === "court" && courtBadgeCount ? <strong className="nav-badge">{courtBadgeCount}</strong> : null}
            {item.badge ? <strong className="nav-badge subtle">{item.badge}</strong> : null}
          </button>
        ))}
        <button
          className={isMoreActive || isMoreOpen ? "active" : ""}
          type="button"
          onClick={() => setIsMoreOpen((current) => !current)}
          aria-expanded={isMoreOpen}
          aria-controls="dashboard-mobile-more"
        >
          <MoreIcon />
          <span>More</span>
          {hiddenBadgeCount ? <strong className="nav-badge dot" aria-label={`${hiddenBadgeCount} hidden updates`} /> : null}
        </button>
      </nav>
      {isMoreOpen ? (
        <div className="mobile-more-layer">
          <button className="mobile-more-backdrop" type="button" aria-label="Close more menu" onClick={() => setIsMoreOpen(false)} />
          <div className="mobile-more-sheet" id="dashboard-mobile-more">
            {mobileMoreNav.map((item) => (
              <button
                className={activeSection === item.id ? "active" : ""}
                type="button"
                key={item.id}
                onClick={() => selectMobileSection(item.id)}
              >
                <SvgIcon icon={item.icon} />
                <span>{item.label}</span>
                {item.badge ? <strong className="nav-badge subtle">{item.badge}</strong> : null}
              </button>
            ))}
            <a className="discord-link" href="#discord" onClick={() => setIsMoreOpen(false)}>Discord</a>
          </div>
        </div>
      ) : null}

      <InventorySheet open={activeSheet === "inventory"} onClose={closeSheet} player={player} initialTab={inventoryTab} />
      <CharacterSheet open={activeSheet === "character"} onClose={closeSheet} player={player} onLogout={handleLogout} />
    </main>
  );
}
