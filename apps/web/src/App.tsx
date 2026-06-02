import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MapCanvas } from "./map/MapCanvas.js";

type Alignment = "conservative" | "centrist" | "reformist";
type DetailKind = "profession" | "house" | "party" | "city";
type AuthMode = "login" | "signup";

function assetPath(path: string) {
  return `${import.meta.env.BASE_URL}${path}`.replace(/([^:])\/+/g, "$1/");
}

type Tier = {
  building: string;
  rank: string;
  benefit: string;
  upkeep?: string;
};

type Profession = {
  kind: "profession";
  slug: string;
  initial: string;
  name: string;
  rank: string;
  objective: string;
  income: string;
  tiers: Tier[];
  note: string;
};

type House = {
  kind: "house";
  slug: string;
  initial: string;
  image: string;
  name: string;
  alignment: Alignment;
  stance: string;
  motto: string;
  patron: string;
  ancestor: string;
  crest: string;
  history: string;
  moment: string;
};

type Party = {
  kind: "party";
  slug: string;
  initial: string;
  image: string;
  name: string;
  script: string;
  title: string;
  alignment: Alignment;
  formed: string;
  motto: string;
  stipend: string;
  who: string;
  wants: string;
  influence: string;
};

type City = {
  kind: "city";
  slug: string;
  initial: string;
  name: string;
  resource: string;
  capital?: boolean;
  flavor: string;
};

type DetailEntry = Profession | House | Party | City;

const landingStats = {
  cities: "10",
  houses: "10",
  seasonLabel: "Season I",
  seasonStatus: "Open now",
};

const professions: Profession[] = [
  {
    kind: "profession",
    slug: "landowner",
    initial: "L",
    name: "Landowner",
    rank: "@Georgos",
    objective: "Turn fields and estates into the grain engine of your city.",
    income: "2 Wheat/day",
    tiers: [
      { building: "Farm", rank: "@Ktematias", benefit: "4 Wheat/day" },
      { building: "Large Farm", rank: "@Choriarches", benefit: "10 Wheat/day", upkeep: "-10 gold" },
      { building: "Estate", rank: "@Protogeorgos", benefit: "15 Wheat/day" },
      { building: "Large Estate", rank: "@Mega Georgos", benefit: "20 Wheat/day", upkeep: "-25 gold" },
    ],
    note: "All professions cost 100 gold to start. Wheat is roughly 10 gold/unit; Landowners can use the Forge.",
  },
  {
    kind: "profession",
    slug: "trader",
    initial: "T",
    name: "Trader",
    rank: "@Emporos",
    objective: "Move wine, rare resources, and influence across the Mediterranean routes.",
    income: "2 Wine/day",
    tiers: [
      { building: "Trade Post", rank: "@Nautilos Emporos", benefit: "4 Wine/day" },
      { building: "Large Trade Post", rank: "@Emporikos Presbeutes", benefit: "10 Wine/day", upkeep: "-10 gold" },
      { building: "Trading Hub", rank: "@Emporos Archon", benefit: "15 Wine/day" },
      { building: "Trade Port", rank: "@Emporos Mega", benefit: "20 Wine/day", upkeep: "-25 gold" },
    ],
    note: "All professions cost 100 gold to start. Wine is roughly 15 gold/unit; trade ports unlock rare resources.",
  },
  {
    kind: "profession",
    slug: "priest",
    initial: "P",
    name: "Priest",
    rank: "@Neokoros",
    objective: "Convert devotion, healing, and ritual authority into civic power.",
    income: "2 Herbal/day +5 Devotion",
    tiers: [
      { building: "Shrine", rank: "@Mystes", benefit: "4 Herbal/day; +5 Devotion" },
      { building: "Temple", rank: "@Hierophant", benefit: "10 Herbal/day; +10 Devotion" },
      { building: "Sanctuary", rank: "@Archiereus", benefit: "15 Herbal/day; +15 Devotion" },
      { building: "Grand Sanctuary", rank: "@Mega Archiereus", benefit: "20 Herbal/day; +20 Devotion" },
    ],
    note: "All professions cost 100 gold to start. Herbal is roughly 20 gold/unit; Priests train Healers. One Healer restores 10 troops.",
  },
  {
    kind: "profession",
    slug: "philosopher",
    initial: "F",
    name: "Philosopher",
    rank: "@Didaskalos",
    objective: "Build schools, prestige, and diplomatic leverage through learning.",
    income: "10 gold/day +5 Prestige",
    tiers: [
      { building: "School", rank: "@Scholarch", benefit: "20 gold/day; +5 Prestige" },
      { building: "Academy", rank: "@Philosophos", benefit: "30 gold/day; +10 Prestige" },
      { building: "Lyceum", rank: "@Sophistes", benefit: "40 gold/day; +20 Prestige" },
      { building: "Great Lyceum", rank: "@Megasophistes", benefit: "50 gold/day; +30 Prestige" },
    ],
    note: "All professions cost 100 gold to start. Philosophers craft prestige items through the Cloth Factory and gain +10% diplomatic missions.",
  },
  {
    kind: "profession",
    slug: "shipbuilder",
    initial: "S",
    name: "Shipbuilder",
    rank: "@Naupegos",
    objective: "Own the dockyards that decide who can trade, raid, and cross the sea.",
    income: "10 gold/day",
    tiers: [
      { building: "Shipyard", rank: "@Naukleros", benefit: "20 gold/day" },
      { building: "Naval Dock", rank: "@Epimeletes", benefit: "30 gold/day" },
      { building: "Shipwright Complex", rank: "@Ship Architekton", benefit: "40 gold/day" },
      { building: "Grand Naval Facility", rank: "@Mega Naupegos", benefit: "50 gold/day" },
    ],
    note: "All professions cost 100 gold to start. Shipbuilders craft naval supplies, sailors, and ships, and research new ship types.",
  },
  {
    kind: "profession",
    slug: "hetaira",
    initial: "H",
    name: "Hetaira",
    rank: "@Hetaira",
    objective: "Turn salons, gossip, and dangerous favors into quiet political force.",
    income: "20 gold/day +5 Intrigue",
    tiers: [
      { building: "Salon", rank: "@Desmoteros", benefit: "30 gold/day; +10 Intrigue" },
      { building: "Courtesan House", rank: "@Pallake", benefit: "40 gold/day; +15 Intrigue" },
      { building: "Luxury Villa", rank: "@Hetairarches", benefit: "50 gold/day; +20 Intrigue; +5% intrigue" },
      { building: "Grand Villa", rank: "@Megalhetaira", benefit: "60 gold/day; +25 Intrigue; +10% intrigue" },
    ],
    note: "All professions cost 100 gold to start. Hetairai craft poisons and gossip spreaders, train Healers, and use the Cloth Factory.",
  },
  {
    kind: "profession",
    slug: "military-leader",
    initial: "M",
    name: "Military Leader",
    rank: "@Dekarchos",
    objective: "Command citizen soldiers and grow from local captain to League warlord.",
    income: "20 gold/day +5 Militia; leads 10 troops",
    tiers: [
      { building: "Enhanced Training", rank: "@Ekatontarchos", benefit: "30 gold/day; +10 Militia; leads 100 troops" },
      { building: "Advanced Training Facility", rank: "@Lochagos", benefit: "40 gold/day; +15 Militia; leads 250 troops" },
      { building: "Fortified Barracks", rank: "@Taxiarchos", benefit: "50 gold/day; +20 Militia; leads 750 troops" },
      { building: "Citadel Command Center", rank: "@Xiliarchos", benefit: "60 gold/day; +25 Militia; leads 1000 troops" },
    ],
    note: "All professions cost 100 gold to start. Military Leaders craft military traits with wine and papyrus and can use the Forge.",
  },
];

