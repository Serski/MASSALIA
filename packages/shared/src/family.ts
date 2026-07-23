import { z } from "zod";
import { REAL_MS_PER_SEASON, SEASONS_PER_YEAR } from "./calendar.js";
import { manumissionConfigSchema } from "./manumission.js";

// One game year in real milliseconds (4 real days) — the same clock as character
// and child age. Used as the default for the lazy spouse-age math.
const REAL_MS_PER_GAME_YEAR = REAL_MS_PER_SEASON * SEASONS_PER_YEAR;

// ---------------------------------------------------------------------------
// Family pack, Prompt A: marriage & the per-player candidate pool. All tuning
// lives in content/family/family-config.json — these functions are pure and take
// the config (and an injectable rng) so they unit-test deterministically.
// ---------------------------------------------------------------------------

const range = z.tuple([z.number(), z.number()]);
const statMap = z
  .object({ prestige: z.number().optional(), devotion: z.number().optional(), militia: z.number().optional(), intelligence: z.number().optional() })
  .strict();

const candidateTraitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    childChanceBonus: z.number().optional(),
    birthDeathRiskMod: z.number().optional(),
    dowryDrachmae: z.number().optional(),
    statBonus: statMap.optional(),
  })
  .strict();

// The full shipped config is validated; later-pack keys (children, regency, …)
// are modelled loosely so the source-of-truth file always passes.
export const familyConfigSchema = z.object({
  comingOfAge: z.number(),
  candidates: z.object({
    perDraw: z.number(),
    drawCadenceGameYears: z.number(),
    statRanges: z.object({ prestige: range, devotion: range, militia: range, intelligence: range }),
    traitChance: z.number(),
    traitPool: z.array(z.string()),
    // Wife personality: a pool of player trait ids (content/traits.json) drawn
    // for marriage candidates at personalityChance. Separate axis from the
    // mechanical traitPool above; only the drawn trait's opposes/embraces tags
    // are consumed (via composure), never its statMod.
    personalityPool: z.array(z.string()),
    personalityChance: z.number(),
    houseWeighting: z.string(),
  }),
  candidateTraits: z.array(candidateTraitSchema),
  // Wife lifespan & fertility: wives age, die of old age in [deathAge.min, max],
  // and only bear children inside [fertilityWindow.from, to] (inclusive).
  spouse: z.object({
    deathAge: z.object({ min: z.number(), max: z.number() }),
    fertilityWindow: z.object({ from: z.number(), to: z.number() }),
  }),
  marriage: z.object({
    crossIdeologyPenalty: z.object({ threshold: z.number(), ideologyShift: z.number(), partyFavorLoss: z.number() }),
    eligibleClasses: z.array(z.string()),
  }),
  children: z.object({
    yearlyChildChance: z.number(),
    thirdPlusChildChance: z.number(),
    birthDeathRisk: z.number(),
    maxChildren: z.number(),
    sexRatioBoys: z.number(),
    portraits: z.object({
      boy: z.object({ infant: z.string(), child: z.string() }),
      girl: z.object({ infant: z.string(), child: z.string() }),
    }),
    portraitStages: z.array(z.object({ fromAge: z.number(), stage: z.string() })),
  }),
  succession: z
    .object({
      prestigeCarryover: z.object({ blood: z.number(), adopted: z.number(), regent: z.number() }),
      alwaysInherited: z.array(z.string()),
      heirStartAge: z.number(),
      adoptedStartAgeRange: range,
      regentStartAgeRange: range,
    })
    .passthrough(),
  adoption: z.object({
    perDraw: z.number(),
    drawCadenceGameYears: z.number(),
    hetairaRule: z.object({ womenOnly: z.boolean(), successorClass: z.string() }).passthrough(),
  }),
  regency: z.object({}).passthrough(),
  // Manumission (the slave's path out): which citizen classes a freedman may
  // buy into, and the trait that unlocks it. Validated at boot.
  manumission: manumissionConfigSchema,
  classRules: z.object({
    slave: z.object({ familyLocked: z.boolean(), unlockOnClasses: z.array(z.string()) }).passthrough(),
    hetaira: z.object({ marriage: z.boolean(), children: z.boolean(), adoption: z.string() }).passthrough(),
  }),
});

export type FamilyConfig = z.infer<typeof familyConfigSchema>;

export function parseFamilyConfig(data: unknown): FamilyConfig {
  return familyConfigSchema.parse(data);
}

