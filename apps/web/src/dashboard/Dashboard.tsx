import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { api, ApiError, apiErrorMessage, type PlayerState } from "../api.js";
import { assetPath, nobleHouses, professions } from "../data/league.js";
import { DashboardCard, type DashboardSection, type IconName, MoreIcon, type PanelProps, type PlayerDashboardState, type PlayerDashboardView, SvgIcon, playerFromState } from "./shared.js";
import { AvatarImage, CharacterSheet, InventorySheet, type InventoryTab } from "./sheets.js";
import { SuccessionScreen } from "./SuccessionScreen.js";
import "./dashboard.css";
const CourtPanel = lazy(() => import("./panels/CourtPanel.js"));
const LedgerPanel = lazy(() => import("./panels/LedgerPanel.js"));
const MarketPanel = lazy(() => import("./panels/MarketPanel.js"));
const FamilyPanel = lazy(() => import("./panels/FamilyPanel.js"));
const PoliticsPanel = lazy(() => import("./panels/PoliticsPanel.js"));
const AtlasPanel = lazy(() => import("./panels/AtlasPanel.js"));
const StandingsPanel = lazy(() => import("./panels/StandingsPanel.js"));
// First-run welcome overlay: lazy so it never weighs on the main bundle (Suspense
// fallback null — it must never block the dashboard from rendering).
const WelcomeOverlay = lazy(() => import("./WelcomeOverlay.js"));
// The in-game Guide sheet: lazy, loaded only when the player opens it.
const GuideSheet = lazy(() => import("./GuideSheet.js"));

type DashboardNavItem = {
  id: DashboardSection;
  label: string;
  icon: IconName;
  badge?: number;
};

const dashboardNav: DashboardNavItem[] = [
  { id: "court", label: "Court", icon: "court" },
  { id: "ledger", label: "Ledger", icon: "ledger" },
  { id: "market", label: "Market", icon: "market" },
  { id: "family", label: "Family", icon: "family" }, // badge is player.familyPending (dynamic)
  { id: "politics", label: "Politics", icon: "politics" },
  { id: "atlas", label: "Atlas", icon: "atlas" },
  { id: "standings", label: "Standings", icon: "standings" },
];

const mobilePrimaryNav: DashboardNavItem[] = dashboardNav.filter((item) =>
  ["court", "ledger", "market", "family"].includes(item.id),
);