const leagueCities: City[] = [
  { kind: "city", slug: "massalia", initial: "M", name: "Massalia", resource: "Lead", capital: true, flavor: "The capital is a shared hub of harbor votes, lead contracts, and League ambition." },
  { kind: "city", slug: "emporion", initial: "E", name: "Emporion", resource: "Tin", flavor: "A shared western market where tin wealth and Iberian trade pull many players into the same streets." },
  { kind: "city", slug: "rhoda", initial: "R", name: "Rhoda", resource: "Leather", flavor: "A communal coastal workshop where leather goods, ships, and frontier politics overlap." },
  { kind: "city", slug: "agathe", initial: "A", name: "Agathe", resource: "Horse", flavor: "A shared cavalry-minded settlement where horses shape local prestige and military planning." },
  { kind: "city", slug: "arelate", initial: "A", name: "Arelate", resource: "Wool", flavor: "A river hub where many citizens turn wool, tolls, and alliances into steady influence." },
  { kind: "city", slug: "olbia", initial: "O", name: "Olbia", resource: "Wood", flavor: "A shared timber port where shipwrights and traders compete without owning the city outright." },
  { kind: "city", slug: "monoikos", initial: "M", name: "Monoikos", resource: "Iron", flavor: "A rugged shared harbor where iron, forts, and maritime risk draw ambitious players together." },
  { kind: "city", slug: "antipolis", initial: "A", name: "Antipolis", resource: "Marble", flavor: "A civic showcase where marble turns shared public works into prestige." },
  { kind: "city", slug: "nikaia", initial: "N", name: "Nikaia", resource: "Stone", flavor: "A shared defensive city where stone, walls, and council politics create durable power." },
  { kind: "city", slug: "athinopolis", initial: "A", name: "Athinopolis", resource: "Salt", flavor: "A shared salt hub where food, trade, and ritual supply lines become political currency." },
];

