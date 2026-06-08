import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type PlayerState, type CharacterSheet as CharacterSheetData } from "../api.js";
import { assetPath, buildableBuildings, nobleHouses, professions, type House, type Profession } from "../data/league.js";
import { portraitPools, type PortraitClassSlug } from "../data/portraits.js";
import { MapCanvas } from "../map/MapCanvas.js";
import "./dashboard.css";

type DashboardSection = "court" | "holdings" | "market" | "family" | "politics" | "atlas";

type IconName = "court" | "holdings" | "market" | "family" | "politics" | "atlas";

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
  seasonDay: number;
  seasonEndsIn: number;
  gold: number;
  prestige: number;
  influence: number;
  professionSlug: string;
  houseSlug: string;
  classResource: {
    type: string;
    label: string;
    amount: number;
  };
  party: "Palaioi" | "Dynatoi" | "Unaligned";
  // -100 Traditionalist .. +100 Reformist, 0 = centre.
  ideology: number;
  // Active party censure (ideology drift): flag + ISO expiry for the countdown.
  censured: boolean;
  censureExpiresAt: string | null;
  stats: FourStats;
  balances: Record<string, number>;
  faceImage?: string;
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

type CourtChoice = {
  id: string;
  label: string;
  hint: string;
  outcome: string;
};

type CourtEvent = {
  id: string;
  title: string;
  kicker: string;
  sceneLabel: string;
  body: string;
  urgency: "low" | "medium" | "high";
  kind?: "court" | "family" | "market";
  choices: CourtChoice[];
};

// Props shared by every panel. `onRefresh` re-pulls /me/state after a real
// mutation (e.g. joining/leaving a party).
type PanelProps = { player: PlayerDashboardView; onRefresh: () => void };

const placeholderFamilyEventCount = 1;

const dashboardNav: DashboardNavItem[] = [
  { id: "court", label: "Court", icon: "court" },
  { id: "holdings", label: "Holdings", icon: "holdings" },
  { id: "market", label: "Market", icon: "market" },
  { id: "family", label: "Family", icon: "family", badge: placeholderFamilyEventCount },
  { id: "politics", label: "Politics", icon: "politics" },
  { id: "atlas", label: "Atlas", icon: "atlas" },
];

const mobilePrimaryNav: DashboardNavItem[] = dashboardNav.filter((item) =>
  ["court", "holdings", "market", "family"].includes(item.id),
);

const mobileMoreNav: DashboardNavItem[] = dashboardNav.filter((item) =>
  ["politics", "atlas"].includes(item.id),
);

// TODO: Replace with authenticated player profile/session state once auth is connected.
const placeholderPlayerState: PlayerDashboardState = {
  name: "Pytheas",
  email: "pytheas@example.com",
  newsletterOptIn: false,
  seasonDay: 18,
  seasonEndsIn: 11,
  gold: 420,
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
  stats: { prestige: 12, devotion: 0, militia: 0, intelligence: 0 },
  balances: { wine: 36, wheat: 130, tin: 60, iron: 40 },
};

// TODO: Replace with real away-summary records.
const placeholderDigest: DigestItem[] = [
  { id: "trade", title: "Harbor trade", text: "Two wine offers expired while you were away." },
  { id: "house", title: "House Leonidas", text: "Your House gained standing among conservative citizens." },
  { id: "season", title: "Season clock", text: "Season I advanced by one day. The assembly meets soon." },
];