// Boot-time guard: every personalityPool id must resolve to a real loaded trait.
// The wife's personality reuses player traits by id, so a typo'd or removed id
// would silently roll wives with no resolvable personality — fail loudly at boot
// instead. `knownTraitIds` is the id set of the loaded traits.json catalog.
export function assertPersonalityPoolResolves(cfg: FamilyConfig, knownTraitIds: Iterable<string>): void {
  const known = new Set(knownTraitIds);
  const missing = cfg.candidates.personalityPool.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new Error(
      `family-config personalityPool references unknown trait id(s): ${missing.join(", ")}. ` +
        "Every id must exist in content/traits/traits.json.",
    );
  }
}

// Trait lookup (dowry, stat bonus) by id.
export function candidateTrait(cfg: FamilyConfig, traitId: string | null) {
  return traitId ? cfg.candidateTraits.find((trait) => trait.id === traitId) ?? null : null;
}

// --- Candidate generation --------------------------------------------------

export type Sex = "male" | "female";
export type CandidatePurpose = "marriage" | "adoption";

export type CandidateDraft = {
  purpose: CandidatePurpose;
  name: string;
  sex: Sex;
  houseSlug: string;
  age: number;
  prestige: number;
  devotion: number;
  militia: number;
  intelligence: number;
  traitId: string | null;
  ideology: number;
};

// Greek name banks (not tuning — a name source, kept in code). Female names supply
// wives and women-only adoptions; male names supply other adoptees.
const GREEK_FEMALE_NAMES = [
  "Aglaia", "Theano", "Niobe", "Chloe", "Myrrine", "Lysandra", "Phoebe", "Eirene", "Kallisto", "Daphne",
  "Penelope", "Aspasia", "Helike", "Berenike", "Xanthe", "Melitta", "Phryne", "Glykera", "Ariadne", "Korinna",
];
const GREEK_MALE_NAMES = [
  "Lykos", "Damon", "Theron", "Nikias", "Kleon", "Hippias", "Demetrios", "Sostratos", "Kallias", "Philon",
  "Andreas", "Eumenes", "Leonidas", "Pyrrhos", "Aristos", "Kimon", "Drakon", "Hieron", "Menon", "Telamon",
];

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

// Marriage candidates are female (Greek female names, wives). Adoption candidates
// are either sex EXCEPT women-only (the hetaira rule). Stats roll inside
// cfg.candidates.statRanges; a trait lands with cfg.candidates.traitChance; the
// house is uniform; the candidate's ideology is its house's start ideology.
export function generateCandidates(
  rng: () => number,
  purpose: CandidatePurpose,
  count: number,
  cfg: FamilyConfig,
  houses: { slug: string; ideology: number }[],
  womenOnly = false,
): CandidateDraft[] {
  const ranges = cfg.candidates.statRanges;
  const ageRange: [number, number] = purpose === "marriage" ? [18, 30] : cfg.succession.adoptedStartAgeRange;
  const drafts: CandidateDraft[] = [];

  for (let i = 0; i < count; i++) {
    // Marriage is always a wife; adoption is either sex unless women-only.
    const sex: Sex = purpose === "marriage" || womenOnly ? "female" : rng() < 0.5 ? "female" : "male";
    const name = pick(rng, sex === "female" ? GREEK_FEMALE_NAMES : GREEK_MALE_NAMES);
    const house = pick(rng, houses);
    const traitId = rng() < cfg.candidates.traitChance ? pick(rng, cfg.candidates.traitPool) : null;

    drafts.push({
      purpose,
      name,
      sex,
      houseSlug: house.slug,
      age: randInt(rng, ageRange[0], ageRange[1]),
      prestige: randInt(rng, ranges.prestige[0], ranges.prestige[1]),
      devotion: randInt(rng, ranges.devotion[0], ranges.devotion[1]),
      militia: randInt(rng, ranges.militia[0], ranges.militia[1]),
      intelligence: randInt(rng, ranges.intelligence[0], ranges.intelligence[1]),
      traitId,
      ideology: house.ideology,
    });
  }
  return drafts;
}

// --- Cross-house marriage penalty ------------------------------------------

export type MarriagePenalty = { ideologyShift: number; partyFavorLoss: number };

