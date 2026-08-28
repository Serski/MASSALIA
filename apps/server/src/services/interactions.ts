import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { characterTraits, createDb, houses, interactions, players, playerCharacters, resources } from "@massalia/db";
import { assassinateSuccessChance, currentAge, effectiveStats, parseInteractionsConfig, poisonSuccessChance, type CharacterStats, type InteractionsConfig } from "@massalia/shared";
import type { CharacterRow } from "./character.js";
import { getAgeConfig } from "./age.js";
import { seatOf } from "./oligarchy.js";
import { getHeldTraits } from "./traits.js";
import { buildingContext, settledPopCount, type ActingContext } from "./buildings.js";
import { enforceDeathAndHandoff } from "./succession.js";
import { broadcastState } from "./worldState.js";

const POISON_TRAIT = "poisoned";

const db = createDb();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/politics/interactions.json");

let config: InteractionsConfig | null = null;

export async function loadInteractionsConfig(): Promise<InteractionsConfig> {
  const raw = JSON.parse(await fs.readFile(configFile, "utf8"));
  config = parseInteractionsConfig(raw);
  return config;
}

export function getInteractionsConfig(): InteractionsConfig {
  if (!config) throw new Error("Interactions config not loaded — call loadInteractionsConfig() at boot.");
  return config;
}

// --- The lock reasons a viewer sees on a profile. These are the exact strings the
// web renders under a disabled interaction button (visible-but-locked). ---------
const LOCK_DEAD = "The dead make no dealings.";
const LOCK_NO_SEAT = "Requires a seat in the chamber.";
const POISON_NO_STANDING = "Target lacks standing.";
const POISON_NO_POISON = "You hold no poison.";
const TREAT_NOT_AFFLICTED = "You are not afflicted.";
const TREAT_NO_PHYSICIAN = "No physician attends you.";
const TREAT_NO_REMEDY = "You hold no remedy.";
// "Target lacks standing." is shared by both hostile channels' prestige-floor lock.
const NO_STANDING = POISON_NO_STANDING;
const bladeCostMessage = (cost: number) => `A blade costs ${cost} drachmae — you cannot afford it.`;

// A compact remaining-time string for the cooldown copy ("1d 6h" / "6h").
function formatCooldownRemaining(ms: number): string {
  const hours = Math.ceil(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return rem ? `${days}d ${rem}h` : `${days}d`;
  }
  return `${Math.max(1, hours)}h`;
}
// The lock a viewer sees / an attempt returns while a hostile move is still cooling
// down against this target. NEW PLAYER-FACING COPY — flagged for review.
const cooldownLockMessage = (remainingMs: number) =>
  `Your hand is already turned against them — two seasons must pass before you strike again (${formatCooldownRemaining(remainingMs)} left).`;

export interface PublicProfile {
  characterId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  classId: string;
  party: string;
  // The dynastic chamber seat this character holds, if any (public fact).
  seatIndex: number | null;
  // The ONLY raw stat exposed — standings are rank-only by design, so the profile
  // shows public facts (prestige is the political-standing signal), not the sheet.
  prestige: number;
  isAlive: boolean;
  // Server-computed: this profile is the viewer's own character. The web hides the
  // interaction row on your own profile; the server value is authoritative (the
  // caller's isSelf hint is only a fallback).
  isSelf: boolean;
  viewer: {
    isOligarch: boolean;
    canInteract: boolean;
    // Precedence: dead target → not an oligarch → self. null when the viewer may
    // interact, and null (with canInteract false) on the viewer's own profile.
    lockReason: string | null;
    // The poison action (Prompt 2). canPoison mirrors the poisonAttempt gates
    // (minus the roll); poisonLockReason gives the visible-but-locked hint in
    // precedence order: dead → not an oligarch → target lacks standing → no poison.
    canPoison: boolean;
    poisonLockReason: string | null;
    // The assassinate action (Prompt 3). Same shape; precedence: dead → not an
    // oligarch → target lacks standing → can't afford the blade. The cost is exposed
    // so the web's confirm step can show it without hardcoding the config value.
    canAssassinate: boolean;
    assassinateLockReason: string | null;
    assassinateCost: number;
  };
}

