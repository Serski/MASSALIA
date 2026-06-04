import { useEffect, useMemo, useState, type ReactNode } from "react";
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

type PlayerDashboardState = {
  name: string;
  seasonDay: number;
  seasonEndsIn: number;
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
  seasonDay: 18,
  seasonEndsIn: 11,
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
    seasonDay: state.world.seasonDay,
    seasonEndsIn: state.world.seasonEndsIn,
    gold: state.resources.gold,
    prestige: state.resources.prestige,
    influence: state.resources.influence,
    professionSlug: profession.slug,
    houseSlug: house.slug,
    classResource: {
      label: state.resources.classResource.label,
      amount: state.resources.classResource.amount,
    },
    party: normalizeParty(state.character.party),
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

function ResourcePill({ value, label, delta }: { value: string | number; label: string; delta?: string }) {
  return (
    <span className="resource-pill">
      <strong>{value}</strong>
      <span>{label}</span>
      {delta ? <em>{delta}</em> : null}
    </span>
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
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [loadError, setLoadError] = useState("");
  const player = useMemo(() => playerState ? playerFromState(playerState) : getPlaceholderPlayer(), [playerState]);
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
          <strong>Ends in {player.seasonEndsIn} days</strong>
        </div>
        <div className="resource-pill-row" aria-label="Player resources">
          <ResourcePill value={player.gold} label="Gold" delta="+30/day" />
          <ResourcePill value={player.classResource.amount} label={player.classResource.label} delta="+10/day" />
          <ResourcePill value={player.prestige} label="Prestige" />
          <ResourcePill value={player.influence} label="Influence" />
        </div>
        <div className="dashboard-player-chip">
          <span className="dashboard-avatar" aria-hidden="true">
            {player.faceImage ? <img src={player.faceImage} alt="" loading="lazy" /> : player.profession.image ? <img src={player.profession.image} alt="" loading="lazy" /> : player.name[0]}
          </span>
          <div>
            <strong>{player.name}</strong>
            <span className="desktop-player-subline">{player.profession.rank} - {player.profession.name}</span>
            <span className="mobile-player-subline">{player.profession.name} · {player.profession.rank} · leans {player.party}</span>
          </div>
          <span className="house-mini-medal" aria-label={`House ${player.house.name}`}>{player.house.name[0]}</span>
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
    </main>
  );
}