const mobileMoreNav: DashboardNavItem[] = dashboardNav.filter((item) =>
  ["politics", "atlas", "standings"].includes(item.id),
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
  stories: [],
  olympiad: null,
  scandal: null,
  familyPending: 0,
  manumission: null,
  // The placeholder is "already onboarded" so neither the overlay nor the pulse
  // flashes before real /me/state loads and reports the true flags.
  introSeen: true,
  sheetSeen: true,
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
const panelComponents: Record<DashboardSection, LazyExoticComponent<ComponentType<PanelProps>>> = {
  court: CourtPanel,
  ledger: LedgerPanel,
  market: MarketPanel,
  family: FamilyPanel,
  politics: PoliticsPanel,
  atlas: AtlasPanel,
  standings: StandingsPanel,
};

export function Dashboard({ onExit, onRequireLogin, onRequireCharacter }: { onExit: () => void; onRequireLogin: () => void; onRequireCharacter: () => void }) {
  const [activeSection, setActiveSection] = useState<DashboardSection>("court");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState<"inventory" | "character" | "guide" | null>(null);
  // Which Inventory tab to open on: the drachmae pill opens Economy, the inventory
  // button opens Resources (default).
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>("resources");
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [courtRemaining, setCourtRemaining] = useState(0);
  const [loadError, setLoadError] = useState("");
  // Soft email-verification banner: shows while the account is unverified, is
  // dismissible for the session only (reappears next load), and can resend the link.
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [verifyResend, setVerifyResend] = useState<{ status: "idle" | "sending" | "sent" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const resendVerification = useCallback(async () => {
    setVerifyResend({ status: "sending", message: "" });
    try {
      const res = await api.resendVerification();
      setVerifyResend({ status: "sent", message: res.message });
    } catch (error) {
      setVerifyResend({ status: "error", message: apiErrorMessage(error, "auth") });
    }
  }, []);
  const player = useMemo(() => playerState ? playerFromState(playerState) : getPlaceholderPlayer(), [playerState]);
  // Onboarding: the welcome overlay (intro) and the portrait pulse (sheet). Each is
  // acked at most once, optimistically hidden regardless of the network result — a
  // failed ack simply re-shows on the next load, never nags in-session.
  const [introDismissed, setIntroDismissed] = useState(false);
  const [sheetAcked, setSheetAcked] = useState(false);
  const introAckRef = useRef(false);
  const sheetAckRef = useRef(false);
  const dismissIntro = useCallback(() => {
    if (introAckRef.current) return;
    introAckRef.current = true;
    setIntroDismissed(true);
    api.onboardingSeen("intro").catch(() => {});
  }, []);
  const ackSheet = useCallback(() => {
    if (sheetAckRef.current) return;
    sheetAckRef.current = true;
    setSheetAcked(true);
    api.onboardingSeen("sheet").catch(() => {});
  }, []);
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
          // A banned account is 401 everywhere except /auth/me, which answers 403
          // with the reason — show that instead of bouncing to the login page.
          api.me()
            .then(() => onRequireLogin())
            .catch((probe) => {
              if (probe instanceof ApiError && probe.status === 403) setLoadError(probe.message);
              else onRequireLogin();
            });
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
          <button
            className={!player.sheetSeen && !sheetAcked ? "avatar-btn onboarding-pulse" : "avatar-btn"}
            type="button"
            onClick={() => {
              setActiveSheet("character");
              // Opening the sheet acks the pulse (once) and clears it optimistically.
              if (!player.sheetSeen) ackSheet();
            }}
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
                {item.id === "family" && player.familyPending ? <strong className="nav-badge subtle">{player.familyPending}</strong> : null}
              </button>
            ))}
          </nav>
          <button className="sidebar-guide" type="button" onClick={() => setActiveSheet("guide")}>
            <SvgIcon icon="guide" />
            Guide
          </button>
          {/* Leave the city: back to the account-level Lobby (the session stays). */}
          <button className="sidebar-guide sidebar-lobby" type="button" onClick={onExit}>
            Lobby
          </button>
        </aside>

        <section className="dashboard-content" aria-live="polite">
          {playerState && playerState.user.emailVerified === false && !verifyBannerDismissed ? (
            <div className="verify-banner" role="status">
              <span className="verify-banner-text">
                {verifyResend.status === "sent"
                  ? "Verification email sent."
                  : verifyResend.status === "error"
                    ? verifyResend.message
                    : "Verify your email to make sure account recovery works — check your inbox."}
              </span>
              {verifyResend.status !== "sent" ? (
                <button
                  className="verify-banner-resend"
                  type="button"
                  onClick={resendVerification}
                  disabled={verifyResend.status === "sending"}
                >
                  {verifyResend.status === "sending" ? "Sending…" : "Resend email"}
                </button>
              ) : null}
              <button
                className="verify-banner-close"
                type="button"
                aria-label="Dismiss"
                onClick={() => setVerifyBannerDismissed(true)}
              >
                ×
              </button>
            </div>
          ) : null}
          {loadError ? (
            <section className="dashboard-panel">
              <DashboardCard>
                <h2>Unable to load the game</h2>
                <p>{loadError}</p>
              </DashboardCard>
            </section>
          ) : playerState ? (
            <Suspense fallback={<div className="dashboard-panel-loading" aria-busy="true" />}>
              <ActivePanel player={player} onRefresh={refreshState} />
            </Suspense>
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
            {item.id === "family" && player.familyPending ? <strong className="nav-badge subtle">{player.familyPending}</strong> : null}
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
            <button
              type="button"
              onClick={() => {
                setActiveSheet("guide");
                setIsMoreOpen(false);
              }}
            >
              <SvgIcon icon="guide" />
              <span>Guide</span>
            </button>
            <button type="button" onClick={onExit}>
              <span>Lobby</span>
            </button>
          </div>
        </div>
      ) : null}

      <InventorySheet open={activeSheet === "inventory"} onClose={closeSheet} player={player} initialTab={inventoryTab} />
      <CharacterSheet open={activeSheet === "character"} onClose={closeSheet} player={player} onExit={onExit} onLogout={handleLogout} onAccountDeleted={onRequireLogin} />

      {activeSheet === "guide" ? (
        <Suspense fallback={null}>
          <GuideSheet open onClose={closeSheet} />
        </Suspense>
      ) : null}

      {player.introSeen === false && !introDismissed ? (
        <Suspense fallback={null}>
          <WelcomeOverlay onDismiss={dismissIntro} />
        </Suspense>
      ) : null}
    </main>
  );
}