// GET /api/interactions/profile/:characterId — the public character profile a
// viewer opens from the hemicycle or standings. Public facts only (no raw sheet).
export async function publicProfile(viewerRow: CharacterRow, characterId: string, now: Date = new Date()): Promise<PublicProfile | null> {
  const rows = await db
    .select({
      id: playerCharacters.id,
      classId: playerCharacters.classId,
      party: playerCharacters.party,
      prestige: playerCharacters.prestige,
      status: playerCharacters.status,
      houseSlug: playerCharacters.houseSlug,
      name: players.name,
      houseName: houses.name,
    })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .leftJoin(houses, eq(houses.slug, playerCharacters.houseSlug))
    .where(eq(playerCharacters.id, characterId))
    .limit(1);
  const target = rows[0];
  if (!target) return null;

  const isAlive = target.status === "alive";
  const isSelf = target.id === viewerRow.id;
  const isOligarch = (await seatOf(viewerRow.id)) !== null;
  const seat = await seatOf(target.id);

  // Precedence: a dead target locks first, then a viewer without a seat, then
  // self (no lock reason — the web hides the interaction row on your own profile).
  let lockReason: string | null = null;
  if (!isAlive) lockReason = LOCK_DEAD;
  else if (!isOligarch) lockReason = LOCK_NO_SEAT;
  const canInteract = isAlive && isOligarch && !isSelf;

  // The shared hostile cooldown for this viewer→target pair (poison + assassinate).
  // Both gates read it after standing, mirroring the attempt paths.
  const cooldownMs = isSelf ? 0 : await hostileCooldownRemainingMs(viewerRow.id, target.id, now);
  const onCooldown = cooldownMs > 0;

  // Poison gate (Prompt 2) — same order as poisonAttempt's gates, minus the roll.
  const { prestigeFloor } = getInteractionsConfig();
  const viewerPoison = isSelf ? 0 : await heldResourceAmount(viewerRow.playerId, "poison");
  let poisonLockReason: string | null = null;
  if (isSelf) poisonLockReason = null;
  else if (!isAlive) poisonLockReason = LOCK_DEAD;
  else if (!isOligarch) poisonLockReason = LOCK_NO_SEAT;
  else if (target.prestige < prestigeFloor) poisonLockReason = POISON_NO_STANDING;
  else if (onCooldown) poisonLockReason = cooldownLockMessage(cooldownMs);
  else if (viewerPoison < 1) poisonLockReason = POISON_NO_POISON;
  const canPoison = isAlive && isOligarch && !isSelf && target.prestige >= prestigeFloor && !onCooldown && viewerPoison >= 1;

  // Assassinate gate (Prompt 3) — same order as assassinateAttempt's gates, minus the roll.
  const assassinate = getInteractionsConfig().actions.assassinate;
  const canAfford = viewerRow.drachmae >= assassinate.costDrachmae;
  let assassinateLockReason: string | null = null;
  if (isSelf) assassinateLockReason = null;
  else if (!isAlive) assassinateLockReason = LOCK_DEAD;
  else if (!isOligarch) assassinateLockReason = LOCK_NO_SEAT;
  else if (target.prestige < prestigeFloor) assassinateLockReason = NO_STANDING;
  else if (onCooldown) assassinateLockReason = cooldownLockMessage(cooldownMs);
  else if (!canAfford) assassinateLockReason = bladeCostMessage(assassinate.costDrachmae);
  const canAssassinate = isAlive && isOligarch && !isSelf && target.prestige >= prestigeFloor && !onCooldown && canAfford;

  return {
    characterId: target.id,
    name: target.name,
    houseSlug: target.houseSlug,
    houseName: target.houseName ?? target.houseSlug,
    classId: target.classId,
    party: target.party,
    seatIndex: seat?.holderType === "player" ? seat.seatIndex : null,
    prestige: target.prestige,
    isAlive,
    isSelf,
    viewer: { isOligarch, canInteract, lockReason, canPoison, poisonLockReason, canAssassinate, assassinateLockReason, assassinateCost: assassinate.costDrachmae },
  };
}