const nobleHouses: House[] = [
  { kind: "house", slug: "kleitos", initial: "K", image: assetPath("assets/Kleitos.png"), name: "Kleitos", alignment: "reformist", stance: "Reformist", motto: "Unity in diversity strengthens us.", patron: "Hestia", ancestor: "Agathon Kleitos, 580-517 BC", crest: "Dove with olive branch", history: "Pushed Gaulish integration and a broader League identity.", moment: "Brokered the Accord of Liris in 560 BC." },
  { kind: "house", slug: "miltiades", initial: "M", image: assetPath("assets/Mitliades.png"), name: "Miltiades", alignment: "reformist", stance: "Mod. Reformist", motto: "Understanding is the foundation of peace.", patron: "Asclepius", ancestor: "Cleisthenes Miltiades, 570-509 BC", crest: "Scroll with Greek and Gaulish symbols", history: "Built its name through diplomacy, interpreters, and patient civic education.", moment: "Founded the first bilingual school around 530 BC." },
  { kind: "house", slug: "xanthippos", initial: "X", image: assetPath("assets/Xanthipos.png"), name: "Xanthippos", alignment: "centrist", stance: "Centrist", motto: "Harmony through balance.", patron: "Iris", ancestor: "Damon Xanthippos, 550-492 BC", crest: "Scale with helmet and torque", history: "Mediator family trusted by merchants, soldiers, Greeks, and Gauls.", moment: "Secured the Treaty of Metron in 490 BC." },
  { kind: "house", slug: "iason", initial: "I", image: assetPath("assets/Iason.png"), name: "Iason", alignment: "conservative", stance: "Centrist to Conservative", motto: "Navigate the old, embrace the new.", patron: "Proteus", ancestor: "Periander Iason, 530-475 BC", crest: "Galley with oars", history: "Sea-facing house that keeps old forms while testing foreign routes.", moment: "Led the Iberian trade expedition in 450 BC." },
  { kind: "house", slug: "timon", initial: "T", image: assetPath("assets/Timon.png"), name: "Timon", alignment: "conservative", stance: "Conservative", motto: "Preserve the arts, sustain the soul.", patron: "Erato", ancestor: "Theodorus Timon, 560-491 BC", crest: "Greek lyre", history: "Patrons of festivals, poetry, and old Hellenic rites.", moment: "Held the first festival to the Greek gods in 420 BC." },
  { kind: "house", slug: "aristeides", initial: "A", image: assetPath("assets/Aristeides.png"), name: "Aristeides", alignment: "centrist", stance: "Centrist", motto: "Defend and respect all borders.", patron: "Nike", ancestor: "Leon Aristeides, 540-478 BC", crest: "Shield and crossed spear", history: "Border defenders who value discipline more than factional purity.", moment: "Distinguished itself at the Battle of the Rhone in 460 BC." },
  { kind: "house", slug: "herakleides", initial: "H", image: assetPath("assets/Herakleides.png"), name: "Herakleides", alignment: "conservative", stance: "Mod. Conservative", motto: "Justice adapts, principles endure.", patron: "Themis", ancestor: "Myron Herakleides, 560-512 BC", crest: "Stone tablet and stylus", history: "Legalist house that guards old institutions while accepting measured reforms.", moment: "Revised the legal code in 480 BC." },
  { kind: "house", slug: "nicanor", initial: "N", image: assetPath("assets/Nicanor.png"), name: "Nicanor", alignment: "reformist", stance: "Mod. Reformist", motto: "Through the seas, we find our stars.", patron: "Tyche", ancestor: "Eumenes Nicanor, 520-481 BC", crest: "Celestial sphere", history: "Navigators, chance-takers, and long-distance traders.", moment: "Reached Britannia by the stars in 510 BC." },
  { kind: "house", slug: "philon", initial: "P", image: assetPath("assets/Philon.png"), name: "Philon", alignment: "reformist", stance: "Reformist to Centrist", motto: "Healing hands, merging wisdom.", patron: "Panacea", ancestor: "Chrysippus Philon, 550-492 BC", crest: "Serpent on staff", history: "Medical house blending Greek technique with Gaulish herbal knowledge.", moment: "Opened the first Greek and Gaulish clinic around 550 BC." },
  { kind: "house", slug: "leonidas", initial: "L", image: assetPath("assets/Leonidas.png"), name: "Leonidas", alignment: "conservative", stance: "Very Conservative", motto: "In tradition, we trust.", patron: "Aeolus", ancestor: "Alexandros Leonidas, 600-528 BC", crest: "Roaring lion", history: "Old aristocratic house committed to pure Hellenic continuity.", moment: "Built the temple of Apollo in 600 BC." },
];

