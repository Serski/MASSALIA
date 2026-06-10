import { and, eq, sql } from "drizzle-orm";
import { children, createDb, dynasties, familyCandidates, playerCharacters, players, successions } from "@massalia/db";
import {
  capStat,
  childAge,
  currentAge,
  defaultChildName,
  generateCandidates,
  inheritance,
  lifeStage,
  rollDeathAge,
  successionPlan,
  type CharacterStats,
  type FamilyConfig,
  type StatBlock,
  type Sex,
} from "@massalia/shared";
import { getAgeConfig } from "./age.js";
import { getFamilyConfig } from "./family.js";
import { getComposureConfig } from "./composure.js";
import { getHeldTraits } from "./traits.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

type CharacterRow = typeof playerCharacters.$inferSelect;
type CandidateRow = typeof familyCandidates.$inferSelect;

const LADDER_PREFIXES = ["rhetoric", "philosophia", "gymnasium", "mysteries"];

function deadStats(row: CharacterRow): StatBlock {
  return { prestige: row.prestige, devotion: row.devotion, militia: row.militia, intelligence: row.intelligence };
}

function randomAdultAvatar(): string | null {
  const avatars = getAgeConfig().avatars;
  // Art is generic placeholder; pick any adult avatar (matched to sex once female art lands).
  return avatars.length ? avatars[Math.floor(Math.random() * avatars.length)]!.id : null;
}

async function childInfos(characterId: string, now: Date) {
  const gameYearMs = getAgeConfig().realMsPerGameYear;
  const rows = await db.select().from(children).where(eq(children.parentCharacterId, characterId));
  return rows.map((c) => ({ id: c.id, age: childAge(c.bornAt.getTime(), now.getTime(), gameYearMs), sex: c.sex as Sex, name: c.name }));
}

// The deceased's highest-tier ladder trait name (for the epitaph), if any.
async function topLadderTrait(characterId: string): Promise<string | null> {
  const held = await getHeldTraits(characterId);
  const ladder = held.filter((t) => LADDER_PREFIXES.some((p) => t.id.startsWith(`${p}-`)));
  if (!ladder.length) return null;
  const tier = (id: string) => Number(id.split("-").pop() ?? 0);
  return ladder.reduce((best, t) => (tier(t.id) > tier(best.id) ? t : best)).name;
}

async function playerName(playerId: string): Promise<string> {
  const rows = await db.select({ name: players.name }).from(players).where(eq(players.id, playerId)).limit(1);
  return rows[0]?.name ?? "Your forebear";
}

// Mutate the single slot (players row + player_characters row) into the heir. The
// always-inherited set (house, holdings, drachmae, oligarch seat / is_councilor)
// is simply NOT reset. Records a successions row + increments the dynasty
// generation unless `recordKind` is null (a regency starts in trust, no handoff yet).
async function becomeHeir(
  slot: CharacterRow,
  heir: { name: string; sex: Sex; age: number; avatarId: string | null; stats: StatBlock; isRegent?: boolean; regentForChildId?: string | null; drachmae?: number; isCouncilor?: boolean },
  recordKind: "blood" | "adopted" | "regent_handoff" | "fresh" | null,
  now: Date,
  removeChildId?: string,
): Promise<void> {
  const ageCfg = getAgeConfig();
  const startingComposure = getComposureConfig().startingComposure ?? 70;

  if (recordKind && slot.dynastyId) {
    const fromName = await playerName(slot.playerId);
    const fromAge = currentAge(slot.startAge, slot.createdAt.getTime(), now.getTime(), ageCfg);
    await db.update(dynasties).set({ generation: sql`${dynasties.generation} + 1` }).where(eq(dynasties.id, slot.dynastyId));
    await db.insert(successions).values({
      dynastyId: slot.dynastyId,
      fromCharacterId: slot.id,
      toCharacterId: slot.id,
      kind: recordKind,
      fromName,
      fromAge,
      toName: heir.name,
    });
  }

  await db.update(players).set({ name: heir.name, faceId: heir.avatarId }).where(eq(players.id, slot.playerId));

  const updates: Partial<typeof playerCharacters.$inferInsert> = {
    status: "alive",
    prestige: capStat(heir.stats.prestige, ageCfg),
    devotion: capStat(heir.stats.devotion, ageCfg),
    militia: capStat(heir.stats.militia, ageCfg),
    intelligence: capStat(heir.stats.intelligence, ageCfg),
    sex: heir.sex,
    avatarId: heir.avatarId,
    startAge: heir.age,
    createdAt: now,
    deathAge: rollDeathAge(ageCfg),
    composure: startingComposure,
    lastComposureUpdate: now,
    breakUntil: null,
    breaksCount: 0,
    lastDecayAt: now,
    // The heir starts unmarried; the spouse + child-roll state resets.
    spouseCandidateId: null,
    lastChildRollAt: null,
    isRegent: heir.isRegent ?? false,
    regentForChildId: heir.regentForChildId ?? null,
    adoptedCandidateId: null,
  };
  if (heir.drachmae !== undefined) updates.drachmae = heir.drachmae;
  if (heir.isCouncilor !== undefined) updates.isCouncilor = heir.isCouncilor;
  await db.update(playerCharacters).set(updates).where(eq(playerCharacters.id, slot.id));

  if (removeChildId) await db.delete(children).where(eq(children.id, removeChildId));
  await broadcastState();
}