// The whole-unit amount of a player-scoped resource (e.g. poison, remedy) a player
// holds. Resources are keyed by (scope='player', scopeId=playerId, type); the
// balance is a numeric string floored to an integer for the gate checks.
async function heldResourceAmount(playerId: string, type: string): Promise<number> {
  const rows = await db
    .select({ amount: resources.amount })
    .from(resources)
    .where(and(eq(resources.scope, "player"), eq(resources.scopeId, playerId), eq(resources.type, type)))
    .limit(1);
  return Math.floor(Number(rows[0]?.amount ?? 0));
}

// The remaining hostile cooldown (ms) for this attacker→target pair — 0 when clear.
// One hostile attempt (poison OR assassinate, combined) per pair per
// hostileCooldownHours, counted from the attempt regardless of outcome: every real
// attempt writes a poison/assassinate ledger row (failures included), so the most
// recent such row against this target starts the clock.
async function hostileCooldownRemainingMs(actorId: string, targetId: string, now: Date): Promise<number> {
  const windowMs = getInteractionsConfig().hostileCooldownHours * 3_600_000;
  const rows = await db
    .select({ createdAt: interactions.createdAt })
    .from(interactions)
    .where(and(eq(interactions.actorCharacterId, actorId), eq(interactions.targetCharacterId, targetId), inArray(interactions.type, ["poison", "assassinate"])))
    .orderBy(desc(interactions.createdAt))
    .limit(1);
  const last = rows[0]?.createdAt;
  if (!last) return 0;
  return Math.max(0, windowMs - (now.getTime() - last.getTime()));
}

// --- Give drachmae (Interaction Pipeline, Prompt 1) --------------------------

export type GiveResult =
  | { ok: false; code: number; error: string }
  | { ok: true; amount: number; wallet: number };

// POST /api/interactions/give: a seat-holding, living oligarch sends drachmae to
// another living citizen. Gates run in order (actor alive → actor holds a seat →
// integer amount within bounds → target exists/alive/same-world/not-self → actor
// can afford). Then ONE transaction: a guarded decrement on the actor (mirrors
// buySeat's conditional deduction), an increment on the living target, and the
// interactions ledger row — any guard failing rolls the whole thing back.
export async function giveDrachmae(actorRow: CharacterRow, targetCharacterId: string, amount: number): Promise<GiveResult> {
  const give = getInteractionsConfig().actions.give;

  if (actorRow.status !== "alive") return { ok: false, code: 409, error: LOCK_DEAD };
  if (!(await seatOf(actorRow.id))) return { ok: false, code: 403, error: LOCK_NO_SEAT };
  if (!Number.isInteger(amount) || amount < give.minAmount || amount > give.maxAmount) {
    return { ok: false, code: 400, error: `A gift must be a whole sum between ${give.minAmount} and ${give.maxAmount} drachmae.` };
  }

  const targetRows = await db
    .select({ id: playerCharacters.id, worldId: playerCharacters.worldId, status: playerCharacters.status })
    .from(playerCharacters)
    .where(eq(playerCharacters.id, targetCharacterId))
    .limit(1);
  const target = targetRows[0];
  if (!target) return { ok: false, code: 404, error: "No such citizen." };
  if (target.worldId !== actorRow.worldId) return { ok: false, code: 404, error: "No such citizen." };
  if (target.id === actorRow.id) return { ok: false, code: 409, error: "You cannot send drachmae to yourself." };
  if (target.status !== "alive") return { ok: false, code: 409, error: LOCK_DEAD };

  if (actorRow.drachmae < amount) return { ok: false, code: 409, error: "You cannot afford that gift." };

  let wallet: number;
  try {
    wallet = await db.transaction(async (tx) => {
      // Conditional deduction: re-checks the balance (and liveness) inside the
      // transaction, so two concurrent gifts can never overdraw the actor.
      const paid = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} - ${amount}` })
        .where(and(eq(playerCharacters.id, actorRow.id), gte(playerCharacters.drachmae, amount), eq(playerCharacters.status, "alive")))
        .returning({ drachmae: playerCharacters.drachmae });
      if (!paid.length) throw new Error("cannot_afford");

      // Credit the target, still guarded on their liveness (they could have died
      // between the pre-check and here).
      const credited = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} + ${amount}` })
        .where(and(eq(playerCharacters.id, targetCharacterId), eq(playerCharacters.status, "alive")))
        .returning({ id: playerCharacters.id });
      if (!credited.length) throw new Error("target_gone");

      await tx.insert(interactions).values({
        worldId: actorRow.worldId,
        actorCharacterId: actorRow.id,
        targetCharacterId,
        type: "give",
        payload: { amount },
      });
      return paid[0]!.drachmae;
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "cannot_afford") return { ok: false, code: 409, error: "You cannot afford that gift." };
    if (message === "target_gone") return { ok: false, code: 409, error: LOCK_DEAD };
    throw error;
  }

  await broadcastState();
  return { ok: true, amount, wallet };
}

