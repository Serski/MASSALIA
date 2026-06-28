import { z } from "zod";

export type Alignment = "conservative" | "centrist" | "reformist";


export type Tier = {
  building: string;
  rank: string;
  benefit: string;
  upkeep?: string;
};

export type NarrativeMilestone = {
  milestone: string;
  advance: string;
};

export type Profession = {
  kind: "profession";
  slug: string;
  initial: string;
  image: string;
  name: string;
  rank: string;
  objective: string;
  income: string;
  tiers: Tier[];
  note: string;
  hardMode?: boolean;
  narrativePath?: {
    milestones: NarrativeMilestone[];
    todo: string;
  };
};

// A building the player can construct from the Holdings panel. Locked entries
// carry a `requirement` string and are shown disabled until it is met.
export type BuildableBuilding = {
  slug: string;
  name: string;
  icon: string;
  cost: number;
  buildDays: number;
  benefit: string;
  // Present => locked until met. The Holdings panel renders the reason.
  requirement?: string;
};

export type House = {
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

export const professions: Profession[] = [
  {
    kind: "profession",
    slug: "landowner",
    initial: "L",
    image: "assets/LANDLORD copy.png",
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
    image: "assets/TRADER copy.png",
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
    image: "assets/PRIEST copy.png",
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
    image: "assets/PHILOSOPHER copy.png",
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
    image: "assets/SHIP BUILDER copy.png",
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
    image: "assets/HETAIRA copy.png",
    name: "Hetaira",
    rank: "@Hetaira",
    objective: "Turn salons, gossip, and dangerous favors into quiet political force.",
    income: "20 gold/day +5 Intelligence",
    tiers: [
      { building: "Salon", rank: "@Desmoteros", benefit: "30 gold/day; +10 Intelligence" },
      { building: "Courtesan House", rank: "@Pallake", benefit: "40 gold/day; +15 Intelligence" },
      { building: "Luxury Villa", rank: "@Hetairarches", benefit: "50 gold/day; +20 Intelligence; +5% intelligence" },
      { building: "Grand Villa", rank: "@Megalhetaira", benefit: "60 gold/day; +25 Intelligence; +10% intelligence" },
    ],
    note: "All professions cost 100 gold to start. Hetairai craft poisons and gossip spreaders, train Healers, and use the Cloth Factory.",
  },
  {
    kind: "profession",
    slug: "hoplite",
    initial: "M",
    image: "assets/HOPLITE copy.png",
    name: "Hoplite",
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
  {
    kind: "profession",
    slug: "slave",
    initial: "S",
    image: "assets/SLAVE.png",
    name: "Slave",
    rank: "@Doulos",
    objective: "Hard mode. Begin at the very bottom of Massalian society with nothing to your name: no land, no coin, no House. Endure, scrape together a peculium, and earn your freedom through the story, then rise into any profession you choose.",
    income: "0 gold/day · earn your freedom",
    tiers: [],
    note: "Solo hard-mode start. No other player commands this path; freedom is earned through narrative progression.",
    hardMode: true,
    narrativePath: {
      milestones: [
        { milestone: "Bound", advance: "Survive the opening story and learn who holds power around you." },
        { milestone: "Laboring", advance: "Take low-status work, gather favors, and avoid debt traps." },
        { milestone: "Peculium", advance: "Build permitted savings through story choices and small opportunities." },
        { milestone: "Manumitted", advance: "Secure freedom through the narrative arc and become a freedman." },
        { milestone: "Free Citizen", advance: "Choose any profession and begin a normal ladder from the bottom." },
      ],
      todo: "TODO: Final milestone requirements and numeric thresholds are not designed yet.",
    },
  },
];

// TODO: TUNING — placeholder catalog of constructable buildings. Final costs,
// durations, benefits, per-profession availability, and unlock requirements are
// not designed yet. Locked entries (with `requirement`) render disabled.
export const buildableBuildings: BuildableBuilding[] = [
  { slug: "counting-house", name: "Counting House", icon: "💰", cost: 300, buildDays: 7, benefit: "+5% trade income" },
  { slug: "tavern", name: "Tavern", icon: "🍺", cost: 250, buildDays: 5, benefit: "+Favor · hear the harbor's rumors" },
  { slug: "shrine-hermes", name: "Shrine to Hermes", icon: "🏺", cost: 200, buildDays: 4, benefit: "+1 Devotion/day · patron of merchants" },
  { slug: "large-trade-post", name: "Large Trade Post", icon: "🔒", cost: 600, buildDays: 10, benefit: "10 Wine/day; upkeep -10 gold", requirement: "Requires @Emporikos Presbeutes (Tier 2)" },
];

export const nobleHouses: House[] = [
  { kind: "house", slug: "kleitos", initial: "K", image: "assets/Kleitos.png", name: "Kleitos", alignment: "reformist", stance: "Reformist", motto: "Unity in diversity strengthens us.", patron: "Hestia", ancestor: "Agathon Kleitos, 580-517 BC", crest: "Dove with olive branch", history: "Pushed Gaulish integration and a broader League identity.", moment: "Brokered the Accord of Liris in 560 BC." },
  { kind: "house", slug: "miltiades", initial: "M", image: "assets/Mitliades.png", name: "Miltiades", alignment: "reformist", stance: "Mod. Reformist", motto: "Understanding is the foundation of peace.", patron: "Asclepius", ancestor: "Cleisthenes Miltiades, 570-509 BC", crest: "Scroll with Greek and Gaulish symbols", history: "Built its name through diplomacy, interpreters, and patient civic education.", moment: "Founded the first bilingual school around 530 BC." },
  { kind: "house", slug: "xanthippos", initial: "X", image: "assets/Xanthipos.png", name: "Xanthippos", alignment: "centrist", stance: "Centrist", motto: "Harmony through balance.", patron: "Iris", ancestor: "Damon Xanthippos, 550-492 BC", crest: "Scale with helmet and torque", history: "Mediator family trusted by merchants, soldiers, Greeks, and Gauls.", moment: "Secured the Treaty of Metron in 490 BC." },
  { kind: "house", slug: "iason", initial: "I", image: "assets/Iason.png", name: "Iason", alignment: "conservative", stance: "Centrist to Conservative", motto: "Navigate the old, embrace the new.", patron: "Proteus", ancestor: "Periander Iason, 530-475 BC", crest: "Galley with oars", history: "Sea-facing house that keeps old forms while testing foreign routes.", moment: "Led the Iberian trade expedition in 450 BC." },
  { kind: "house", slug: "timon", initial: "T", image: "assets/Timon.png", name: "Timon", alignment: "conservative", stance: "Conservative", motto: "Preserve the arts, sustain the soul.", patron: "Erato", ancestor: "Theodorus Timon, 560-491 BC", crest: "Greek lyre", history: "Patrons of festivals, poetry, and old Hellenic rites.", moment: "Held the first festival to the Greek gods in 420 BC." },
  { kind: "house", slug: "aristeides", initial: "A", image: "assets/Aristeides.png", name: "Aristeides", alignment: "centrist", stance: "Centrist", motto: "Defend and respect all borders.", patron: "Nike", ancestor: "Leon Aristeides, 540-478 BC", crest: "Shield and crossed spear", history: "Border defenders who value discipline more than factional purity.", moment: "Distinguished itself at the Battle of the Rhone in 460 BC." },
  { kind: "house", slug: "herakleides", initial: "H", image: "assets/Herakleides.png", name: "Herakleides", alignment: "conservative", stance: "Mod. Conservative", motto: "Justice adapts, principles endure.", patron: "Themis", ancestor: "Myron Herakleides, 560-512 BC", crest: "Stone tablet and stylus", history: "Legalist house that guards old institutions while accepting measured reforms.", moment: "Revised the legal code in 480 BC." },
  { kind: "house", slug: "nicanor", initial: "N", image: "assets/Nicanor.png", name: "Nicanor", alignment: "reformist", stance: "Mod. Reformist", motto: "Through the seas, we find our stars.", patron: "Tyche", ancestor: "Eumenes Nicanor, 520-481 BC", crest: "Celestial sphere", history: "Navigators, chance-takers, and long-distance traders.", moment: "Reached Britannia by the stars in 510 BC." },
  { kind: "house", slug: "philon", initial: "P", image: "assets/Philon.png", name: "Philon", alignment: "reformist", stance: "Reformist to Centrist", motto: "Healing hands, merging wisdom.", patron: "Panacea", ancestor: "Chrysippus Philon, 550-492 BC", crest: "Serpent on staff", history: "Medical house blending Greek technique with Gaulish herbal knowledge.", moment: "Opened the first Greek and Gaulish clinic around 550 BC." },
  { kind: "house", slug: "leonidas", initial: "L", image: "assets/Leonidas.png", name: "Leonidas", alignment: "conservative", stance: "Very Conservative", motto: "In tradition, we trust.", patron: "Aeolus", ancestor: "Alexandros Leonidas, 600-528 BC", crest: "Roaring lion", history: "Old aristocratic house committed to pure Hellenic continuity.", moment: "Built the temple of Apollo in 600 BC." },
];

// ---------------------------------------------------------------------------
// World-state data layers (Atlas Phase 2a): the nine League colonies and the
// nineteen neighbouring factions. Content carries the STABLE ids, display names,
// grouping, and the seeded starting values; current per-world values live in DB
// (league_cities / faction_relations), seeded from these defaults on first read.
// Values are static this phase — no growth, drift, or accrual (that is 2b).
// ---------------------------------------------------------------------------

// --- The diplomatic stance scale (7 rungs, war .. allied) -------------------
// Stored as the string id for stability; the numeric ordering belongs here, not
// in the data, so the scale can be reordered/extended without rewriting content.
export const STANCE_SCALE = [
  { id: "war", value: -3, label: "War" },
  { id: "hostile", value: -2, label: "Hostile" },
  { id: "unfriendly", value: -1, label: "Unfriendly" },
  { id: "neutral", value: 0, label: "Neutral" },
  { id: "friendly", value: 1, label: "Friendly" },
  { id: "cordial", value: 2, label: "Cordial" },
  { id: "allied", value: 3, label: "Allied" },
] as const;

export type StanceId = (typeof STANCE_SCALE)[number]["id"];
export type StanceMeta = { id: StanceId; value: number; label: string };

// A non-empty tuple of the ids, for z.enum and exhaustive iteration.
export const STANCE_IDS = STANCE_SCALE.map((s) => s.id) as [StanceId, ...StanceId[]];

const STANCE_BY_ID = new Map<StanceId, StanceMeta>(STANCE_SCALE.map((s) => [s.id, s]));

export function stanceMeta(id: StanceId): StanceMeta {
  const meta = STANCE_BY_ID.get(id);
  if (!meta) throw new Error(`Unknown diplomatic stance: ${id}`);
  return meta;
}

// The numeric rung of a stance (war = -3 .. allied = +3) — for ordering/colour.
export function stanceValue(id: StanceId): number {
  return stanceMeta(id).value;
}

function assertUniqueIds(ids: string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${kind} id: ${id}`);
    seen.add(id);
  }
}

// --- League cities ----------------------------------------------------------

export const CITY_GROUPS = ["metropolis", "eastern", "western"] as const;
export type CityGroup = (typeof CITY_GROUPS)[number];

const cityStartSchema = z
  .object({
    population: z.number().int().nonnegative(),
    tax: z.number().int().nonnegative(),
    stability: z.number().int().min(0).max(100),
    fortifications: z.number().int().min(1).max(5),
    garrison: z.number().int().nonnegative(),
  })
  .strict();

const citySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    group: z.enum(CITY_GROUPS),
    start: cityStartSchema,
  })
  .strict();

export const citiesContentSchema = z.object({ cities: z.array(citySchema).min(1) }).strict();

export type CityStart = z.infer<typeof cityStartSchema>;
export type CityDef = z.infer<typeof citySchema>;
export type CitiesContent = z.infer<typeof citiesContentSchema>;

export function parseCitiesContent(data: unknown): CitiesContent {
  const parsed = citiesContentSchema.parse(data);
  assertUniqueIds(parsed.cities.map((c) => c.id), "city");
  return parsed;
}

// --- Diplomacy factions -----------------------------------------------------

export const FACTION_GROUPS = ["gauls", "celto-ligurian", "ligurian", "aquitani", "iberian", "major-powers"] as const;
export type FactionGroup = (typeof FACTION_GROUPS)[number];

const factionStartSchema = z
  .object({
    stance: z.enum(STANCE_IDS),
    vassal: z.boolean(),
  })
  .strict();

const factionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    group: z.enum(FACTION_GROUPS),
    start: factionStartSchema,
  })
  .strict();

export const factionsContentSchema = z.object({ factions: z.array(factionSchema).min(1) }).strict();

export type FactionStart = z.infer<typeof factionStartSchema>;
export type FactionDef = z.infer<typeof factionSchema>;
export type FactionsContent = z.infer<typeof factionsContentSchema>;

export function parseFactionsContent(data: unknown): FactionsContent {
  const parsed = factionsContentSchema.parse(data);
  assertUniqueIds(parsed.factions.map((f) => f.id), "faction");
  return parsed;
}

// --- League city drift (Atlas Phase 2b-i): gentle once-per-game-year growth ---
// Cities evolve slowly over time. Constants are deliberately small and named here
// so they are trivially tunable (balance deferred to evidence). Diplomacy stances
// do NOT drift this phase; only cities. Pure + DB-free so it is unit-tested.

// +2% population per game year (rounded) — larger cities gain more in absolute terms.
export const CITY_POP_GROWTH = 0.02;
// +2% garrison per game year (rounded) — gentle creep alongside population.
export const CITY_GARRISON_GROWTH = 0.02;
// Stability drifts toward this baseline so it self-settles rather than runs away.
export const CITY_STABILITY_BASELINE = 70;
// ±1 per game year toward the baseline (capped so it never overshoots).
export const CITY_STABILITY_STEP = 1;

export type CityDriftStats = {
  population: number;
  tax: number;
  stability: number;
  fortifications: number;
  garrison: number;
};

// One pure once-per-year drift step. Idempotent via lastGrowthYear: if the city
// has already grown in (or after) `currentYear`, it is returned unchanged. A city
// that is behind grows exactly one step (it does NOT replay every missed year —
// it jumps to the current year) and the caller stamps lastGrowthYear = currentYear.
// tax is left FLAT (it is not a function of population — content ratios vary
// 3.3%–12%); fortifications NEVER auto-grow (1..5, Archon-upgraded in a later phase).
export function driftCity(
  city: CityDriftStats & { lastGrowthYear: number | null },
  currentYear: number,
): { changed: boolean; next: CityDriftStats & { lastGrowthYear: number | null } } {
  if (city.lastGrowthYear !== null && city.lastGrowthYear >= currentYear) {
    return { changed: false, next: { ...city } };
  }
  let stability = city.stability;
  if (stability < CITY_STABILITY_BASELINE) {
    stability = Math.min(CITY_STABILITY_BASELINE, stability + CITY_STABILITY_STEP);
  } else if (stability > CITY_STABILITY_BASELINE) {
    stability = Math.max(CITY_STABILITY_BASELINE, stability - CITY_STABILITY_STEP);
  }
  return {
    changed: true,
    next: {
      population: Math.round(city.population * (1 + CITY_POP_GROWTH)),
      tax: city.tax, // flat — not derived from population
      stability,
      fortifications: city.fortifications, // never auto-grows
      garrison: Math.round(city.garrison * (1 + CITY_GARRISON_GROWTH)),
      lastGrowthYear: currentYear,
    },
  };
}

// --- World-scoped event-effect verbs (Atlas Phase 2b-ii) --------------------
// Pure, trigger-agnostic helpers shared by the player-event resolver now and a
// future autonomous world tick. They take the target's CURRENT value plus a
// delta and return the clamped new value — they do NOT know who or what caused
// the change (the target is always explicit at the call site).

// The city stats an event may move. fortifications is deliberately EXCLUDED
// (1..5, Archon-upgraded in a later phase) — events never touch it.
export type CityStat = "population" | "tax" | "stability" | "garrison";

// Apply a delta to a city stat, clamped sensibly: stability is bounded 0..100;
// population/tax/garrison floor at 0 (never negative). Integer-rounded to match
// the integer columns.
export function applyCityStat(stat: CityStat, current: number, amount: number): number {
  const raw = Math.round(current + amount);
  if (stat === "stability") return Math.max(0, Math.min(100, raw));
  return Math.max(0, raw);
}

const STANCE_MIN_VALUE = Math.min(...STANCE_SCALE.map((s) => s.value));
const STANCE_MAX_VALUE = Math.max(...STANCE_SCALE.map((s) => s.value));
const STANCE_BY_VALUE = new Map<number, StanceId>(STANCE_SCALE.map((s) => [s.value, s.id]));

// Shift a stance by a signed (integer) number of rungs along the war..allied
// scale, clamped to the ends. e.g. shiftStance("neutral", 2) === "cordial";
// shiftStance("allied", 5) === "allied".
export function shiftStance(current: StanceId, amount: number): StanceId {
  const next = Math.max(STANCE_MIN_VALUE, Math.min(STANCE_MAX_VALUE, stanceValue(current) + Math.round(amount)));
  return STANCE_BY_VALUE.get(next)!;
}