// Marrying across the ideological divide pulls the CHARACTER toward the
// candidate's side and costs standing with their own party — but only when the
// gap is at least the configured threshold.
export function marriagePenalty(characterIdeology: number, candidateHouseIdeology: number, cfg: FamilyConfig): MarriagePenalty {
  const penalty = cfg.marriage.crossIdeologyPenalty;
  const diff = candidateHouseIdeology - characterIdeology;
  if (Math.abs(diff) < penalty.threshold) return { ideologyShift: 0, partyFavorLoss: 0 };
  // Shift toward the candidate's side (positive = Reformist, negative = Traditionalist).
  return { ideologyShift: diff > 0 ? penalty.ideologyShift : -penalty.ideologyShift, partyFavorLoss: penalty.partyFavorLoss };
}

// --- Class eligibility (Prompt A) ------------------------------------------

export function isFamilyLocked(classId: string, cfg: FamilyConfig): boolean {
  return classId === "slave" && cfg.classRules.slave.familyLocked;
}

export function canMarry(classId: string, cfg: FamilyConfig): boolean {
  if (isFamilyLocked(classId, cfg)) return false;
  if (classId === "hetaira") return cfg.classRules.hetaira.marriage; // false
  return cfg.marriage.eligibleClasses.includes(classId);
}

export function adoptionWomenOnly(classId: string, cfg: FamilyConfig): boolean {
  return classId === "hetaira" && cfg.classRules.hetaira.adoption === "womenOnly";
}

// --- Children & growing up (Prompt B) --------------------------------------

// Lazy age from the season clock — the same math as character age (1 game year
// per realMsPerGameYear). Floors to whole game years.
export function childAge(bornAtMs: number, nowMs: number, realMsPerGameYear: number): number {
  return Math.max(0, Math.floor((nowMs - bornAtMs) / realMsPerGameYear));
}

export function isOfAge(age: number, cfg: FamilyConfig): boolean {
  return age >= cfg.comingOfAge;
}

// --- Wife lifespan & fertility window --------------------------------------

// A wife ages lazily: her rolled age at generation + whole game-years elapsed
// since (1 game year / 4 real days — the same math as character & child age).
// realMsPerGameYear is injectable for tests; defaults to the real clock.
export function spouseCurrentAge(
  candidateAge: number,
  candidateCreatedAtMs: number,
  nowMs: number,
  realMsPerGameYear: number = REAL_MS_PER_GAME_YEAR,
): number {
  return candidateAge + Math.max(0, Math.floor((nowMs - candidateCreatedAtMs) / realMsPerGameYear));
}

// True once the wife reaches the death age rolled for her at marriage.
export function isSpouseDeceased(spouseAge: number, spouseDeathAge: number): boolean {
  return spouseAge >= spouseDeathAge;
}

// Children come only within the fertility window (inclusive on both ends).
export function isFertile(spouseAge: number, cfg: FamilyConfig): boolean {
  const window = cfg.spouse.fertilityWindow;
  return spouseAge >= window.from && spouseAge <= window.to;
}

// Roll a wife's death age uniformly in [deathAge.min, deathAge.max] (inclusive)
// at marriage time. rng injectable for tests.
export function rollSpouseDeathAge(cfg: FamilyConfig, rng: () => number = Math.random): number {
  const { min, max } = cfg.spouse.deathAge;
  return randInt(rng, min, max);
}

// A default Greek name for a newborn (sticks if the player never renames).
export function defaultChildName(sex: Sex, rng: () => number = Math.random): string {
  return pick(rng, sex === "female" ? GREEK_FEMALE_NAMES : GREEK_MALE_NAMES);
}

// Just the trait fields the child roll needs (a spouse's candidate trait).
export type SpouseTrait = { childChanceBonus?: number; birthDeathRiskMod?: number } | null;

// --- Death, succession & regency (Prompt C) --------------------------------

export type StatBlock = { prestige: number; devotion: number; militia: number; intelligence: number };

export type SuccessionKind = "blood" | "adopted" | "regency" | "fresh" | "forced_adoption";

export type ChildInfo = { id: string; age: number; sex: Sex; name: string };

export type SuccessionPlan = {
  kind: SuccessionKind;
  // The of-age child who inherits (blood), or the minor a regent holds for (regency).
  heirChildId?: string;
  regentForChildId?: string;
};