// --- Poison (Interaction Pipeline, Prompt 2) --------------------------------

export type PoisonOutcome = "ill" | "dead" | "failed";
export type PoisonResult =
  | { ok: false; code: number; error: string }
  | { ok: true; outcome: PoisonOutcome };

// DEBUG-ONLY rng override for live verification (mirrors merc's MERC_FORCE_OUTCOME):
// POISON_FORCE_OUTCOME=ill|dead|fail pins the success roll then the severity roll.
// Unset in normal play → the real Math.random rolls.
function forcedPoisonRng(): (() => number) | undefined {
  switch (process.env.POISON_FORCE_OUTCOME) {
    case "ill": return sequence([0, 0]); // success, then illness (< illnessChance)
    case "dead": return sequence([0, 0.999999]); // success, then death (>= illnessChance)
    case "fail": return () => 0.999999; // roll always >= p → never succeeds
    default: return undefined;
  }
}
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

function baseStatsOf(row: { prestige: number; devotion: number; militia: number; intelligence: number }): CharacterStats {
  return { prestige: row.prestige, devotion: row.devotion, militia: row.militia, intelligence: row.intelligence };
}
async function effectiveIntelligence(characterId: string, base: CharacterStats): Promise<number> {
  return effectiveStats(base, await getHeldTraits(characterId)).intelligence;
}

// The spymaster's contribution to a hostile attempt (Prompt 4), applied at both
// channels' call sites. The ATTACKER's hunt bonus (added to A) and the TARGET's
// guard bonus (added to D) each apply only when that side retains a spymaster —
// read through the SETTLED path (settleAll → player_pops), same as physician/
// bodyguard — in that posture. A dismissed spymaster contributes nothing despite a
// persisted posture, because the count read comes back 0.
async function spymasterMods(
  actorRow: CharacterRow,
  target: { spymasterPosture: string },
  targetCtx: ActingContext | null,
  now: Date,
): Promise<{ huntBonus: number; targetGuard: number }> {
  const spy = getInteractionsConfig().spymaster;
  const actorCtx = await buildingContext(actorRow.playerId, actorRow.worldId);
  const actorHasSpy = actorCtx ? (await settledPopCount(actorCtx, "spymaster", now)) >= 1 : false;
  const huntBonus = actorHasSpy && actorRow.spymasterPosture === "hunt" ? spy.huntMod : 0;
  const targetHasSpy = targetCtx ? (await settledPopCount(targetCtx, "spymaster", now)) >= 1 : false;
  const targetGuard = targetHasSpy && target.spymasterPosture === "guard" ? spy.guardMod : 0;
  return { huntBonus, targetGuard };
}

