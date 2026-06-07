import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type PlayerState } from "../api.js";
import { assetPath, nobleHouses, professions, type House, type Profession } from "../data/league.js";
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
  // -100..+100; negative = Reformist, positive = Conservative, 0 = centre.
  alignment: number;
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

type Holding = {
  id: string;
  title: string;
  rank: string;
  benefit: string;
  status: string;
};

type MarketPrice = {
  id: string;
  good: string;
  price: number;
  trend: "up" | "down" | "flat";
  stock: string;
};

type MarketOffer = {
  id: string;
  good: string;
  side: "Buy" | "Sell";
  amount: number;
  price: number;
};

type HouseholdPerson = {
  id: string;
  name: string;
  role: string;
  age: number;
  status: string;
  traits: string[];
  house?: House;
};

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
  alignment: 0,
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

// TODO: Replace with player-owned buildings/holdings from profession progression state.
const placeholderHoldings: Holding[] = [
  { id: "trade-post", title: "Trade Post", rank: "@Nautilos Emporos", benefit: "4 Wine/day", status: "Upgrade available" },
  { id: "warehouse", title: "Harbor Warehouse", rank: "Storehouse", benefit: "+10 resource capacity", status: "Operational" },
  { id: "ledger", title: "Account Ledger", rank: "Civic record", benefit: "+2 influence/day", status: "Pending clerk" },
];

// TODO: Replace with live market quotes and player order book.
const placeholderMarketPrices: MarketPrice[] = [
  { id: "tin", good: "Tin", price: 22, trend: "up", stock: "thin" },
  { id: "wine", good: "Wine", price: 15, trend: "flat", stock: "steady" },
  { id: "wheat", good: "Wheat", price: 10, trend: "down", stock: "ample" },
  { id: "iron", good: "Iron", price: 28, trend: "up", stock: "tight" },
  { id: "salt", good: "Salt", price: 13, trend: "flat", stock: "steady" },
  { id: "marble", good: "Marble", price: 34, trend: "down", stock: "slow" },
  { id: "lead", good: "Lead", price: 18, trend: "flat", stock: "steady" },
  { id: "stone", good: "Stone", price: 8, trend: "down", stock: "full" },
  { id: "wood", good: "Wood", price: 9, trend: "up", stock: "active" },
  { id: "leather", good: "Leather", price: 16, trend: "flat", stock: "steady" },
  { id: "horse", good: "Horse", price: 45, trend: "up", stock: "rare" },
];

const placeholderOpenOffers: MarketOffer[] = [
  { id: "offer-wine", good: "Wine", side: "Sell", amount: 12, price: 17 },
  { id: "offer-iron", good: "Iron", side: "Buy", amount: 6, price: 25 },
];

// TODO: Replace with household state and kinship records.
const placeholderHousehold: HouseholdPerson[] = [
  { id: "pytheas", name: "Pytheas", role: "Householder", age: 31, status: "Active", traits: ["Trader", "Cautious"], house: nobleHouses.find((house) => house.slug === "leonidas") },
  { id: "kleio", name: "Kleio", role: "Younger cousin", age: 17, status: "Eligible later", traits: ["Literate", "Ambitious"], house: nobleHouses.find((house) => house.slug === "leonidas") },
  { id: "menon", name: "Menon", role: "Ward", age: 9, status: "Needs tutor", traits: ["Curious", "Unproven"], house: nobleHouses.find((house) => house.slug === "leonidas") },
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
    alignment: state.character.alignment,
    stats: state.stats,
    balances: state.resources.balances,
    faceImage: getFaceImage(profession.slug, state.character.faceId),
    profession,
    house,
  };
}