// Generate one adult successor draft (used for the auto-regent), aged in
// regentStartAgeRange, with its own rolled stats + avatar.
function generateAdult(cfg: FamilyConfig, ageBand: [number, number]) {
  // Reuse the candidate generator, then place the age in the requested band.
  const [draft] = generateCandidates(Math.random, "adoption", 1, cfg, [{ slug: "xanthippos", ideology: 0 }]);
  const age = ageBand[0] + Math.floor(Math.random() * (ageBand[1] - ageBand[0] + 1));
  return { ...draft!, age };
}

// --- Death enforcement + regency handoff (lazy on read; BullMQ checkpoint too) --

// Acts on the age pack's death tracking: when a living character reaches death_age
// (or a regent's ward comes of age), open succession / hand off. Callable directly
// so future assassination/battle reuse this exact path.
export async function enforceDeathAndHandoff(characterId: string, now: Date = new Date()): Promise<void> {
  const rows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const row = rows[0];
  if (!row || row.status !== "alive") return;
  const cfg = getFamilyConfig();
  const ageCfg = getAgeConfig();

  // Regency auto-handoff: the ward reaches coming-of-age -> the child takes over.
  if (row.isRegent && row.regentForChildId) {
    const wardRows = await db.select().from(children).where(eq(children.id, row.regentForChildId)).limit(1);
    const ward = wardRows[0];
    if (ward && childAge(ward.bornAt.getTime(), now.getTime(), ageCfg.realMsPerGameYear) >= cfg.comingOfAge) {
      const stats = bloodStats(deadStats(row), cfg, cfg.succession.prestigeCarryover.regent);
      await becomeHeir(
        row,
        { name: ward.name, sex: ward.sex as Sex, age: cfg.succession.heirStartAge, avatarId: randomAdultAvatar(), stats, isRegent: false, regentForChildId: null },
        "regent_handoff",
        now,
        ward.id,
      );
      return;
    }
  }

  // Death: reaching death_age opens succession (status -> deceased; resolved by the player).
  const age = currentAge(row.startAge, row.createdAt.getTime(), now.getTime(), ageCfg);
  if (row.deathAge !== null && age >= row.deathAge) {
    await db.update(playerCharacters).set({ status: "deceased" }).where(eq(playerCharacters.id, characterId));
    await broadcastState();
  }
}

// Blood-style stats: the 3 non-prestige stats rolled fresh + a +1 nudge, with
// prestige carried over at the given rate.
function bloodStats(dead: StatBlock, cfg: FamilyConfig, carryoverRate: number): StatBlock {
  const rolled = inheritance(dead, "blood", cfg, { rng: Math.random });
  return { ...rolled, prestige: Math.floor(dead.prestige * carryoverRate) + (highestIsPrestige(dead) ? 1 : 0) };
}
function highestIsPrestige(s: StatBlock): boolean {
  return s.prestige >= s.devotion && s.prestige >= s.militia && s.prestige >= s.intelligence;
}

// --- Succession state + resolution -----------------------------------------

async function hasAdopted(row: CharacterRow): Promise<boolean> {
  return row.adoptedCandidateId !== null;
}