// POST /api/interactions/poison: a seat-holding oligarch attempts to poison a
// standing target. Gates run in order (actor alive → holds a seat → target exists/
// alive/same-world/not-self → target meets the prestige floor → actor holds poison).
// The success chance is a hidden, lazily-computed defense channel (poisonSuccessChance);
// a physician the target retains lifts their defense. On success, illnessChance
// splits illness (the 'poisoned' affliction) vs. death (reuses the succession path).
// The attempt spends one poison whatever the outcome; failures leave no target-visible
// record (only the actor's return value reveals the outcome).
export async function poisonAttempt(
  actorRow: CharacterRow,
  targetCharacterId: string,
  now: Date = new Date(),
  rng: () => number = forcedPoisonRng() ?? Math.random,
): Promise<PoisonResult> {
  const cfg = getInteractionsConfig();
  const poison = cfg.actions.poison;

  if (actorRow.status !== "alive") return { ok: false, code: 409, error: LOCK_DEAD };
  if (!(await seatOf(actorRow.id))) return { ok: false, code: 403, error: LOCK_NO_SEAT };

  const targetRows = await db
    .select({
      id: playerCharacters.id,
      playerId: playerCharacters.playerId,
      worldId: playerCharacters.worldId,
      status: playerCharacters.status,
      prestige: playerCharacters.prestige,
      devotion: playerCharacters.devotion,
      militia: playerCharacters.militia,
      intelligence: playerCharacters.intelligence,
      startAge: playerCharacters.startAge,
      createdAt: playerCharacters.createdAt,
      spymasterPosture: playerCharacters.spymasterPosture,
    })
    .from(playerCharacters)
    .where(eq(playerCharacters.id, targetCharacterId))
    .limit(1);
  const target = targetRows[0];
  if (!target) return { ok: false, code: 404, error: "No such citizen." };
  if (target.worldId !== actorRow.worldId) return { ok: false, code: 404, error: "No such citizen." };
  if (target.id === actorRow.id) return { ok: false, code: 409, error: "You cannot poison yourself." };
  if (target.status !== "alive") return { ok: false, code: 409, error: LOCK_DEAD };
  if (target.prestige < cfg.prestigeFloor) return { ok: false, code: 403, error: POISON_NO_STANDING };
  // One hostile attempt per pair per window (poison + assassinate share it). Checked
  // after standing and before any vial is spent — a refusal consumes nothing.
  const poisonCooldownMs = await hostileCooldownRemainingMs(actorRow.id, target.id, now);
  if (poisonCooldownMs > 0) return { ok: false, code: 429, error: cooldownLockMessage(poisonCooldownMs) };
  if ((await heldResourceAmount(actorRow.playerId, "poison")) < 1) return { ok: false, code: 409, error: POISON_NO_POISON };

  // Resolution — every read server-side; nothing about the defense is persisted. The
  // physician + spymaster counts are read through the SETTLED path (settleAll →
  // player_pops), never a raw unsettled count. The attacker's spymaster (in 'hunt')
  // lifts A; the target's spymaster (in 'guard') lifts D alongside the physician.
  const targetCtx = await buildingContext(target.playerId, actorRow.worldId);
  const { huntBonus, targetGuard } = await spymasterMods(actorRow, target, targetCtx, now);
  const attackIntel = (await effectiveIntelligence(actorRow.id, baseStatsOf(actorRow))) + huntBonus;
  const hasPhysician = targetCtx ? (await settledPopCount(targetCtx, "physician", now)) >= 1 : false;
  const defenderIntel = await effectiveIntelligence(target.id, baseStatsOf(target));
  const chance = poisonSuccessChance(attackIntel, defenderIntel, hasPhysician, targetGuard, poison);

  const success = rng() < chance;
  const outcome: PoisonOutcome = !success ? "failed" : rng() < poison.illnessChance ? "ill" : "dead";

  // Death path sets death_age to the current whole-year age; the succession handoff
  // (status → deceased) runs AFTER the tx — it re-reads and locks the same row, so it
  // cannot run inside the tx without deadlocking.
  const deathAge = Math.floor(currentAge(target.startAge, target.createdAt.getTime(), now.getTime(), getAgeConfig()));

  try {
    await db.transaction(async (tx) => {
      // Guarded consume: one poison is spent whatever the outcome. The >= 1 guard is
      // the concurrency backstop (two attempts can never spend a single vial).
      const consumed = await tx
        .update(resources)
        .set({ amount: sql`${resources.amount} - 1` })
        .where(and(eq(resources.scope, "player"), eq(resources.scopeId, actorRow.playerId), eq(resources.type, "poison"), sql`${resources.amount} >= 1`))
        .returning({ id: resources.id });
      if (!consumed.length) throw new Error("no_poison");

      if (outcome === "ill") {
        // The 'poisoned' affliction has no personality cap and no opposite, so this
        // direct insert is behaviorally identical to addTrait — kept on the tx so the
        // consume + effect + ledger stay atomic (the trait service takes no tx).
        await tx.insert(characterTraits).values({ characterId: target.id, traitId: POISON_TRAIT }).onConflictDoNothing();
      } else if (outcome === "dead") {
        await tx.update(playerCharacters).set({ deathAge }).where(eq(playerCharacters.id, target.id));
      }

      await tx.insert(interactions).values({
        worldId: actorRow.worldId,
        actorCharacterId: actorRow.id,
        targetCharacterId: target.id,
        type: "poison",
        payload: { outcome },
      });
    });
  } catch (error) {
    if ((error as Error).message === "no_poison") return { ok: false, code: 409, error: POISON_NO_POISON };
    throw error;
  }

  if (outcome === "dead") await enforceDeathAndHandoff(target.id, now);
  await broadcastState();
  return { ok: true, outcome };
}

