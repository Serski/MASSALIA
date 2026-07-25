import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  characterTraits,
  checkSpouseDeath,
  children,
  createDb,
  drawFamilyCandidates,
  effectLog,
  familyCandidates,
  houses,
  marriages,
  partyFavor,
  playerCharacters,
  players,
  rollChildrenDue,
  worlds,
} from "@massalia/db";
import {
  applyStatGrowth,
  assertPersonalityPoolResolves,
  canMarry,
  candidateTrait,
  capStat,
  childAge,
  clampIdeology,
  clampPhilia,
  currentAge,
  gameDate,
  isFamilyLocked,
  isFertile,
  isOfAge,
  isSpouseDeceased,
  marriagePenalty,
  parseFamilyConfig,
  philiaBand,
  portraitFor,
  REAL_MS_PER_SEASON,
  rollSpouseDeathAge,
  spouseCurrentAge,
  successionPlan,
  type FamilyConfig,
  type Sex,
  type Trait,
} from "@massalia/shared";
import { getAgeConfig, portraitUrl } from "./age.js";
import { addTrait, getAllTraitDefs, getHeldTraits, getTraitDef } from "./traits.js";
import { applyComposureDelta } from "./composure.js";
import { broadcastState } from "./worldState.js";
import { onIdeologyChanged } from "./politics.js";
import { enqueueChildRoll, enqueueFamilyDraw } from "./queue.js";

const db = createDb();
// The in-life adoption rite is age-gated at 30 (shared by familyState's outlook/
// showAdoption and adopt()'s guard — one source of truth). The death-flow forced
// adoption is never age-gated.
export const ADOPTION_MIN_AGE = 30;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/family/family-config.json");

let config: FamilyConfig | null = null;

export async function loadFamilyConfig(): Promise<FamilyConfig> {
  config = parseFamilyConfig(JSON.parse(await fs.readFile(configFile, "utf8")));
  // Boot-time guard: the wife personality pool references trait ids by string;
  // every one must resolve against the loaded traits.json catalog. loadTraitDefs()
  // runs before loadFamilyConfig() at boot (see apps/server/src/index.ts).
  assertPersonalityPoolResolves(config, getAllTraitDefs().map((trait) => trait.id));
  return config;
}

export function getFamilyConfig(): FamilyConfig {
  if (!config) throw new Error("Family config not loaded. Call loadFamilyConfig() at boot.");
  return config;
}

// The LIVING spouse's personality resolved as composure-ready traits, or [] when
// the character is unmarried, widowed, or the wife has no personality (legacy /
// pre-pack rows). Gated on spouseCandidateId FIRST so unmarried characters incur
// zero DB reads. One joined query (candidate + her active marriage); aliveness
// reuses the shared spouseCurrentAge / isSpouseDeceased math — never re-derived —
// so a wife dead of old age but not yet swept still counts as gone. Only her
// opposes/embraces tags feed composure; statMod is never read.
// The state of a character's LIVING spouse, or null when unmarried / widowed (a
// wife past her spouseDeathAge but not yet swept counts as gone). Gated on
// spouseCandidateId FIRST so unmarried characters incur zero DB reads; otherwise
// exactly ONE joined query (candidate + her active marriage). Surfaces everything
// a caller might need from that single query: her composure-ready personality
// traits, her mechanical trait id, the combined id set for event eligibility, and
// the marriage row id + philia. statMod is never read.
export type LivingSpouse = {
  marriageId: string | null;
  philia: number | null;
  personalityTraits: Trait[]; // 0 or 1 resolved trait (for composure)
  spouseTraitId: string | null; // mechanical trait id
  spouseTraitIds: string[]; // personality + mechanical ids (for event eligibility)
};

export async function livingSpouseState(
  character: Pick<CharacterRow, "id" | "spouseCandidateId">,
  now: Date = new Date(),
): Promise<LivingSpouse | null> {
  if (!character.spouseCandidateId) return null; // unmarried — no DB read
  const rows = await db
    .select({
      personalityTraitId: familyCandidates.personalityTraitId,
      traitId: familyCandidates.traitId,
      age: familyCandidates.age,
      createdAt: familyCandidates.createdAt,
      spouseDeathAge: marriages.spouseDeathAge,
      marriageId: marriages.id,
      philia: marriages.philia,
    })
    .from(familyCandidates)
    .leftJoin(
      marriages,
      and(eq(marriages.candidateId, familyCandidates.id), eq(marriages.characterId, character.id), isNull(marriages.endedAt)),
    )
    .where(eq(familyCandidates.id, character.spouseCandidateId))
    .limit(1);
  const row = rows[0];
  if (!row) return null; // candidate row gone
  if (row.spouseDeathAge !== null) {
    const wifeAge = spouseCurrentAge(row.age, row.createdAt.getTime(), now.getTime(), getAgeConfig().realMsPerGameYear);
    if (isSpouseDeceased(wifeAge, row.spouseDeathAge)) return null; // widowed, not yet swept
  }
  const def = row.personalityTraitId ? getTraitDef(row.personalityTraitId) : undefined;
  const spouseTraitIds = [row.personalityTraitId, row.traitId].filter((id): id is string => id !== null);
  return {
    marriageId: row.marriageId,
    philia: row.philia,
    personalityTraits: def ? [def] : [],
    spouseTraitId: row.traitId ?? null,
    spouseTraitIds,
  };
}

// Family-arena eligibility inputs for the daily draw, resolved lazily. Callers
// MUST gate on the winter day before invoking (non-winter draws never need this).
// Slaves (family locked) short-circuit with zero queries — they can never
// qualify. Otherwise: the living spouse via livingSpouseState (0 reads if
// unmarried) plus ONE query for living children.
export type FamilyEligibility = {
  married: boolean;
  spouseTraitIds: string[];
  livingChildren: { sex: "male" | "female"; ageYears: number }[];
};