function getEligibleMatches(playerHouseSlug: string) {
  return nobleHouses
    .filter((house) => house.slug !== playerHouseSlug)
    .slice(0, 4)
    .map((house, index) => ({
      id: `match-${house.slug}`,
      name: index % 2 === 0 ? `Daughter of ${house.name}` : `Younger son of ${house.name}`,
      role: `${house.stance} match`,
      age: 18 + index,
      status: "Introduction available",
      traits: [house.patron, house.crest],
      house,
    }));
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

function CourtPanel() {
  return (
    <section className="dashboard-panel" aria-labelledby="court-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Home</p>
        <h1 id="court-title">Court</h1>
        <p>Messages, petitions, and decisions waiting for your return.</p>
      </div>
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

function HoldingsPanel({ player }: { player: PlayerDashboardView }) {
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
              <p>{holding.benefit} - {holding.status}</p>
            </ListRow>
          ))}
        </div>
        <p className="dashboard-todo">TODO: holdings are placeholder rows until profession building state exists.</p>
      </DashboardCard>
    </section>
  );
}

function MarketPanel() {
  const [note, setNote] = useState("TODO: market actions are local placeholders until exchange services exist.");
  const placeOrder = (good: string, side: "Buy" | "Sell", price: number) => {
    setNote(`TODO placeholder: ${side} order staged for ${good} at ${price} gold.`);
  };
  const cancelOrder = (offer: MarketOffer) => {
    setNote(`TODO placeholder: cancel request staged for ${offer.side} ${offer.amount} ${offer.good}.`);
  };

  return (
    <section className="dashboard-panel" aria-labelledby="market-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Agora</p>
        <h1 id="market-title">Market</h1>
        <p>Prices, open offers, and placeholder buy/sell actions for the exchange.</p>
      </div>
      <div className="market-stat-row">
        <DashboardCard><span className="dashboard-label">Volume</span><strong>184 lots</strong><p>TODO placeholder daily trade volume.</p></DashboardCard>
        <DashboardCard><span className="dashboard-label">Spread</span><strong>3 gold</strong><p>TODO placeholder average bid/ask spread.</p></DashboardCard>
        <DashboardCard><span className="dashboard-label">Tax</span><strong>6%</strong><p>TODO placeholder city market toll.</p></DashboardCard>
      </div>
      <DashboardCard>
        <div className="panel-subhead">
          <h2>Price board</h2>
          <span className="dashboard-label">11 goods</span>
        </div>
        <div className="market-board" role="table" aria-label="Market price board">
          {placeholderMarketPrices.map((item) => (
            <div className="market-row" role="row" key={item.id}>
              <div className="market-good" role="cell">
                <span className="market-token" aria-hidden="true">{item.good[0]}</span>
                <div>
                  <strong>{item.good}</strong>
                  <span>{item.stock} stock</span>
                </div>
              </div>
              <span className={`market-trend trend-${item.trend}`} role="cell">{item.trend}</span>
              <strong role="cell">{item.price}g</strong>
              <div className="dashboard-action-row" role="cell">
                <button className="dashboard-ghost-button" type="button" onClick={() => placeOrder(item.good, "Buy", item.price)}>Buy</button>
                <button className="dashboard-primary-button" type="button" onClick={() => placeOrder(item.good, "Sell", item.price)}>Sell</button>
              </div>
            </div>
          ))}
        </div>
        <p className="dashboard-todo">{note}</p>
      </DashboardCard>
      <DashboardCard>
        <h2>Open offers</h2>
        <div className="dashboard-list">
          {placeholderOpenOffers.map((offer) => (
            <ListRow
              key={offer.id}
              action={<button className="dashboard-ghost-button" type="button" onClick={() => cancelOrder(offer)}>Cancel</button>}
            >
              <strong>{offer.side} {offer.good}</strong>
              <p>{offer.amount} lots at {offer.price} gold each.</p>
            </ListRow>
          ))}
        </div>
      </DashboardCard>
    </section>
  );
}

function PersonCard({ person, action }: { person: HouseholdPerson; action?: ReactNode }) {
  return (
    <article className="person-card">
      <div className="person-avatar">
        {person.house ? <img src={person.house.image} alt="" loading="lazy" /> : <span>{person.name[0]}</span>}
      </div>
      <div className="person-body">
        <span className="dashboard-label">{person.role}</span>
        <h3>{person.name}</h3>
        <p>Age {person.age} - {person.status}</p>
        <div className="trait-row">
          {person.traits.map((trait) => <span key={trait}>{trait}</span>)}
        </div>
      </div>
      {action ? <div className="person-action">{action}</div> : null}
    </article>
  );
}