// --- Treat (cure your own poisoning) ----------------------------------------

export type TreatResult = { ok: false; code: number; error: string } | { ok: true };

// POST /api/interactions/treat: a self-action. Gates in order (holds 'poisoned' →
// a physician attends → holds a remedy). One tx: consume the remedy, remove the
// affliction, log a self-targeted 'treat' interaction (its chronicle line).
export async function treat(actorRow: CharacterRow, now: Date = new Date()): Promise<TreatResult> {
  const held = await getHeldTraits(actorRow.id);
  if (!held.some((t) => t.id === POISON_TRAIT)) return { ok: false, code: 409, error: TREAT_NOT_AFFLICTED };

  const ctx = await buildingContext(actorRow.playerId, actorRow.worldId);
  const physicians = ctx ? await settledPopCount(ctx, "physician", now) : 0;
  if (physicians < 1) return { ok: false, code: 409, error: TREAT_NO_PHYSICIAN };
  if ((await heldResourceAmount(actorRow.playerId, "remedy")) < 1) return { ok: false, code: 409, error: TREAT_NO_REMEDY };

  try {
    await db.transaction(async (tx) => {
      const consumed = await tx
        .update(resources)
        .set({ amount: sql`${resources.amount} - 1` })
        .where(and(eq(resources.scope, "player"), eq(resources.scopeId, actorRow.playerId), eq(resources.type, "remedy"), sql`${resources.amount} >= 1`))
        .returning({ id: resources.id });
      if (!consumed.length) throw new Error("no_remedy");

      // Direct delete mirrors removeTrait (no tx-aware service) — kept atomic with
      // the remedy spend + ledger row.
      await tx.delete(characterTraits).where(and(eq(characterTraits.characterId, actorRow.id), eq(characterTraits.traitId, POISON_TRAIT)));

      await tx.insert(interactions).values({
        worldId: actorRow.worldId,
        actorCharacterId: actorRow.id,
        targetCharacterId: actorRow.id,
        type: "treat",
        payload: {},
      });
    });
  } catch (error) {
    if ((error as Error).message === "no_remedy") return { ok: false, code: 409, error: TREAT_NO_REMEDY };
    throw error;
  }

  await broadcastState();
  return { ok: true };
}

// --- Assassinate (Interaction Pipeline, Prompt 3) ---------------------------

export type AssassinateOutcome = "dead" | "failed";
export type AssassinateResult =
  | { ok: false; code: number; error: string }
  | { ok: true; outcome: AssassinateOutcome };