export async function familyEligibilityContext(
  character: Pick<CharacterRow, "id" | "spouseCandidateId" | "classId">,
  now: Date = new Date(),
): Promise<FamilyEligibility> {
  if (isFamilyLocked(character.classId, getFamilyConfig())) {
    return { married: false, spouseTraitIds: [], livingChildren: [] }; // slave — no reads
  }
  const spouse = await livingSpouseState(character, now);
  const childRows = await db
    .select({ sex: children.sex, bornAt: children.bornAt })
    .from(children)
    .where(and(eq(children.parentCharacterId, character.id), isNull(children.diedAt)));
  const realMsPerGameYear = getAgeConfig().realMsPerGameYear;
  const livingChildren = childRows.map((child) => ({
    sex: child.sex as "male" | "female",
    ageYears: childAge(child.bornAt.getTime(), now.getTime(), realMsPerGameYear),
  }));
  return { married: spouse !== null, spouseTraitIds: spouse?.spouseTraitIds ?? [], livingChildren };
}

type CharacterRow = typeof playerCharacters.$inferSelect;
type CandidateRow = typeof familyCandidates.$inferSelect;

// One game year = the age clock's realMsPerGameYear (4 real days).
function gameYearMs(cfg: FamilyConfig): number {
  return getAgeConfig().realMsPerGameYear * cfg.candidates.drawCadenceGameYears;
}

// Lazy-on-read safety net: draw any purpose the character currently lacks
// unconsumed offers for, then schedule the yearly BullMQ refresh. Per-purpose
// (onlyMissing) so consuming marriage offers never disturbs standing adoption
// offers, and vice versa — and a legacy character with only one purpose's rows
// self-heals the missing one on the next read. The worker keeps them fresh after.
export async function ensureFreshDraw(character: CharacterRow, now: Date = new Date()): Promise<void> {
  const cfg = getFamilyConfig();
  if (isFamilyLocked(character.classId, cfg)) return;

  const drawn = await drawFamilyCandidates(character.id, { familyCfg: cfg, ageCfg: getAgeConfig(), now, onlyMissing: true });
  if (drawn.length > 0) await enqueueFamilyDraw(character.id, gameYearMs(cfg));
}

const HOUSE_NAMES_CACHE = new Map<string, string>();
async function houseName(slug: string): Promise<string> {
  if (HOUSE_NAMES_CACHE.has(slug)) return HOUSE_NAMES_CACHE.get(slug)!;
  const rows = await db.select({ name: houses.name }).from(houses).where(eq(houses.slug, slug)).limit(1);
  const name = rows[0]?.name ?? slug;
  HOUSE_NAMES_CACHE.set(slug, name);
  return name;
}

function candidateView(cand: CandidateRow, cfg: FamilyConfig, houseLabel: string) {
  const trait = candidateTrait(cfg, cand.traitId);
  // Wife personality: display name + description only, resolved from traits.json
  // by id. Null for adoption/legacy rows. statMod is deliberately NOT read here —
  // her personality only reacts to the player's choices (composure), it does not
  // buff him.
  const personalityDef = cand.personalityTraitId ? getTraitDef(cand.personalityTraitId) : undefined;
  return {
    id: cand.id,
    name: cand.name,
    sex: cand.sex,
    houseSlug: cand.houseSlug,
    houseName: houseLabel,
    age: cand.age,
    ideology: cand.ideology,
    stats: { prestige: cand.prestige, devotion: cand.devotion, militia: cand.militia, intelligence: cand.intelligence },
    trait: trait ? { id: trait.id, name: trait.name, description: trait.description } : null,
    personality: personalityDef ? { id: personalityDef.id, name: personalityDef.name, description: personalityDef.description } : null,
    dowry: trait?.dowryDrachmae ?? 0,
    // Her age-stage portrait (matches the player's own resolution in character.ts).
    portrait: portraitUrl(portraitFor(cand.avatarId ?? "", cand.age, getAgeConfig())),
  };
}

// Lazy-on-read child roll (the BullMQ worker is the scheduled path). Safe to call
// on every GET — it only rolls when a game year has actually elapsed.
export async function advanceChildren(characterId: string, now: Date = new Date()): Promise<void> {
  await rollChildrenDue(characterId, { familyCfg: getFamilyConfig(), ageCfg: getAgeConfig(), now });
}

// Lazy-on-read spouse death of old age (the BullMQ sweep is the scheduled net).
// Ends the marriage with 'spouse_died' and frees the widower to remarry; the
// notice surfaces through familyState (a recently 'spouse_died' marriage).
export async function advanceSpouseDeath(characterId: string, now: Date = new Date()): Promise<void> {
  const death = await checkSpouseDeath(characterId, { familyCfg: getFamilyConfig(), ageCfg: getAgeConfig(), now });
  if (death) await broadcastState();
}

// Highest fromAge threshold that is <= age wins (same rule as the adult stageFor).
function childStageFor(age: number, cfg: FamilyConfig): "infant" | "child" {
  let stage = cfg.children.portraitStages[0]!.stage;
  for (const s of cfg.children.portraitStages) if (age >= s.fromAge) stage = s.stage;
  return stage as "infant" | "child";
}

function childPortrait(sex: string, age: number, cfg: FamilyConfig): string {
  const set = sex === "male" ? cfg.children.portraits.boy : cfg.children.portraits.girl;
  return `/content/${set[childStageFor(age, cfg)]}`;
}