const parties: Party[] = [
  {
    kind: "party",
    slug: "palaioi",
    initial: "P",
    image: assetPath("assets/PALAIOI READY.png"),
    name: "Palaioi",
    script: "PALAIOI",
    title: "The Conservatives",
    alignment: "conservative",
    formed: "360 BC",
    motto: "Preserving the Heritage",
    stipend: "Party Archon: 80 gold/day",
    who: "The old Phocaean aristocracy, families of the first settlers who hold land, temples, and military prestige.",
    wants: "Pure Hellenic tradition, resistance to Gaulish syncretism, and independence from Carthage and Rome.",
    influence: "They draw strength from old families, temples, officer networks, and citizens wary of foreign entanglements.",
  },
  {
    kind: "party",
    slug: "dynatoi",
    initial: "D",
    image: assetPath("assets/DYNATOI READY.png"),
    name: "Dynatoi",
    script: "DYNATOI",
    title: "The Reformists",
    alignment: "reformist",
    formed: "c. 360 BC",
    motto: "Reform for Prosperity",
    stipend: "Party Archon: 80 gold/day",
    who: "Newer progressive families, traders, and diplomats tied to the Gaulish tribes.",
    wants: "A cosmopolitan Massalia open to Gaulish customs, trade expansion into Gaul, and security through alliance.",
    influence: "They rise through merchant wealth, diplomacy, interpreters, and citizens who see survival in adaptation.",
  },
];

const offices = [
  { title: "Archons x2", type: "Elected", pay: "150 gold/day", description: "Heads of state and chief generals; one must be Palaioi, one Dynatoi." },
  { title: "Ephors x2", type: "Appointed", pay: "60 gold/day", description: "Checks on the Archons; finances, laws, and calling or dissolving council." },
  { title: "Council of Oligarchy", type: "Council", pay: "40 gold/day", description: "Senior family members who approve laws, treaties, war, and budgets." },
  { title: "Strategoi x2", type: "Appointed", pay: "100 gold/day", description: "Command armies with or for the Archons." },
];

const detailCollections = {
  professions,
  houses: nobleHouses,
  parties,
  cities: leagueCities,
};

const detailRoutes: Record<DetailKind, keyof typeof detailCollections> = {
  profession: "professions",
  house: "houses",
  party: "parties",
  city: "cities",
};

function getDetailPath(entry: DetailEntry) {
  return `/${detailRoutes[entry.kind]}/${entry.slug}`;
}

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function Crest({ initial, image, label, className = "" }: { initial: string; image?: string; label: string; className?: string }) {
  return (
    <span className={`crest-medallion${image ? " crest-medallion-image" : ""}${className ? ` ${className}` : ""}`} aria-label={label}>
      {image ? <img src={image} alt="" /> : <span>{initial}</span>}
    </span>
  );
}