// The succession ladder, in order: an of-age child (blood) > an adopted heir >
// a regency for a minor child > a fresh start (slave) / forced adoption (citizens
// & hetaira). Every branch yields a playable next character.
export function successionPlan(character: { classId: string }, children: ChildInfo[], hasAdoptedHeir: boolean, cfg: FamilyConfig): SuccessionPlan {
  const ofAge = children.filter((child) => child.age >= cfg.comingOfAge);
  if (ofAge.length > 0) {
    const eldest = ofAge.reduce((a, b) => (b.age > a.age ? b : a));
    return { kind: "blood", heirChildId: eldest.id };
  }
  if (hasAdoptedHeir) return { kind: "adopted" };
  if (children.length > 0) {
    // All remaining children are minors — regent for the eldest (next of age).
    const eldestMinor = children.reduce((a, b) => (b.age > a.age ? b : a));
    return { kind: "regency", regentForChildId: eldestMinor.id };
  }
  return character.classId === "slave" ? { kind: "fresh" } : { kind: "forced_adoption" };
}

const STAT_ORDER: (keyof StatBlock)[] = ["prestige", "devotion", "militia", "intelligence"];

// The dead's highest stat (ties resolve by STAT_ORDER), for the bloodline nudge.
export function highestStatKey(stats: StatBlock): keyof StatBlock {
  return STAT_ORDER.reduce((best, key) => (stats[key] > stats[best] ? key : best), STAT_ORDER[0]!);
}

export type InheritanceKind = "blood" | "adopted" | "regent";
export type Inheritance = StatBlock & { alwaysInherited: string[] };

// What the next character starts with. Prestige ALWAYS carries over (floored by
// the kind's rate: blood .50 / adopted .35 / regent .30). A blood heir rolls the
// other three fresh from the candidate ranges plus a +1 bloodline nudge to the
// dead's highest stat; an adopted/regent successor keeps the candidate's own
// already-rolled stats. House/holdings/drachmae/seat always pass (alwaysInherited).
export function inheritance(
  dead: StatBlock,
  kind: InheritanceKind,
  cfg: FamilyConfig,
  opts: { rng?: () => number; candidate?: StatBlock } = {},
): Inheritance {
  const prestige = Math.floor(dead.prestige * (cfg.succession.prestigeCarryover[kind] ?? 0));
  const alwaysInherited = cfg.succession.alwaysInherited;

  if (kind === "blood") {
    const rng = opts.rng ?? Math.random;
    const r = cfg.candidates.statRanges;
    const rolled: StatBlock = {
      prestige,
      devotion: r.devotion[0] + Math.floor(rng() * (r.devotion[1] - r.devotion[0] + 1)),
      militia: r.militia[0] + Math.floor(rng() * (r.militia[1] - r.militia[0] + 1)),
      intelligence: r.intelligence[0] + Math.floor(rng() * (r.intelligence[1] - r.intelligence[0] + 1)),
    };
    // +1 nudge toward the dead's strongest line.
    const nudge = highestStatKey(dead);
    rolled[nudge] += 1;
    return { ...rolled, alwaysInherited };
  }

  // adopted / regent: keep the candidate's own stats, only prestige carries over.
  const candidate = opts.candidate ?? { prestige: 0, devotion: 0, militia: 0, intelligence: 0 };
  return { prestige, devotion: candidate.devotion, militia: candidate.militia, intelligence: candidate.intelligence, alwaysInherited };
}

export type ChildRollOutcome =
  | { born: false }
  | { born: true; sex: Sex; motherDied: boolean };

// The yearly roll for one married character. No child past maxChildren; the 3rd+
// child uses the lower chance; the spouse's Fertile/Frail trait nudges both the
// child chance and the birth-death risk. If the mother dies the child still
// survives (the line continues; the cost is the wife) — handled by the caller.
export function childRoll(
  rng: () => number,
  marriage: { active: boolean },
  existingChildrenCount: number,
  spouseTrait: SpouseTrait,
  cfg: FamilyConfig,
): ChildRollOutcome {
  if (!marriage.active) return { born: false };
  if (existingChildrenCount >= cfg.children.maxChildren) return { born: false };

  const base = existingChildrenCount < 2 ? cfg.children.yearlyChildChance : cfg.children.thirdPlusChildChance;
  const chance = base + (spouseTrait?.childChanceBonus ?? 0);
  if (rng() >= chance) return { born: false };

  const sex: Sex = rng() < cfg.children.sexRatioBoys ? "male" : "female";
  const risk = cfg.children.birthDeathRisk + (spouseTrait?.birthDeathRiskMod ?? 0);
  const motherDied = rng() < risk;
  return { born: true, sex, motherDied };
}