// DEBUG-ONLY rng override (mirrors merc's MERC_FORCE_OUTCOME): ASSASSINATE_FORCE_OUTCOME
// =dead|fail pins the single success roll. Unset in normal play → the real Math.random.
function forcedAssassinateRng(): (() => number) | undefined {
  switch (process.env.ASSASSINATE_FORCE_OUTCOME) {
    case "dead": return () => 0; // roll always < p → succeeds
    case "fail": return () => 0.999999; // roll always >= p → fails
    default: return undefined;
  }
}

// POST /api/interactions/assassinate: a seat-holding oligarch pays for a blade against
// a standing target. Gates mirror poison's order (actor alive → holds a seat → target
// exists/alive/same-world/not-self → prestige floor → actor affords the cost). The
// success chance is the hidden bodyguard-defense channel (assassinateSuccessChance);
// each bodyguard the target retains adds diminishing defense. On success the target
// dies (reuses the succession path). The blade is paid whatever the outcome; failure
// leaves a target-visible chronicle line (an anonymous "a blade was turned aside").
export async function assassinateAttempt(
  actorRow: CharacterRow,
  targetCharacterId: string,
  now: Date = new Date(),
  rng: () => number = forcedAssassinateRng() ?? Math.random,
): Promise<AssassinateResult> {
  const cfg = getInteractionsConfig();
  const assassinate = cfg.actions.assassinate;
  const cost = assassinate.costDrachmae;

  if (actorRow.status !== "alive") return { ok: false, code: 409, error: LOCK_DEAD };
  if (!(await seatOf(actorRow.id))) return { ok: false, code: 403, error: LOCK_NO_SEAT };

  const targetRows = await db
    .select({
      id: playerCharacters.id,
      playerId: playerCharacters.playerId,
      worldId: playerCharacters.worldId,
      status: playerCharacters.status,
      prestige: playerCharacters.prestige,
      devotion: playerCharacters.devotion,
      militia: playerCharacters.militia,
      intelligence: playerCharacters.intelligence,
      startAge: playerCharacters.startAge,
      createdAt: playerCharacters.createdAt,
      spymasterPosture: playerCharacters.spymasterPosture,
    })
    .from(playerCharacters)
    .where(eq(playerCharacters.id, targetCharacterId))
    .limit(1);
  const target = targetRows[0];
  if (!target) return { ok: false, code: 404, error: "No such citizen." };
  if (target.worldId !== actorRow.worldId) return { ok: false, code: 404, error: "No such citizen." };
  if (target.id === actorRow.id) return { ok: false, code: 409, error: "You cannot mark yourself." };
  if (target.status !== "alive") return { ok: false, code: 409, error: LOCK_DEAD };
  if (target.prestige < cfg.prestigeFloor) return { ok: false, code: 403, error: NO_STANDING };
  // One hostile attempt per pair per window (poison + assassinate share it). Checked
  // after standing and before the blade is paid — a refusal consumes nothing.
  const bladeCooldownMs = await hostileCooldownRemainingMs(actorRow.id, target.id, now);
  if (bladeCooldownMs > 0) return { ok: false, code: 429, error: cooldownLockMessage(bladeCooldownMs) };
  if (actorRow.drachmae < cost) return { ok: false, code: 409, error: bladeCostMessage(cost) };

  // Resolution — every read server-side. The bodyguard + spymaster counts are read
  // through the SETTLED path (settleAll → player_pops), the same channel physicians
  // use. The attacker's spymaster (in 'hunt') lifts A; the target's spymaster (in
  // 'guard') lifts D alongside the bodyguards.
  const targetCtx = await buildingContext(target.playerId, actorRow.worldId);
  const { huntBonus, targetGuard } = await spymasterMods(actorRow, target, targetCtx, now);
  const attackIntel = (await effectiveIntelligence(actorRow.id, baseStatsOf(actorRow))) + huntBonus;
  const bodyguards = targetCtx ? await settledPopCount(targetCtx, "bodyguard", now) : 0;
  const defenderIntel = await effectiveIntelligence(target.id, baseStatsOf(target));
  const chance = assassinateSuccessChance(attackIntel, defenderIntel, bodyguards, targetGuard, assassinate);

  const outcome: AssassinateOutcome = rng() < chance ? "dead" : "failed";
  const deathAge = Math.floor(currentAge(target.startAge, target.createdAt.getTime(), now.getTime(), getAgeConfig()));

  try {
    await db.transaction(async (tx) => {
      // Guarded decrement (buySeat pattern): the blade is paid whatever the outcome.
      // The gte + alive guard is the concurrency backstop against overdraw.
      const paid = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} - ${cost}` })
        .where(and(eq(playerCharacters.id, actorRow.id), gte(playerCharacters.drachmae, cost), eq(playerCharacters.status, "alive")))
        .returning({ id: playerCharacters.id });
      if (!paid.length) throw new Error("cannot_afford");

      if (outcome === "dead") {
        await tx.update(playerCharacters).set({ deathAge }).where(eq(playerCharacters.id, target.id));
      }

      await tx.insert(interactions).values({
        worldId: actorRow.worldId,
        actorCharacterId: actorRow.id,
        targetCharacterId: target.id,
        type: "assassinate",
        payload: { outcome },
      });
    });
  } catch (error) {
    if ((error as Error).message === "cannot_afford") return { ok: false, code: 409, error: bladeCostMessage(cost) };
    throw error;
  }

  if (outcome === "dead") await enforceDeathAndHandoff(target.id, now);
  await broadcastState();
  return { ok: true, outcome };
}

// --- Spymaster posture (Interaction Pipeline, Prompt 4) ---------------------

const SPY_NONE = "You retain no spymaster.";
const SPY_COOLDOWN = "Your spymaster needs a season to redirect his web.";
const SPY_SAME = "Your spymaster already keeps this posture.";

export type SpymasterStatus = { posture: string; cooldownRemainingMs: number };

// The posture + remaining cooldown for a character, derived from the persisted
// columns + config. Cheap (no settle) — the web already knows retention from the
// owned pop count on the same surface, so this only carries the posture state.
export function spymasterStatus(row: CharacterRow, now: Date = new Date()): SpymasterStatus {
  const cooldownMs = getInteractionsConfig().spymaster.postureCooldownHours * 3_600_000;
  const changed = row.spymasterPostureChangedAt;
  const cooldownRemainingMs = changed ? Math.max(0, changed.getTime() + cooldownMs - now.getTime()) : 0;
  return { posture: row.spymasterPosture, cooldownRemainingMs };
}

export type SetPostureResult = { ok: false; code: number; error: string } | { ok: true; posture: string };

// POST /api/interactions/spymaster-posture: switch the retained spymaster's posture.
// Gates in order: retains a spymaster (settled read) → valid posture → one-switch-
// per-season cooldown → not already this posture. Sets both columns on success.
export async function setSpymasterPosture(actorRow: CharacterRow, posture: string, now: Date = new Date()): Promise<SetPostureResult> {
  const spy = getInteractionsConfig().spymaster;
  const ctx = await buildingContext(actorRow.playerId, actorRow.worldId);
  const retains = ctx ? (await settledPopCount(ctx, "spymaster", now)) >= 1 : false;
  if (!retains) return { ok: false, code: 409, error: SPY_NONE };
  if (posture !== "guard" && posture !== "hunt") return { ok: false, code: 400, error: "A posture must be 'guard' or 'hunt'." };

  const cooldownMs = spy.postureCooldownHours * 3_600_000;
  const changed = actorRow.spymasterPostureChangedAt;
  if (changed && now.getTime() - changed.getTime() < cooldownMs) return { ok: false, code: 409, error: SPY_COOLDOWN };
  if (actorRow.spymasterPosture === posture) return { ok: false, code: 409, error: SPY_SAME };

  await db
    .update(playerCharacters)
    .set({ spymasterPosture: posture, spymasterPostureChangedAt: now })
    .where(eq(playerCharacters.id, actorRow.id));
  await broadcastState();
  return { ok: true, posture };
}