function DetailLink({ entry, children, className }: { entry: DetailEntry; children: ReactNode; className: string }) {
  const href = getDetailPath(entry);
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

function AuthPanel({
  mode,
  onModeChange,
  onClose,
  isModal = false,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose?: () => void;
  isModal?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newsletter, setNewsletter] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const isSignup = mode === "signup";

  useEffect(() => {
    const firstField = panelRef.current?.querySelector<HTMLInputElement>("input");
    firstField?.focus();
  }, [mode]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (isSignup && !termsAccepted) {
      setMessage("Accept the Terms & Conditions and Privacy Policy to join the League.");
      return;
    }

    // TODO: Replace placeholder handlers with real email/password auth endpoints and post-auth redirect.
    setMessage(
      isSignup
        ? "TODO: registration endpoint is not connected yet. Post-signup destination still needs confirmation."
        : "TODO: login endpoint is not connected yet.",
    );
  }

  function handleSocial(provider: string) {
    // TODO: Confirm final OAuth provider list and redirect/callback URLs before wiring OAuth.
    setMessage(`TODO: ${provider} OAuth is not connected yet.`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isModal) {
      return;
    }
    if (event.key === "Escape") {
      onClose?.();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      return;
    }
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

  return (
    <div className="auth-scroll-frame" ref={panelRef} onKeyDown={handleKeyDown}>
      <div className="auth-rod auth-rod-top" aria-hidden="true" />
      <div className="auth-rod auth-rod-bottom" aria-hidden="true" />
      <span className="auth-finial auth-finial-top-left" aria-hidden="true" />
      <span className="auth-finial auth-finial-top-right" aria-hidden="true" />
      <span className="auth-finial auth-finial-bottom-left" aria-hidden="true" />
      <span className="auth-finial auth-finial-bottom-right" aria-hidden="true" />
      <div className="auth-tab-toggle" role="tablist" aria-label="Auth mode">
        <button className={mode === "login" ? "active" : ""} type="button" onClick={() => onModeChange("login")}>
          Log In
        </button>
        <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => onModeChange("signup")}>
          Sign Up
        </button>
      </div>
      <div className="auth-meander auth-meander-top" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-corner auth-corner-tl" aria-hidden="true" />
        <div className="auth-corner auth-corner-tr" aria-hidden="true" />
        <div className="auth-corner auth-corner-bl" aria-hidden="true" />
        <div className="auth-corner auth-corner-br" aria-hidden="true" />
        {onClose ? (
          <button className="auth-close" type="button" onClick={onClose} aria-label="Close authentication panel">
            ×
          </button>
        ) : null}
        <div className="auth-card-inner" role={isModal ? "dialog" : undefined} aria-modal={isModal || undefined} aria-labelledby="auth-title">
          <p className="auth-brandline">The League of Massalia</p>
          <h1 id="auth-title">{isSignup ? "Join the League" : "Enter the League"}</h1>
          <p className="auth-subtitle">
            {isSignup ? "Choose a city. Pledge a House. Make your name." : "Your city awaits your return."}
          </p>

          <div className="auth-social-row" aria-label="Social sign in">
            {["Discord", "Google", "Facebook"].map((provider) => (
              <button key={provider} type="button" onClick={() => handleSocial(provider)}>
                <span aria-hidden="true">{provider[0]}</span>
                {provider}
              </button>
            ))}
          </div>

          <div className="auth-divider"><span>or</span></div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              <span>Email</span>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="Email address"
                required
              />
              <i aria-hidden="true">✉</i>
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="Password"
                minLength={8}
                required
              />
              <i aria-hidden="true">▣</i>
            </label>

            {isSignup ? (
              <div className="auth-checks">
                <label>
                  <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
                  <span>Send me season updates and League dispatches.</span>
                </label>
                <label>
                  <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} required />
                  <span>
                    I accept the <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Policy</a>.
                  </span>
                </label>
              </div>
            ) : null}

            {message ? <p className="auth-message" role="status">{message}</p> : null}

            <button className="primary-cta auth-submit" type="submit" disabled={isSignup && !termsAccepted}>
              {isSignup ? "Sign up & play free" : "Log in"}
            </button>
          </form>

          {!isSignup ? <a className="auth-forgot" href="/forgot-password">Forgot your password?</a> : null}

          <p className="auth-switch">
            {isSignup ? "Already a citizen?" : "New to the League?"}{" "}
            <button type="button" onClick={() => onModeChange(isSignup ? "login" : "signup")}>
              {isSignup ? "Enter the League" : "Found your legacy"} →
            </button>
          </p>
        </div>
      </div>
      <div className="auth-meander auth-meander-bottom" aria-hidden="true" />
    </div>
  );
}

function AuthModal({ mode, onModeChange, onClose }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void; onClose: () => void }) {
  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <div className="auth-modal-shell" onMouseDown={(event) => event.stopPropagation()}>
        <AuthPanel mode={mode} onModeChange={onModeChange} onClose={onClose} isModal />
      </div>
    </div>
  );
}

function AuthRoutePage({ mode }: { mode: AuthMode }) {
  return (
    <main className="landing-shell auth-page-shell">
      <AuthPanel mode={mode} onModeChange={(nextMode) => navigateTo(`/${nextMode}`)} />
    </main>
  );
}

function DetailPage({ entry, onStart, onOpenAuth }: { entry: DetailEntry; onStart: () => void; onOpenAuth: (mode: AuthMode) => void }) {
  const emblem = "image" in entry ? entry.image : undefined;
  const ctaText =
    entry.kind === "house"
      ? `Pledge to ${entry.name}`
      : entry.kind === "party"
        ? `Join the ${entry.name}`
        : entry.kind === "profession"
          ? "Choose this path"
          : "Begin here";

  return (
    <main className="landing-shell detail-shell">
      <nav className="landing-nav" aria-label="Main">
        <button className="brand-lockup" type="button" onClick={() => navigateTo("/")}>
          <span className="brand-mark" aria-hidden="true">
            <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </span>
          <span>MASSALIA</span>
        </button>
        <div className="nav-primary-links" aria-label="Landing sections">
          <a href="/#world">The World</a>
          <a href="/#factions">Factions</a>
          <a href="/#atlas">Atlas</a>
        </div>
        <div className="nav-actions">
          <button className="nav-button nav-login" type="button" onClick={() => onOpenAuth("login")}>Login</button>
          <button className="nav-button nav-signup" type="button" onClick={() => onOpenAuth("signup")}>Sign Up</button>
        </div>
      </nav>

      <section className="detail-hero">
        <button className="back-link" type="button" onClick={() => navigateTo("/")}>Back to landing</button>
        <div className="detail-heading">
          <Crest initial={entry.initial} image={emblem} label={`${entry.name} ${emblem ? "emblem" : "generic crest"}`} />
          <div>
            <p className="section-eyebrow">{entry.kind}</p>
            <h1>{entry.name}</h1>
            <p className="placeholder-note">{emblem ? "Official emblem." : "Generic crest — swap real logo."}</p>
          </div>
        </div>
        <DetailBody entry={entry} />
        {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. */}
        <button className="primary-cta" type="button" onClick={onStart}>{ctaText}</button>
      </section>
      <LandingFooter />
    </main>
  );
}

