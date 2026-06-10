import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  createDb,
  drawFamilyCandidates,
  effectLog,
  familyCandidates,
  houses,
  marriages,
  partyFavor,
  playerCharacters,
} from "@massalia/db";
import {
  canMarry,
  candidateTrait,
  clampIdeology,
  isFamilyLocked,
  marriagePenalty,
  parseFamilyConfig,
  type FamilyConfig,
} from "@massalia/shared";
import { getAgeConfig } from "./age.js";
import { broadcastState } from "./worldState.js";
import { onIdeologyChanged } from "./politics.js";
import { enqueueFamilyDraw } from "./queue.js";

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
  };
}

// GET /api/family payload: locks, current spouse, and the open offers (with the
// cross-house penalty preview baked into each marriage candidate).
export async function familyState(character: CharacterRow) {
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
    if (rows[0]) spouse = candidateView(rows[0], cfg, await houseName(rows[0].houseSlug));
  }

  return {
    sex: character.sex,
    classId: character.classId,
    married: character.spouseCandidateId !== null,
    locks: { locked, marriage: marriageAllowed, adoption: !locked },
    characterIdeology: character.ideology,
    spouse,
    candidates: { marriage: marriageOffers, adoption: adoptionOffers },
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
    await tx.insert(marriages).values({ characterId: character.id, candidateId });
    await tx.update(familyCandidates).set({ consumedAt: now }).where(eq(familyCandidates.id, candidateId));

    const updates: Partial<typeof playerCharacters.$inferInsert> = { spouseCandidateId: candidateId };
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