function FamilyPanel({ player }: { player: PlayerDashboardView }) {
  const [note, setNote] = useState("TODO: family actions are local placeholders until kinship backend exists.");
  const matches = useMemo(() => getEligibleMatches(player.house.slug), [player.house.slug]);

  return (
    <section className="dashboard-panel" aria-labelledby="family-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Household</p>
        <h1 id="family-title">Family</h1>
        <p>Kin, heirs, and marriage ties. Family events use the same Court queue.</p>
      </div>
      <div className="family-action-row">
        <button className="dashboard-primary-button" type="button" onClick={() => setNote("TODO placeholder: adoption inquiry staged for your household.")}>Adopt an heir</button>
        <button className="dashboard-ghost-button" type="button" onClick={() => setNote("TODO placeholder: matchmaker inquiry staged for your household.")}>Seek a match</button>
      </div>
      <div className="dashboard-grid two">
        <DashboardCard>
          <div className="panel-subhead">
            <h2>Your household</h2>
            <span className="nav-badge">{placeholderFamilyEventCount}</span>
          </div>
          <div className="person-stack">
            {placeholderHousehold.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                action={
                  person.id === "menon"
                    ? <button className="dashboard-ghost-button" type="button" onClick={() => setNote("TODO placeholder: tutor arrangement staged for Menon.")}>Tutor</button>
                    : null
                }
              />
            ))}
          </div>
        </DashboardCard>
        <DashboardCard>
          <h2>Eligible matches</h2>
          <div className="person-stack">
            {matches.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                action={<button className="dashboard-primary-button" type="button" onClick={() => setNote(`TODO placeholder: introduction proposed with ${person.house?.name}.`)}>Propose</button>}
              />
            ))}
          </div>
        </DashboardCard>
      </div>
      <p className="dashboard-todo">{note}</p>
    </section>
  );
}