function DetailBody({ entry }: { entry: DetailEntry }) {
  if (entry.kind === "profession") {
    return (
      <div className="detail-grid">
        <article className="detail-panel">
          <h2>Objective</h2>
          <p>{entry.objective}</p>
          <p><strong>Starting income:</strong> {entry.income}</p>
          <p><strong>Cost to start:</strong> 100 gold</p>
          <p>{entry.note}</p>
        </article>
        <article className="detail-panel">
          <h2>Four-tier ladder</h2>
          <ol className="tier-list">
            {entry.tiers.map((tier) => (
              <li key={tier.building}>
                <strong>{tier.building}</strong>
                <span>{tier.rank}</span>
                <p>{tier.benefit}{tier.upkeep ? `; upkeep ${tier.upkeep}` : ""}</p>
              </li>
            ))}
          </ol>
        </article>
      </div>
    );
  }

  if (entry.kind === "house") {
    return (
      <div className="detail-grid">
        <article className="detail-panel">
          <h2>{entry.stance}</h2>
          <p className="party-motto">"{entry.motto}"</p>
          <p><strong>Patron deity:</strong> {entry.patron}</p>
          <p><strong>Famous ancestor:</strong> {entry.ancestor}</p>
          <p><strong>Crest:</strong> {entry.crest}</p>
        </article>
        <article className="detail-panel">
          <h2>House memory</h2>
          <p>{entry.history}</p>
          <p><strong>Defining moment:</strong> {entry.moment}</p>
        </article>
      </div>
    );
  }

  if (entry.kind === "party") {
    return (
      <div className="detail-grid">
        <article className={`detail-panel ${entry.slug}-detail`}>
          <h2>{entry.title}</h2>
          <p className="party-motto">"{entry.motto}"</p>
          <p><strong>Formed:</strong> {entry.formed}</p>
          <p><strong>{entry.stipend}</strong></p>
        </article>
        <article className="detail-panel">
          <h2>Ideology</h2>
          <p><strong>Who they are:</strong> {entry.who}</p>
          <p><strong>What they want:</strong> {entry.wants}</p>
          <p>{entry.influence}</p>
        </article>
      </div>
    );
  }

  return (
    <div className="detail-grid">
      <article className="detail-panel">
        <h2>{entry.capital ? "Capital city" : "Shared city hub"}</h2>
        <p><strong>Resource:</strong> {entry.resource}</p>
        <p>{entry.flavor}</p>
      </article>
      <article className="detail-panel">
        <h2>How cities work</h2>
        <p>Cities are shared player hubs. You join a city, build your role inside it, and contest its politics with other citizens rather than owning it alone.</p>
        <p className="todo-note">TODO: confirm whether map-level competition exists, such as Houses or parties contesting cities, or League conflicts with rivals.</p>
      </article>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="footer-brand">MASSALIA</div>
      <nav aria-label="Legal">
        <a href="#discord">Discord</a>
        <a href="#lore">Lore</a>
        <a href="#map">Map</a>
        <a href="#support">Support</a>
      </nav>
      <small>© 320 BC – MMXXVI · THE LEAGUE OF MASSALIA</small>
    </footer>
  );
}

function getDetailEntry(pathname: string): DetailEntry | undefined {
  const segments = pathname.split("/");
  const collectionName = segments[1];
  const slug = segments[2];
  if (!collectionName || !slug || !(collectionName in detailCollections)) {
    return undefined;
  }
  return detailCollections[collectionName as keyof typeof detailCollections].find((entry) => entry.slug === slug);
}