// Children list (+ lazy coming-of-age) and the pending birth event (the newest
// still-unnamed child; the default name sticks once the season passes).
async function childrenSection(character: CharacterRow, now: Date) {
  const cfg = getFamilyConfig();
  const gameYearMs = getAgeConfig().realMsPerGameYear;
  const rows = await db.select().from(children).where(and(eq(children.parentCharacterId, character.id), isNull(children.diedAt))).orderBy(desc(children.bornAt));

  const list = [];
  for (const child of rows) {
    const age = childAge(child.bornAt.getTime(), now.getTime(), gameYearMs);
    const ofAge = isOfAge(age, cfg);
    // Lazy coming-of-age: stamp the moment they reach 15 (no stat roll — that's succession).
    if (ofAge && child.comeOfAgeAt === null) {
      await db.update(children).set({ comeOfAgeAt: now }).where(eq(children.id, child.id));
    }
    // Auto-acknowledge a birth once its naming season has passed (default sticks).
    if (!child.named && now.getTime() - child.bornAt.getTime() >= REAL_MS_PER_SEASON) {
      await db.update(children).set({ named: true }).where(eq(children.id, child.id));
      child.named = true;
    }
    list.push({
      id: child.id,
      name: child.name,
      sex: child.sex,
      age,
      portrait: childPortrait(child.sex, age, cfg),
      comingOfAge: cfg.comingOfAge,
      yearsToComingOfAge: Math.max(0, cfg.comingOfAge - age),
      // Patrilineal: only of-age SONS are heir-eligible. Daughters still come of age.
      heirEligible: ofAge && child.sex === "male",
      named: child.named,
    });
  }

  // The pending birth event: newest child still awaiting a name.
  const pending = rows.find((child) => !child.named && now.getTime() - child.bornAt.getTime() < REAL_MS_PER_SEASON);
  let birthEvent = null;
  if (pending) {
    // Grief: did this birth end the marriage? (the roll stamps both at the same instant)
    const ended = await db
      .select({ candidateId: marriages.candidateId })
      .from(marriages)
      .where(and(eq(marriages.characterId, character.id), eq(marriages.endReason, "death_in_childbirth"), eq(marriages.endedAt, pending.bornAt)))
      .limit(1);
    let lateWifeName: string | null = null;
    if (ended[0]) {
      const wife = await db.select({ name: familyCandidates.name }).from(familyCandidates).where(eq(familyCandidates.id, ended[0].candidateId)).limit(1);
      lateWifeName = wife[0]?.name ?? null;
    }
    birthEvent = { childId: pending.id, childName: pending.name, sex: pending.sex, motherDied: lateWifeName !== null, lateWifeName };
  }

  return { children: list, birthEvent };
}

// Rename a newborn (the birth event's text input). Falls back to keeping the
// default if the name is blank; marks the child named either way.
export async function nameChild(character: CharacterRow, childId: string, name: string, now: Date = new Date()): Promise<{ ok: boolean; name: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 64);
  const rows = await db.select().from(children).where(and(eq(children.id, childId), eq(children.parentCharacterId, character.id), isNull(children.diedAt))).limit(1);
  const child = rows[0];
  if (!child) return { ok: false, name: "" };
  const finalName = clean || child.name; // blank -> keep the generated default
  await db.update(children).set({ name: finalName, named: true }).where(eq(children.id, childId));
  void now;
  await broadcastState();
  return { ok: true, name: finalName };
}

