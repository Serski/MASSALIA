import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, contentUrl, type PlayerState, type CharacterSheet as CharacterSheetData, type EventResolution, type DailySet, type RoutineSet, type RoutineResult, type FamilyState, type MarriageCandidate, type FamilyChild, type BirthEvent, type SpouseDeathNotice, type SuccessionState, type FestivalLive, type OlympiadStatus, type OlympiadBallot, type ManumissionChoice, type ChamberSeat, type ChamberView, type ChamberVotesView, type ChamberVoteView, type SeatParty, type ElectionsView, type ElectionOfficeView, type OfficesView, type OfficeSeatView, type OfficeSide, type AgendaView, type AgendaScopeView, type BuildingsCatalog, type BuildingsMine, type CatalogEntry, type OwnedBuilding, type ClassSection, type VendorPrice, type ServiceView } from "../api.js";
import { assetPath, nobleHouses, professions, type House, type Profession } from "../data/league.js";
import { portraitPools, type PortraitClassSlug } from "../data/portraits.js";
import { MapCanvas } from "../map/MapCanvas.js";
import "./dashboard.css";

type DashboardSection = "court" | "ledger" | "market" | "family" | "politics" | "atlas";

type IconName = "court" | "ledger" | "market" | "family" | "politics" | "atlas";

type DashboardNavItem = {
  id: DashboardSection;
  label: string;
  icon: IconName;
  badge?: number;
};

type FourStats = {
  prestige: number;
  devotion: number;
  militia: number;
  intelligence: number;
};

type PlayerDashboardState = {
  name: string;
  email: string;
  newsletterOptIn: boolean;
  // Written in-game date, e.g. "Winter, 300 BC".
  gameDateLabel: string;
  // Current season name ("Winter".."Autumn"), drives the clock-strip icon.
  seasonName: string;
  seasonEndsIn: number;
  drachmae: number;
  prestige: number;
  influence: number;
  professionSlug: string;
  houseSlug: string;
  classResource: {
    type: string;
    label: string;
    amount: number;
  } | null;
  party: "Palaioi" | "Dynatoi" | "Unaligned";
  // -100 Traditionalist .. +100 Reformist, 0 = centre.
  ideology: number;
  // Active party censure (ideology drift): flag + ISO expiry for the countdown.
  censured: boolean;
  censureExpiresAt: string | null;
  composure: number;
  withdrawn: boolean;
  stats: FourStats;
  balances: Record<string, number>;
  faceImage?: string;
  // Life-arc (age pack).
  currentAge: number;
  lifeStage: string;
  portrait?: string;
  deceased: boolean;
  decaying: string[];
  // The festival live this season (a free civic event), or null.
  festival: FestivalLive | null;
  // The Olympiad cycle status (phase, badges, live event, victor), or null.
  olympiad: OlympiadStatus | null;
  // Manumission: { eligible } when a slave holds the freedman trait, else null.
  manumission: { eligible: boolean } | null;
};

type PlayerDashboardView = PlayerDashboardState & {
  profession: Profession;
  house: House;
};

type DigestItem = {
  id: string;
  title: string;
  text: string;
};

// Props shared by every panel. `onRefresh` re-pulls /me/state after a real
// mutation (e.g. joining/leaving a party).
type PanelProps = { player: PlayerDashboardView; onRefresh: () => void };

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
  balances: { wine: 36, wheat: 130, tin: 60, iron: 40 },
  currentAge: 30,
  lifeStage: "Prime",
  deceased: false,
  decaying: [],
  festival: null,
  olympiad: null,
  manumission: null,
};

// TODO: Replace with real away-summary records.
const placeholderDigest: DigestItem[] = [
  { id: "trade", title: "Harbor trade", text: "Two wine offers expired while you were away." },
  { id: "house", title: "House Leonidas", text: "Your House gained standing among conservative citizens." },
  { id: "season", title: "Season clock", text: "Season I advanced by one day. The assembly meets soon." },
];

function getPlaceholderPlayer(): PlayerDashboardView {
  const profession = professions.find((item) => item.slug === placeholderPlayerState.professionSlug) ?? professions[0]!;
  const house = nobleHouses.find((item) => item.slug === placeholderPlayerState.houseSlug) ?? nobleHouses[0]!;
  return { ...placeholderPlayerState, profession, house };
}

function normalizeParty(party: string): PlayerDashboardState["party"] {
  if (party.toLowerCase() === "palaioi") return "Palaioi";
  if (party.toLowerCase() === "dynatoi") return "Dynatoi";
  return "Unaligned";
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

function getFaceImage(professionSlug: string, faceId: string | null) {
  const portraits = portraitPools[professionSlug as PortraitClassSlug] ?? [];
  return portraits.find((portrait) => portrait.id === faceId && !portrait.placeholder)?.image;
}

function playerFromState(state: PlayerState): PlayerDashboardView {
  const profession = professions.find((item) => item.slug === state.character.professionSlug) ?? professions[0]!;
  const house = nobleHouses.find((item) => item.slug === state.character.houseSlug) ?? nobleHouses[0]!;
  return {
    name: state.character.name,
    email: state.user.email,
    newsletterOptIn: state.user.newsletterOptIn,
    gameDateLabel: state.world.gameDateLabel,
    seasonName: state.world.gameDate?.seasonName ?? "Winter",
    seasonEndsIn: state.world.seasonEndsIn,
    drachmae: state.resources.drachmae,
    prestige: state.resources.prestige,
    influence: state.resources.influence,
    professionSlug: profession.slug,
    houseSlug: house.slug,
    classResource: state.resources.classResource,
    party: normalizeParty(state.character.party),
    // Guard against a missing value (e.g. a frontend/backend deploy-window skew)
    // so the bar degrades to "Centrist (0%)" instead of rendering "NaN%".
    ideology: state.character.ideology ?? 0,
    censured: state.character.censured,
    censureExpiresAt: state.character.censureExpiresAt,
    composure: state.character.composure,
    withdrawn: state.character.withdrawn,
    stats: state.stats,
    balances: state.resources.balances,
    faceImage: getFaceImage(profession.slug, state.character.faceId),
    currentAge: state.character.currentAge,
    lifeStage: state.character.lifeStage,
    portrait: contentUrl(state.character.portrait),
    deceased: state.character.deceased,
    decaying: state.character.decaying ?? [],
    festival: state.festival ?? null,
    olympiad: state.olympiad ?? null,
    manumission: state.manumission ?? null,
    profession,
    house,
  };
}

function iconPath(icon: IconName) {
  switch (icon) {
    case "court":
      return (
        <>
          <path d="M5 18h14" />
          <path d="M7 18V9l5-4 5 4v9" />
          <path d="M9 18v-5h6v5" />
        </>
      );
    case "ledger":
      return (
        <>
          <path d="M4 20V8l8-4 8 4v12" />
          <path d="M8 20v-7h8v7" />
          <path d="M4 11h16" />
        </>
      );
    case "market":
      return (
        <>
          <path d="M4 10h16l-1-4H5l-1 4Z" />
          <path d="M6 10v9h12v-9" />
          <path d="M9 19v-5h6v5" />
        </>
      );
    case "family":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <circle cx="16" cy="9" r="2.5" />
          <path d="M4 20c.8-4 2.7-6 5-6s4.2 2 5 6" />
          <path d="M13 15c1-.8 2-1.2 3-1.2 2 0 3.5 1.8 4 5.2" />
        </>
      );
    case "politics":
      return (
        <>
          <path d="M12 3 4 8l8 5 8-5-8-5Z" />
          <path d="M4 13l8 5 8-5" />
          <path d="M4 17l8 5 8-5" />
        </>
      );
    case "atlas":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16" />
          <path d="M12 4c2 2.2 3 4.8 3 8s-1 5.8-3 8" />
          <path d="M12 4c-2 2.2-3 4.8-3 8s1 5.8 3 8" />
        </>
      );
  }
}

