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

// The landing "View rank ladder" panels (apps/web/src/App.tsx) render this array
// verbatim, so the numbers here MUST track the live game data. They are hand-synced
// (not imported) from three sources — content JSON is loaded at runtime via fs and
// this package compiles with rootDir "src", so a static cross-root JSON import would
// break both the tsc and the server build. Re-sync when any of these change:
//   • content/buildings/buildings.json  — the six class buildings' tier names, rank
//     handles, base income (dr/day at tier 1) and goods yields.
//   • content/military/ranks.json       — the hoplite's four army ranks (no buildings).
//   • packages/shared/src/buildings.ts  — the curve: income/goods scale by
//     YIELD_GROWTH (1.8) per tier; UPKEEP = [0,1,3,6] dr/day. Incomes are rounded to
//     whole drachmae and goods via formatPerDay, matching the dashboard's display.
export const professions: Profession[] = [
  {
    kind: "profession",
    slug: "landowner",
    initial: "L",
    image: "assets/LANDLORD copy.png",
    name: "Landowner",
    rank: "@Georgos",
    objective: "Turn fields and estates into the grain engine of your city.",
    income: "6 dr/day; 6 Wheat/day",
    tiers: [
      { building: "Farmstead", rank: "@Georgos", benefit: "6 dr/day; 6 Wheat/day" },
      { building: "Olive Groves", rank: "@Ktematias", benefit: "11 dr/day; 11 Wheat/day", upkeep: "1 dr/day" },
      { building: "Great Estate", rank: "@Protogeorgos", benefit: "19 dr/day; 19 Wheat/day; 2 Olive Oil/day", upkeep: "3 dr/day" },
      { building: "Chōra (Χώρα)", rank: "@Mega Georgos", benefit: "35 dr/day; 35 Wheat/day; 4 Olive Oil/day", upkeep: "6 dr/day" },
    ],
    note: "Every free class starts with 150 dr. Wheat is roughly 3 dr/unit; Landowners can use the Forge.",
  },
  {
    kind: "profession",
    slug: "trader",
    initial: "T",
    image: "assets/TRADER copy.png",
    name: "Trader",
    rank: "@Kapelos",
    objective: "Move wine, rare resources, and influence across the Mediterranean routes.",
    income: "10 dr/day",
    tiers: [
      { building: "Market Stall", rank: "@Kapelos", benefit: "10 dr/day" },
      { building: "Counting House", rank: "@Emporos", benefit: "17 dr/day; 2 Wine/day", upkeep: "1 dr/day" },
      { building: "Trade House", rank: "@Naukleros", benefit: "31 dr/day; 4 Wine/day", upkeep: "3 dr/day" },
      { building: "Emporion of the West", rank: "@Megemporos", benefit: "56 dr/day; 6 Wine/day", upkeep: "6 dr/day" },
    ],
    note: "Every free class starts with 150 dr. Wine is roughly 5 dr/unit; trade ports unlock rare resources.",
  },
  {
    kind: "profession",
    slug: "priest",
    initial: "P",
    image: "assets/PRIEST copy.png",
    name: "Priest",
    rank: "@Neokoros",
    objective: "Convert devotion, healing, and ritual authority into civic power.",
    income: "7 dr/day; 4 Herbs/day",
    tiers: [
      { building: "Roadside Shrine", rank: "@Neokoros", benefit: "7 dr/day; 4 Herbs/day" },
      { building: "Temple Precinct", rank: "@Hiereus", benefit: "13 dr/day; 7 Herbs/day", upkeep: "1 dr/day" },
      { building: "Sanctuary of Artemis", rank: "@Archiereus", benefit: "23 dr/day; 13 Herbs/day", upkeep: "3 dr/day" },
      { building: "Oracle Seat", rank: "@Hierophantes", benefit: "42 dr/day; 23 Herbs/day", upkeep: "6 dr/day" },
    ],
    note: "Every free class starts with 150 dr. Herbs are roughly 5 dr/unit; Priests train Healers. One Healer restores 10 troops.",
  },
  {
    kind: "profession",
    slug: "philosopher",
    initial: "F",
    image: "assets/PHILOSOPHER copy.png",
    name: "Philosopher",
    rank: "@Sophistes",
    objective: "Build schools, prestige, and diplomatic leverage through learning.",
    income: "11 dr/day",
    tiers: [
      { building: "Stoa Corner", rank: "@Sophistes", benefit: "11 dr/day" },
      { building: "Private School", rank: "@Didaskalos", benefit: "19 dr/day", upkeep: "1 dr/day" },
      { building: "Academy", rank: "@Scholarches", benefit: "35 dr/day", upkeep: "3 dr/day" },
      { building: "The Lyceum", rank: "@Philosophos", benefit: "63 dr/day", upkeep: "6 dr/day" },
    ],
    note: "Every free class starts with 150 dr. Philosophers craft prestige items through the Cloth Factory and gain +10% diplomatic missions.",
  },
  {
    kind: "profession",
    slug: "shipbuilder",
    initial: "S",
    image: "assets/SHIP BUILDER copy.png",
    name: "Shipbuilder",
    rank: "@Naupegos",
    objective: "Own the dockyards that decide who can trade, raid, and cross the sea.",
    income: "8 dr/day; 1 Naval Supplies/day",
    tiers: [
      { building: "Boat Shed", rank: "@Naupegos", benefit: "8 dr/day; 1 Naval Supplies/day" },
      { building: "Slipway", rank: "@Architekton", benefit: "15 dr/day; 2 Naval Supplies/day", upkeep: "1 dr/day" },
      { building: "Small Shipyard", rank: "@Nauarchos", benefit: "27 dr/day; 3 Naval Supplies/day", upkeep: "3 dr/day" },
      { building: "Great Shipyard", rank: "@Meganaupegos", benefit: "49 dr/day; 6 Naval Supplies/day", upkeep: "6 dr/day" },
    ],
    note: "Every free class starts with 150 dr. Shipbuilders craft naval supplies, sailors, and ships, and research new ship types.",
  },
  {
    kind: "profession",
    slug: "hetaira",
    initial: "H",
    image: "assets/HETAIRA copy.png",
    name: "Hetaira",
    rank: "@Auletris",
    objective: "Turn salons, gossip, and dangerous favors into quiet political force.",
    income: "11 dr/day",
    tiers: [
      { building: "Rented Rooms", rank: "@Auletris", benefit: "11 dr/day" },
      { building: "The Salon", rank: "@Hetaira", benefit: "19 dr/day", upkeep: "1 dr/day" },
      { building: "House of Muses", rank: "@Megale Hetaira", benefit: "35 dr/day", upkeep: "3 dr/day" },
      { building: "The Symposion Court", rank: "@Despoina", benefit: "63 dr/day", upkeep: "6 dr/day" },
    ],
    note: "Every free class starts with 150 dr. Hetairai craft poisons and gossip spreaders, train Healers, and use the Cloth Factory.",
  },
  {
    kind: "profession",
    slug: "hoplite",
    initial: "M",
    image: "assets/HOPLITE copy.png",
    name: "Hoplite",
    rank: "@Stratiotes",
    objective: "Command citizen soldiers and grow from local captain to League warlord.",
    income: "8 dr/day",
    tiers: [
      { building: "Recruit", rank: "@Stratiotes", benefit: "8 dr/day" },
      { building: "Veteran", rank: "@Epilektos", benefit: "16 dr/day; +1 militia/day; needs 15 Militia, 10 Prestige" },
      { building: "Lochagos", rank: "@Lochagos", benefit: "28 dr/day; +1 militia/day; needs 30 Militia, 25 Prestige" },
      { building: "Archilochagos", rank: "@Archilochagos", benefit: "45 dr/day; +2 militia/day; needs 50 Militia, 45 Prestige" },
    ],
    note: "Every free class starts with 150 dr. Military Leaders craft military traits with wine and papyrus and can use the Forge.",
  },
  {
    kind: "profession",
    slug: "slave",
    initial: "S",
    image: "assets/SLAVE.png",
    name: "Slave",
    rank: "@Doulos",
    objective: "Hard mode. Begin at the very bottom of Massalian society with nothing to your name: no land, no coin, no House. Endure, scrape together a peculium, and earn your freedom through the story, then rise into any profession you choose.",
    income: "0 dr/day · earn your freedom",
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

// --- The diplomatic opinion bar (Diplomacy D1) ------------------------------
// EU4-style numeric relation, −200..+200, that REPLACES the stance value as the
// source of truth. The five middle stances become display bands of this number;
// War (−200) and Allied (+200) are latched status FLAGS (atWar / allied), not
// bands — D1 stores/displays them but never sets them from opinion (a later
// phase adds the war/alliance actions that flip the flag and snap to the edge).
export const OPINION_MIN = -200;
export const OPINION_MAX = 200;

// Display bands over the bar. Edges are deliberately INCLUSIVE of ±200 so an
// event that drives opinion to the extreme still renders a band (Hostile/Cordial)
// even though the war/allied flag is unset — an accepted D1 limitation. The ids
// reuse the matching STANCE_SCALE ids so existing colour-coding keys still work.
export type OpinionBandId = "hostile" | "unfriendly" | "neutral" | "friendly" | "cordial";
export type OpinionBand = { id: OpinionBandId; label: string; min: number; max: number };
export const OPINION_BANDS: readonly OpinionBand[] = [
  { id: "hostile", label: "Hostile", min: -200, max: -76 },
  { id: "unfriendly", label: "Unfriendly", min: -75, max: -16 },
  { id: "neutral", label: "Neutral", min: -15, max: 15 },
  { id: "friendly", label: "Friendly", min: 16, max: 75 },
  { id: "cordial", label: "Cordial", min: 76, max: 200 },
] as const;

// The display band for any opinion value (clamped into range first, so out-of-
// bound inputs still resolve). Pure — used by the route, the event resolver, and
// the UI so the band is computed in exactly one place.
export function opinionBand(opinion: number): { id: OpinionBandId; label: string } {
  const clamped = Math.max(OPINION_MIN, Math.min(OPINION_MAX, Math.round(opinion)));
  // The bands tile the whole −200..+200 range, so a clamped value always matches;
  // the neutral fallback only guards an (impossible) gap to satisfy the type.
  const band = OPINION_BANDS.find((b) => clamped >= b.min && clamped <= b.max);
  return band ? { id: band.id, label: band.label } : { id: "neutral", label: "Neutral" };
}

// Apply a signed delta to an opinion value, clamped to −200..+200 and integer-
// rounded (mirrors applyCityStat). The event effect's `amount` is now POINTS of
// opinion, not rungs of stance.
export function applyOpinion(current: number, amount: number): number {
  return Math.max(OPINION_MIN, Math.min(OPINION_MAX, Math.round(current + amount)));
}

// Map a legacy 7-rung stance id to a starting opinion (the band midpoint, so the
// migration backfill and the content seed produce no visible jump). war/allied
// map to the extremes AND imply the corresponding latched flag (see the 0032
// backfill); the five middle rungs map to their band midpoints.
const STANCE_OPINION_MIDPOINT: Record<StanceId, number> = {
  war: -200,
  hostile: -137,
  unfriendly: -45,
  neutral: 0,
  friendly: 45,
  cordial: 137,
  allied: 200,
};
export function stanceToOpinion(id: StanceId): number {
  return STANCE_OPINION_MIDPOINT[id];
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
    // The source of truth (Diplomacy D1): a −200..+200 opinion bar. The five
    // middle stances are display bands of this number (see opinionBand); War and
    // Allied are latched status flags, not bands.
    opinion: z.number().int().min(OPINION_MIN).max(OPINION_MAX),
    atWar: z.boolean(),
    allied: z.boolean(),
    vassal: z.boolean(),
  })
  .strict();

// --- Faction characters (Diplomacy D3) --------------------------------------
// Rulers, heirs, and war-chiefs are STATIC content. They age once per game year
// (a pure function of the calendar at read time — see liveAge), but never die or
// get succeeded this phase. Stats are 0..100 (shown to the player as raw numbers
// — NPC scouting intel, deliberately unlike the player's rank-only display rule).
export const FACTION_SEXES = ["M", "F"] as const;

const factionStatSchema = z.number().int().min(0).max(100);
// Shared character fields. bornAge is the character's age at world start (year 0);
// live age is derived as bornAge + game-years-elapsed.
const factionCharBase = {
  name: z.string().min(1),
  sex: z.enum(FACTION_SEXES),
  bornAge: z.number().int().min(0).max(120),
  prestige: factionStatSchema,
  devotion: factionStatSchema,
  militia: factionStatSchema,
  intelligence: factionStatSchema,
};

const rulerSchema = z.object({ ...factionCharBase, title: z.string().min(1) }).strict();
const heirSchema = z.object({ ...factionCharBase, rel: z.string().min(1) }).strict();
// War-chiefs carry a title like rulers; a faction whose ruler IS the war-leader
// (e.g. Syracuse / Agathocles) stores null.
const warChiefSchema = z.object({ ...factionCharBase, title: z.string().min(1) }).strict();

export const FACTION_GOVERNANCE = ["personal", "institutional"] as const;
export type FactionGovernance = (typeof FACTION_GOVERNANCE)[number];

const factionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    group: z.enum(FACTION_GROUPS),
    // A durable, identity-only lore blurb (who the faction IS — geography, what
    // they are known for) — NOT their relationship to Massalia (that is the live
    // opinion bar, which changes). Static content; travels content → route → view,
    // never stored per-world. Placeholder copy the design team will refine.
    blurb: z.string().min(1).max(280),
    // personal = ruler/heir/war-chief; institutional = a council label, no people.
    governance: z.enum(FACTION_GOVERNANCE),
    start: factionStartSchema,
    // NPC-to-NPC, one-directional static lists of OTHER faction ids (validated to
    // resolve in parseFactionsContent). Not an opinion matrix — just flavour lists.
    rivals: z.array(z.string()).default([]),
    allies: z.array(z.string()).default([]),
    // Personal-only: ruler + heir required, warChief object OR null (key present).
    ruler: rulerSchema.optional(),
    heir: heirSchema.optional(),
    warChief: warChiefSchema.nullable().optional(),
    // Institutional-only: the governing-body label (no ruler/heir/war-chief).
    institutionLabel: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.governance === "institutional") {
      if (!f.institutionLabel) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["institutionLabel"], message: "institutional faction requires institutionLabel" });
      if (f.ruler || f.heir || f.warChief !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ruler"], message: "institutional faction must not have ruler/heir/warChief" });
      }
    } else {
      if (!f.ruler) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ruler"], message: "personal faction requires a ruler" });
      if (!f.heir) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["heir"], message: "personal faction requires an heir" });
      if (f.warChief === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["warChief"], message: "personal faction requires warChief (object or null)" });
      if (f.institutionLabel) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["institutionLabel"], message: "personal faction must not have institutionLabel" });
    }
  });