// GET /api/family payload: locks, current spouse, and the open offers (with the
// cross-house penalty preview baked into each marriage candidate).
export async function familyState(character: CharacterRow, now: Date = new Date()) {
  const cfg = getFamilyConfig();
  const locked = isFamilyLocked(character.classId, cfg); // slave
  const marriageAllowed = canMarry(character.classId, cfg);

  const offers = locked
    ? []
    : await db
        .select()
        .from(familyCandidates)
        .where(and(eq(familyCandidates.forCharacterId, character.id), isNull(familyCandidates.consumedAt)));

  const marriageOffers = [];
  for (const cand of offers.filter((o) => o.purpose === "marriage")) {
    const view = candidateView(cand, cfg, await houseName(cand.houseSlug));
    const penalty = marriagePenalty(character.ideology, cand.ideology, cfg);
    marriageOffers.push({ ...view, penalty, party: character.party });
  }
  const adoptionOffers = [];
  for (const cand of offers.filter((o) => o.purpose === "adoption")) {
    adoptionOffers.push(candidateView(cand, cfg, await houseName(cand.houseSlug)));
  }

  let spouse = null;
  if (character.spouseCandidateId) {
    const rows = await db.select().from(familyCandidates).where(eq(familyCandidates.id, character.spouseCandidateId)).limit(1);
    if (rows[0]) {
      // She ages over time — surface her CURRENT age and a quiet fertility hint.
      const currentAge = spouseCurrentAge(rows[0].age, rows[0].createdAt.getTime(), now.getTime(), getAgeConfig().realMsPerGameYear);
      // Philia (for the bond bar) + the action-availability flags, computed
      // server-side so the client never re-derives calendar math. Every active
      // marriage has a row via the schema default; null philia only if none.
      const marriageRows = await db
        .select({ philia: marriages.philia, lastGiftYear: marriages.lastGiftYear, lastSymposiumYear: marriages.lastSymposiumYear, loverState: marriages.loverState, marriedAt: marriages.marriedAt })
        .from(marriages)
        .where(and(eq(marriages.characterId, character.id), eq(marriages.candidateId, character.spouseCandidateId), isNull(marriages.endedAt)))
        .limit(1);
      const marriageRow = marriageRows[0];
      const philia = marriageRow?.philia ?? null;
      // Divorce availability from the SAME cooldown helper the guard enforces.
      const cooldown = marriageRow ? divorceCooldown(marriageRow.marriedAt, now) : { available: false, reason: null };
      const year = gameDate(now.getTime(), await worldStartedMs(character.worldId)).yearInGame;
      spouse = {
        ...candidateView(rows[0], cfg, await houseName(rows[0].houseSlug)),
        age: currentAge,
        // Re-resolve at her CURRENT age so the portrait ages as she does.
        portrait: portraitUrl(portraitFor(rows[0].avatarId ?? "", currentAge, getAgeConfig())),
        fertile: isFertile(currentAge, cfg),
        pastChildbearing: currentAge > cfg.spouse.fertilityWindow.to,
        philia,
        philiaBand: philia !== null ? philiaBand(philia) : null,
        // A gift this game year already → the next is +1 (diminished). Symposium is
        // once per game year.
        giftDiminished: marriageRow?.lastGiftYear === year,
        symposiumAvailable: marriageRow?.lastSymposiumYear !== year,
        loverState: marriageRow?.loverState ?? "none",
        divorceAvailable: cooldown.available,
        divorceBlockedReason: cooldown.reason,
      };
    }
  }

  // A spouse-death notice: a marriage that ended of old age within the last season
  // (auto-acknowledged once the season passes, like the birth notice).
  let spouseDeath = null;
  if (!locked) {
    const ended = await db
      .select()
      .from(marriages)
      .where(and(eq(marriages.characterId, character.id), eq(marriages.endReason, "spouse_died")))
      .orderBy(desc(marriages.endedAt))
      .limit(1);
    const row = ended[0];
    if (row && row.endedAt && now.getTime() - row.endedAt.getTime() < REAL_MS_PER_SEASON) {
      const wife = await db.select({ name: familyCandidates.name }).from(familyCandidates).where(eq(familyCandidates.id, row.candidateId)).limit(1);
      const yearsMarried = Math.max(0, Math.floor((row.endedAt.getTime() - row.marriedAt.getTime()) / getAgeConfig().realMsPerGameYear));
      spouseDeath = { lateWifeName: wife[0]?.name ?? null, yearsMarried };
    }
  }

  // A divorce notice: a marriage the player ended within the last season (derived
  // exactly like the spouse-death notice; auto-acknowledged once the season passes).
  // The card renders in a later phase — this is server-side derivation only.
  let divorceNotice = null;
  if (!locked) {
    const ended = await db
      .select()
      .from(marriages)
      .where(and(eq(marriages.characterId, character.id), eq(marriages.endReason, "divorced")))
      .orderBy(desc(marriages.endedAt))
      .limit(1);
    const row = ended[0];
    if (row && row.endedAt && now.getTime() - row.endedAt.getTime() < REAL_MS_PER_SEASON) {
      const wife = await db.select({ name: familyCandidates.name }).from(familyCandidates).where(eq(familyCandidates.id, row.candidateId)).limit(1);
      const yearsMarried = Math.max(0, Math.floor((row.endedAt.getTime() - row.marriedAt.getTime()) / getAgeConfig().realMsPerGameYear));
      divorceNotice = { formerWifeName: wife[0]?.name ?? null, yearsMarried };
    }
  }

  // A tragedy notice: a marriage that ended in tragedy within the last season,
  // windowed on endedAt like the others. One object carries the archetype; the web
  // picks the copy. A Clytemnestra SUCCESS produces no notice here — that marriage
  // belongs to the dead predecessor's characterId, so this heir-keyed read never
  // surfaces it; the Chronicle carries the murder instead.
  let tragedyNotice = null;
  if (!locked) {
    const ended = await db
      .select()
      .from(marriages)
      .where(and(eq(marriages.characterId, character.id), inArray(marriages.endReason, ["tragedy_phaedra", "tragedy_clytemnestra", "tragedy_medea"])))
      .orderBy(desc(marriages.endedAt))
      .limit(1);
    const row = ended[0];
    if (row && row.endedAt && now.getTime() - row.endedAt.getTime() < REAL_MS_PER_SEASON) {
      const wife = await db.select({ name: familyCandidates.name }).from(familyCandidates).where(eq(familyCandidates.id, row.candidateId)).limit(1);
      const yearsMarried = Math.max(0, Math.floor((row.endedAt.getTime() - row.marriedAt.getTime()) / getAgeConfig().realMsPerGameYear));
      tragedyNotice = { archetype: row.endReason!.replace("tragedy_", ""), formerWifeName: wife[0]?.name ?? null, yearsMarried };
    }
  }

  // Lover-plot notices on the CURRENT marriage: she has fallen / the city knows,
  // each windowed on its timestamp like the other one-shot notices. Derivation
  // only — the cards render in a later phase.
  let fellNotice = false;
  let discoveredNotice = false;
  if (!locked && character.spouseCandidateId) {
    const rows = await db
      .select({ loverFellAt: marriages.loverFellAt, loverDiscoveredAt: marriages.loverDiscoveredAt })
      .from(marriages)
      .where(and(eq(marriages.characterId, character.id), eq(marriages.candidateId, character.spouseCandidateId), isNull(marriages.endedAt)))
      .limit(1);
    const row = rows[0];
    if (row?.loverFellAt && now.getTime() - row.loverFellAt.getTime() < REAL_MS_PER_SEASON) fellNotice = true;
    if (row?.loverDiscoveredAt && now.getTime() - row.loverDiscoveredAt.getTime() < REAL_MS_PER_SEASON) discoveredNotice = true;
  }

  const { children: childList, birthEvent } = locked ? { children: [], birthEvent: null } : await childrenSection(character, now);

  // --- Succession outlook + the in-life adoption rite -------------------------
  const hasAdopted = character.adoptedCandidateId !== null;
  const age = currentAge(character.startAge, character.createdAt.getTime(), now.getTime(), getAgeConfig());
  // The adopted (consumed) candidate — ONE query, reused for the outlook heir name
  // and the windowed adoption notice. Absent when the character has not adopted.
  const adoptedCand = hasAdopted
    ? (await db
        .select({ name: familyCandidates.name, houseSlug: familyCandidates.houseSlug, consumedAt: familyCandidates.consumedAt })
        .from(familyCandidates)
        .where(eq(familyCandidates.id, character.adoptedCandidateId!))
        .limit(1))[0]
    : undefined;

  // Outlook via the shared plan from data already in hand (children ages+sex,
  // hasAdopted, class) — the plan kind costs no query; only the adopted heir's name
  // reuses the candidate read above.
  const plan = successionPlan({ classId: character.classId }, childList.map((c) => ({ id: c.id, age: c.age, sex: c.sex as Sex, name: c.name })), hasAdopted, cfg);
  const heirName =
    plan.kind === "blood" ? (childList.find((c) => c.id === plan.heirChildId)?.name ?? null)
    : plan.kind === "regency" ? (childList.find((c) => c.id === plan.regentForChildId)?.name ?? null)
    : plan.kind === "adopted" ? (adoptedCand?.name ?? null)
    : null;
  const successionOutlook = { kind: plan.kind, heirName };

  // The Adopt button shows when the line is not blood-secure (or the hetaira, whose
  // only path is adoption), the character has not yet named an heir, and is >= 30.
  const showAdoption = !locked && (plan.kind !== "blood" || character.classId === "hetaira") && !hasAdopted && age >= ADOPTION_MIN_AGE;

  // Adoption notice: one season on the adopted candidate's consumedAt (the anchor).
  let adoptionNotice: { name: string; house: string } | null = null;
  if (adoptedCand?.consumedAt && now.getTime() - adoptedCand.consumedAt.getTime() < REAL_MS_PER_SEASON) {
    adoptionNotice = { name: adoptedCand.name, house: await houseName(adoptedCand.houseSlug) };
  }

  // pendingCount (ruling D): every unnamed-in-window child counted individually +
  // each in-window notice. A child past its naming season is auto-named, so any
  // still-unnamed child is within its window. Reaches 0 when nothing pends.
  const pendingCount =
    childList.filter((c) => !c.named).length +
    [spouseDeath, divorceNotice, tragedyNotice, adoptionNotice].filter(Boolean).length +
    (fellNotice ? 1 : 0) +
    (discoveredNotice ? 1 : 0);

  return {
    sex: character.sex,
    classId: character.classId,
    married: character.spouseCandidateId !== null,
    locks: { locked, marriage: marriageAllowed, adoption: !locked },
    characterIdeology: character.ideology,
    spouse,
    spouseDeath,
    divorceNotice,
    tragedyNotice,
    fellNotice,
    discoveredNotice,
    successionOutlook,
    showAdoption,
    adoptionNotice,
    pendingCount,
    candidates: { marriage: marriageOffers, adoption: adoptionOffers },
    children: childList,
    birthEvent,
  };
}