function SvgIcon({ icon }: { icon: IconName }) {
  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true">
      {iconPath(icon)}
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function DashboardCard({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <article className={`dashboard-card${className ? ` ${className}` : ""}`} style={style}>{children}</article>;
}

function ListRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="dashboard-list-row">
      <div>{children}</div>
      {action ? <div className="dashboard-row-action">{action}</div> : null}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Reusable panel building blocks ported from the v8 mockup.
// ---------------------------------------------------------------------------

// Scene-art banner slot. Real art is swappable later via the `art` prop; until
// then it renders the gradient placeholder + dashed "scene art" tag.
function PanelBanner({ scene, art, className = "" }: { scene: string; art?: string; className?: string }) {
  return (
    <div
      className={`panel-banner${className ? ` ${className}` : ""}`}
      style={art ? { backgroundImage: `url("${art}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {art ? null : <span className="scene-tag">scene art — {scene}</span>}
    </div>
  );
}

type TraitTone = "good" | "warn" | "neutral";

function Tchip({ label, tone = "neutral" }: { label: string; tone?: TraitTone }) {
  return <span className={`tchip tone-${tone}`}>{label}</span>;
}

function PanelRow({
  icon,
  title,
  sub,
  action,
  tag,
  dim = false,
}: {
  icon: string;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  tag?: string;
  dim?: boolean;
}) {
  return (
    <div className={`panel-row${dim ? " dim" : ""}`}>
      <div className="pr-l">
        <span className="pr-ic" aria-hidden="true">{icon}</span>
        <div>
          <div className="pr-t">{title}</div>
          {sub ? <div className="pr-s">{sub}</div> : null}
        </div>
      </div>
      {action ? action : tag ? <span className="pr-lvl">{tag}</span> : null}
    </div>
  );
}

function StubButton({
  children,
  ghost = false,
  disabled = false,
  message,
  onStub,
}: {
  children: ReactNode;
  ghost?: boolean;
  disabled?: boolean;
  message: string;
  onStub: (message: string) => void;
}) {
  return (
    <button
      type="button"
      className={`panel-btn${ghost ? " ghost" : ""}`}
      disabled={disabled}
      onClick={() => onStub(message)}
    >
      {children}
    </button>
  );
}

function PersonFaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="9" r="4" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

function PersonRow({
  name,
  nameSuffix,
  role,
  traits,
  right,
}: {
  name: string;
  nameSuffix?: ReactNode;
  role: string;
  traits: { label: string; tone?: TraitTone }[];
  right?: ReactNode;
}) {
  return (
    <div className="person-row">
      <span className="person-face">
        <PersonFaceIcon />
      </span>
      <div className="person-meta">
        <div className="person-name">
          {name}
          {nameSuffix}
        </div>
        <div className="person-role">{role}</div>
        <div className="person-traits">
          {traits.map((trait) => (
            <Tchip key={trait.label} label={trait.label} tone={trait.tone} />
          ))}
        </div>
      </div>
      {right}
    </div>
  );
}

function DigestList({ items }: { items: { id: string; icon: string; text: ReactNode }[] }) {
  return (
    <div className="pol-aside">
      {items.map((item) => (
        <div className="news-row" key={item.id}>
          <span className="news-ic" aria-hidden="true">{item.icon}</span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

// --- Politics countdown (censure expiry) -----------------------------------
function remainingSeconds(untilIso: string | null) {
  if (!untilIso) return 0;
  const ms = new Date(untilIso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "0s";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function useCountdownSeconds(untilIso: string | null) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(untilIso));
  useEffect(() => {
    setRemaining(remainingSeconds(untilIso));
    if (!untilIso) return;
    const id = window.setInterval(() => {
      const next = remainingSeconds(untilIso);
      setRemaining(next);
      if (next <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [untilIso]);
  return remaining;
}

function ideologyReadout(ideology: number) {
  const abs = Math.abs(ideology);
  if (abs === 0) return "Centrist (0%)";
  return `${abs}% ${ideology < 0 ? "Traditionalist" : "Reformist"}`;
}

// ---------------------------------------------------------------------------
// Panel placeholder data (TODO: real services later).
// ---------------------------------------------------------------------------

// TODO: market listings are placeholder until the market service exists.
type MarketCat = "res" | "item" | "people" | "special";
const placeholderListings: {
  id: string;
  cat: MarketCat;
  icon: string;
  name: string;
  price: string;
  seller: string;
  sellerIsGame: boolean;
  action: string;
}[] = [
  { id: "tin", cat: "res", icon: "🪨", name: "Tin × 40", price: "11 g ea", seller: "Nikandros", sellerIsGame: false, action: "Buy" },
  { id: "wine", cat: "res", icon: "🍷", name: "Wine × 20", price: "15 g ea", seller: "the Agora", sellerIsGame: true, action: "Buy" },
  { id: "wheat", cat: "res", icon: "🌾", name: "Wheat × 100", price: "9 g ea", seller: "Philippa", sellerIsGame: false, action: "Buy" },
  { id: "letter", cat: "item", icon: "📜", name: "Letter of Credit", price: "95 g", seller: "Dorieus", sellerIsGame: false, action: "Buy" },
  { id: "amphora", cat: "item", icon: "🏺", name: "Bronze Amphora set", price: "60 g", seller: "the Agora", sellerIsGame: true, action: "Buy" },
  { id: "guard", cat: "people", icon: "🛡️", name: "Caravan Guard · contract", price: "40 g", seller: "the Agora", sellerIsGame: true, action: "Hire" },
  { id: "tutor", cat: "people", icon: "📖", name: "Tutor · for your children", price: "120 g", seller: "the Agora", sellerIsGame: true, action: "Hire" },
  { id: "expedition", cat: "special", icon: "⛵", name: "Expedition share · a long voyage", price: "500 g", seller: "the Agora", sellerIsGame: true, action: "Buy" },
  { id: "ring", cat: "special", icon: "💍", name: "Lion-seal ring · unique", price: "800 g", seller: "Kallias", sellerIsGame: false, action: "Buy" },
];

// TODO: buy orders are placeholder until the market service exists.
const placeholderBuyOrders: { id: string; icon: string; title: string; sub: string; mine: boolean }[] = [
  { id: "tin", icon: "🪨", title: "Seeking 60 Tin · 10g ea", sub: "Posted by you · partial · 22 filled", mine: true },
  { id: "wheat", icon: "🌾", title: "Seeking 30 Wheat · 8g ea", sub: "Posted by Dorieus", mine: false },
];

const marketFilters: { id: "all" | MarketCat; label: string }[] = [
  { id: "all", label: "All" },
  { id: "res", label: "Resources" },
  { id: "item", label: "Items" },
  { id: "people", label: "People" },
  { id: "special", label: "Special" },
];

const partyNews = [
  { id: "champion", icon: "📣", text: <>A member seeks the party's backing for <b>Archon</b>.</> },
  { id: "drift", icon: "⚠️", text: <>Members who drift to the other side are <b>expelled</b>.</> },
];

const partyOptions: {
  slug: "dynatoi" | "palaioi";
  greek: string;
  name: "Dynatoi" | "Palaioi";
  pitch: string;
  side: "Reformist" | "Traditionalist";
  consClass: boolean;
}[] = [
  { slug: "dynatoi", greek: "ΔΥΝΑΤΟΙ", name: "Dynatoi", pitch: "The reformers — new money, open ports, and a League remade. They court the bold.", side: "Reformist", consClass: false },
  { slug: "palaioi", greek: "ΠΑΛΑΙΟΙ", name: "Palaioi", pitch: "The old guard — tradition, temples, and the founders' law. They reward loyalty.", side: "Traditionalist", consClass: true },
];

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const ARENA_LABELS: Record<string, string> = {
  class: "Your Calling",
  general: "Massalia",
  council: "Oligarchy Council",
  party: "Your Party",
};

// The curated daily decision set: one card per arena, each resolvable once, with
// composure previews on every choice (never a hidden cost).
function CourtDecisions({ onRefresh }: PanelProps) {
  const [daily, setDaily] = useState<DailySet | null>(null);
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, EventResolution>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api
      .dailyEvents()
      .then(setDaily)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Unable to load decisions."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .dailyEvents()
      .then((set) => {
        if (!cancelled) setDaily(set);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Unable to load decisions.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = async (eventId: string, choiceId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveEvent(eventId, choiceId);
      setOutcomes((prev) => ({ ...prev, [eventId]: result }));
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not resolve that decision.");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="dashboard-todo">{error}</p>;
  if (!daily) return <p className="dashboard-todo">Loading decisions…</p>;
  if (!daily.cards.length) return <p className="dashboard-todo">No decisions await you today.</p>;

  return (
    <div className="dashboard-event-stack">
      {daily.withdrawn ? (
        <div className="court-status withdrawn" role="status">
          ⚠️ You have withdrawn from public life. Today's decisions are closed; new ones arrive tomorrow.
        </div>
      ) : daily.remaining === 0 ? (
        <div className="court-status spent" role="status">
          You have settled today's decisions. New ones arrive tomorrow.
        </div>
      ) : (
        <div className="court-status open">
          {daily.remaining} of {daily.cards.length} decisions awaiting you today
        </div>
      )}
      {daily.cards.map((card) => {
        const event = card.event;
        const liveOutcome = outcomes[event.id];
        const isResolved = card.resolved || Boolean(liveOutcome);
        return (
          <DashboardCard className="event-card" key={event.id}>
            <div className="event-body">
              <span className="dashboard-label event-kicker">{ARENA_LABELS[card.arena] ?? "Decision"}</span>
              <h3>{event.scene}</h3>
              {isResolved ? (
                <div className="event-outcome" role="status">
                  <p>{liveOutcome?.resultText ?? card.resolvedResult}</p>
                  {liveOutcome && liveOutcome.composureDelta !== 0 ? (
                    <p className={`composure-note ${liveOutcome.composureDelta < 0 ? "neg" : "pos"}`}>
                      {liveOutcome.composureDelta > 0 ? "+" : ""}{liveOutcome.composureDelta} Composure — {liveOutcome.composureReason}
                    </p>
                  ) : null}
                  {liveOutcome?.broke ? (
                    <p className="composure-note neg">
                      You broke down{liveOutcome.grantedTrait ? ` and learned to cope (${liveOutcome.grantedTrait})` : ""} — withdrawn until tomorrow.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="event-choice-stack">
                  {event.choices.map((choice) => (
                    <button
                      className="event-choice-button"
                      type="button"
                      key={choice.id}
                      disabled={busy || daily.withdrawn}
                      onClick={() => resolve(event.id, choice.id)}
                    >
                      <strong>{choice.label}</strong>
                      {choice.costs.length > 0 || choice.composureDelta !== 0 ? (
                        <span className="choice-costs">
                          {choice.costs.map((cost, i) => (
                            <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                          ))}
                          {choice.composureDelta !== 0 ? (
                            <span
                              className={`cost-chip ${choice.composureDelta < 0 ? "cost-negative" : "cost-positive"}`}
                              title={choice.composureReason}
                            >
                              {choice.composureDelta > 0 ? "+" : ""}{choice.composureDelta} Composure
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DashboardCard>
        );
      })}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </div>
  );
}

const LADDER_LABELS: Record<string, string> = {
  rhetoric: "Rhetoric",
  philosophia: "Philosophia",
  gymnasium: "Gymnasium",
  mysteries: "Mysteries",
};

// The proactive half of the daily loop: pick ONE routine per day. Mirrors the
// CourtDecisions resolve/preview pattern; locks after a pick and shows the four
// upbringing-ladder progress bars.
function RoutinesCard({ onRefresh }: PanelProps) {
  const [set, setSet] = useState<RoutineSet | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<RoutineResult | null>(null);

  const load = useCallback(() => {
    api.routines().then(setSet).catch((err) => setError(err instanceof ApiError ? err.message : "Unable to load routines."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .routines()
      .then((next) => !cancelled && setSet(next))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Unable to load routines."));
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async (routineId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveRoutine(routineId);
      setOutcome(result);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not begin that routine.");
    } finally {
      setBusy(false);
    }
  };

  const ladderBars = set ? (
    <div className="routine-ladders" style={{ display: "grid", gap: 6, marginTop: 12 }}>
      {Object.entries(set.ladders).map(([key, ladder]) => {
        const pct = ladder.nextThreshold ? Math.min(100, Math.round((ladder.xp / ladder.nextThreshold) * 100)) : 100;
        return (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto", gap: 8, alignItems: "center", fontSize: 11 }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.8 }}>{LADDER_LABELS[key] ?? key}</span>
            <span style={{ height: 6, borderRadius: 3, background: "rgba(12, 8, 7, 0.5)", border: "1px solid rgba(181, 138, 69, 0.18)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--dash-good)" }} />
            </span>
            <span style={{ opacity: 0.7 }}>{ladder.nextThreshold !== null ? `${ladder.xp}/${ladder.nextThreshold}` : `${ladder.xp} ✓`}</span>
          </div>
        );
      })}
    </div>
  ) : null;

  // order:3 keeps this after the digest on the mobile court-grid reflow.
  return (
    <DashboardCard className="actions-card" style={{ order: 3 }}>
      <h2>Your Day</h2>
      {error ? (
        <p className="dashboard-todo">{error}</p>
      ) : !set ? (
        <p className="dashboard-todo">Loading routines…</p>
      ) : set.withdrawn ? (
        <p className="dashboard-todo" role="status">You have withdrawn from public life. Choose a routine again tomorrow.</p>
      ) : set.pickedRoutineId ? (
        <div className="routine-chosen" role="status">
          <p>
            Today you chose <strong>{set.cards.find((c) => c.id === set.pickedRoutineId)?.label ?? "your routine"}</strong>. New choices arrive tomorrow.
          </p>
          {outcome && outcome.composureDelta !== 0 ? (
            <p className={`composure-note ${outcome.composureDelta < 0 ? "neg" : "pos"}`}>
              {outcome.composureDelta > 0 ? "+" : ""}{outcome.composureDelta} Composure — {outcome.composureReason}
            </p>
          ) : null}
          {outcome?.ladder?.traitGranted ? (
            <p className="composure-note pos">Your practice bore fruit: {outcome.ladder.traitGranted}.</p>
          ) : null}
          {outcome?.broke ? (
            <p className="composure-note neg">The day broke you — withdrawn until tomorrow.</p>
          ) : null}
        </div>
      ) : (
        <div className="event-choice-stack">
          {set.cards.map((card) => (
            <button
              className="event-choice-button"
              type="button"
              key={card.id}
              disabled={busy}
              title={card.scene}
              onClick={() => pick(card.id)}
            >
              <strong>{card.label}</strong>
              {card.costs.length > 0 || card.composureDelta !== 0 ? (
                <span className="choice-costs">
                  {card.costs.map((cost, i) => (
                    <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                  ))}
                  {card.composureDelta !== 0 ? (
                    <span className={`cost-chip ${card.composureDelta < 0 ? "cost-negative" : "cost-positive"}`} title={card.composureReason}>
                      {card.composureDelta > 0 ? "+" : ""}{card.composureDelta} Composure
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {ladderBars}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </DashboardCard>
  );
}

// A festival is a free civic event — surfaced prominently, above the daily
// decisions, with each donation tier's previewed effects.
function FestivalBanner({ festival, onRefresh }: { festival: FestivalLive; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<EventResolution | null>(null);

  const choose = async (choiceId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveFestival(festival.festivalId, choiceId);
      setOutcome(result);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The festival offering could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardCard className="festival-card">
      <div className="event-body">
        <span className="dashboard-label festival-kicker">🎭 Festival · free civic event</span>
        <h3>{festival.event.scene}</h3>
        {outcome ? (
          <div className="event-outcome" role="status">
            <p>{outcome.resultText}</p>
            {outcome.composureDelta !== 0 ? (
              <p className={`composure-note ${outcome.composureDelta < 0 ? "neg" : "pos"}`}>
                {outcome.composureDelta > 0 ? "+" : ""}{outcome.composureDelta} Composure — {outcome.composureReason}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="event-choice-stack">
            {festival.event.choices.map((choice) => (
              <button className="event-choice-button" type="button" key={choice.id} disabled={busy} onClick={() => choose(choice.id)}>
                <strong>{choice.label}</strong>
                {choice.costs.length > 0 || choice.composureDelta !== 0 ? (
                  <span className="choice-costs">
                    {choice.costs.map((cost, i) => (
                      <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                    ))}
                    {choice.composureDelta !== 0 ? (
                      <span className={`cost-chip ${choice.composureDelta < 0 ? "cost-negative" : "cost-positive"}`} title={choice.composureReason}>
                        {choice.composureDelta > 0 ? "+" : ""}{choice.composureDelta} Composure
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// Remaining real time until a window shuts (the ballot/Olympiad countdown).
function timeUntil(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closing now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// The live Olympic event (nominate / the Games) — surfaced like a festival: free,
// no daily decision spent. On the Games it reveals the victor/honorable outcome.
function OlympicBanner({ live, onRefresh }: { live: NonNullable<OlympiadStatus["liveEvent"]>; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<EventResolution | null>(null);
  const [victory, setVictory] = useState<{ won: boolean } | null>(null);

  const choose = async (choiceId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveOlympic(choiceId);
      setOutcome(result);
      if (result.compete) setVictory({ won: result.compete.won });
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The herald could not record your choice.");
    } finally {
      setBusy(false);
    }
  };

  const isGames = live.eventId === "olympic-games";
  return (
    <DashboardCard className="olympic-card">
      <div className="event-body">
        <span className="dashboard-label olympic-kicker">{isGames ? "🏛️ The Olympic Games" : "🏛️ The Olympiad · the assembly nominates"}</span>
        <h3>{live.event.scene}</h3>
        {outcome ? (
          <div className="event-outcome" role="status">
            {victory ? (
              <p className={victory.won ? "olympic-victory" : "composure-note"}>
                {victory.won ? "🥇 Olive crown! Massalia crowns an Olympionikes." : "An honorable showing — the city is not shamed."}
              </p>
            ) : null}
            <p>{outcome.resultText}</p>
          </div>
        ) : (
          <div className="event-choice-stack">
            {live.event.choices.map((choice) => (
              <button className="event-choice-button" type="button" key={choice.id} disabled={busy} onClick={() => choose(choice.id)}>
                <strong>{choice.label}</strong>
                {choice.costs.length > 0 || choice.composureDelta !== 0 ? (
                  <span className="choice-costs">
                    {choice.costs.map((cost, i) => (
                      <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                    ))}
                    {choice.composureDelta !== 0 ? (
                      <span className={`cost-chip ${choice.composureDelta < 0 ? "cost-negative" : "cost-positive"}`} title={choice.composureReason}>
                        {choice.composureDelta > 0 ? "+" : ""}{choice.composureDelta} Composure
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// The voting ballot: every living citizen votes (even those who cannot stand).
// Live standings are HIDDEN until close — your vote is changeable until the window
// shuts, with a countdown.
function OlympicBallotPanel({ onRefresh }: { onRefresh: () => void }) {
  const [ballot, setBallot] = useState<OlympiadBallot | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.olympicBallot().then(setBallot).catch(() => setNote("The ballot could not be read."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const vote = async (candidateId: string) => {
    setBusy(true);
    setNote("");
    try {
      await api.olympicVote(candidateId);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your vote could not be cast.");
    } finally {
      setBusy(false);
    }
  };

  if (!ballot || ballot.phase !== "voting") return null;
  return (
    <DashboardCard className="olympic-card ballot-card">
      <div className="event-body">
        <span className="dashboard-label olympic-kicker">🗳️ Olympic ballot · choose {ballot.seats} to send</span>
        <h3>The assembly votes. Closes in {timeUntil(ballot.votingEndsAt)}.</h3>
        <p className="dashboard-todo">The count is sealed until the vote closes — choose who carries Massalia's name. You may change your vote until then.</p>
        <div className="event-choice-stack">
          {ballot.candidates.length === 0 ? (
            <p className="dashboard-todo">No names stand on the ballot.</p>
          ) : (
            ballot.candidates.map((c) => {
              const chosen = ballot.yourVote === c.characterId;
              return (
                <button
                  key={c.characterId}
                  type="button"
                  className={`event-choice-button${chosen ? " ballot-chosen" : ""}`}
                  disabled={busy}
                  onClick={() => vote(c.characterId)}
                >
                  <strong>{c.name} of House {c.houseName}</strong>
                  <span className="choice-costs">
                    <span className="cost-chip cost-neutral">{titleCase(c.classId)}</span>
                    <span className="cost-chip cost-positive">Prestige {c.prestige}</span>
                    {chosen ? <span className="cost-chip cost-positive">✓ your vote</span> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// The Olympiad section of the Court: the city-wide victor, your delegate badge,
// the live event banner, and the voting ballot — whatever the phase calls for.
function OlympiadSection({ olympiad, onRefresh }: { olympiad: OlympiadStatus; onRefresh: () => void }) {
  return (
    <>
      {olympiad.champion ? (
        <DashboardCard className="olympic-card champion-card">
          <div className="event-body">
            <span className="dashboard-label olympic-kicker">🥇 Olympia</span>
            <h3>Massalia crowns an Olympionikes — {olympiad.champion.name}, victor at the Games!</h3>
          </div>
        </DashboardCard>
      ) : null}
      {olympiad.youAreOlympionikes ? (
        <p className="olympic-badge olympic-honor" role="status">🥇 Olympionikes — an Olympic victor, crowned with wild olive. An honor that outlives the man.</p>
      ) : null}
      {olympiad.youAreDelegate ? (
        <p className="olympic-badge" role="status">🏛️ You are an Olympic Delegate — chosen to carry Massalia's name to Olympia.</p>
      ) : null}
      {olympiad.liveEvent ? <OlympicBanner live={olympiad.liveEvent} onRefresh={onRefresh} /> : null}
      {olympiad.phase === "voting" ? <OlympicBallotPanel onRefresh={onRefresh} /> : null}
    </>
  );
}

// The stat bonus of a manumission class, rendered as chips.
function bonusChips(bonus: ManumissionChoice["bonus"]) {
  const labels: [keyof ManumissionChoice["bonus"], string][] = [
    ["prestige", "Prestige"],
    ["devotion", "Devotion"],
    ["militia", "Militia"],
    ["intelligence", "Intelligence"],
  ];
  return labels
    .filter(([key]) => (bonus[key] ?? 0) !== 0)
    .map(([key, label]) => (
      <span key={key} className="cost-chip cost-positive">+{bonus[key]} {label}</span>
    ));
}

// The milestone the whole slave arc has built toward: a freedman buys into a
// citizen class. Choosing one switches classId — the mine routine is gone and the
// full citizen daily loop + family unlock. Shown only while the slave holds freedman.
function FreedomPanel({ onRefresh }: { onRefresh: () => void }) {
  const [choices, setChoices] = useState<ManumissionChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.manumission()
      .then((opts) => !cancelled && setChoices(opts.eligible ? opts.choices : []))
      .catch(() => !cancelled && setNote("The registry could not be read."));
    return () => { cancelled = true; };
  }, []);

  const claim = async (classId: string, name: string) => {
    setBusy(true);
    setNote("");
    try {
      await api.manumit(classId);
      setNote(`Free, and a ${name.toLowerCase()} of Massalia. The mine is behind you.`);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The manumission could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  if (!choices) return null;
  return (
    <DashboardCard className="freedom-card">
      <div className="event-body">
        <span className="dashboard-label freedom-kicker">⛓️‍💥 Claim your freedom</span>
        <h3>The registry holds your name as a free citizen. Choose the life you will build.</h3>
        <p className="dashboard-todo">You keep all you have earned — your stats, your traits, your years — and take up the trade of your new station.</p>
        <div className="freedom-grid">
          {choices.map((choice) => (
            <DashboardCard className="freedom-choice" key={choice.classId}>
              <div className="event-body">
                <span className="dashboard-label">{choice.name}</span>
                <p className="freedom-flavor">{choice.flavor}</p>
                <span className="choice-costs">{bonusChips(choice.bonus)}</span>
                <button className="event-choice-button" type="button" disabled={busy} onClick={() => claim(choice.classId, choice.name)}>
                  <strong>Become a {choice.name}</strong>
                </button>
              </div>
            </DashboardCard>
          ))}
        </div>
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

function CourtPanel({ player, onRefresh }: PanelProps) {
  return (
    <section className="dashboard-panel" aria-labelledby="court-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Home</p>
        <h1 id="court-title">Court</h1>
        <p>Messages, petitions, and decisions waiting for your return.</p>
      </div>
      <PanelBanner scene="the court of Massalia" />
      <div className="court-grid">
        <div className="decision-column">
          {player.manumission?.eligible ? <FreedomPanel onRefresh={onRefresh} /> : null}
          {player.olympiad ? <OlympiadSection olympiad={player.olympiad} onRefresh={onRefresh} /> : null}
          {player.festival ? <FestivalBanner festival={player.festival} onRefresh={onRefresh} /> : null}
          <div className="panel-subhead decision-subhead">
            <span className="dashboard-label">Decisions awaiting you</span>
          </div>
          <CourtDecisions player={player} onRefresh={onRefresh} />
        </div>
        <aside className="court-rail" aria-label="Court summary">
          <DashboardCard className="digest-card">
            <h2>While you were away</h2>
            <div className="dashboard-list compact">
              {placeholderDigest.map((item) => (
                <ListRow key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </ListRow>
              ))}
            </div>
            <p className="dashboard-todo">TODO: digest is placeholder data until the away-summary service exists.</p>
          </DashboardCard>
          {/* Daily Routines: the proactive half of the daily loop. order:3 lives
              inside RoutinesCard so it stays after the digest on the mobile reflow. */}
          <RoutinesCard player={player} onRefresh={onRefresh} />
        </aside>
      </div>
    </section>
  );
}

// --- The Ledger / player economy (Economy Build 1) --------------------------
// A universal frame for ALL classes: (a) Your Trade — the class building line,
// (b) Common Buildings — the seven commons, and (c) the class-section slot, a
// generic stateful/time-bound/stat-gated list built for the hardest future case
// (the hoplite's contracts), empty now. Plus the banded NPC-agora vendor drawer.

// A short, human countdown to an ISO instant (e.g. "ready in 5h", "ready in 2d").
function buildCountdown(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ready";
  const hours = Math.ceil(ms / 3_600_000);
  return hours < 24 ? `ready in ${hours}h` : `ready in ${Math.ceil(hours / 24)}d`;
}

function yieldSummary(yields: { good: string; perDay: number }[]): string {
  return yields.map((y) => `${y.perDay >= 1 ? Math.round(y.perDay) : y.perDay.toFixed(1)} ${y.good}/day`).join(" · ");
}

const GOOD_ICON: Record<string, string> = {
  grain: "🌾", oliveoil: "🫒", wine: "🍷", chicken: "🐔", timber: "🪵", bull: "🐂", horse: "🐎",
};

// The class-section slot. Built to render a list of stateful, time-bound, stat-
// gated entries (the hoplite's future contracts); for now every class's list is
// empty, so it shows a labelled "coming soon" placeholder.
function ClassActionsList({ section }: { section: ClassSection }) {
  if (!section.label) {
    // Landowner / slave: no class section — a flavor line, not a slot.
    return section.flavor ? <p className="dashboard-todo">{section.flavor}</p> : null;
  }
  return (
    <>
      <div className="panel-label">{section.label}</div>
      <div className="panel-grid2">
        {section.entries.length === 0 ? (
          <PanelRow icon="📜" title={`${section.label} — coming soon`} sub="This path's stateful undertakings arrive in a later build." dim />
        ) : (
          section.entries.map((entry) => (
            <PanelRow
              key={entry.id}
              icon="📜"
              title={entry.title}
              sub={entry.detail}
              tag={entry.status}
            />
          ))
        )}
      </div>
    </>
  );
}

// The hoplite's "Service" section (Hoplite Step 1): the home army rank ladder +
// daily salary. Rendered in the class-section slot for hoplites only; other
// classes keep the generic ClassActionsList placeholder. A later step adds the
// "Commissions" mercenary board.
function ServiceSection({ label, onRefresh }: { label: string; onRefresh: () => void }) {
  const [data, setData] = useState<ServiceView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(await api.service());
  }, []);
  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to load your service record."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setNote("");
    try {
      await fn();
      await load();
      onRefresh();
      if (ok) setNote(ok);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <>
        <div className="panel-label">{label}</div>
        <p className="dashboard-todo">{note || "Reading the muster roll…"}</p>
      </>
    );
  }

  const accrued = data.accrued;
  const hasAccrued = accrued.drachmae > 0 || accrued.militia > 0;
  const next = data.next;
  const enlisted = data.rankId !== "none";

  return (
    <>
      <div className="panel-label">{label}</div>
      <div className="panel-grid2">
        {enlisted && data.rank ? (
          <PanelRow
            icon="🛡️"
            title={`${data.rank.name} · ${data.rank.salaryPerDay}dr/day`}
            sub={`Home garrison${data.rank.militiaPerDay > 0 ? ` · +${data.rank.militiaPerDay} militia/day` : ""}`}
            tag="serving"
          />
        ) : (
          <PanelRow icon="🛡️" title="Not enlisted" sub="Apply to the home garrison to draw a soldier's salary." />
        )}
      </div>

      {hasAccrued ? (
        <div className="ledger-collect">
          <div>
            <strong>Pay owed</strong>
            <div className="pr-s">
              {accrued.drachmae > 0 ? `${accrued.drachmae}dr` : ""}
              {accrued.drachmae > 0 && accrued.militia > 0 ? " · " : ""}
              {accrued.militia > 0 ? `+${accrued.militia} militia` : ""}
            </div>
          </div>
          <button type="button" className="primary-cta" disabled={busy} onClick={() => act(() => api.collectService(), "Pay collected.")}>
            Collect pay
          </button>
        </div>
      ) : null}

      <div className="panel-grid2">
        {!enlisted ? (
          <PanelRow
            icon="📜"
            title="Enlist — Recruit"
            sub={next ? `${next.salaryPerDay}dr/day · no requirement` : ""}
            action={
              <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.enlistService(), "Enlisted as Recruit.")}>
                Enlist
              </button>
            }
          />
        ) : next ? (
          <PanelRow
            icon="📜"
            title={`Promote → ${next.name}`}
            sub={
              data.qualifies
                ? `${next.salaryPerDay}dr/day · gate met (${next.gate.militia} militia / ${next.gate.prestige} prestige)`
                : `need ${next.gate.militia} militia (you have ${data.stats.militia}) · ${next.gate.prestige} prestige (you have ${data.stats.prestige})`
            }
            dim={!data.qualifies}
            tag={data.qualifies ? undefined : "locked"}
            action={
              data.qualifies ? (
                <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.promoteService(), `Promoted to ${next.name}.`)}>
                  Promote
                </button>
              ) : undefined
            }
          />
        ) : (
          <PanelRow icon="🏅" title="Archilochagos" sub="The highest home rank — you command the garrison." dim />
        )}
      </div>
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </>
  );
}

function VendorDrawer({ catalog, onTrade, busy }: { catalog: BuildingsCatalog; onTrade: (action: "buy" | "sell", type: string, qty: number) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ledger-vendor">
      <button type="button" className="panel-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Close the agora" : "Visit the agora vendor"}
      </button>
      {open ? (
        <div className="panel-grid2" style={{ marginTop: 10 }}>
          {catalog.vendor.map((price: VendorPrice) => (
            <div key={price.good} className="panel-row">
              <div className="pr-l">
                <span className="pr-ic" aria-hidden="true">{GOOD_ICON[price.good] ?? "📦"}</span>
                <div>
                  <div className="pr-t">{price.good[0]!.toUpperCase() + price.good.slice(1)}</div>
                  <div className="pr-s">buy {price.buy}dr · sell {price.sell}dr</div>
                </div>
              </div>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => onTrade("buy", price.good, 1)}>Buy 1</button>
                <button type="button" className="panel-btn" disabled={busy} onClick={() => onTrade("sell", price.good, 1)}>Sell 1</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="pr-s" style={{ marginTop: 6 }}>The agora trades at a fixed band ({catalog.season}); the vendor sells dear and buys cheap, so the market can never deadlock.</p>
    </div>
  );
}

function LedgerPanel({ player, onRefresh }: PanelProps) {
  const [catalog, setCatalog] = useState<BuildingsCatalog | null>(null);
  const [mine, setMine] = useState<BuildingsMine | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([api.buildingsCatalog(), api.buildingsMine()]);
    setCatalog(c);
    setMine(m);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to load your ledger."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setNote("");
    try {
      await fn();
      await load();
      onRefresh();
      if (ok) setNote(ok);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
    }
  };

  if (!catalog || !mine) {
    return (
      <section className="dashboard-panel" aria-labelledby="ledger-title">
        <div className="dashboard-panel-heading">
          <p className="section-eyebrow">{player.profession.name}</p>
          <h1 id="ledger-title">Your Ledger</h1>
        </div>
        <p className="dashboard-todo">{note || "Reckoning your books…"}</p>
      </section>
    );
  }

  const ownedById = new Map<string, OwnedBuilding>(mine.buildings.map((b) => [b.id, b]));
  const classBuilding = catalog.classBuilding;
  const ownedClass = classBuilding ? ownedById.get(classBuilding.id) : undefined;
  const pendingGoods = Object.entries(mine.pendingGoods);
  const hasPending = pendingGoods.length > 0 || mine.pendingIncomeTotal >= 1;

  const ownedRow = (b: OwnedBuilding) => (
    <PanelRow
      key={b.id}
      icon={b.icon ?? "🏛️"}
      title={`${b.name}${b.kind === "class" ? ` · Tier ${b.tier}` : ""}`}
      sub={
        b.status === "constructing"
          ? `under construction · ${buildCountdown(b.completesAt)}`
          : `${yieldSummary(b.yields)}${b.upkeepPerDay > 0 ? ` · upkeep ${b.upkeepPerDay}dr/day` : ""}`
      }
      tag={b.status === "constructing" ? "building" : undefined}
      action={
        b.status === "active" && b.upgrade ? (
          <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.upgradeBuilding(b.id))}>
            Upgrade → {b.upgrade.name} · {b.upgrade.cost}dr
          </button>
        ) : undefined
      }
    />
  );

  const buildableRow = (entry: CatalogEntry, disabled?: string) => {
    const t1 = entry.tiers[0]!;
    const sub = entry.composurePerDay
      ? `+${entry.composurePerDay} composure/day (flat) · ${t1.cost}dr · ${t1.buildDays}d`
      : entry.storageBonus
        ? `+${entry.storageBonus} storage · ${t1.cost}dr · ${t1.buildDays}d`
        : `${yieldSummary(t1.yields)} · ${t1.cost}dr · ${t1.buildDays}d`;
    return (
      <PanelRow
        key={entry.id}
        icon={entry.icon ?? "🏛️"}
        title={entry.name}
        sub={disabled ? disabled : sub}
        dim={Boolean(disabled)}
        tag={disabled ? "soon" : undefined}
        action={
          disabled ? undefined : (
            <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.buildBuilding(entry.id))}>
              Build · {t1.cost}dr
            </button>
          )
        }
      />
    );
  };

  // Other classes have no wired class line yet: show their profession tier-1 as a
  // buildable preview, disabled until their own build lands.
  const professionTier1 = player.profession.tiers[0];

  return (
    <section className="dashboard-panel" aria-labelledby="ledger-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">{player.profession.name} · {catalog.season}</p>
        <h1 id="ledger-title">Your Ledger</h1>
        <p>Massalia · your trade, your buildings, and their income.</p>
      </div>
      <PanelBanner scene="your quarter of the city" />

      {hasPending || mine.upkeepOwed > 0 ? (
        <div className="ledger-collect">
          <div>
            <strong>Ready to collect</strong>
            <div className="pr-s">
              {pendingGoods.map(([good, amt]) => `${Math.floor(amt)} ${good}`).join(" · ") || "—"}
              {mine.pendingIncomeTotal >= 1 ? ` · ${Math.floor(mine.pendingIncomeTotal)}dr income` : ""}
              {mine.upkeepOwed > 0 ? ` · upkeep owed ${Math.round(mine.upkeepOwed)}dr` : ""}
            </div>
          </div>
          <button type="button" className="primary-cta" disabled={busy} onClick={() => act(() => api.collectBuildings(), "Collected.")}>
            Collect
          </button>
        </div>
      ) : null}

      <div className="panel-label">Your Trade</div>
      <div className="panel-grid2">
        {classBuilding ? (
          ownedClass ? ownedRow(ownedClass) : buildableRow(classBuilding)
        ) : professionTier1 ? (
          <PanelRow
            icon="🏛️"
            title={professionTier1.building}
            sub={`${professionTier1.benefit} — your class line opens in a later build`}
            dim
            tag="soon"
          />
        ) : (
          <PanelRow icon="🛠️" title="No trade line" sub="This path builds standing through the story, not buildings." />
        )}
      </div>

      <div className="panel-label">Common Buildings</div>
      <div className="panel-grid2">
        {catalog.commons.map((entry) => {
          const owned = ownedById.get(entry.id);
          return owned ? ownedRow(owned) : buildableRow(entry);
        })}
      </div>

      {player.professionSlug === "hoplite" ? (
        <ServiceSection label={mine.classSection.label ?? "Service"} onRefresh={onRefresh} />
      ) : (
        <ClassActionsList section={mine.classSection} />
      )}

      <div className="panel-label">The Agora</div>
      <VendorDrawer catalog={catalog} busy={busy} onTrade={(action, type, qty) => act(() => api.vendorTrade(action, type, qty))} />

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}

function MarketPanel() {
  const [cat, setCat] = useState<"all" | MarketCat>("all");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const q = query.trim().toLowerCase();
  const visible = placeholderListings.filter(
    (listing) => (cat === "all" || listing.cat === cat) && (!q || listing.name.toLowerCase().includes(q)),
  );

  return (
    <section className="dashboard-panel" aria-labelledby="market-title">
      <div className="market-head">
        <div className="dashboard-panel-heading">
          <p className="section-eyebrow">Agora</p>
          <h1 id="market-title">The Agora — Market</h1>
          <p>Buy from players or the Agora itself · list your goods · post what you seek.</p>
        </div>
        <div className="market-head-actions">
          <StubButton message="TODO: listing items for sale is a stub until the market service exists." onStub={setNote}>+ List to sell</StubButton>
          <StubButton ghost message="TODO: posting buy orders is a stub until the market service exists." onStub={setNote}>Post buy order</StubButton>
        </div>
      </div>
      <PanelBanner scene="the agora at midday" />

      <div className="market-filterbar">
        <input
          className="market-search"
          placeholder="Search by name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search listings"
        />
        {marketFilters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`fchip${cat === filter.id ? " on" : ""}`}
            aria-pressed={cat === filter.id}
            onClick={() => setCat(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="panel-label">For sale</div>
      <div className="mkt-table" role="table" aria-label="Listings for sale">
        <div className="mkt-row mkt-h" role="row">
          <span role="columnheader">Listing</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Seller</span>
          <span role="columnheader" className="mkt-act-head">Action</span>
        </div>
        {visible.map((listing) => (
          <div className="mkt-row" role="row" key={listing.id}>
            <div className="mkt-good" role="cell">
              <span className="mkt-gic" aria-hidden="true">{listing.icon}</span>
              <span className="mkt-gn">{listing.name}</span>
            </div>
            <span className="mkt-price" role="cell">{listing.price}</span>
            <span className={`mkt-seller${listing.sellerIsGame ? " game" : ""}`} role="cell">{listing.seller}</span>
            <div className="mkt-act" role="cell">
              <StubButton message={`TODO: ${listing.action} is a stub until the market service exists.`} onStub={setNote}>
                {listing.action}
              </StubButton>
            </div>
          </div>
        ))}
        {visible.length === 0 ? <div className="mkt-empty">No listings match your search.</div> : null}
      </div>
      <p className="dashboard-todo">“People” are contract hires — guards, tutors, and other services. Never persons as property.</p>

      <div className="panel-label">Seeking to buy</div>
      <div className="panel-grid2">
        {placeholderBuyOrders.map((order) => (
          <PanelRow
            key={order.id}
            icon={order.icon}
            title={order.title}
            sub={order.sub}
            action={
              order.mine ? (
                <StubButton ghost message="TODO: cancelling an order is a stub until the market service exists." onStub={setNote}>Cancel</StubButton>
              ) : (
                <StubButton message="TODO: fulfilling an order is a stub until the market service exists." onStub={setNote}>Fulfill</StubButton>
              )
            }
          />
        ))}
      </div>
      <p className="dashboard-todo">TODO: all market listings and orders are placeholders until the market service exists.</p>
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}

// Display-layer title-case so a slug-derived dynasty name reads "House Leonidas".
function titleCase(text: string): string {
  return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function ordinalGeneration(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

const SUCCESSION_KIND_LABEL: Record<string, string> = {
  blood: "blood heir",
  adopted: "adoption",
  regent_handoff: "regent handoff",
  fresh: "fresh start",
};

const FAMILY_STAT_DEFS: { key: keyof FourStats; abbr: string }[] = [
  { key: "prestige", abbr: "PRE" },
  { key: "devotion", abbr: "DEV" },
  { key: "militia", abbr: "MIL" },
  { key: "intelligence", abbr: "INT" },
];

function CandidateStatChips({ stats }: { stats: FourStats }) {
  return (
    <span className="choice-costs">
      {FAMILY_STAT_DEFS.map((s) => (
        <span key={s.key} className="cost-chip cost-neutral">{s.abbr} {stats[s.key]}</span>
      ))}
    </span>
  );
}

// Human-readable cross-house penalty preview for a marriage candidate.
function penaltyText(candidate: MarriageCandidate): string | null {
  const { ideologyShift, partyFavorLoss } = candidate.penalty;
  if (ideologyShift === 0) return null;
  const dir = ideologyShift > 0 ? "Reformist" : "Traditionalist";
  const partyLabel = candidate.party === "palaioi" ? "Palaioi" : candidate.party === "dynatoi" ? "Dynatoi" : null;
  const favorBit = partyFavorLoss > 0 && partyLabel ? ` and cost ${partyFavorLoss} ${partyLabel} favor` : "";
  return `Marrying into House ${candidate.houseName} will pull you ${ideologyShift > 0 ? "+" : ""}${ideologyShift} toward ${dir}${favorBit}.`;
}

// A child portrait (boy/girl), gracefully falling back to an initial while the
// placeholder art has no real PNG yet.
function ChildPortrait({ child }: { child: FamilyChild }) {
  const [ok, setOk] = useState(true);
  const src = contentUrl(child.portrait);
  if (!src || !ok) return <span className="child-av-fallback" aria-hidden="true">{child.name[0]}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setOk(false)} />;
}

function ChildCard({ child }: { child: FamilyChild }) {
  const pct = child.comingOfAge > 0 ? Math.min(100, Math.round((child.age / child.comingOfAge) * 100)) : 100;
  return (
    <DashboardCard className="child-card">
      <div className="child-row">
        <span className="child-av">
          <ChildPortrait child={child} />
        </span>
        <div className="child-id">
          <div className="child-nm">
            {child.name} <span className="child-meta">· {child.sex === "male" ? "son" : "daughter"} · age {child.age}</span>
            {child.heirEligible ? <span className="heir-tag">Heir eligible</span> : null}
          </div>
          {child.heirEligible ? (
            <div className="child-grow done">Of age — an eligible heir.</div>
          ) : (
            <>
              <div className="child-grow-bar" aria-label={`${child.age} of ${child.comingOfAge}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="child-grow">{child.yearsToComingOfAge} year{child.yearsToComingOfAge === 1 ? "" : "s"} to coming of age</div>
            </>
          )}
        </div>
      </div>
    </DashboardCard>
  );
}

function BirthNotice({ event, busy, onName }: { event: BirthEvent; busy: boolean; onName: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <DashboardCard className="birth-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">A child is born to your house</span>
        <h3>A {event.sex === "male" ? "son" : "daughter"} is born — provisionally named {event.childName}.</h3>
        {event.motherDied ? (
          <p className="composure-note neg">Your wife {event.lateWifeName ?? ""} did not survive the birth. The child lives; the house endures in grief.</p>
        ) : null}
        <div className="birth-name-row">
          <input
            type="text"
            value={name}
            placeholder={event.childName}
            maxLength={64}
            aria-label="Name the child"
            onChange={(e) => setName(e.target.value)}
          />
          <button className="event-choice-button" type="button" disabled={busy} onClick={() => onName(name)}>
            <strong>{name.trim() ? `Name ${name.trim()}` : `Keep ${event.childName}`}</strong>
          </button>
        </div>
        <p className="dashboard-todo">If you let the season pass, the name {event.childName} stays.</p>
      </div>
    </DashboardCard>
  );
}

// Spouse death of old age — rendered somberly, like a childbirth death. The
// widower's marriage prospects return at the next yearly draw.
function SpouseDeathCard({ notice }: { notice: SpouseDeathNotice }) {
  const name = notice.lateWifeName ?? "Your wife";
  const years = notice.yearsMarried;
  return (
    <DashboardCard className="birth-card mourning-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">A death in the household</span>
        <h3>{name} has died.</h3>
        <p className="composure-note neg">
          {name}, your wife of {years} year{years === 1 ? "" : "s"}, has died of old age. The house mourns; in time you may seek a new match.
        </p>
      </div>
    </DashboardCard>
  );
}

function FamilyPanel({ onRefresh }: PanelProps) {
  const [state, setState] = useState<FamilyState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.family().then(setState).catch((err) => setError(err instanceof ApiError ? err.message : "Unable to load the household."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .family()
      .then((next) => !cancelled && setState(next))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Unable to load the household."));
    return () => {
      cancelled = true;
    };
  }, []);

  const marry = async (candidateId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.marry(candidateId);
      setConfirmId(null);
      const dowryBit = result.dowry > 0 ? ` Her dowry brings +${result.dowry} drachmae.` : "";
      const shiftBit = result.ideologyShift !== 0 ? ` The match pulls you ${result.ideologyShift > 0 ? "+" : ""}${result.ideologyShift} toward ${result.ideologyShift > 0 ? "Reformist" : "Traditionalist"}${result.partyFavorLoss > 0 ? ` (−${result.partyFavorLoss} party favor)` : ""}.` : "";
      setNote(`You are wed to ${result.spouseName}.${dowryBit}${shiftBit}`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The match could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const nameChild = async (childId: string, name: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.nameChild(childId, name);
      setNote(`Your child is named ${result.name}.`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The child could not be named.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-panel" aria-labelledby="family-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Household</p>
        <h1 id="family-title">House &amp; Family</h1>
        <p>Your blood, your heirs, and the matches that bind the Houses.</p>
      </div>
      <PanelBanner scene="the oikos" />

      {state?.dynasty ? (
        <div className="dynasty-head">
          <strong>{titleCase(state.dynasty.name)}</strong> · {ordinalGeneration(state.dynasty.generation)} generation
          {state.dynasty.history.length > 0 ? (
            <ul className="dynasty-history">
              {state.dynasty.history.map((h, i) => (
                <li key={i}>
                  {h.fromName ? `${h.fromName} (age ${h.fromAge ?? "?"})` : "—"} → <strong>{h.toName ?? "heir"}</strong>
                  <span className="dynasty-kind"> · {SUCCESSION_KIND_LABEL[h.kind] ?? h.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="dashboard-todo">{error}</p>
      ) : !state ? (
        <p className="dashboard-todo">Loading household…</p>
      ) : state.locks.locked ? (
        <>
          <div className="panel-label">Locked</div>
          <p className="dashboard-todo" role="status">No family is permitted to the unfree. Freedom will open this.</p>
        </>
      ) : (
        <>
          {state.birthEvent ? <BirthNotice event={state.birthEvent} busy={busy} onName={(name) => nameChild(state.birthEvent!.childId, name)} /> : null}

          {state.spouseDeath ? <SpouseDeathCard notice={state.spouseDeath} /> : null}

          {state.spouse ? (
            <>
              <div className="panel-label">Your spouse</div>
              <PersonRow
                name={`${state.spouse.name} of House ${state.spouse.houseName}`}
                nameSuffix={<span className="person-suffix"> · your wife</span>}
                role={`Age ${state.spouse.age} · ${state.spouse.houseName}`}
                traits={state.spouse.trait ? [{ label: state.spouse.trait.name, tone: "good" }] : []}
                right={<CandidateStatChips stats={state.spouse.stats} />}
              />
              {state.spouse.pastChildbearing ? (
                <p className="composure-note muted spouse-fertility-note">She is past her childbearing years.</p>
              ) : null}
            </>
          ) : null}

          {state.children.length > 0 ? (
            <>
              <div className="panel-label">Children · {state.children.length}</div>
              {state.children.map((child) => (
                <ChildCard key={child.id} child={child} />
              ))}
            </>
          ) : null}

          {state.locks.marriage && !state.married ? (
            <>
              <div className="panel-label">Prospects</div>
              {state.candidates.marriage.length === 0 ? (
                <p className="dashboard-todo">No matches are on offer this season.</p>
              ) : (
                state.candidates.marriage.map((candidate) => {
                  const penalty = penaltyText(candidate);
                  return (
                    <DashboardCard className="prospect-card" key={candidate.id}>
                      <div className="event-body">
                        <span className="dashboard-label">{candidate.name} of House {candidate.houseName}</span>
                        <p>Age {candidate.age}{candidate.trait ? ` · ${candidate.trait.name}` : ""}{candidate.dowry > 0 ? ` · dowry ${candidate.dowry}g` : ""}</p>
                        <CandidateStatChips stats={candidate.stats} />
                        {penalty ? <p className="composure-note neg">{penalty}</p> : <p className="composure-note pos">No ideological cost — a comfortable match.</p>}
                        {confirmId === candidate.id ? (
                          <div className="event-choice-stack">
                            <button className="event-choice-button" type="button" disabled={busy} onClick={() => marry(candidate.id)}>
                              <strong>Confirm marriage to {candidate.name}</strong>
                            </button>
                            <button className="dashboard-ghost-button" type="button" disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="event-choice-button" type="button" disabled={busy} onClick={() => setConfirmId(candidate.id)}>
                            <strong>Marry {candidate.name}</strong>
                          </button>
                        )}
                      </div>
                    </DashboardCard>
                  );
                })
              )}
            </>
          ) : null}

          {!state.locks.marriage && !state.locks.locked ? (
            <>
              <div className="panel-label">Adoption</div>
              {state.candidates.adoption.length === 0 ? (
                <p className="dashboard-todo">No wards are on offer this season.</p>
              ) : (
                state.candidates.adoption.map((candidate) => (
                  <PersonRow
                    key={candidate.id}
                    name={`${candidate.name} of House ${candidate.houseName}`}
                    role={`Age ${candidate.age}${candidate.trait ? ` · ${candidate.trait.name}` : ""}`}
                    traits={candidate.trait ? [{ label: candidate.trait.name, tone: "good" }] : []}
                    right={<CandidateStatChips stats={candidate.stats} />}
                  />
                ))
              )}
              <p className="dashboard-todo">Marriage is not your path; an heir comes by adoption — the rite arrives with the succession pack.</p>
            </>
          ) : null}
        </>
      )}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The Oligarchy Chamber (Politics Prompt 1): the 300-seat hemicycle, buying a
// dynastic seat, and the yearly chamber vote with its public ballot ledger.
// ---------------------------------------------------------------------------

const SEAT_PARTY_LABELS: Record<SeatParty, string> = {
  palaioi: "Palaioi",
  dynatoi: "Dynatoi",
  independent: "Independent",
};

type SeatDot = { x: number; y: number; seat: ChamberSeat };

// Lay the chamber out as a parliament arc: rows of dots, seats per row
// proportional to the row's circumference. Display order groups the benches —
// Palaioi NPCs far left, Dynatoi NPCs far right, independents in the centre,
// and the bought/empty seats (seat_index 110+) filling the gaps left-to-right
// as players buy in. seat_index is the stable identity; this mapping is purely
// presentational.
function hemicycleLayout(seats: ChamberSeat[]): SeatDot[] {
  const total = seats.length;
  if (!total) return [];
  const cx = 230;
  const cy = 212;
  const rowCount = 6;
  const radii = Array.from({ length: rowCount }, (_, i) => 86 + i * 22);
  const weight = radii.reduce((sum, r) => sum + r, 0);
  const counts = radii.map((r) => Math.floor((total * r) / weight));
  let remainder = total - counts.reduce((sum, n) => sum + n, 0);
  for (let i = rowCount - 1; remainder > 0; i = (i - 1 + rowCount) % rowCount, remainder--) counts[i]!++;

  // All dot positions, sorted left -> right across the arc.
  const positions: { x: number; y: number; angle: number }[] = [];
  counts.forEach((n, i) => {
    const r = radii[i]!;
    for (let k = 0; k < n; k++) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (n - 1);
      positions.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle), angle });
    }
  });
  positions.sort((a, b) => b.angle - a.angle || a.y - b.y);

  // Benches: Palaioi left, Dynatoi right (mirrored), independents centred,
  // everything else (player + empty, by seat_index) fills the free slots.
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const slots = new Array<ChamberSeat | undefined>(total);
  const npc = (party: SeatParty) => ordered.filter((seat) => seat.holderType === "npc" && seat.party === party);
  npc("palaioi").forEach((seat, i) => (slots[i] = seat));
  npc("dynatoi").forEach((seat, i) => (slots[total - 1 - i] = seat));
  const independents = npc("independent");
  let cursor = Math.floor((total - independents.length) / 2);
  for (const seat of independents) {
    while (slots[cursor]) cursor++;
    slots[cursor] = seat;
  }
  cursor = 0;
  for (const seat of ordered) {
    if (seat.holderType === "npc") continue;
    while (slots[cursor]) cursor++;
    slots[cursor] = seat;
  }

  return slots.map((seat, i) => ({ x: positions[i]!.x, y: positions[i]!.y, seat: seat! }));
}

function Hemicycle({ seats }: { seats: ChamberSeat[] }) {
  const dots = useMemo(() => hemicycleLayout(seats), [seats]);
  return (
    <svg className="hemicycle" viewBox="0 0 460 226" role="img" aria-label="The Oligarchy chamber — 300 seats">
      {dots.map(({ x, y, seat }) => (
        <circle
          key={seat.seatIndex}
          cx={x}
          cy={y}
          r={seat.holderType === "player" ? 5.2 : 4.2}
          className={`seat-dot seat-${seat.party ?? "empty"}${seat.holderType === "player" ? " seat-held" : ""}`}
        >
          <title>
            {seat.holderType === "player"
              ? `${seat.holderName ?? "A citizen"} — seat ${seat.seatIndex} (${SEAT_PARTY_LABELS[seat.party ?? "independent"]})`
              : seat.holderType === "npc"
                ? `${SEAT_PARTY_LABELS[seat.party!]} bench — seat ${seat.seatIndex}`
                : `Empty seat ${seat.seatIndex} — 300 dr.`}
          </title>
        </circle>
      ))}
    </svg>
  );
}

// The public ballot record — every voter named with the side they took.
function BallotLedger({ ballots }: { ballots: ChamberVoteView["ballots"] }) {
  if (!ballots.length) return <p className="dashboard-todo">No citizen ballots were cast.</p>;
  return (
    <div className="ledger-list">
      {ballots.map((ballot) => (
        <span key={`${ballot.voterName}-${ballot.castAt}`} className={`ledger-chip ledger-${ballot.choice}`}>
          {ballot.voterName} · {ballot.choice === "yes" ? "AYE" : "NAY"}
        </span>
      ))}
    </div>
  );
}

function OligarchySection({ onRefresh }: PanelProps) {
  const [chamber, setChamber] = useState<ChamberView | null>(null);
  const [votes, setVotes] = useState<ChamberVotesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.oligarchyChamber().then(setChamber).catch((err) => setError(err instanceof ApiError ? err.message : "The chamber rolls could not be read."));
    api.chamberVotes().then(setVotes).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openVote = votes?.open ?? null;
  const lastVote = votes?.past[0] ?? null;
  const countdown = useCountdownSeconds(openVote ? openVote.closesAt : null);

  const buy = async () => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.buySeat();
      setNote(`Seat ${result.seatIndex} is yours. Your name joins the roll of the Three Hundred — and your heirs will keep it.`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The purchase could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const cast = async (choice: "yes" | "no") => {
    setBusy(true);
    setNote("");
    try {
      await api.castChamberVote(choice);
      load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your ballot could not be cast.");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="dashboard-todo">{error}</p>;
  if (!chamber) return <p className="dashboard-todo">Loading the chamber…</p>;

  const { composition, you } = chamber;

  return (
    <>
      <div className="panel-label panel-label-seal">
        <img src={assetPath(OFFICE_ICON.oligarch ?? "")} alt="" loading="lazy" />
        The Oligarchy — the Three Hundred
      </div>
      <DashboardCard className="chamber-card">
        <div className="chamber-grid">
          <Hemicycle seats={chamber.seats} />
          <div className="chamber-legend">
            <div className="legend-row"><span className="legend-dot seat-palaioi" /> Palaioi · {composition.npc.palaioi + composition.players.palaioi} ({composition.players.palaioi} citizens)</div>
            <div className="legend-row"><span className="legend-dot seat-dynatoi" /> Dynatoi · {composition.npc.dynatoi + composition.players.dynatoi} ({composition.players.dynatoi} citizens)</div>
            <div className="legend-row"><span className="legend-dot seat-independent" /> Independent · {composition.npc.independent + composition.players.independent} ({composition.players.independent} citizens)</div>
            <div className="legend-row"><span className="legend-dot seat-empty" /> Empty · {composition.empty}</div>
            <div className="legend-note">{composition.playersTotal} seats held by living dynasties.</div>
            {you.holdsSeat ? (
              <div className="legend-note legend-yours">🏛️ Your dynasty holds seat {you.seatIndex}.</div>
            ) : null}
          </div>
        </div>
      </DashboardCard>

      {!you.holdsSeat && you.canBuy ? (
        <DashboardCard className="oligarchy-buy-card">
          <div className="event-body">
            <span className="dashboard-label oligarchy-kicker">🏛️ A seat among the Three Hundred</span>
            <h3>The chamber has empty marble. Buy your dynasty's seat — it passes to your heirs with your name.</h3>
            <p className="dashboard-todo">A seat seats you in the Oligarchy Council: its daily matters reach your desk, and the yearly chamber vote counts your voice — publicly.</p>
            <button className="event-choice-button" type="button" disabled={busy} onClick={buy}>
              <strong>Buy a seat — {chamber.seatPrice} dr.</strong>
            </button>
          </div>
        </DashboardCard>
      ) : null}
      {!you.holdsSeat && !you.canBuy && you.reason ? (
        <PanelRow icon="🏛️" title="A seat among the Three Hundred" sub={you.reason} dim tag="—" />
      ) : null}

      {openVote ? (
        <DashboardCard className="chamber-vote-card">
          <div className="event-body">
            <span className="dashboard-label oligarchy-kicker">🗳️ The chamber votes — closes in {formatDuration(countdown)}</span>
            <h3>{openVote.title}</h3>
            <p className="chamber-vote-desc">{openVote.description}</p>
            {openVote.youMayVote ? (
              <div className="event-choice-stack chamber-vote-choices">
                <button
                  type="button"
                  className={`event-choice-button${openVote.yourBallot === "yes" ? " ballot-chosen" : ""}`}
                  disabled={busy}
                  onClick={() => cast("yes")}
                >
                  <strong>Vote AYE</strong>
                  {openVote.yourBallot === "yes" ? <span className="choice-costs"><span className="cost-chip cost-positive">✓ your ballot — changeable until close</span></span> : null}
                </button>
                <button
                  type="button"
                  className={`event-choice-button${openVote.yourBallot === "no" ? " ballot-chosen" : ""}`}
                  disabled={busy}
                  onClick={() => cast("no")}
                >
                  <strong>Vote NAY</strong>
                  {openVote.yourBallot === "no" ? <span className="choice-costs"><span className="cost-chip cost-positive">✓ your ballot — changeable until close</span></span> : null}
                </button>
              </div>
            ) : (
              <p className="dashboard-todo">Only seat-holders vote in the chamber. Ballots are a public record.</p>
            )}
            {openVote.ballots.length ? (
              <>
                <div className="panel-label panel-label-spaced">Ballots on the floor — public record</div>
                <BallotLedger ballots={openVote.ballots} />
              </>
            ) : null}
          </div>
        </DashboardCard>
      ) : null}

      {lastVote ? (
        <DashboardCard className={`chamber-result-card ${lastVote.status}`}>
          <div className="event-body">
            <span className="dashboard-label oligarchy-kicker">
              {lastVote.status === "passed" ? "✅ The chamber assented" : "❌ The chamber refused"} · year {300 - lastVote.gameYear} BC
            </span>
            <h3>{lastVote.title} — {lastVote.yesCount ?? 0} aye, {lastVote.noCount ?? 0} nay</h3>
            <div className="panel-label">The ledger — who voted how</div>
            <BallotLedger ballots={lastVote.ballots} />
          </div>
        </DashboardCard>
      ) : null}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Archon & Ephor offices + elections (Politics Prompt 2). The constitution's
// seats by side/party, the declare→vote→resolve cycle (secret ballot), the
// appointment cascade, and the dynasty-spanning office ledger.
// ---------------------------------------------------------------------------

const OFFICE_LABEL: Record<string, string> = { archon: "Archon", ephor: "Ephor", strategos: "Strategos" };
const SIDE_LABEL: Record<string, string> = { palaioi: "Palaioi", dynatoi: "Dynatoi" };
// Office seals reuse the front-page government art (App.tsx office grid):
// Archon→ARCHON, Ephor→EPHOR, Strategos→GENERAL, the Oligarchy Council→OLIGARCH.
const OFFICE_ICON: Record<string, string> = {
  archon: "assets/offices/ARCHON.webp",
  ephor: "assets/offices/EPHOR.webp",
  strategos: "assets/offices/GENERAL.webp",
  oligarch: "assets/offices/OLIGARCH.webp",
};

function partyDotClass(party: string | null | undefined): string {
  if (party === "palaioi") return "seat-palaioi";
  if (party === "dynatoi") return "seat-dynatoi";
  return "seat-independent";
}
function bcYear(gameYear: number): string {
  return `${300 - gameYear} BC`;
}
function titleCaseVia(via: string | null): string {
  if (!via) return "";
  return via.charAt(0).toUpperCase() + via.slice(1);
}

// One appointment picker (Ephor vacancy or Strategos), lazily loading eligible
// same-side seat-holders when opened.
function AppointPicker({ kind, side, onAppoint }: { kind: "ephor" | "strategos"; side: OfficeSide | null; onAppoint: (characterId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [appointees, setAppointees] = useState<{ characterId: string; name: string; houseName: string; party: string }[] | null>(null);
  useEffect(() => {
    if (!open) return;
    api.officeAppointees(side ?? "").then((r) => setAppointees(r.appointees)).catch(() => setAppointees([]));
  }, [open, side]);
  if (!open) {
    return (
      <button type="button" className="panel-btn" onClick={() => setOpen(true)}>
        Appoint {kind === "ephor" ? "an Ephor" : "a Strategos"}
      </button>
    );
  }
  return (
    <div className="appoint-picker">
      {!appointees ? (
        <span className="dashboard-todo">Loading eligible seat-holders…</span>
      ) : appointees.length === 0 ? (
        <span className="dashboard-todo">No eligible seat-holder is available.</span>
      ) : (
        appointees.map((a) => (
          <button key={a.characterId} type="button" className="event-choice-button" onClick={() => onAppoint(a.characterId)}>
            <strong>{a.name} of House {a.houseName}</strong>
            <span className="choice-costs"><span className={`cost-chip cost-neutral`}>{a.party === "none" ? "Independent" : SIDE_LABEL[a.party]}</span></span>
          </button>
        ))
      )}
    </div>
  );
}

function OfficeSeatRow({ seat, onAppoint }: { seat: OfficeSeatView; onAppoint: (kind: "ephor" | "strategos", side: OfficeSide | null, characterId: string) => void }) {
  const label = `${seat.office === "strategos" ? "Strategos" : `${SIDE_LABEL[seat.side ?? ""]} ${OFFICE_LABEL[seat.office]}`}`;
  return (
    <div className="office-seat">
      <span className={`legend-dot ${partyDotClass(seat.holder?.party ?? seat.side)}`} />
      <span className="office-seat-icon" aria-hidden="true">
        <img src={assetPath(OFFICE_ICON[seat.office] ?? "")} alt="" loading="lazy" />
      </span>
      <div className="office-seat-body">
        <div className="office-seat-title">{label}</div>
        {seat.holder ? (
          <div className="office-seat-sub">
            {seat.holder.name} of House {seat.holder.houseName}
            {seat.acquiredVia && seat.acquiredVia !== "elected" ? <span className="office-via"> · {titleCaseVia(seat.acquiredVia)}</span> : null}
          </div>
        ) : (
          <div className="office-seat-sub vacant">Vacant</div>
        )}
      </div>
      {!seat.holder && seat.youMayAppoint ? (
        <AppointPicker
          kind={seat.office === "strategos" ? "strategos" : "ephor"}
          side={seat.side}
          onAppoint={(id) => onAppoint(seat.office === "strategos" ? "strategos" : "ephor", seat.side, id)}
        />
      ) : null}
    </div>
  );
}

// The live election: declaration (declare a candidacy) or voting (secret ballot).
function ElectionCycleCard({ office, onRefresh }: { office: ElectionOfficeView; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const until = office.phase === "declaration" ? office.declarationEndsAt : office.votingEndsAt;
  const countdown = useCountdownSeconds(until);

  const declare = async (side: OfficeSide) => {
    setBusy(true);
    setNote("");
    try {
      await api.declareCandidacy(office.office, side);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your candidacy could not be recorded.");
    } finally {
      setBusy(false);
    }
  };
  const vote = async (candidateCharacterId: string) => {
    setBusy(true);
    setNote("");
    try {
      await api.castElectionVote(office.office, candidateCharacterId);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your vote could not be cast.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardCard className="election-card">
      <div className="event-body">
        <span className="dashboard-label oligarchy-kicker">
          🗳️ {OFFICE_LABEL[office.office]} election — {office.phase === "declaration" ? "declarations close" : "voting closes"} in {formatDuration(countdown)}
        </span>
        {office.phase === "declaration" ? (
          <>
            <h3>The {OFFICE_LABEL[office.office]}ship is open. The benches fill with candidates.</h3>
            {office.youAreCandidate ? (
              <p className="dashboard-todo">✓ You have declared. Campaign in your daily routines to court the blocs before the vote.</p>
            ) : office.youMayDeclare.palaioi || office.youMayDeclare.dynatoi ? (
              <div className="event-choice-stack">
                {office.youMayDeclare.palaioi ? (
                  <button type="button" className="event-choice-button" disabled={busy} onClick={() => declare("palaioi")}>
                    <strong>Declare for the {OFFICE_LABEL[office.office]}ship — Palaioi bench</strong>
                  </button>
                ) : null}
                {office.youMayDeclare.dynatoi ? (
                  <button type="button" className="event-choice-button" disabled={busy} onClick={() => declare("dynatoi")}>
                    <strong>Declare for the {OFFICE_LABEL[office.office]}ship — Dynatoi bench</strong>
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="dashboard-todo">You are not eligible to stand (a seat in the Three Hundred and a clear party path are required).</p>
            )}
          </>
        ) : (
          <>
            <h3>Cast your vote for {OFFICE_LABEL[office.office]} — one per bench.</h3>
            <p className="dashboard-todo">🔒 The ballot is secret. Only the winners are announced; no tally is shown until close.</p>
            {(["palaioi", "dynatoi"] as OfficeSide[]).map((side) => {
              const sideCandidates = office.candidates.filter((c) => c.side === side);
              return (
                <div key={side} className="ballot-side">
                  <div className="panel-label">{SIDE_LABEL[side]} bench</div>
                  {sideCandidates.length === 0 ? (
                    <p className="dashboard-todo">No candidate stood on this bench — the seat will fall vacant.</p>
                  ) : (
                    sideCandidates.map((c) => {
                      const chosen = office.yourVote === c.characterId;
                      return (
                        <button key={c.characterId} type="button" className={`event-choice-button${chosen ? " ballot-chosen" : ""}`} disabled={busy} onClick={() => vote(c.characterId)}>
                          <strong>{c.name} of House {c.houseName}</strong>
                          <span className="choice-costs">
                            <span className="cost-chip cost-neutral">{c.party === "none" ? "Independent" : SIDE_LABEL[c.party]}</span>
                            <span className="cost-chip cost-positive">Prestige {c.prestige}</span>
                            {chosen ? <span className="cost-chip cost-positive">✓ your vote</span> : null}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

function OfficesSection({ onRefresh }: PanelProps) {
  const [offices, setOffices] = useState<OfficesView | null>(null);
  const [elections, setElections] = useState<ElectionsView | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.offices().then(setOffices).catch(() => {});
    api.elections().then(setElections).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onRefresh();
  };

  const onAppoint = async (kind: "ephor" | "strategos", side: OfficeSide | null, characterId: string) => {
    setNote("");
    try {
      if (kind === "ephor" && side) await api.appointEphor(side, characterId);
      else await api.appointStrategos(characterId);
      refresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The appointment could not be made.");
    }
  };

  if (!offices) return null;

  return (
    <>
      <div className="panel-label panel-label-spaced">The Constitution — offices of the League</div>
      <DashboardCard className="offices-grid-card">
        <div className="offices-grid">
          {offices.seats.map((seat) => (
            <OfficeSeatRow key={`${seat.office}-${seat.side ?? "x"}-${seat.seatSlot}`} seat={seat} onAppoint={onAppoint} />
          ))}
        </div>
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </DashboardCard>

      {elections?.offices.length ? (
        elections.offices.map((office) => <ElectionCycleCard key={office.office} office={office} onRefresh={refresh} />)
      ) : (
        <p className="dashboard-todo">
          No election is in session.{elections?.nextElectionYear != null ? ` The next falls in ${bcYear(elections.nextElectionYear)}.` : ""}
        </p>
      )}

      {offices.houseTallies.length ? (
        <>
          <div className="panel-label panel-label-spaced">Houses by office held</div>
          <div className="ledger-list">
            {offices.houseTallies.map((t) => (
              <span key={t.houseName} className="ledger-chip">
                {t.houseName}: {t.archonships ? `${t.archonships} Archonship${t.archonships > 1 ? "s" : ""}` : ""}
                {t.archonships && t.ephorships ? " · " : ""}
                {t.ephorships ? `${t.ephorships} Ephorship${t.ephorships > 1 ? "s" : ""}` : ""}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {offices.ledger.length ? (
        <>
          <div className="panel-label panel-label-spaced">The political ledger</div>
          <div className="office-ledger">
            {offices.ledger.slice(0, 16).map((h, i) => (
              <div key={i} className="office-ledger-row">
                <span className={`legend-dot ${partyDotClass(h.side)}`} />
                <span>
                  <b>{h.holderName}</b> of House {h.houseName} — {h.side ? `${SIDE_LABEL[h.side]} ` : ""}{OFFICE_LABEL[h.office]}
                  {h.acquiredVia !== "elected" ? ` (${titleCaseVia(h.acquiredVia)})` : ""}, {bcYear(h.startedYear)}
                  {h.endedYear != null ? `–${bcYear(h.endedYear)}` : " — sitting"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

// The treasury balance + audit ledger (the Ephors' oversight), visible to all.
function TreasuryCard({ treasury }: { treasury: AgendaScopeView["treasury"] }) {
  const label = treasury.owner === "league" ? "League treasury" : `${titleCase(treasury.owner)} treasury`;
  return (
    <DashboardCard className="treasury-card">
      <div className="event-body">
        <span className="dashboard-label">{label}</span>
        <p className="treasury-balance">{treasury.balance} <span className="treasury-unit">drachmae</span></p>
        {treasury.ledger.length > 0 ? (
          <ul className="treasury-ledger">
            {treasury.ledger.slice(0, 6).map((l, i) => (
              <li key={i}><span className={l.delta >= 0 ? "ledger-pos" : "ledger-neg"}>{l.delta >= 0 ? "+" : ""}{l.delta}</span> <span className="ledger-reason">{l.reason}</span></li>
            ))}
          </ul>
        ) : <p className="dashboard-todo">The books are empty.</p>}
      </div>
    </DashboardCard>
  );
}

// One government's agenda: the drafting docket (with the officials' draft/veto
// controls) or the drafted card going to the chamber, plus the treasury.
function AgendaScopeSection({ view, onRefresh }: { view: AgendaScopeView; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote("");
    try { await fn(); setNote(ok); onRefresh(); } catch (err) { setNote(err instanceof ApiError ? err.message : "That could not be done."); } finally { setBusy(false); }
  };
  const drafted = view.cards.find((c) => c.id === view.draftedCardId);
  const kicker = view.scope === "league" ? "🏛️ The League agenda" : `⚖️ ${titleCase(view.scope)} agenda`;
  return (
    <DashboardCard className="agenda-card">
      <div className="event-body">
        <span className="dashboard-label agenda-kicker">{kicker}{view.phase ? ` · ${view.phase}` : ""}</span>
        {view.phase === "drafting" ? (
          <>
            <h3>{view.youMayDraft ? "Choose the measure that goes before the chamber." : "The officials weigh the docket."}</h3>
            <div className="agenda-grid">
              {view.cards.map((card) => {
                const isDrafted = card.id === view.draftedCardId;
                const isVetoed = card.id === view.vetoedCardId;
                return (
                  <DashboardCard key={card.id} className={`agenda-choice${isDrafted ? " agenda-drafted" : ""}${isVetoed ? " agenda-vetoed" : ""}`}>
                    <div className="event-body">
                      <span className="dashboard-label">{card.title}</span>
                      <p className="agenda-flavor">{card.description}</p>
                      <span className="choice-costs">
                        <span className="cost-chip cost-neutral">{titleCase(card.partyLean)} lean</span>
                        {card.cost > 0 ? <span className="cost-chip cost-negative">{card.cost} dr.</span> : <span className="cost-chip cost-positive">Free</span>}
                        {isVetoed ? <span className="cost-chip cost-negative">Vetoed</span> : null}
                        {isDrafted ? <span className="cost-chip cost-positive">✓ drafted</span> : null}
                      </span>
                      {view.youMayDraft && !isVetoed ? (
                        <button className="event-choice-button" type="button" disabled={busy} onClick={() => act(() => api.draftAgenda(view.scope, card.id), `${card.title} goes to the chamber.`)}>
                          <strong>Put forward</strong>
                        </button>
                      ) : null}
                    </div>
                  </DashboardCard>
                );
              })}
            </div>
            {view.youMayVeto && drafted ? (
              <button className="dashboard-ghost-button agenda-veto-btn" type="button" disabled={busy} onClick={() => act(() => api.vetoAgenda(view.scope), `You vetoed ${drafted.title}.`)}>
                ⛔ Veto {drafted.title} (one per term)
              </button>
            ) : null}
          </>
        ) : view.phase === "voting" ? (
          <h3>{drafted ? `"${drafted.title}" is before the chamber — cast your vote below.` : "The chamber is in session."}</h3>
        ) : (
          <p className="dashboard-todo">No measure is in session.</p>
        )}
        <TreasuryCard treasury={view.treasury} />
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// The league agenda + treasury for the council tab; lazily fetched.
function LeagueAgendaSection({ onRefresh }: { onRefresh: () => void }) {
  const [view, setView] = useState<AgendaView | null>(null);
  const load = useCallback(() => { api.agenda().then(setView).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onRefresh(); };
  if (!view) return null;
  return <AgendaScopeSection view={view.league} onRefresh={refresh} />;
}

// The party government for the party tab: its treasury, agenda, and for-life leaders.
function PartyGovernmentSection({ party, onRefresh }: { party: "palaioi" | "dynatoi"; onRefresh: () => void }) {
  const [view, setView] = useState<AgendaView | null>(null);
  const load = useCallback(() => { api.agenda().then(setView).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onRefresh(); };
  if (!view) return null;
  const leaders = view.leaders.filter((l) => l.party === party);
  return (
    <>
      <div className="panel-label">Party leadership</div>
      <div className="party-leaders">
        {leaders.map((l) => (
          <PersonRow
            key={l.office}
            name={l.holder ? l.holder.name : "— vacant —"}
            nameSuffix={<span className="person-suffix"> · {l.office === "party_archon" ? "Party Archon" : "Party Ephor"}</span>}
            role={l.youHold ? "You hold this seat (for life)" : "For life · barred from league office"}
            traits={l.youHold ? [{ label: "You", tone: "good" }] : []}
          />
        ))}
      </div>
      <AgendaScopeSection view={view[party]} onRefresh={refresh} />
    </>
  );
}

function PoliticsPanel({ player, onRefresh }: PanelProps) {
  const [tab, setTab] = useState<"council" | "party">("council");
  const [note, setNote] = useState("");
  const censureSeconds = useCountdownSeconds(player.censured ? player.censureExpiresAt : null);
  const joined = player.party !== "Unaligned";

  const join = async (slug: "dynatoi" | "palaioi") => {
    setNote("");
    try {
      await api.joinParty(slug);
      onRefresh();
    } catch (error) {
      setNote(error instanceof ApiError ? error.message : "Could not join the party. Try again.");
    }
  };
  const leave = async () => {
    setNote("");
    try {
      await api.leaveParty();
      onRefresh();
    } catch (error) {
      setNote(error instanceof ApiError ? error.message : "Could not leave the party. Try again.");
    }
  };

  return (
    <section className="dashboard-panel" aria-labelledby="politics-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Assembly</p>
        <h1 id="politics-title">Politics</h1>
        <p>The Oligarchy Council rules the League — and two parties fight to steer it.</p>
      </div>

      <div className="cs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "council"} className={`cs-tab${tab === "council" ? " on" : ""}`} onClick={() => setTab("council")}>
          Oligarchy Council
        </button>
        <button type="button" role="tab" aria-selected={tab === "party"} className={`cs-tab${tab === "party" ? " on" : ""}`} onClick={() => setTab("party")}>
          Your Party {joined ? <span className="party-tab-tag">· {player.party}</span> : <span className="party-tab-lock" aria-label="locked">🔒</span>}
        </button>
      </div>

      {tab === "council" ? (
        <div className="pol-page">
          <OligarchySection player={player} onRefresh={onRefresh} />
          <LeagueAgendaSection onRefresh={onRefresh} />
          <OfficesSection player={player} onRefresh={onRefresh} />
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      ) : joined ? (
        <div className="pol-page">
          <PanelBanner
            scene={`the ${player.party} hall`}
            art={assetPath(player.party === "Dynatoi" ? "assets/DYNATOI READY.png" : "assets/PALAIOI READY.png")}
            className={player.party === "Dynatoi" ? "banner-reform" : "banner-cons"}
          />
          {player.censured ? (
            <div className="censure-banner" role="alert">
              <span className="censure-ic" aria-hidden="true">⚠️</span>
              <div>
                <strong>Under censure</strong>
                <p>
                  Your ideology has drifted from the {player.party}. Return to at least 10% {player.party === "Dynatoi" ? "Reformist" : "Traditionalist"} within{" "}
                  <b>{formatDuration(censureSeconds)}</b> or you will be expelled (and branded a turncoat).
                </p>
              </div>
            </div>
          ) : null}
          <PartyGovernmentSection party={player.party.toLowerCase() === "dynatoi" ? "dynatoi" : "palaioi"} onRefresh={onRefresh} />
          <div className="court-grid">
            <div>
              <div className="panel-label">Party news</div>
              <DigestList items={partyNews} />
              <div className="panel-label">Membership</div>
              <div className="pol-aside">
                <div className="mini-office">
                  <div>
                    <div className="mo-t">Your standing</div>
                    <div className="mo-s">Member of the {player.party}</div>
                  </div>
                  <span className="pr-lvl">—</span>
                </div>
                <div className="mini-office">
                  <div>
                    <div className="mo-t">Leave the {player.party}</div>
                    <div className="mo-s">{player.censured ? "Blocked while under censure" : "Defecting brands you a turncoat"}</div>
                  </div>
                  <button type="button" className="panel-btn ghost" onClick={leave} disabled={player.censured}>Leave</button>
                </div>
              </div>
            </div>
          </div>
          <p className="dashboard-todo">TODO: party matters and news are placeholder; joining and leaving are real (players.party).</p>
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      ) : (
        <div className="pol-page">
          <div className="panel-label">Choose your side</div>
          <p className="pol-intro">
            Your ideology is <b>{ideologyReadout(player.ideology)}</b>. Joining a party requires at least 10% ideology toward its side — and drifting 10% toward the other side will see you expelled.
          </p>
          <div className="panel-grid2">
            {partyOptions.map((option) => {
              const qualifies = option.slug === "dynatoi" ? player.ideology >= 10 : player.ideology <= -10;
              const canJoin = qualifies && !player.censured;
              const pct = option.slug === "dynatoi" ? Math.max(0, player.ideology) : Math.max(0, -player.ideology);
              return (
                <div className={`party-pick${option.consClass ? " cons" : ""}`} key={option.slug}>
                  <div
                    className="party-banner"
                    style={{
                      backgroundImage: `url("${assetPath(option.consClass ? "assets/PALAIOI READY.png" : "assets/DYNATOI READY.png")}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <div className="party-body">
                    <div className="party-greek">{option.greek}</div>
                    <div className="party-name">{option.name}</div>
                    <p className="party-pitch">{option.pitch}</p>
                    <button
                      type="button"
                      className={`panel-btn${canJoin ? "" : " ghost"}`}
                      disabled={!canJoin}
                      onClick={() => join(option.slug)}
                    >
                      Join the {option.name}
                    </button>
                    <div className="party-req">
                      {qualifies
                        ? `You qualify — ${pct}% ${option.side} (needs 10%)`
                        : `Requires 10% ${option.side} — you are ${ideologyReadout(player.ideology)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="dashboard-todo">
            Join eligibility uses your real ideology. Drift out of range while a member and you are censured for 3 days, then expelled if you do not return.
          </p>
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      )}
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

// ---------------------------------------------------------------------------
// Top-bar + slide-up sheets (Inventory / Character) ported from the v8 mockup.
// ---------------------------------------------------------------------------

// Placeholder per-day production rates shown on the gold pill and store rows.
// TODO: real rates land with the Phase 2 production tick; flagged until then.
const PLACEHOLDER_GOLD_RATE = "+30 / day";
const PLACEHOLDER_CLASS_RATE = "+10 / day";
const PLACEHOLDER_RATE_TITLE = "Placeholder rate — real production lands in Phase 2.";
// TODO: real "new items" badge once the items system exists. 0 = nothing to show.
const PLACEHOLDER_NEW_ITEM_COUNT = 0;
// Everyone starts at Tier 1; real tier tracking lands with profession progression.
const BASE_TIER_LABEL = "Tier 1";

// Emoji per resource type, used for the class store row and goods. The wallet
// (drachmae) is not a resources-table type — its coin row uses 🪙 directly.
const resourceIcons: Record<string, string> = {
  wine: "🍷",
  wheat: "🌾",
  herbal: "🌿",
  prestige: "🏛️",
  intelligence: "🧠",
  militia: "⚔️",
  freedom: "⛓️",
  favor: "🤝",
};

// Goods catalog for the inventory Resources tab. Amounts come from the real
// /me/state balances map; goods absent from it render as 0 (dimmed, not hidden).
const goodsCatalog: { type: string; label: string; icon: string }[] = [
  { type: "wheat", label: "Wheat", icon: "🌾" },
  { type: "tin", label: "Tin", icon: "🪨" },
  { type: "iron", label: "Iron", icon: "⚙️" },
  { type: "salt", label: "Salt", icon: "🧂" },
  { type: "marble", label: "Marble", icon: "🏛️" },
  { type: "lead", label: "Lead", icon: "🔩" },
  { type: "stone", label: "Stone", icon: "🧱" },
  { type: "wood", label: "Wood", icon: "🪵" },
  { type: "leather", label: "Leather", icon: "🥾" },
  { type: "wool", label: "Wool", icon: "🧶" },
  { type: "horse", label: "Horse", icon: "🐎" },
];

const statDefs: { key: keyof FourStats; label: string }[] = [
  { key: "prestige", label: "Prestige" },
  { key: "devotion", label: "Devotion" },
  { key: "militia", label: "Militia" },
  { key: "intelligence", label: "Intelligence" },
];

// Each profession's primary (highlighted) stat. Paths whose income grants no
// stat fall back to Prestige (general standing).
const primaryStatByProfession: Record<string, keyof FourStats> = {
  philosopher: "prestige",
  priest: "devotion",
  hetaira: "intelligence",
  hoplite: "militia",
};

function primaryStatFor(slug: string): keyof FourStats {
  return primaryStatByProfession[slug] ?? "prestige";
}

// TODO: placeholder items until the items system exists.
const placeholderItems = [
  { id: "tin-shipment", icon: "📦", name: "Recovered Tin Shipment", origin: 'Event reward · "The Missing Shipment" · sell or hold', action: "Sell" },
  { id: "letter-credit", icon: "📜", name: "Letter of Credit", origin: "Redeem at any Agora for 100 dr.", action: "Redeem" },
];

// TODO: placeholder units until the units system exists.
const placeholderUnits = [
  { id: "caravan", icon: "🛡️", name: "Caravan Guards × 2", line: "Protect your trade routes · upkeep −1g/day each", tag: "hired", dim: false },
  { id: "militia", icon: "⚔️", name: "Militia × 0", line: "Trained and led by Military Leaders", tag: "—", dim: true },
];

// TODO: placeholder achievements until the achievement system exists.
const earnedAchievements = [
  { id: "first-coin", icon: "🪙", name: "First Coin", detail: "Earn your first drachmae from your trade.", when: "Season I · Day 1" },
  { id: "name-at-court", icon: "⚖️", name: "A Name at Court", detail: "Resolve your first decision.", when: "Season I · Day 2" },
];
const lockedAchievements = [
  { id: "archon", icon: "🏛️", name: "Archon", detail: "Be elected Archon of the League." },
  { id: "oikos", icon: "💍", name: "Oikos", detail: "Bind two Houses by marriage." },
  { id: "manumitted", icon: "⛓️", name: "Manumitted", detail: "Earn freedom as a Doulos." },
  { id: "season-survivor", icon: "🏆", name: "Season Survivor", detail: "Complete a full season." },
];

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const tld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  return `${local[0]}•••@•••${tld}`;
}

// Prefers the age portrait (which ages young -> prime at 30 -> old at 50); falls
// back through the class portrait and profession art when art is missing (the
// age portraits ship as placeholders until real PNGs land).
function AvatarImage({ player }: { player: PlayerDashboardView }) {
  const candidates = [player.portrait, player.faceImage, player.profession.image].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [player.portrait, player.faceImage, player.profession.image]);
  const src = candidates[idx];
  if (!src) return <span>{player.name[0]}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setIdx((current) => current + 1)} />;
}

function SheetLabel({ children }: { children: ReactNode }) {
  return <div className="sheet-label">{children}</div>;
}

function SheetTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="cs-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`cs-tab${active === tab.id ? " on" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.badge ? <span className="cs-tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

function DetailRow({
  icon,
  name,
  sub,
  tag,
  tone = "neutral",
  action,
  dim = false,
}: {
  icon: string;
  name: ReactNode;
  sub?: ReactNode;
  tag?: string;
  tone?: "asset" | "neutral" | "flaw";
  action?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className={`sheet-row${dim ? " dim" : ""}`}>
      <span className="sheet-row-ic" aria-hidden="true">{icon}</span>
      <div className="sheet-row-body">
        <strong>{name}</strong>
        {sub ? <span>{sub}</span> : null}
      </div>
      {action ? (
        <div className="sheet-row-action">{action}</div>
      ) : tag ? (
        <span className={`sheet-row-tag tone-${tone}`}>{tag}</span>
      ) : null}
    </div>
  );
}

function ResRow({
  icon,
  name,
  sub,
  amount,
  rate,
  rateTone = "zero",
  rateTitle,
  dim = false,
}: {
  icon: string;
  name: string;
  sub?: string;
  amount: string;
  rate: string;
  rateTone?: "up" | "zero";
  rateTitle?: string;
  dim?: boolean;
}) {
  return (
    <div className={`res-row${dim ? " dim" : ""}`}>
      <span className="res-ic" aria-hidden="true">{icon}</span>
      <div className="res-n">
        {name}
        {sub ? <span className="res-sub"> · {sub}</span> : null}
      </div>
      <span className="res-amt">{amount}</span>
      <span className={`res-rate ${rateTone}${rateTitle ? " placeholder" : ""}`} title={rateTitle}>
        {rate}
      </span>
    </div>
  );
}

function AlignmentBar({ ideology }: { ideology: number }) {
  const clamped = Math.max(-100, Math.min(100, ideology));
  const markerPct = 50 + clamped / 2; // -100 (Traditionalist) -> 0%, +100 (Reformist) -> 100%
  const readout = ideologyReadout(clamped);
  const eligibility =
    clamped >= 10
      ? "eligible for the Dynatoi"
      : clamped <= -10
        ? "eligible for the Palaioi"
        : "centrist — not yet eligible for a party";
  // Left = Traditionalist (bronze), right = Reformist (blue).
  const readoutColor = clamped < 0 ? "#c08a5e" : clamped > 0 ? "var(--dash-ref)" : "var(--dash-parchment)";
  return (
    <div className="cs-align">
      <div className="align-ends">
        <span style={{ color: "#c08a5e" }}>◀ Traditionalist</span>
        <span style={{ color: "var(--dash-ref)" }}>Reformist ▶</span>
      </div>
      <div className="align-bar" role="img" aria-label={`Ideology: ${readout}`}>
        <span className="align-tick" style={{ left: "45%" }} />
        <span className="align-center" />
        <span className="align-tick" style={{ left: "55%" }} />
        <span className="align-marker" style={{ left: `${markerPct}%` }} />
      </div>
      <p className="align-read">
        <b style={{ color: readoutColor }}>{readout}</b> · {eligibility} · your decisions move this
      </p>
    </div>
  );
}

function BottomSheet({
  open,
  onClose,
  labelledBy,
  title,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  title?: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={sheetRef}>
        <span className="sheet-handle" aria-hidden="true" />
        <button className="sheet-close" type="button" ref={closeRef} onClick={onClose}>
          Close
        </button>
        <div className="sheet-body">
          {title ? (
            <h2 className="sheet-title" id={labelledBy}>
              {title}
            </h2>
          ) : null}
          {header}
          {children}
        </div>
      </div>
    </div>
  );
}

function InventoryResources({ player }: { player: PlayerDashboardView }) {
  const classType = player.classResource?.type ?? null;
  return (
    <div role="tabpanel">
      <div className="cap-banner">
        <div>
          <div className="cap-t">Warehouse</div>
          <div className="cap-s">Storage capacity arrives with the warehouse system</div>
        </div>
        <div className="cap-right">
          <div className="cap-s">— / — used</div>
          <div className="capbar" aria-hidden="true">
            <i style={{ width: "0%" }} />
          </div>
        </div>
      </div>
      <p className="sheet-todo">TODO: warehouse capacity is a placeholder until storage limits exist.</p>

      <SheetLabel>Coin &amp; class stores</SheetLabel>
      <ResRow
        icon="🪙"
        name="Drachmae"
        amount={player.drachmae.toLocaleString()}
        rate={PLACEHOLDER_GOLD_RATE}
        rateTone="up"
        rateTitle={PLACEHOLDER_RATE_TITLE}
      />
      {/* Some paths (e.g. Shipbuilder) earn drachmae directly and have no separate
          class resource — render the class store row only when one exists. */}
      {player.classResource ? (
        <ResRow
          icon={resourceIcons[player.classResource.type] ?? "🏺"}
          name={player.classResource.label}
          sub="your trade"
          amount={player.classResource.amount.toLocaleString()}
          rate={PLACEHOLDER_CLASS_RATE}
          rateTone="up"
          rateTitle={PLACEHOLDER_RATE_TITLE}
        />
      ) : null}
      <p className="sheet-todo">TODO: per-day production rates are placeholders until the Phase 2 tick lands.</p>

      <SheetLabel>Goods</SheetLabel>
      {goodsCatalog
        .filter((good) => good.type !== classType)
        .map((good) => {
          const amount = player.balances[good.type] ?? 0;
          return (
            <ResRow
              key={good.type}
              icon={good.icon}
              name={good.label}
              amount={amount.toLocaleString()}
              rate="—"
              rateTone="zero"
              dim={amount === 0}
            />
          );
        })}
    </div>
  );
}

function InventoryItems() {
  return (
    <div role="tabpanel">
      <SheetLabel>Items · {placeholderItems.length}</SheetLabel>
      {placeholderItems.map((item) => (
        <DetailRow
          key={item.id}
          icon={item.icon}
          name={item.name}
          sub={item.origin}
          action={
            <button className="sheet-btn" type="button" disabled title="TODO: items system not wired yet">
              {item.action}
            </button>
          }
        />
      ))}
      <div className="slot-empty">Items come from events, trade, and rewards — they are kept here.</div>
      <p className="sheet-todo">TODO: items are placeholder rows until the items system exists.</p>
    </div>
  );
}

function InventoryUnits() {
  return (
    <div role="tabpanel">
      <SheetLabel>Your units</SheetLabel>
      {placeholderUnits.map((unit) => (
        <DetailRow key={unit.id} icon={unit.icon} name={unit.name} sub={unit.line} tag={unit.tag} dim={unit.dim} />
      ))}
      <div className="slot-empty">
        Hire guards for protection — or befriend a Dekarchos. Armies are a Military Leader&apos;s trade.
      </div>
      <p className="sheet-todo">TODO: units are placeholder rows until the units system exists.</p>
    </div>
  );
}

type InventoryTab = "resources" | "items" | "units";

function InventorySheet({
  open,
  onClose,
  player,
}: {
  open: boolean;
  onClose: () => void;
  player: PlayerDashboardView;
}) {
  const [tab, setTab] = useState<InventoryTab>("resources");
  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="inventory-sheet-title" title="Inventory">
      <SheetTabs<InventoryTab>
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: "resources", label: "Resources" },
          { id: "items", label: "Items", badge: placeholderItems.length },
          { id: "units", label: "Units" },
        ]}
      />
      {tab === "resources" ? <InventoryResources player={player} /> : null}
      {tab === "items" ? <InventoryItems /> : null}
      {tab === "units" ? <InventoryUnits /> : null}
    </BottomSheet>
  );
}

// Icon + asset/neutral/flaw tag for a trait row (old Fatty-style display).
const traitCategoryIcons: Record<string, string> = {
  personality: "🧠",
  upbringing: "⚓",
  class: "⚔️",
  coping: "🌿",
  reputation: "🏛️",
};

function traitTone(trait: CharacterSheetData["traits"][number]): "asset" | "neutral" | "flaw" {
  const mod = trait.statMod;
  const net = mod ? (mod.prestige ?? 0) + (mod.devotion ?? 0) + (mod.militia ?? 0) + (mod.intelligence ?? 0) : 0;
  return net > 0 ? "asset" : net < 0 ? "flaw" : "neutral";
}

function TraitRows({ traits }: { traits: CharacterSheetData["traits"] }) {
  if (!traits.length) {
    return (
      <div className="slot-empty">Traits are earned through decisions, quests, and the life you lead — some help, some haunt.</div>
    );
  }
  return (
    <>
      {traits.map((trait) => {
        const tone = traitTone(trait);
        return (
          <DetailRow
            key={trait.id}
            icon={traitCategoryIcons[trait.category] ?? "•"}
            name={trait.name}
            sub={trait.description}
            tag={tone === "flaw" ? "flaw" : tone}
            tone={tone}
          />
        );
      })}
    </>
  );
}

function ComposureBar({ composure, withdrawn }: { composure: number; withdrawn: boolean }) {
  const pct = Math.max(0, Math.min(100, composure));
  const tone = pct <= 20 ? "low" : pct <= 50 ? "mid" : "high";
  return (
    <div className="composure">
      <div className="composure-track">
        <span className={`composure-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="composure-read">
        <span>{pct} / 100</span>
        {withdrawn ? <span className="composure-withdrawn">⚠️ Withdrawn from public life</span> : null}
      </div>
    </div>
  );
}

function CharacterTab({ player, sheet }: { player: PlayerDashboardView; sheet: CharacterSheetData | null }) {
  const primary = primaryStatFor(player.professionSlug);
  // Effective stats (base + trait mods) from the canonical sheet; base from the
  // sheet too, falling back to /me/state base while the sheet loads.
  const effective = sheet?.effective ?? player.stats;
  const base = sheet?.base ?? player.stats;
  // Prestige NEVER decays (reputation outlives the man) — never mark it declining.
  const declining = (key: keyof FourStats) => key !== "prestige" && player.decaying.includes(key);
  const anyDeclining = statDefs.some((stat) => declining(stat.key));
  return (
    <div role="tabpanel">
      <SheetLabel>Stats · capped at 100</SheetLabel>
      <div className="cs-stats">
        {statDefs.map((stat) => {
          const value = effective[stat.key];
          const delta = value - base[stat.key];
          const isDeclining = declining(stat.key);
          return (
            <div
              key={stat.key}
              className={`cs-stat${stat.key === primary ? " primary" : ""}${isDeclining ? " declining" : ""}`}
              title={isDeclining ? "Age is taking its toll on this stat." : delta ? `base ${base[stat.key]} · ${delta > 0 ? "+" : ""}${delta} from traits` : undefined}
            >
              <div className="cs-stat-v">
                {value}<span className="cs-stat-cap">/100</span>
                {delta ? <span className="cs-stat-delta">{delta > 0 ? `+${delta}` : delta}</span> : null}
                {isDeclining ? <span className="cs-stat-decay" aria-label="declining with age">▼</span> : null}
              </div>
              <div className="cs-stat-k">{stat.label}</div>
            </div>
          );
        })}
      </div>
      {anyDeclining ? (
        <p className="sheet-todo">Age is taking its toll — body and mind soften with the years. Prestige endures.</p>
      ) : (
        <p className="sheet-todo">Effective stats = base + trait bonuses, capped at 100.</p>
      )}

      <SheetLabel>Composure</SheetLabel>
      <ComposureBar composure={sheet?.composure ?? player.composure} withdrawn={sheet?.withdrawn ?? player.withdrawn} />

      <SheetLabel>Alignment</SheetLabel>
      <AlignmentBar ideology={player.ideology} />

      <SheetLabel>Traits · {sheet ? sheet.traits.length : "…"}</SheetLabel>
      {sheet ? <TraitRows traits={sheet.traits} /> : <div className="slot-empty">Loading traits…</div>}
    </div>
  );
}

function AchievementsTab() {
  return (
    <div role="tabpanel">
      <SheetLabel>Earned · {earnedAchievements.length}</SheetLabel>
      <div className="ach-grid">
        {earnedAchievements.map((ach) => (
          <div className="ach" key={ach.id}>
            <span className="ach-ic" aria-hidden="true">{ach.icon}</span>
            <div>
              <div className="ach-t">{ach.name}</div>
              <div className="ach-d">{ach.detail}</div>
              <div className="ach-when">{ach.when}</div>
            </div>
          </div>
        ))}
      </div>
      <SheetLabel>Locked</SheetLabel>
      <div className="ach-grid">
        {lockedAchievements.map((ach) => (
          <div className="ach locked" key={ach.id}>
            <span className="ach-ic" aria-hidden="true">{ach.icon}</span>
            <div>
              <div className="ach-t">{ach.name}</div>
              <div className="ach-d">{ach.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="sheet-todo">TODO: achievements are placeholder until the achievement system exists.</p>
    </div>
  );
}

function SettingsTab({ player, onLogout }: { player: PlayerDashboardView; onLogout: () => void }) {
  const [newsletter, setNewsletter] = useState(player.newsletterOptIn);
  const [savingNewsletter, setSavingNewsletter] = useState(false);
  const [note, setNote] = useState("");

  const toggleNewsletter = async () => {
    const next = !newsletter;
    setNewsletter(next);
    setSavingNewsletter(true);
    setNote("");
    try {
      await api.setNewsletter(next);
    } catch {
      setNewsletter(!next);
      setNote("Could not save your newsletter preference. Try again.");
    } finally {
      setSavingNewsletter(false);
    }
  };

  const stub = (label: string) => () => setNote(`TODO: ${label} is not wired yet.`);

  return (
    <div role="tabpanel">
      <SheetLabel>Account</SheetLabel>
      <div className="settings-row">
        <span className="set-l">Email</span>
        <span className="set-r">
          <span className="set-v">{maskEmail(player.email)}</span>
          <button className="set-act" type="button" onClick={stub("changing your email")}>Change</button>
        </span>
      </div>
      <div className="settings-row">
        <span className="set-l">Password</span>
        <button className="set-act" type="button" onClick={stub("changing your password")}>Change password</button>
      </div>
      <div className="settings-row">
        <span className="set-l">Discord</span>
        <button className="set-act" type="button" onClick={stub("Discord linking")}>Link account</button>
      </div>

      <SheetLabel>Preferences</SheetLabel>
      <div className="settings-row">
        <span className="set-l">Season updates newsletter</span>
        <button
          type="button"
          role="switch"
          aria-checked={newsletter}
          aria-label="Season updates newsletter"
          className={`toggle${newsletter ? " on" : ""}`}
          onClick={toggleNewsletter}
          disabled={savingNewsletter}
        >
          <span className="toggle-knob" aria-hidden="true" />
        </button>
      </div>
      <div className="settings-row">
        <span className="set-l">Event notifications via Discord</span>
        <span className="set-v">requires linked account</span>
      </div>

      {note ? <p className="sheet-todo" role="status">{note}</p> : null}

      <SheetLabel>Session</SheetLabel>
      <div className="settings-row">
        <span className="set-l">Signed in as {player.name}</span>
        <button className="set-act danger" type="button" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}

type CharacterSheetTab = "character" | "achievements" | "settings";

function CharacterSheet({
  open,
  onClose,
  player,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  player: PlayerDashboardView;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<CharacterSheetTab>("character");
  const [sheet, setSheet] = useState<CharacterSheetData | null>(null);
  const partyChip = player.party === "Unaligned" ? "Party — chosen in-game" : player.party;

  // Pull the canonical sheet (traits + base/effective stats) each time it opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSheet(null);
    api
      .character()
      .then((result) => {
        if (!cancelled) setSheet(result.character);
      })
      .catch(() => {
        /* sheet stays null -> tab shows base stats + loading state */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      labelledBy="character-sheet-title"
      header={
        <div className="cs-head">
          <span className="cs-av"><AvatarImage player={player} /></span>
          <div className="cs-id">
            <div className="cs-nm" id="character-sheet-title">
              {player.name} <span className="cs-ep">· epithet earned later</span>
            </div>
            <div className="cs-rk">
              {player.profession.rank} · {player.profession.name} · {BASE_TIER_LABEL}
            </div>
            <div className="cs-rk">
              Age {player.currentAge} · {player.lifeStage}
              {player.deceased ? <span className="cs-deceased"> · final years</span> : null}
            </div>
            <div className="cs-chips">
              <span className="chip house">⬤ House {player.house.name} · {player.house.stance}</span>
              <span className="chip">{partyChip}</span>
            </div>
          </div>
        </div>
      }
    >
      <SheetTabs<CharacterSheetTab>
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: "character", label: "Character" },
          { id: "achievements", label: "Achievements" },
          { id: "settings", label: "Settings" },
        ]}
      />
      {tab === "character" ? <CharacterTab player={player} sheet={sheet} /> : null}
      {tab === "achievements" ? <AchievementsTab /> : null}
      {tab === "settings" ? <SettingsTab player={player} onLogout={onLogout} /> : null}
    </BottomSheet>
  );
}

// The blocking Succession screen: death notice -> heir reveal -> confirm, so the
// player always continues controlling a living character.
function SuccessionScreen({ succession, onResolved }: { succession: SuccessionState; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const { epitaph, plan, heir, candidates } = succession;

  const succeed = async (candidateId?: string) => {
    setBusy(true);
    setError("");
    try {
      await api.succeed(candidateId);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The succession could not be settled.");
      setBusy(false);
    }
  };

  return (
    <main className="succession-shell">
      <section className="succession-card">
        <p className="section-eyebrow">Succession</p>
        <h1 className="succession-title">
          {epitaph.name}{epitaph.ladderTrait ? `, ${epitaph.ladderTrait}` : ""}, dies in the {epitaph.age}th year.
        </h1>
        <p className="succession-epitaph">{epitaph.lifeStage} · age {epitaph.age}. The house must pass to another.</p>

        {plan.kind === "forced_adoption" ? (
          <>
            <p>No blood remains to inherit. Choose a ward to adopt — they become the next head of your house.</p>
            <div className="succession-candidates">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`succession-candidate${picked === c.id ? " selected" : ""}`}
                  onClick={() => setPicked(c.id)}
                  aria-pressed={picked === c.id}
                >
                  <strong>{c.name}</strong>
                  <span>{c.sex === "male" ? "man" : "woman"} · age {c.age}</span>
                </button>
              ))}
            </div>
            <button className="primary-cta" type="button" disabled={busy || !picked} onClick={() => succeed(picked!)}>
              {busy ? "Settling…" : "Adopt and continue"}
            </button>
          </>
        ) : plan.kind === "regency" ? (
          <>
            <p>{heir ? `${heir.name} — ${heir.relation}.` : "Your heir is too young to rule."} A regent will govern in trust until the heir comes of age.</p>
            <button className="primary-cta" type="button" disabled={busy} onClick={() => succeed()}>
              {busy ? "Settling…" : "Appoint a regent and continue"}
            </button>
          </>
        ) : plan.kind === "fresh" ? (
          <>
            <p>The unfree leave nothing behind. Begin again, a new life in the city.</p>
            <button className="primary-cta" type="button" disabled={busy} onClick={() => succeed()}>
              {busy ? "Settling…" : "Begin anew"}
            </button>
          </>
        ) : (
          <>
            <p>{heir ? `Your heir: ${heir.name} — ${heir.relation}.` : "Your adopted heir takes the house."} Continue the line as the next head.</p>
            <button className="primary-cta" type="button" disabled={busy} onClick={() => succeed()}>
              {busy ? "Settling…" : heir ? `Continue as ${heir.name}` : "Continue the line"}
            </button>
          </>
        )}
        {error ? <p className="auth-message" role="status">{error}</p> : null}
      </section>
    </main>
  );
}

const panelComponents: Record<DashboardSection, (props: PanelProps) => ReactNode> = {
  court: CourtPanel,
  ledger: LedgerPanel,
  market: MarketPanel,
  family: FamilyPanel,
  politics: PoliticsPanel,
  atlas: AtlasPanel,
};

export function Dashboard({ onExit, onRequireLogin, onRequireCharacter }: { onExit: () => void; onRequireLogin: () => void; onRequireCharacter: () => void }) {
  const [activeSection, setActiveSection] = useState<DashboardSection>("court");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState<"inventory" | "character" | null>(null);
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
            onClick={() => setActiveSheet("inventory")}
            title="Open your inventory"
          >
            <span className="vital-ic" aria-hidden="true">🪙</span>
            <span className="vital-v">{player.drachmae.toLocaleString()}</span>
            <span className="vital-meta">
              <span className="vital-k">Drachmae</span>
              <span className="vital-d placeholder" title={PLACEHOLDER_RATE_TITLE}>{PLACEHOLDER_GOLD_RATE}</span>
            </span>
          </button>
          <button
            className="topbar-vital inventory-vital"
            type="button"
            onClick={() => setActiveSheet("inventory")}
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
            <button className="dashboard-ghost-button" type="button" onClick={onExit}>Campaigns</button>
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

      <InventorySheet open={activeSheet === "inventory"} onClose={closeSheet} player={player} />
      <CharacterSheet open={activeSheet === "character"} onClose={closeSheet} player={player} onLogout={handleLogout} />
    </main>
  );
}