export async function successionInfo(row: CharacterRow, now: Date = new Date()) {
  if (row.status !== "deceased") return null;
  const cfg = getFamilyConfig();
  const ageCfg = getAgeConfig();
  const kids = await childInfos(row.id, now);
  const plan = successionPlan({ classId: row.classId }, kids, await hasAdopted(row), cfg);

  const epitaphName = await playerName(row.playerId);
  const age = currentAge(row.startAge, row.createdAt.getTime(), now.getTime(), ageCfg);
  const ladder = await topLadderTrait(row.id);

  // For the forced-adoption path, surface the 3 candidate choices.
  let candidates: { id: string; name: string; sex: string; age: number; houseSlug: string }[] = [];
  if (plan.kind === "forced_adoption") {
    candidates = (await db
      .select()
      .from(familyCandidates)
      .where(and(eq(familyCandidates.forCharacterId, row.id), eq(familyCandidates.purpose, "adoption"))))
      .filter((c) => c.consumedAt === null)
      .map((c) => ({ id: c.id, name: c.name, sex: c.sex, age: c.age, houseSlug: c.houseSlug }));
  }

  // Preview the named heir where one is determined.
  let heirPreview: { name: string; relation: string } | null = null;
  if (plan.kind === "blood") {
    const heir = kids.find((k) => k.id === plan.heirChildId);
    if (heir) heirPreview = { name: heir.name, relation: heir.sex === "male" ? "your eldest son" : "your eldest daughter" };
  } else if (plan.kind === "regency") {
    const ward = kids.find((k) => k.id === plan.regentForChildId);
    if (ward) heirPreview = { name: ward.name, relation: `your young ${ward.sex === "male" ? "son" : "daughter"} — a regent will govern until ${ward.name} comes of age` };
  }

  return {
    pending: true,
    epitaph: { name: epitaphName, age, lifeStage: lifeStage(age, ageCfg), ladderTrait: ladder },
    plan: { kind: plan.kind },
    heir: heirPreview,
    candidates,
  };
}

export type SucceedResult = { ok: false; code: number; error: string } | { ok: true; heirName: string; kind: string };

// Resolve a pending succession into a living heir who reuses the slot.
export async function resolveSuccession(row: CharacterRow, candidateId: string | undefined, now: Date = new Date()): Promise<SucceedResult> {
  if (row.status !== "deceased") return { ok: false, code: 409, error: "No succession is pending." };
  const cfg = getFamilyConfig();
  const kids = await childInfos(row.id, now);
  const plan = successionPlan({ classId: row.classId }, kids, await hasAdopted(row), cfg);
  const dead = deadStats(row);

  if (plan.kind === "blood") {
    const heir = kids.find((k) => k.id === plan.heirChildId)!;
    const stats = inheritance(dead, "blood", cfg, { rng: Math.random });
    await becomeHeir(row, { name: heir.name, sex: heir.sex, age: cfg.succession.heirStartAge, avatarId: randomAdultAvatar(), stats }, "blood", now, heir.id);
    return { ok: true, heirName: heir.name, kind: "blood" };
  }

  if (plan.kind === "adopted") {
    const candRows = await db.select().from(familyCandidates).where(eq(familyCandidates.id, row.adoptedCandidateId!)).limit(1);
    const cand = candRows[0];
    if (!cand) return { ok: false, code: 409, error: "The adopted heir is no longer available." };
    await applyAdoptedHeir(row, cand, now, "adopted");
    return { ok: true, heirName: cand.name, kind: "adopted" };
  }

  if (plan.kind === "regency") {
    const ward = kids.find((k) => k.id === plan.regentForChildId)!;
    const regent = generateAdult(cfg, cfg.succession.regentStartAgeRange);
    // The regent governs in trust: their OWN stats, holding the oligarch seat for the ward.
    await becomeHeir(
      row,
      { name: regent.name, sex: regent.sex, age: regent.age, avatarId: randomAdultAvatar(), stats: { prestige: regent.prestige, devotion: regent.devotion, militia: regent.militia, intelligence: regent.intelligence }, isRegent: true, regentForChildId: ward.id },
      null, // a regency does not advance the generation — that waits for the handoff
      now,
    );
    return { ok: true, heirName: regent.name, kind: "regency" };
  }

  if (plan.kind === "forced_adoption") {
    if (!candidateId) return { ok: false, code: 400, error: "Choose an heir to adopt." };
    const candRows = await db
      .select()
      .from(familyCandidates)
      .where(and(eq(familyCandidates.id, candidateId), eq(familyCandidates.forCharacterId, row.id)))
      .limit(1);
    const cand = candRows[0];
    if (!cand || cand.purpose !== "adoption" || cand.consumedAt !== null) return { ok: false, code: 409, error: "That heir is no longer available." };
    await applyAdoptedHeir(row, cand, now, "adopted");
    return { ok: true, heirName: cand.name, kind: "adopted" };
  }

  // fresh (slave): a clean new character — the unfree leave nothing behind.
  const name = defaultChildName(row.sex as Sex);
  const r = cfg.candidates.statRanges;
  const fresh: StatBlock = {
    prestige: r.prestige[0] + Math.floor(Math.random() * (r.prestige[1] - r.prestige[0] + 1)),
    devotion: r.devotion[0] + Math.floor(Math.random() * (r.devotion[1] - r.devotion[0] + 1)),
    militia: r.militia[0] + Math.floor(Math.random() * (r.militia[1] - r.militia[0] + 1)),
    intelligence: r.intelligence[0] + Math.floor(Math.random() * (r.intelligence[1] - r.intelligence[0] + 1)),
  };
  await becomeHeir(row, { name, sex: row.sex as Sex, age: cfg.succession.heirStartAge, avatarId: randomAdultAvatar(), stats: fresh, drachmae: 10, isCouncilor: false }, "fresh", now);
  return { ok: true, heirName: name, kind: "fresh" };
}