function PoliticsPanel({ player }: { player: PlayerDashboardView }) {
  return (
    <section className="dashboard-panel" aria-labelledby="politics-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Assembly</p>
        <h1 id="politics-title">Politics</h1>
        <p>Party allegiance, House standing, and offices in play.</p>
      </div>
      <div className="dashboard-grid two">
        <DashboardCard>
          <h2>Palaioi vs Dynatoi</h2>
          <div className="party-duel">
            <div className={`party-card${player.party === "Palaioi" ? " selected" : ""}`}>
              <span className="dashboard-label">Old houses</span>
              <strong>Palaioi</strong>
              <p>Conservative families, temple patrons, and citizens who trust old order.</p>
            </div>
            <div className={`party-card${player.party === "Dynatoi" ? " selected" : ""}`}>
              <span className="dashboard-label">Rising powers</span>
              <strong>Dynatoi</strong>
              <p>Merchants, reformers, ambitious officers, and families hungry for motion.</p>
            </div>
          </div>
          {player.party === "Unaligned" ? <p className="unaligned-note">Unaligned - chosen in-game through a narrated event.</p> : null}
        </DashboardCard>
        <DashboardCard>
          <h2>House standing</h2>
          <strong>{player.house.name}</strong>
          <p>{player.house.stance}</p>
          <p className="party-motto">"{player.house.motto}"</p>
          <div className="house-meter" aria-label="House standing placeholder">
            <span style={{ width: "62%" }} />
          </div>
          <p className="dashboard-todo">TODO: House standing score awaits backend state.</p>
        </DashboardCard>
      </div>
      <DashboardCard>
        <h2>Offices & elections</h2>
        <div className="dashboard-list compact">
          <ListRow><strong>Archon seats</strong><p>2 contested</p></ListRow>
          <ListRow><strong>Council petitions</strong><p>3 awaiting support</p></ListRow>
          <ListRow><strong>Next assembly</strong><p>Day 21</p></ListRow>
        </div>
        <p className="dashboard-todo">TODO: offices/elections are placeholder data until political state exists.</p>
      </DashboardCard>
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
  "military-leader": "militia",
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

// TODO: placeholder traits until the event engine grants real ones.
const placeholderTraits = [
  { id: "shrewd", icon: "🧠", name: "Shrewd", line: "+5% better prices at the Agora · earned: Season I", tag: "asset", tone: "asset" as const },
  { id: "harbor-born", icon: "⚓", name: "Harbor-Born", line: "+Favor with shipmasters · from your origins in Massalia", tag: "asset", tone: "asset" as const },
  { id: "unproven", icon: "🌱", name: "Unproven", line: "The Houses have not yet measured you · fades as standing grows", tag: "neutral", tone: "neutral" as const },
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
  tone?: "asset" | "neutral";
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

function AlignmentBar({ alignment }: { alignment: number }) {
  const clamped = Math.max(-100, Math.min(100, alignment));
  const markerPct = 50 + clamped / 2; // -100 -> 0%, 0 -> 50%, +100 -> 100%
  const abs = Math.abs(clamped);
  const side = clamped < 0 ? "Reformist" : clamped > 0 ? "Conservative" : "Centrist";
  const readout = abs === 0 ? "Centrist (0%)" : `${abs}% ${side}`;
  const eligibility =
    clamped <= -10
      ? "eligible for the Dynatoi"
      : clamped >= 10
        ? "eligible for the Palaioi"
        : "centrist — not yet eligible for a party";
  const readoutColor = clamped < 0 ? "var(--dash-ref)" : clamped > 0 ? "#c08a5e" : "var(--dash-parchment)";
  return (
    <div className="cs-align">
      <div className="align-ends">
        <span style={{ color: "var(--dash-ref)" }}>◀ Reformist</span>
        <span style={{ color: "#c08a5e" }}>Conservative ▶</span>
      </div>
      <div className="align-bar" role="img" aria-label={`Alignment: ${readout}`}>
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

function CharacterTab({ player }: { player: PlayerDashboardView }) {
  const primary = primaryStatFor(player.professionSlug);
  return (
    <div role="tabpanel">
      <SheetLabel>Stats</SheetLabel>
      <div className="cs-stats">
        {statDefs.map((stat) => (
          <div key={stat.key} className={`cs-stat${stat.key === primary ? " primary" : ""}`}>
            <div className="cs-stat-v">{player.stats[stat.key]}</div>
            <div className="cs-stat-k">{stat.label}</div>
          </div>
        ))}
      </div>
      <p className="sheet-todo">TODO: Devotion, Militia, and Intelligence stay 0 until the event engine grants them.</p>

      <SheetLabel>Alignment</SheetLabel>
      <AlignmentBar alignment={player.alignment} />

      <SheetLabel>Traits · {placeholderTraits.length}</SheetLabel>
      {placeholderTraits.map((trait) => (
        <DetailRow key={trait.id} icon={trait.icon} name={trait.name} sub={trait.line} tag={trait.tag} tone={trait.tone} />
      ))}
      <div className="slot-empty">Traits are earned through decisions, quests, and the life you lead — some help, some haunt.</div>
      <p className="sheet-todo">TODO: traits are placeholder until the event engine grants real ones.</p>
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
  const partyChip = player.party === "Unaligned" ? "Party — chosen in-game" : player.party;
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
      {tab === "character" ? <CharacterTab player={player} /> : null}
      {tab === "achievements" ? <AchievementsTab /> : null}
      {tab === "settings" ? <SettingsTab player={player} onLogout={onLogout} /> : null}
    </BottomSheet>
  );
}

const panelComponents: Record<DashboardSection, (props: { player: PlayerDashboardView }) => ReactNode> = {
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

  useEffect(() => {
    let cancelled = false;
    api.state()
      .then((state) => {
        if (!cancelled) setPlayerState(state);
      })
      .catch((error) => {
        if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
  }, [onRequireCharacter, onRequireLogin]);

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
            <ActivePanel player={player} />
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