export const factionsContentSchema = z.object({ factions: z.array(factionSchema).min(1) }).strict();

export type FactionRuler = z.infer<typeof rulerSchema>;
export type FactionHeir = z.infer<typeof heirSchema>;
export type FactionWarChief = z.infer<typeof warChiefSchema>;
export type FactionStart = z.infer<typeof factionStartSchema>;
export type FactionDef = z.infer<typeof factionSchema>;
export type FactionsContent = z.infer<typeof factionsContentSchema>;

// Live age = age at world start + whole game-years elapsed. Pure (the caller
// supplies the elapsed count from the calendar); nobody dies — age just rises.
export function liveAge(bornAge: number, gameYearsElapsed: number): number {
  return bornAge + Math.max(0, Math.floor(gameYearsElapsed));
}

export function parseFactionsContent(data: unknown): FactionsContent {
  const parsed = factionsContentSchema.parse(data);
  assertUniqueIds(parsed.factions.map((f) => f.id), "faction");
  // Every rival/ally id must reference a real faction — a dangling id is a content
  // bug, so fail loudly at parse/boot rather than render a broken name.
  const ids = new Set(parsed.factions.map((f) => f.id));
  for (const f of parsed.factions) {
    for (const ref of [...f.rivals, ...f.allies]) {
      if (!ids.has(ref)) throw new Error(`Faction ${f.id} references unknown faction id: ${ref}`);
    }
  }
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