// The nav-badge count for me/state — the SAME formula as familyState.pendingCount,
// but as focused count/existence queries so me/state never pays for the full family
// payload. Every unnamed newborn + each in-window notice (ended-marriage death/
// divorce/tragedy, lover fell/discovered, adoption). The one-game-year marriage
// cooldown makes two marriage-ends in a single one-season window impossible, so
// counting ended-marriage rows matches familyState's per-notice tally.
export async function familyPendingCount(character: CharacterRow, now: Date = new Date()): Promise<number> {
  if (isFamilyLocked(character.classId, getFamilyConfig())) return 0;
  const windowStart = new Date(now.getTime() - REAL_MS_PER_SEASON);
  let count = 0;

  // Unnamed newborns (a past-window child is auto-named, so any unnamed one is in window).
  const unnamed = await db
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.parentCharacterId, character.id), isNull(children.diedAt), eq(children.named, false)));
  count += unnamed.length;

  // Ended-marriage notices (spouse death / divorce / the three tragedies) in window.
  const endedRecently = await db
    .select({ id: marriages.id })
    .from(marriages)
    .where(and(
      eq(marriages.characterId, character.id),
      inArray(marriages.endReason, ["spouse_died", "divorced", "tragedy_phaedra", "tragedy_clytemnestra", "tragedy_medea"]),
      gte(marriages.endedAt, windowStart),
    ));
  count += endedRecently.length;

  // Lover fell / discovered on the active marriage, each windowed.
  if (character.spouseCandidateId) {
    const m = (await db
      .select({ loverFellAt: marriages.loverFellAt, loverDiscoveredAt: marriages.loverDiscoveredAt })
      .from(marriages)
      .where(and(eq(marriages.characterId, character.id), eq(marriages.candidateId, character.spouseCandidateId), isNull(marriages.endedAt)))
      .limit(1))[0];
    if (m?.loverFellAt && m.loverFellAt.getTime() > windowStart.getTime()) count += 1;
    if (m?.loverDiscoveredAt && m.loverDiscoveredAt.getTime() > windowStart.getTime()) count += 1;
  }

  // Adoption notice: the adopted candidate consumed within the window.
  if (character.adoptedCandidateId) {
    const c = (await db.select({ consumedAt: familyCandidates.consumedAt }).from(familyCandidates).where(eq(familyCandidates.id, character.adoptedCandidateId)).limit(1))[0];
    if (c?.consumedAt && c.consumedAt.getTime() > windowStart.getTime()) count += 1;
  }

  return count;
}

export type MarryResult =
  | { ok: false; code: number; error: string }
  | { ok: true; spouseName: string; dowry: number; ideologyShift: number; partyFavorLoss: number; party: string };