async function applyAdoptedHeir(row: CharacterRow, cand: CandidateRow, now: Date, kind: "adopted"): Promise<void> {
  const cfg = getFamilyConfig();
  const candStats: CharacterStats = { prestige: cand.prestige, devotion: cand.devotion, militia: cand.militia, intelligence: cand.intelligence };
  const stats = inheritance(deadStats(row), "adopted", cfg, { candidate: candStats });
  await db.update(familyCandidates).set({ consumedAt: now }).where(eq(familyCandidates.id, cand.id));
  await becomeHeir(row, { name: cand.name, sex: cand.sex as Sex, age: cand.age, avatarId: cand.avatarId, stats }, kind, now);
}

// --- Adoption (and adopt-to-exit during a regency) -------------------------

export type AdoptResult = { ok: false; code: number; error: string } | { ok: true; heirName: string; endedRegency: boolean };

export async function adopt(row: CharacterRow, candidateId: string, now: Date = new Date()): Promise<AdoptResult> {
  const candRows = await db
    .select()
    .from(familyCandidates)
    .where(and(eq(familyCandidates.id, candidateId), eq(familyCandidates.forCharacterId, row.id)))
    .limit(1);
  const cand = candRows[0];
  if (!cand || cand.purpose !== "adoption" || cand.consumedAt !== null) return { ok: false, code: 409, error: "That ward is no longer available." };

  // Adopt-to-exit: during a regency, adopting an adult ends the regency NOW — the
  // adoptee becomes the played character; the minor ward stays as a future heir.
  if (row.isRegent) {
    await applyAdoptedHeir(row, cand, now, "adopted");
    return { ok: true, heirName: cand.name, endedRegency: true };
  }

  // Otherwise: designate an adopted heir for the succession ladder (path b).
  await db.update(familyCandidates).set({ consumedAt: now }).where(eq(familyCandidates.id, cand.id));
  await db.update(playerCharacters).set({ adoptedCandidateId: cand.id }).where(eq(playerCharacters.id, row.id));
  await broadcastState();
  return { ok: true, heirName: cand.name, endedRegency: false };
}

// HUD regent badge: ward + countdown to coming-of-age + the barred offices the
// (future) election system must respect.
export async function regentBadge(row: CharacterRow, now: Date = new Date()) {
  if (!row.isRegent || !row.regentForChildId) return null;
  const cfg = getFamilyConfig();
  const wardRows = await db.select().from(children).where(eq(children.id, row.regentForChildId)).limit(1);
  const ward = wardRows[0];
  const wardAge = ward ? childAge(ward.bornAt.getTime(), now.getTime(), getAgeConfig().realMsPerGameYear) : 0;
  return {
    isRegent: true,
    wardName: ward?.name ?? "the heir",
    wardComingOfAgeInYears: Math.max(0, cfg.comingOfAge - wardAge),
    barredOffices: cfg.regency.barredOffices as string[],
    keepsInTrust: cfg.regency.keepsInTrust as string[],
  };
}

// Whether a regent may stand for / hold a given office (the API gate for the
// future election system). Regents are barred from cfg.regency.barredOffices.
export function regentMayHoldOffice(row: CharacterRow, office: string): boolean {
  if (!row.isRegent) return true;
  return !(getFamilyConfig().regency.barredOffices as string[]).includes(office);
}

// Dynasty header + succession history for the family panel.
export async function dynastyInfo(row: CharacterRow) {
  if (!row.dynastyId) return null;
  const dyn = (await db.select().from(dynasties).where(eq(dynasties.id, row.dynastyId)).limit(1))[0];
  if (!dyn) return null;
  const history = await db.select().from(successions).where(eq(successions.dynastyId, row.dynastyId)).orderBy(successions.occurredAt);
  return {
    name: dyn.name,
    generation: dyn.generation,
    history: history.map((h) => ({ kind: h.kind, fromName: h.fromName, fromAge: h.fromAge, toName: h.toName, at: h.occurredAt.toISOString() })),
  };
}