export function App() {
  const [view, setView] = useState<"landing" | "map">("landing");
  const [pathname, setPathname] = useState(window.location.pathname);
  const [authModalMode, setAuthModalMode] = useState<AuthMode | null>(null);
  const detailEntry = getDetailEntry(pathname);
  const authRouteMode: AuthMode | undefined = pathname === "/login" ? "login" : pathname === "/signup" ? "signup" : undefined;
  const palaioi = parties[0]!;
  const dynatoi = parties[1]!;

  useEffect(() => {
    const handleRoute = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handleRoute);
    return () => window.removeEventListener("popstate", handleRoute);
  }, []);

  const openAuth = (mode: AuthMode) => setAuthModalMode(mode);
  const closeAuth = () => setAuthModalMode(null);
  const startGame = () => openAuth("signup");

  if (view === "map") {
    return (
      <main className="app-shell game-view">
        <section className="topbar">
          <strong>MASSALIA</strong>
          <button className="nav-button compact" type="button" onClick={() => setView("landing")}>
            Campaigns
          </button>
        </section>
        <MapCanvas />
      </main>
    );
  }

  if (authRouteMode) {
    return <AuthRoutePage mode={authRouteMode} />;
  }

  if (detailEntry) {
    return (
      <>
        <DetailPage entry={detailEntry} onStart={startGame} onOpenAuth={openAuth} />
        {authModalMode ? <AuthModal mode={authModalMode} onModeChange={setAuthModalMode} onClose={closeAuth} /> : null}
      </>
    );
  }

  return (
    <main className="landing-shell">
      <section className="landing-hero" aria-label="Massalia campaign launch">
        <nav className="landing-nav" aria-label="Main">
          <button className="brand-lockup" type="button" onClick={() => navigateTo("/")}>
            <span className="brand-mark" aria-hidden="true">
              <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
            </span>
            <span>MASSALIA</span>
          </button>
          <div className="nav-primary-links" aria-label="Landing sections">
            <a href="#world">The World</a>
            <a href="#roles">Professions</a>
            <a href="#atlas">Atlas</a>
            <a href="#factions">Factions</a>
          </div>
          <div className="nav-actions">
            <button className="nav-button nav-login" type="button" onClick={() => openAuth("login")}>Login</button>
            <button className="nav-button nav-signup" type="button" onClick={() => openAuth("signup")}>Sign Up</button>
          </div>
        </nav>

        <section className="hero-content" aria-label="Massalia overview">
          <div className="hero-copy">
            <p className="hero-eyebrow">
              <span className="live-pulse" aria-hidden="true" />
              Free Browser Strategy Game
            </p>
            <p className="hero-lead">4th Century BC · The League Of</p>
            <h1>Massalia</h1>
            <p className="hero-subline">Founded by Phocaean Greeks. Forged by ten cities. Ruled by whoever dares.</p>
            <p className="hero-logline">
              Join one of ten cities, each with its own resource. Join a Noble House, take a side between the old guard
              and the reformers, and trade, scheme, and ally your way to the head of the western Mediterranean&apos;s
              greatest confederation.
            </p>
            <div className="hero-actions">
              {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. The "Play free in your browser" microcopy may also need to change. */}
              <button className="primary-cta" type="button" onClick={startGame}>Start The Game</button>
              <p className="cta-note">No download. Play free in your browser.</p>
            </div>
            <dl className="stat-row" aria-label="Live game status">
              <div><dt>Cities to join</dt><dd>{landingStats.cities}</dd></div>
              <div><dt>Noble Houses</dt><dd>{landingStats.houses}</dd></div>
              <div><dt>{landingStats.seasonLabel}</dt><dd>{landingStats.seasonStatus}</dd></div>
            </dl>
            <p className="todo-note">TODO: wire real live-player count, season length, and countdown when available.</p>
          </div>
          <div className="hero-art-focus" aria-hidden="true">
            <img className="hero-lion" src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </div>
        </section>
      </section>

      <section className="landing-section pillars-section" id="world" aria-labelledby="pillars-title">
        <p className="section-eyebrow">What You Do</p>
        <h2 id="pillars-title">Three choices that shape your game</h2>
        <div className="pillar-grid">
          <article className="pillar-card">
            <span className="pillar-kicker">I · Settle</span>
            <h3>Join a City &amp; Resource</h3>
            <p>Choose your city among the ten, each defined by its resource: tin, marble, horses, and more.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">II · Master a Role</span>
            <h3>Choose a Profession</h3>
            <p>Become a trader, landowner, shipbuilder, priest, philosopher, hetaira, or military leader.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">III · Scheme</span>
            <h3>House &amp; Politics</h3>
            <p>Pledge to a Noble House, side with Palaioi or Dynatoi, and win the Archonship.</p>
          </article>
        </div>
      </section>

      <section className="landing-section roles-section" id="roles" aria-labelledby="roles-title">
        <p className="section-eyebrow">Professions</p>
        <h2 id="roles-title">Seven paths to power</h2>
        <div className="tile-grid">
          {professions.map((profession) => (
            <DetailLink className="landing-tile" entry={profession} key={profession.slug}>
              <Crest initial={profession.initial} label={`${profession.name} generic crest`} />
              <span className="tile-kicker">{profession.rank}</span>
              <h3>{profession.name}</h3>
              <p>{profession.income}</p>
            </DetailLink>
          ))}
        </div>
      </section>

      <section className="landing-section atlas-section" id="atlas" aria-labelledby="atlas-title">
        <div className="atlas-copy">
          <p className="section-eyebrow">Atlas</p>
          <h2 id="atlas-title">The cities of the League</h2>
          <p>Ten Phocaean cities hold the western sea together. Each is a shared player hub with a resource worth fighting over politically, economically, and socially.</p>
          <div className="city-list" aria-label="League cities and resources">
            {leagueCities.map((city) => (
              <DetailLink className="city-item" entry={city} key={city.name}>
                <span>{city.capital ? "★ " : ""}{city.name}</span>
                <strong>{city.resource}</strong>
              </DetailLink>
            ))}
          </div>
          <p className="todo-note">TODO: confirm whether map-level competition exists, such as Houses or parties contesting cities, or League conflicts with rivals.</p>
        </div>
        <div className="map-frame" role="img" aria-label="League of Massalia atlas map">
          <img src={assetPath("assets/MAP01.jpg")} alt="" />
        </div>
      </section>

      <section className="landing-section government-section" aria-labelledby="government-title">
        <p className="section-eyebrow">Government</p>
        <h2 id="government-title">The seats of government</h2>
        <div className="office-grid">
          {offices.map((office) => (
            <article className="office-card" key={office.title}>
              <span className="tile-kicker">{office.type}</span>
              <h3>{office.title}</h3>
              <p>{office.description}</p>
              <strong>{office.pay}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section parties-section" aria-labelledby="parties-title">
        <p className="section-eyebrow">Assembly</p>
        <h2 id="parties-title">Tradition, or reform?</h2>
        <div className="party-duel">
          <DetailLink className="party-card palaioi-card" entry={palaioi}>
            <Crest className="party-watermark" initial={palaioi.initial} image={palaioi.image} label="Palaioi emblem" />
            <div className="party-copy">
              <p className="party-script">{palaioi.script} · {palaioi.name}</p>
              <h3>{palaioi.title}</h3>
              <p className="party-motto">"{palaioi.motto}"</p>
              <p>{palaioi.who}</p>
              <p>{palaioi.wants}</p>
            </div>
          </DetailLink>
          <span className="vs-medallion" aria-hidden="true">VS</span>
          <DetailLink className="party-card dynatoi-card" entry={dynatoi}>
            <Crest className="party-watermark" initial={dynatoi.initial} image={dynatoi.image} label="Dynatoi emblem" />
            <div className="party-copy">
              <p className="party-script">{dynatoi.script} · {dynatoi.name}</p>
              <h3>{dynatoi.title}</h3>
              <p className="party-motto">"{dynatoi.motto}"</p>
              <p>{dynatoi.who}</p>
              <p>{dynatoi.wants}</p>
            </div>
          </DetailLink>
        </div>
      </section>

      <section className="houses-section" id="factions" aria-label="Ten Noble Houses">
        <div className="houses-heading">
          <span className="section-eyebrow">Factions</span>
          <h2>Ten Noble Houses</h2>
        </div>
        <div className="alignment-legend" aria-label="Alignment legend">
          <span><i className="alignment-dot conservative" /> Conservative</span>
          <span><i className="alignment-dot centrist" /> Centrist</span>
          <span><i className="alignment-dot reformist" /> Reformist</span>
        </div>
        <div className="house-tile-grid">
          {nobleHouses.map((house) => (
            <DetailLink className="house-tile" entry={house} key={house.name}>
              <Crest initial={house.initial} image={house.image} label={`${house.name} emblem`} />
              <span className="house-align"><i className={`alignment-dot ${house.alignment}`} /> {house.stance}</span>
              <h3>{house.name}</h3>
              <p>{house.motto}</p>
            </DetailLink>
          ))}
        </div>
      </section>

      <section className="closing-cta" aria-label="Start playing Massalia">
        <div>
          <p className="section-eyebrow">Season I now open</p>
          <h2>Enter The League of Massalia</h2>
          <p>No download. Play free in your browser.</p>
        </div>
        {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. The "Play free in your browser" microcopy may also need to change. */}
        <button className="primary-cta" type="button" onClick={startGame}>Start The Game</button>
      </section>

      <LandingFooter />
      {authModalMode ? <AuthModal mode={authModalMode} onModeChange={setAuthModalMode} onClose={closeAuth} /> : null}
    </main>
  );
}