// POST /api/family/marry — atomic: marriages row, candidate consumed, spouse set,
// dowry + cross-house penalty effects (change_ideology / change_party_favor), SSE.
export async function marry(character: CharacterRow, candidateId: string, now: Date = new Date()): Promise<MarryResult> {
  const cfg = getFamilyConfig();
  if (isFamilyLocked(character.classId, cfg)) {
    return { ok: false, code: 423, error: "No family is permitted to the unfree." };
  }
  if (!canMarry(character.classId, cfg)) {
    return { ok: false, code: 403, error: "Your station does not permit marriage." };
  }
  if (character.spouseCandidateId) {
    return { ok: false, code: 409, error: "You are already married." };
  }

  const rows = await db
    .select()
    .from(familyCandidates)
    .where(and(eq(familyCandidates.id, candidateId), eq(familyCandidates.forCharacterId, character.id)))
    .limit(1);
  const candidate = rows[0];
  if (!candidate || candidate.purpose !== "marriage" || candidate.consumedAt !== null) {
    return { ok: false, code: 409, error: "That match is no longer available." };
  }

  const penalty = marriagePenalty(character.ideology, candidate.ideology, cfg);
  const trait = candidateTrait(cfg, candidate.traitId);
  const dowry = trait?.dowryDrachmae ?? 0;
  const favorParty = character.party === "palaioi" || character.party === "dynatoi" ? character.party : null;
  const applyFavorLoss = penalty.partyFavorLoss > 0 && favorParty !== null;

  await db.transaction(async (tx) => {
    // Roll the wife's lifespan now (uniform in spouse.deathAge); she ages toward it.
    await tx.insert(marriages).values({ characterId: character.id, candidateId, spouseDeathAge: rollSpouseDeathAge(cfg) });
    await tx.update(familyCandidates).set({ consumedAt: now }).where(eq(familyCandidates.id, candidateId));

    // spouse + the child-roll anchor (the first roll comes a game year from now).
    const updates: Partial<typeof playerCharacters.$inferInsert> = { spouseCandidateId: candidateId, lastChildRollAt: now };
    if (dowry > 0) {
      updates.drachmae = character.drachmae + dowry;
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_drachmae", detail: { amount: dowry, source: "marriage:dowry" } });
    }
    if (penalty.ideologyShift !== 0) {
      updates.ideology = clampIdeology(character.ideology + penalty.ideologyShift);
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_ideology", detail: { amount: penalty.ideologyShift, value: updates.ideology, source: "marriage:cross_house" } });
    }
    await tx.update(playerCharacters).set(updates).where(eq(playerCharacters.id, character.id));

    if (applyFavorLoss) {
      await tx
        .insert(partyFavor)
        .values({ characterId: character.id, party: favorParty, favor: -penalty.partyFavorLoss })
        .onConflictDoUpdate({ target: [partyFavor.characterId, partyFavor.party], set: { favor: sql`${partyFavor.favor} - ${penalty.partyFavorLoss}` } });
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_party_favor", detail: { party: favorParty, amount: -penalty.partyFavorLoss, source: "marriage:cross_house" } });
    }
  });

  // A marriage that shifts ideology can open/close a party censure (same hook events use).
  if (penalty.ideologyShift !== 0) await onIdeologyChanged(character.id);
  // Schedule the yearly child roll (worker re-enqueues; lazy-on-read is the net).
  await enqueueChildRoll(character.id, getAgeConfig().realMsPerGameYear * cfg.candidates.drawCadenceGameYears);
  await broadcastState();

  return {
    ok: true,
    spouseName: candidate.name,
    dowry,
    ideologyShift: penalty.ideologyShift,
    partyFavorLoss: applyFavorLoss ? penalty.partyFavorLoss : 0,
    party: favorParty ?? "none",
  };
}

// --- Philia actions (pack B) ------------------------------------------------
// This pack specifies the costs/deltas literally, so they live as named constants
// local to the actions (not in family-config.json).
const GIFT_COST = 25;
const GIFT_PHILIA = 5;
const GIFT_PHILIA_REPEAT = 1; // a second gift within the same game year
const SYMPOSIUM_COST = 35;
const SYMPOSIUM_PHILIA = 8;
const SYMPOSIUM_PHILIA_GREGARIOUS = 10;
const SYMPOSIUM_PHILIA_RESERVED = 5;
const SYMPOSIUM_PRESTIGE = 1;

// The world's start instant (ms), for game-year math via gameDate().
async function worldStartedMs(worldId: string): Promise<number> {
  const rows = await db.select({ startedAt: worlds.startedAt }).from(worlds).where(eq(worlds.id, worldId)).limit(1);
  return rows[0] ? rows[0].startedAt.getTime() : Date.now();
}

export type GiftResult = { ok: true; philia: number; delta: number; diminished: boolean } | { ok: false; code: number; error: string };

// Give her a gift: −25 drachmae, +5 philia — +1 instead if already gifted this
// game year. Costs deduct atomically (buySeat pattern); philia clamps 0..100.
export async function giveGift(character: CharacterRow, now: Date = new Date()): Promise<GiftResult> {
  const spouse = await livingSpouseState(character, now);
  if (!spouse || spouse.marriageId === null) return { ok: false, code: 409, error: "You have no wife to give to." };
  if (character.drachmae < GIFT_COST) return { ok: false, code: 409, error: `A gift costs ${GIFT_COST} drachmae — you cannot afford it.` };
  const marriageId = spouse.marriageId;
  const year = gameDate(now.getTime(), await worldStartedMs(character.worldId)).yearInGame;

  try {
    const out = await db.transaction(async (tx) => {
      const paid = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} - ${GIFT_COST}` })
        .where(and(eq(playerCharacters.id, character.id), gte(playerCharacters.drachmae, GIFT_COST)))
        .returning({ drachmae: playerCharacters.drachmae });
      if (!paid.length) throw new Error("cannot_afford");
      // Read the marriage fresh inside the tx — philia may have moved since.
      const mRows = await tx.select({ philia: marriages.philia, lastGiftYear: marriages.lastGiftYear }).from(marriages).where(eq(marriages.id, marriageId)).limit(1);
      const m = mRows[0]!;
      const diminished = m.lastGiftYear === year;
      const delta = diminished ? GIFT_PHILIA_REPEAT : GIFT_PHILIA;
      const philia = clampPhilia(m.philia + delta);
      await tx.update(marriages).set({ philia, lastGiftYear: year }).where(eq(marriages.id, marriageId));
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_philia", detail: { amount: delta, source: "action:gift" } });
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_drachmae", detail: { amount: -GIFT_COST, value: paid[0]!.drachmae, source: "action:gift" } });
      return { philia, delta, diminished };
    });
    await broadcastState();
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof Error && error.message === "cannot_afford") return { ok: false, code: 409, error: `A gift costs ${GIFT_COST} drachmae — you cannot afford it.` };
    throw error;
  }
}

export type SymposiumResult = { ok: true; philia: number; delta: number; prestige: number } | { ok: false; code: number; error: string };

// Hold a symposium in her honor: −35 drachmae, +8 philia (+10 gregarious / +5
// reserved), +1 prestige — hard once per game year.
export async function holdSymposium(character: CharacterRow, now: Date = new Date()): Promise<SymposiumResult> {
  const spouse = await livingSpouseState(character, now);
  if (!spouse || spouse.marriageId === null) return { ok: false, code: 409, error: "You have no wife to honor." };
  if (character.drachmae < SYMPOSIUM_COST) return { ok: false, code: 409, error: `A symposium costs ${SYMPOSIUM_COST} drachmae — you cannot afford it.` };
  const marriageId = spouse.marriageId;
  const year = gameDate(now.getTime(), await worldStartedMs(character.worldId)).yearInGame;

  const preRows = await db.select({ lastSymposiumYear: marriages.lastSymposiumYear }).from(marriages).where(eq(marriages.id, marriageId)).limit(1);
  if (preRows[0]?.lastSymposiumYear === year) return { ok: false, code: 409, error: "You have already honored her this year." };

  const personalityId = spouse.personalityTraits[0]?.id ?? null;
  const delta = personalityId === "gregarious" ? SYMPOSIUM_PHILIA_GREGARIOUS : personalityId === "reserved" ? SYMPOSIUM_PHILIA_RESERVED : SYMPOSIUM_PHILIA;

  try {
    const out = await db.transaction(async (tx) => {
      const paid = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} - ${SYMPOSIUM_COST}` })
        .where(and(eq(playerCharacters.id, character.id), gte(playerCharacters.drachmae, SYMPOSIUM_COST)))
        .returning({ drachmae: playerCharacters.drachmae, prestige: playerCharacters.prestige, growth: playerCharacters.growthMultiplier });
      if (!paid.length) throw new Error("cannot_afford");
      // Re-guard the once-per-year cap inside the tx (double-submit race).
      const mRows = await tx.select({ philia: marriages.philia, lastSymposiumYear: marriages.lastSymposiumYear }).from(marriages).where(eq(marriages.id, marriageId)).limit(1);
      const m = mRows[0]!;
      if (m.lastSymposiumYear === year) throw new Error("already_honored");

      // Prestige +1 through the same growth+cap the change_stat effect uses.
      const applied = applyStatGrowth(SYMPOSIUM_PRESTIGE, Number(paid[0]!.growth));
      const nextPrestige = capStat(paid[0]!.prestige + applied, getAgeConfig());
      await tx.update(playerCharacters).set({ prestige: nextPrestige }).where(eq(playerCharacters.id, character.id));
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_stat", detail: { stat: "prestige", requested: SYMPOSIUM_PRESTIGE, applied, source: "action:symposium" } });

      const philia = clampPhilia(m.philia + delta);
      await tx.update(marriages).set({ philia, lastSymposiumYear: year }).where(eq(marriages.id, marriageId));
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_philia", detail: { amount: delta, source: "action:symposium" } });
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_drachmae", detail: { amount: -SYMPOSIUM_COST, value: paid[0]!.drachmae, source: "action:symposium" } });
      return { philia, delta, prestige: applied };
    });
    await broadcastState();
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof Error && error.message === "cannot_afford") return { ok: false, code: 409, error: `A symposium costs ${SYMPOSIUM_COST} drachmae — you cannot afford it.` };
    if (error instanceof Error && error.message === "already_honored") return { ok: false, code: 409, error: "You have already honored her this year." };
    throw error;
  }
}