// TODO: Replace with real Court decision/event queue from the server event system.
const placeholderCourtEvents: CourtEvent[] = [
  {
    id: "harbor-dispute",
    title: "Harbor Dispute",
    kicker: "Decision",
    sceneLabel: "Quayside petition",
    body: "Merchants crowd the quay after a rival house blocks three wine carts at the customs shed. They want your name on a petition before the council clerk closes the ledger.",
    urgency: "medium",
    kind: "market",
    choices: [
      { id: "sponsor", label: "Sponsor the petition", hint: "+Influence, costs gold", outcome: "Your clerk files the petition. Traders remember the favor, but the customs faction marks your name." },
      { id: "mediate", label: "Mediate quietly", hint: "Safer standing", outcome: "You send a quiet message through the harbor scribes. No one cheers, but fewer doors close." },
      { id: "ignore", label: "Let it pass", hint: "No cost", outcome: "The ledger shuts without your seal. The harbor solves the quarrel without you." },
    ],
  },
  {
    id: "house-summons",
    title: "House Summons",
    kicker: "House",
    sceneLabel: "Private atrium",
    body: "A senior kinsman asks you to appear at sunset. The matter is small enough to hide and large enough to become a grievance if ignored.",
    urgency: "low",
    kind: "court",
    choices: [
      { id: "attend", label: "Attend in person", hint: "+House standing", outcome: "You arrive before sunset. The family ledger records a modest favor in your name." },
      { id: "send-gift", label: "Send wine", hint: "Costs class resource", outcome: "The amphorae arrive before you do. It is not presence, but it is noticed." },
    ],
  },
  {
    id: "suitor-calls",
    title: "A Suitor Calls",
    kicker: "Family",
    sceneLabel: "Marriage inquiry",
    body: "A cousin from House Timon asks whether your household would hear an introduction. No pledge is made, but refusal also speaks.",
    urgency: "high",
    kind: "family",
    choices: [
      { id: "receive", label: "Receive the envoy", hint: "Opens match talks", outcome: "The envoy is seated and served. The household begins weighing names and dowries." },
      { id: "delay", label: "Delay politely", hint: "Keeps options open", outcome: "Your reply is gracious and slow. The offer remains warm for now." },
      { id: "decline", label: "Decline", hint: "Ends this thread", outcome: "The message returns unopened by any promise. House Timon will remember the courtesy, if not the answer." },
    ],
  },
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
    seasonDay: state.world.seasonDay,
    seasonEndsIn: state.world.seasonEndsIn,
    gold: state.resources.gold,
    prestige: state.resources.prestige,
    influence: state.resources.influence,
    professionSlug: profession.slug,
    houseSlug: house.slug,
    classResource: {
      type: state.resources.classResource.type,
      label: state.resources.classResource.label,
      amount: state.resources.classResource.amount,
    },
    party: normalizeParty(state.character.party),
    // Guard against a missing value (e.g. a frontend/backend deploy-window skew)
    // so the bar degrades to "Centrist (0%)" instead of rendering "NaN%".
    ideology: state.character.ideology ?? 0,
    censured: state.character.censured,
    censureExpiresAt: state.character.censureExpiresAt,
    stats: state.stats,
    balances: state.resources.balances,
    faceImage: getFaceImage(profession.slug, state.character.faceId),
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
    case "holdings":
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

function getChoiceHintTone(hint: string) {
  if (hint.trim().startsWith("+")) {
    return "positive";
  }
  if (hint.trim().startsWith("-")) {
    return "negative";
  }
  return "neutral";
}

function EventCard({ event }: { event: CourtEvent }) {
  const [resolvedChoice, setResolvedChoice] = useState<CourtChoice | null>(null);

  return (
    <DashboardCard className={`event-card urgency-${event.urgency}`}>
      <div className="event-banner" aria-hidden="true">
        <span className="scene-art-tag">Scene art</span>
        <span className="scene-label">{event.sceneLabel}</span>
      </div>
      <div className="event-body">
        <span className="dashboard-label event-kicker">{event.kicker}</span>
        <h3>{event.title}</h3>
        <p>{event.body}</p>
        {resolvedChoice ? (
          <div className="event-outcome" role="status">
            <strong>{resolvedChoice.label}</strong>
            <p>{resolvedChoice.outcome}</p>
          </div>
        ) : (
          <div className="event-choice-stack">
            {event.choices.map((choice) => (
              <button className="event-choice-button" type="button" key={choice.id} onClick={() => setResolvedChoice(choice)}>
                <strong>{choice.label}</strong>
                <span className={`choice-hint hint-${getChoiceHintTone(choice.hint)}`}>{choice.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </DashboardCard>
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
      style={art ? { backgroundImage: `url(${art})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
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

// TODO: council content is placeholder until political state exists.
const councilIssues = [
  { id: "tariff", icon: "⚖️", title: "Tin tariff at the harbor", sub: "Proposed by House Leonidas · voting closes Day 6" },
  { id: "fleet", icon: "🚢", title: "Fund a patrol fleet", sub: "Against Tyrrhenian piracy · costs the treasury 2,000g" },
  { id: "dole", icon: "🏛️", title: "Temple grain dole", sub: "Expand the dole to non-citizens · contested" },
];
const councilElections = [
  { id: "archon", icon: "🏺", title: "Archon seats · 2 contested", sub: "Voting open · 3 days remain", votable: true },
  { id: "assembly", icon: "📜", title: "Next assembly", sub: "Day 21 · petitions close Day 19", votable: false },
];
const councilNews = [
  { id: "seats", icon: "📯", text: <><b>Two Archon seats</b> open this season.</> },
  { id: "tariff", icon: "⚔️", text: <><b>House Leonidas</b> pushed the tin tariff to a vote.</> },
  { id: "pirates", icon: "🚢", text: <>Pirate raids near <b>Antipolis</b> — a patrol fleet is proposed.</> },
];
const partyMatters = [
  { id: "champion", icon: "🗳️", title: "Back a champion for Archon", sub: "Internal vote · the party picks its candidate", votable: true },
  { id: "whip", icon: "🤝", title: "Whip count: tin tariff", sub: "The party asks you to vote AGAINST · loyalty noted", votable: false },
  { id: "recruit", icon: "🪶", title: "Recruit a fence-sitter", sub: "Bring an unaligned player to the cause · +party standing", votable: false },
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

function CourtPanel() {
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
          <div className="panel-subhead decision-subhead">
            <span className="dashboard-label">Decisions awaiting you</span>
            <strong>{placeholderCourtEvents.length} waiting</strong>
          </div>
          <div className="dashboard-event-stack">
            {placeholderCourtEvents.map((event) => <EventCard event={event} key={event.id} />)}
          </div>
          <p className="dashboard-todo">TODO: Court events are placeholder cards until server event queue integration is connected.</p>
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
          <DashboardCard className="offices-card">
            <h2>Offices in play</h2>
            <div className="office-stack">
              <span>Archon seats - 2 contested</span>
              <span>Council petitions - 3 awaiting support</span>
              <span>Next assembly - Day 21</span>
            </div>
            <p className="dashboard-todo">TODO: offices mirror placeholder political state.</p>
          </DashboardCard>
        </aside>
      </div>
    </section>
  );
}

function HoldingsPanel({ player }: PanelProps) {
  const [note, setNote] = useState("");
  const tier1 = player.profession.tiers[0];
  return (
    <section className="dashboard-panel" aria-labelledby="holdings-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">{player.profession.name}</p>
        <h1 id="holdings-title">Your Holdings</h1>
        <p>Massalia · your trade operations and their income.</p>
      </div>
      <PanelBanner scene="your quarter of the city" />

      <div className="panel-label">Your holdings</div>
      <div className="panel-grid2">
        {tier1 ? (
          <PanelRow
            icon="🏛️"
            title={`${tier1.building} · ${BASE_TIER_LABEL}`}
            sub={`${tier1.benefit}${tier1.upkeep ? ` · upkeep ${tier1.upkeep}` : ""}`}
            action={<StubButton message="TODO: holding upgrades land in Phase 2." onStub={setNote}>Upgrade</StubButton>}
          />
        ) : (
          <PanelRow icon="🛠️" title="No holdings yet" sub="This path builds standing through the story, not buildings." />
        )}
        <PanelRow
          icon="⚓"
          title={`Warehouse · ${BASE_TIER_LABEL}`}
          sub="Storage capacity arrives with the warehouse system"
          action={<StubButton message="TODO: warehouse upgrades land with the storage system." onStub={setNote}>Upgrade</StubButton>}
        />
      </div>
      <p className="dashboard-todo">TODO: holdings are derived from your real profession; live production, capacity, and upgrades land in Phase 2 (buttons are stubs).</p>

      <div className="panel-label">Available buildings</div>
      <div className="panel-grid2">
        {buildableBuildings.map((building) => {
          const locked = Boolean(building.requirement);
          return (
            <PanelRow
              key={building.slug}
              icon={building.icon}
              title={building.name}
              sub={locked ? building.requirement : `${building.benefit} · ${building.cost}g · ${building.buildDays} days to build`}
              dim={locked}
              tag={locked ? "locked" : undefined}
              action={
                locked ? undefined : (
                  <StubButton message={`TODO: building construction is a stub (${building.name}).`} onStub={setNote}>
                    Build · {building.cost}g
                  </StubButton>
                )
              }
            />
          );
        })}
      </div>
      <p className="dashboard-todo">TODO: TUNING — buildable catalog is placeholder; build actions are stubs until construction exists.</p>
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

function FamilyPanel() {
  const [note, setNote] = useState("");
  const houseXanthippos = nobleHouses.find((house) => house.slug === "xanthippos");
  const houseKleitos = nobleHouses.find((house) => house.slug === "kleitos");

  return (
    <section className="dashboard-panel" aria-labelledby="family-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Household</p>
        <h1 id="family-title">House &amp; Family</h1>
        <p>Your blood, your heirs, and the matches that bind the Houses.</p>
      </div>
      <PanelBanner scene="the oikos" />

      <div className="panel-label">Your household</div>
      <PersonRow
        name="Theano of House Philon"
        nameSuffix={<span className="person-suffix"> · your wife</span>}
        role="Married 4 years"
        traits={[{ label: "Gregarious", tone: "good" }, { label: "Shrewd", tone: "good" }]}
        right={<span className="pr-lvl">+46 opinion</span>}
      />
      <PersonRow
        name="Damon"
        nameSuffix={<span className="heir-tag">Heir</span>}
        role="Son · age 14 · came of age"
        traits={[{ label: "Ambitious", tone: "good" }]}
        right={<StubButton message="TODO: betrothal arrangement is a stub until the family system exists." onStub={setNote}>Arrange betrothal</StubButton>}
      />
      <PersonRow
        name="Myrrine"
        role="Daughter · age 9"
        traits={[{ label: "Gifted", tone: "good" }, { label: "Shy" }]}
        right={<StubButton ghost message="TODO: choosing a tutor is a stub until the family system exists." onStub={setNote}>Choose tutor</StubButton>}
      />

      <div className="panel-label">Eligible brides</div>
      <PersonRow
        name="Aglaia of House Xanthippos"
        role={`Age 22 · ${houseXanthippos?.stance ?? "Centrist"} family · dowry 400g`}
        traits={[{ label: "Diplomat", tone: "good" }, { label: "Beautiful", tone: "good" }]}
        right={<StubButton message="TODO: proposing a match is a stub until the family system exists." onStub={setNote}>Propose</StubButton>}
      />
      <PersonRow
        name="Niobe of House Kleitos"
        role={`Age 26 · ${houseKleitos?.stance ?? "Reformist"} family · widow · dowry 250g`}
        traits={[{ label: "Shrewd", tone: "good" }, { label: "Proud", tone: "warn" }]}
        right={<StubButton message="TODO: proposing a match is a stub until the family system exists." onStub={setNote}>Propose</StubButton>}
      />

      <div className="panel-label">Adoption</div>
      <PersonRow
        name="Lykos"
        role="Orphan of the harbor · age 7 · fee 150g"
        traits={[{ label: "Quick", tone: "good" }]}
        right={<StubButton message="TODO: adoption is a stub until the family system exists." onStub={setNote}>Adopt · 150g</StubButton>}
      />
      <PersonRow
        name="Chloe"
        role="Ward of the temple · age 10 · fee 150g"
        traits={[{ label: "Pious", tone: "good" }]}
        right={<StubButton message="TODO: adoption is a stub until the family system exists." onStub={setNote}>Adopt · 150g</StubButton>}
      />

      <p className="dashboard-todo">TODO: household, brides, and adoption candidates are placeholders until the family system exists.</p>
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
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
          <PanelBanner scene="the council chamber" />
          <div className="court-grid">
            <div>
              <div className="panel-label">Issues before the council</div>
              {councilIssues.map((issue) => (
                <PanelRow
                  key={issue.id}
                  icon={issue.icon}
                  title={issue.title}
                  sub={issue.sub}
                  action={<StubButton message="TODO: council voting is a stub until political state exists." onStub={setNote}>Vote</StubButton>}
                />
              ))}
              <div className="panel-label panel-label-spaced">Elections</div>
              {councilElections.map((election) => (
                <PanelRow
                  key={election.id}
                  icon={election.icon}
                  title={election.title}
                  sub={election.sub}
                  action={election.votable ? <StubButton message="TODO: election voting is a stub until political state exists." onStub={setNote}>Vote</StubButton> : undefined}
                  tag={election.votable ? undefined : "—"}
                />
              ))}
            </div>
            <div>
              <div className="panel-label">Council news</div>
              <DigestList items={councilNews} />
            </div>
          </div>
          <p className="dashboard-todo">TODO: council issues, elections, and news are placeholder until political state exists.</p>
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      ) : joined ? (
        <div className="pol-page">
          <PanelBanner scene={`the ${player.party} hall`} className={player.party === "Dynatoi" ? "banner-reform" : "banner-cons"} />
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
          <div className="court-grid">
            <div>
              <div className="panel-label">Party matters · {player.party}</div>
              {partyMatters.map((matter) => (
                <PanelRow
                  key={matter.id}
                  icon={matter.icon}
                  title={matter.title}
                  sub={matter.sub}
                  action={matter.votable ? <StubButton message="TODO: party voting is a stub until political state exists." onStub={setNote}>Vote</StubButton> : undefined}
                  tag={matter.votable ? undefined : "noted"}
                />
              ))}
            </div>
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
                  <div className="party-banner">
                    <span className="scene-tag">scene art — {option.consClass ? "the old guard" : "the reformers"}</span>
                  </div>
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

// Emoji per resource type, used for the coin & class store rows and goods.
const resourceIcons: Record<string, string> = {
  gold: "🪙",
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
  { id: "letter-credit", icon: "📜", name: "Letter of Credit", origin: "Redeem at any Agora for 100 gold", action: "Redeem" },
];

// TODO: placeholder units until the units system exists.
const placeholderUnits = [
  { id: "caravan", icon: "🛡️", name: "Caravan Guards × 2", line: "Protect your trade routes · upkeep −1g/day each", tag: "hired", dim: false },
  { id: "militia", icon: "⚔️", name: "Militia × 0", line: "Trained and led by Military Leaders", tag: "—", dim: true },
];

// TODO: placeholder achievements until the achievement system exists.
const earnedAchievements = [
  { id: "first-coin", icon: "🪙", name: "First Coin", detail: "Earn your first gold from a holding.", when: "Season I · Day 1" },
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

function avatarContent(player: PlayerDashboardView) {
  if (player.faceImage) return <img src={player.faceImage} alt="" loading="lazy" />;
  if (player.profession.image) return <img src={player.profession.image} alt="" loading="lazy" />;
  return <span>{player.name[0]}</span>;
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
  const classType = player.classResource.type;
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
        name="Gold"
        amount={player.gold.toLocaleString()}
        rate={PLACEHOLDER_GOLD_RATE}
        rateTone="up"
        rateTitle={PLACEHOLDER_RATE_TITLE}
      />
      {/* Some paths (e.g. Shipbuilder) earn gold as their class resource; skip the duplicate row. */}
      {classType !== "gold" ? (
        <ResRow
          icon={resourceIcons[classType] ?? "🏺"}
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

function CharacterTab({ player, sheet }: { player: PlayerDashboardView; sheet: CharacterSheetData | null }) {
  const primary = primaryStatFor(player.professionSlug);
  // Effective stats (base + trait mods) from the canonical sheet; base from the
  // sheet too, falling back to /me/state base while the sheet loads.
  const effective = sheet?.effective ?? player.stats;
  const base = sheet?.base ?? player.stats;
  return (
    <div role="tabpanel">
      <SheetLabel>Stats</SheetLabel>
      <div className="cs-stats">
        {statDefs.map((stat) => {
          const value = effective[stat.key];
          const delta = value - base[stat.key];
          return (
            <div
              key={stat.key}
              className={`cs-stat${stat.key === primary ? " primary" : ""}`}
              title={delta ? `base ${base[stat.key]} · ${delta > 0 ? "+" : ""}${delta} from traits` : undefined}
            >
              <div className="cs-stat-v">
                {value}
                {delta ? <span className="cs-stat-delta">{delta > 0 ? `+${delta}` : delta}</span> : null}
              </div>
              <div className="cs-stat-k">{stat.label}</div>
            </div>
          );
        })}
      </div>
      <p className="sheet-todo">Effective stats = base + trait bonuses. Base stays 0 until the event engine grants stats.</p>

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
          <span className="cs-av">{avatarContent(player)}</span>
          <div className="cs-id">
            <div className="cs-nm" id="character-sheet-title">
              {player.name} <span className="cs-ep">· epithet earned later</span>
            </div>
            <div className="cs-rk">
              {player.profession.rank} · {player.profession.name} · {BASE_TIER_LABEL}
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

const panelComponents: Record<DashboardSection, (props: PanelProps) => ReactNode> = {
  court: CourtPanel,
  holdings: HoldingsPanel,
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
  const courtBadgeCount = placeholderCourtEvents.length;
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
  }, [onRequireCharacter, onRequireLogin]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

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
            <span>Season I · Day {player.seasonDay}</span>
          </span>
          <strong>· ends in {player.seasonEndsIn} days</strong>
        </div>
        <div className="topbar-actions">
          <button
            className="topbar-vital"
            type="button"
            onClick={() => setActiveSheet("inventory")}
            title="Open your inventory"
          >
            <span className="vital-ic" aria-hidden="true">🪙</span>
            <span className="vital-v">{player.gold.toLocaleString()}</span>
            <span className="vital-meta">
              <span className="vital-k">Gold</span>
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
            <span className="avatar-av" aria-hidden="true">{avatarContent(player)}</span>
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
