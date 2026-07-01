import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
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
  rollChildrenDue,
} from "@massalia/db";
import {
  canMarry,
  candidateTrait,
  childAge,
  clampIdeology,
  isFamilyLocked,
  isFertile,
  isOfAge,
  marriagePenalty,
  parseFamilyConfig,
  portraitFor,
  REAL_MS_PER_SEASON,
  rollSpouseDeathAge,
  spouseCurrentAge,
  type FamilyConfig,
} from "@massalia/shared";
import { getAgeConfig, portraitUrl } from "./age.js";
import { broadcastState } from "./worldState.js";
import { onIdeologyChanged } from "./politics.js";
import { enqueueChildRoll, enqueueFamilyDraw } from "./queue.js";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/family/family-config.json");

let config: FamilyConfig | null = null;

export async function loadFamilyConfig(): Promise<FamilyConfig> {
  config = parseFamilyConfig(JSON.parse(await fs.readFile(configFile, "utf8")));
  return config;
}

export function getFamilyConfig(): FamilyConfig {
  if (!config) throw new Error("Family config not loaded. Call loadFamilyConfig() at boot.");
  return config;
}

type CharacterRow = typeof playerCharacters.$inferSelect;
type CandidateRow = typeof familyCandidates.$inferSelect;

// One game year = the age clock's realMsPerGameYear (4 real days).
function gameYearMs(cfg: FamilyConfig): number {
  return getAgeConfig().realMsPerGameYear * cfg.candidates.drawCadenceGameYears;
}

// Lazy-on-read safety net: if the character has no unconsumed offers, draw one
// and schedule the yearly BullMQ refresh. (The worker keeps it fresh thereafter.)
export async function ensureFreshDraw(character: CharacterRow, now: Date = new Date()): Promise<void> {
  const cfg = getFamilyConfig();
  if (isFamilyLocked(character.classId, cfg)) return;

  const existing = await db
    .select({ id: familyCandidates.id })
    .from(familyCandidates)
    .where(and(eq(familyCandidates.forCharacterId, character.id), isNull(familyCandidates.consumedAt)))
    .limit(1);
  if (existing.length > 0) return;

  await drawFamilyCandidates(character.id, { familyCfg: cfg, ageCfg: getAgeConfig(), now });
  await enqueueFamilyDraw(character.id, gameYearMs(cfg));
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

function childPortrait(sex: string, cfg: FamilyConfig): string {
  return `/content/${sex === "male" ? cfg.children.portraits.boy : cfg.children.portraits.girl}`;
}

// Children list (+ lazy coming-of-age) and the pending birth event (the newest
// still-unnamed child; the default name sticks once the season passes).
async function childrenSection(character: CharacterRow, now: Date) {
  const cfg = getFamilyConfig();
  const gameYearMs = getAgeConfig().realMsPerGameYear;
  const rows = await db.select().from(children).where(eq(children.parentCharacterId, character.id)).orderBy(desc(children.bornAt));

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
      portrait: childPortrait(child.sex, cfg),
      comingOfAge: cfg.comingOfAge,
      yearsToComingOfAge: Math.max(0, cfg.comingOfAge - age),
      heirEligible: ofAge,
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
  const rows = await db.select().from(children).where(and(eq(children.id, childId), eq(children.parentCharacterId, character.id))).limit(1);
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
      spouse = {
        ...candidateView(rows[0], cfg, await houseName(rows[0].houseSlug)),
        age: currentAge,
        // Re-resolve at her CURRENT age so the portrait ages as she does.
        portrait: portraitUrl(portraitFor(rows[0].avatarId ?? "", currentAge, getAgeConfig())),
        fertile: isFertile(currentAge, cfg),
        pastChildbearing: currentAge > cfg.spouse.fertilityWindow.to,
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

  const { children: childList, birthEvent } = locked ? { children: [], birthEvent: null } : await childrenSection(character, now);

  return {
    sex: character.sex,
    classId: character.classId,
    married: character.spouseCandidateId !== null,
    locks: { locked, marriage: marriageAllowed, adoption: !locked },
    characterIdeology: character.ideology,
    spouse,
    spouseDeath,
    candidates: { marriage: marriageOffers, adoption: adoptionOffers },
    children: childList,
    birthEvent,
  };
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