// --- Divorce (pack B) -------------------------------------------------------
// Penalty tiers. FULL applies for any non-fallen marriage (including an active
// plot — starting the plot buys nothing until she falls). FALLEN is a quarter
// tier: divorcing a wife who has already strayed costs far less, and no dowry.
const DIVORCE_FULL = { prestige: -12, devotion: -10, composure: -50, favor: 30, dowry: 60 };
const DIVORCE_FALLEN = { prestige: -3, devotion: -2, composure: -12, favor: 8, dowry: 0 };

export type DivorcePenalties = { prestige: number; devotion: number; composure: number; partyFavor: number; drachmae: number };
export type DivorceResult = { ok: true; tier: "full" | "fallen"; penalties: DivorcePenalties; branded: boolean } | { ok: false; code: number; error: string };

// A voluntary divorce is gated until the marriage is a full game year old. Both
// divorce() and the spouse-card view resolve availability through this one helper,
// so the guard and the button can never disagree on the boundary instant.
const DIVORCE_COOLDOWN_REASON = "The city expects a marriage be given at least a year.";
function divorceCooldown(marriedAt: Date, now: Date): { available: boolean; reason: string | null } {
  const oldEnough = now.getTime() - marriedAt.getTime() >= getAgeConfig().realMsPerGameYear;
  return { available: oldEnough, reason: oldEnough ? null : DIVORCE_COOLDOWN_REASON };
}

// End the marriage on the player's initiative. Mirrors checkSpouseDeath (endedAt/
// endReason + spouseCandidateId null) and the marriage-penalty pattern. Prospects
// reopen via the widower's lazy ensureFreshDraw on the next family read (the
// spouseCandidateId=null gate) — nothing extra here.
export async function divorce(character: CharacterRow, now: Date = new Date()): Promise<DivorceResult> {
  const spouse = await livingSpouseState(character, now);
  if (!spouse || spouse.marriageId === null) return { ok: false, code: 409, error: "You have no wife to divorce." };
  const marriageId = spouse.marriageId;

  const mRows = await db.select({ loverState: marriages.loverState, marriedAt: marriages.marriedAt }).from(marriages).where(eq(marriages.id, marriageId)).limit(1);
  const marriageRow = mRows[0];
  // Cooldown: a marriage must be at least a game year old before it may be dissolved
  // voluntarily. Tragedy + spouse death end marriages regardless — they don't route here.
  if (marriageRow && !divorceCooldown(marriageRow.marriedAt, now).available) {
    return { ok: false, code: 409, error: DIVORCE_COOLDOWN_REASON };
  }
  const fallen = (marriageRow?.loverState ?? "none") === "fallen";
  const tier = fallen ? DIVORCE_FALLEN : DIVORCE_FULL;
  const returnsDowry = tier.dowry > 0 && spouse.spouseTraitId === "dowried";
  const favorParty = character.party === "palaioi" || character.party === "dynatoi" ? character.party : null;

  let prestigeApplied = 0;
  let devotionApplied = 0;
  let drachmaeApplied = 0;
  let favorApplied = 0;

  await db.transaction(async (tx) => {
    const cur = (
      await tx
        .select({ prestige: playerCharacters.prestige, devotion: playerCharacters.devotion, drachmae: playerCharacters.drachmae, growth: playerCharacters.growthMultiplier })
        .from(playerCharacters)
        .where(eq(playerCharacters.id, character.id))
        .limit(1)
    )[0]!;
    // Stats through the same growth+cap the change_stat effect uses (applyStatGrowth
    // returns negatives unscaled; capStat floors at 0).
    prestigeApplied = applyStatGrowth(tier.prestige, Number(cur.growth));
    devotionApplied = applyStatGrowth(tier.devotion, Number(cur.growth));
    const nextPrestige = capStat(cur.prestige + prestigeApplied, getAgeConfig());
    const nextDevotion = capStat(cur.devotion + devotionApplied, getAgeConfig());
    const updates: Partial<typeof playerCharacters.$inferInsert> = { prestige: nextPrestige, devotion: nextDevotion, spouseCandidateId: null };
    if (returnsDowry) {
      // Drachmae floors at 0 (the same as every change_drachmae effect path).
      const nextDrachmae = Math.max(0, cur.drachmae - tier.dowry);
      drachmaeApplied = nextDrachmae - cur.drachmae;
      updates.drachmae = nextDrachmae;
    }
    await tx.update(playerCharacters).set(updates).where(eq(playerCharacters.id, character.id));
    await tx.update(marriages).set({ endedAt: now, endReason: "divorced" }).where(eq(marriages.id, marriageId));

    await tx.insert(effectLog).values({ characterId: character.id, kind: "change_stat", detail: { stat: "prestige", requested: tier.prestige, applied: prestigeApplied, source: "divorce" } });
    await tx.insert(effectLog).values({ characterId: character.id, kind: "change_stat", detail: { stat: "devotion", requested: tier.devotion, applied: devotionApplied, source: "divorce" } });
    if (returnsDowry) {
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_drachmae", detail: { amount: drachmaeApplied, value: updates.drachmae, source: "divorce" } });
    }
    if (favorParty) {
      favorApplied = -tier.favor;
      await tx
        .insert(partyFavor)
        .values({ characterId: character.id, party: favorParty, favor: -tier.favor })
        .onConflictDoUpdate({ target: [partyFavor.characterId, partyFavor.party], set: { favor: sql`${partyFavor.favor} - ${tier.favor}` } });
      await tx.insert(effectLog).values({ characterId: character.id, kind: "change_party_favor", detail: { party: favorParty, amount: -tier.favor, source: "divorce" } });
    }
  });

  // The brand: has this life reached two voluntary divorces? Bound the count on
  // marriedAt >= createdAt — slot ids are reused across generations and becomeHeir
  // resets createdAt, so a naive characterId count would inherit a predecessor's
  // divorces (a future reader: the naive count would LOOK correct — this bound is why).
  // The trait's -2 prestige is live-computed (effectiveStats), so granting it IS the
  // penalty; no stat-row write here. Log once on the actual grant, not every divorce.
  const divorced = await db
    .select({ id: marriages.id })
    .from(marriages)
    .where(and(eq(marriages.characterId, character.id), eq(marriages.endReason, "divorced"), gte(marriages.marriedAt, character.createdAt)));
  const held = await getHeldTraits(character.id);
  let branded = held.some((t) => t.id === "notorious-divorcer");
  if (!branded && divorced.length >= 2) {
    await addTrait(character.id, "notorious-divorcer").catch(() => {}); // reputation: no cap/opposite; ignore the rare rule error
    await db.insert(effectLog).values({ characterId: character.id, kind: "reputation", detail: { traitId: "notorious-divorcer", source: "divorce" } });
    branded = true;
  }

  // Composure via the break-aware service (clamps at 0, may trigger a break).
  await applyComposureDelta(character.id, tier.composure, "divorce", now);
  await broadcastState();

  return {
    ok: true,
    tier: fallen ? "fallen" : "full",
    penalties: { prestige: prestigeApplied, devotion: devotionApplied, composure: tier.composure, partyFavor: favorApplied, drachmae: drachmaeApplied },
    branded,
  };
}

// City-wide scandal headline: the most recent Notorious Divorcer branding, shown
// for one real day (mirrors the Olympiad champion window). Any client sees it on
// its own me/state read; the Court render is a later phase. Null when stale/absent.
export async function scandalHeadline(now: Date = new Date()): Promise<{ name: string } | null> {
  const branded = await db
    .select({ name: players.name, gainedAt: characterTraits.gainedAt })
    .from(characterTraits)
    .innerJoin(playerCharacters, eq(playerCharacters.id, characterTraits.characterId))
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(eq(characterTraits.traitId, "notorious-divorcer"))
    .orderBy(desc(characterTraits.gainedAt))
    .limit(1);
  const row = branded[0];
  if (row && now.getTime() - row.gainedAt.getTime() < REAL_MS_PER_SEASON) return { name: row.name };
  return null;
}

// --- Lover plot (pack B) ----------------------------------------------------
export type LoverPlotResult = { ok: true; loverState: string } | { ok: false; code: number; error: string };

// Push the wife toward a lover. No cost, no other effects here — the yearly fall
// and discovery rolls (rollChildrenDue) and the fertility coupling do the rest.
export async function startLoverPlot(character: CharacterRow, now: Date = new Date()): Promise<LoverPlotResult> {
  const spouse = await livingSpouseState(character, now);
  if (!spouse || spouse.marriageId === null) return { ok: false, code: 409, error: "You have no wife." };
  const marriageId = spouse.marriageId;
  const mRows = await db.select({ loverState: marriages.loverState }).from(marriages).where(eq(marriages.id, marriageId)).limit(1);
  if ((mRows[0]?.loverState ?? "none") !== "none") return { ok: false, code: 409, error: "A lover is already in play." };

  await db.update(marriages).set({ loverState: "active", loverStartedAt: now }).where(eq(marriages.id, marriageId));
  await db.insert(effectLog).values({ characterId: character.id, kind: "lover_plot", detail: { action: "started" } });
  await broadcastState();
  return { ok: true, loverState: "active" };
}
