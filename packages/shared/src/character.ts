import { z } from "zod";
import type { HeldTrait } from "./traits.js";

// ---------------------------------------------------------------------------
// Player character foundation: class/party vocab, starting data, action economy.
// Pure + server-shared. Note the HOPLITE rename (was "military-leader").
// ---------------------------------------------------------------------------

export const CLASS_IDS = [
  "landowner",
  "trader",
  "philosopher",
  "hetaira",
  "hoplite",
  "shipbuilder",
  "priest",
  "slave",
] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const PARTIES = ["none", "palaioi", "dynatoi"] as const;
export type Party = (typeof PARTIES)[number];

export type CharacterStats = {
  prestige: number;
  devotion: number;
  militia: number;
  intelligence: number;
};

export type StatBonus = Partial<CharacterStats>;

// House starting data. ideology: -100 = Traditionalist (left) .. +100 = Reformist
// (right). Bonuses are added to base 0 stats at creation.
export const HOUSE_START: Record<string, { ideology: number; bonus: StatBonus }> = {
  leonidas: { ideology: -80, bonus: { devotion: 2 } },
  timon: { ideology: -55, bonus: { prestige: 2 } },
  iason: { ideology: -35, bonus: { prestige: 1, intelligence: 1 } },
  herakleides: { ideology: -25, bonus: { intelligence: 2 } },
  aristeides: { ideology: -5, bonus: { militia: 2 } },
  xanthippos: { ideology: 0, bonus: { prestige: 1, intelligence: 1 } },
  philon: { ideology: 20, bonus: { devotion: 1, intelligence: 1 } },
  nicanor: { ideology: 30, bonus: { intelligence: 1, militia: 1 } },
  miltiades: { ideology: 45, bonus: { prestige: 1, devotion: 1 } },
  kleitos: { ideology: 60, bonus: { prestige: 2 } },
};

// Class starting data. Slave begins poorer but with a hidden growth multiplier.
export const CLASS_START: Record<ClassId, { bonus: StatBonus; drachmae: number; growthMultiplier: number }> = {
  landowner: { bonus: { prestige: 2 }, drachmae: 100, growthMultiplier: 1.0 },
  trader: { bonus: { intelligence: 2 }, drachmae: 100, growthMultiplier: 1.0 },
  philosopher: { bonus: { intelligence: 3 }, drachmae: 100, growthMultiplier: 1.0 },
  hetaira: { bonus: { prestige: 2, intelligence: 1 }, drachmae: 100, growthMultiplier: 1.0 },
  hoplite: { bonus: { militia: 3 }, drachmae: 100, growthMultiplier: 1.0 },
  shipbuilder: { bonus: { intelligence: 2, militia: 1 }, drachmae: 100, growthMultiplier: 1.0 },
  priest: { bonus: { devotion: 3 }, drachmae: 100, growthMultiplier: 1.0 },
  slave: { bonus: {}, drachmae: 10, growthMultiplier: 1.5 },
};

export const ACTIONS_PER_DAY = 2;
export const STARTING_COMPOSURE = 70;
export const IDEOLOGY_MIN = -100;
export const IDEOLOGY_MAX = 100;

export type StartingCharacter = CharacterStats & {
  drachmae: number;
  ideology: number;
  growthMultiplier: number;
  composure: number;
  party: Party;
};

function addBonus(base: CharacterStats, bonus: StatBonus): CharacterStats {
  return {
    prestige: base.prestige + (bonus.prestige ?? 0),
    devotion: base.devotion + (bonus.devotion ?? 0),
    militia: base.militia + (bonus.militia ?? 0),
    intelligence: base.intelligence + (bonus.intelligence ?? 0),
  };
}

// Server-authoritative starting sheet: house ideology + house bonus + class stats.
export function startingCharacter(houseId: string, classId: ClassId): StartingCharacter {
  const house = HOUSE_START[houseId];
  const klass = CLASS_START[classId];
  if (!house) throw new Error(`Unknown house: ${houseId}`);
  if (!klass) throw new Error(`Unknown class: ${classId}`);

  let stats: CharacterStats = { prestige: 0, devotion: 0, militia: 0, intelligence: 0 };
  stats = addBonus(stats, house.bonus);
  stats = addBonus(stats, klass.bonus);

  return {
    ...stats,
    drachmae: klass.drachmae,
    ideology: clampIdeology(house.ideology),
    growthMultiplier: klass.growthMultiplier,
    composure: STARTING_COMPOSURE,
    party: "none",
  };
}

export function clampIdeology(value: number): number {
  return Math.max(IDEOLOGY_MIN, Math.min(IDEOLOGY_MAX, Math.round(value)));
}

// --- Action economy (no-loop lazy daily reset) -----------------------------

// UTC midnight (ms) for the day containing `date`.
export function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isNewUtcDay(lastReset: Date | null | undefined, now: Date): boolean {
  if (!lastReset) return true;
  return utcDayStart(lastReset) < utcDayStart(now);
}

export type ActionState = { actionsSpentToday: number; lastActionReset: Date | null };

// Lazy reset: if we've crossed into a new UTC day since lastActionReset, zero the
// counter and stamp the reset. Returns the (possibly) updated state + whether it changed.
export function applyDailyReset(state: ActionState, now: Date): ActionState & { didReset: boolean } {
  if (isNewUtcDay(state.lastActionReset, now)) {
    return { actionsSpentToday: 0, lastActionReset: now, didReset: true };
  }
  return { ...state, didReset: false };
}

export function remainingActions(actionsSpentToday: number): number {
  return Math.max(0, ACTIONS_PER_DAY - actionsSpentToday);
}

export type SpendResult =
  | { ok: true; state: ActionState; remaining: number }
  | { ok: false; reason: "no_actions"; state: ActionState; remaining: number };

// Apply lazy reset, then spend one action if any remain.
export function spendAction(state: ActionState, now: Date): SpendResult {
  const reset = applyDailyReset(state, now);
  const base: ActionState = { actionsSpentToday: reset.actionsSpentToday, lastActionReset: reset.lastActionReset };
  if (base.actionsSpentToday >= ACTIONS_PER_DAY) {
    return { ok: false, reason: "no_actions", state: base, remaining: 0 };
  }
  const next: ActionState = {
    actionsSpentToday: base.actionsSpentToday + 1,
    lastActionReset: base.lastActionReset,
  };
  return { ok: true, state: next, remaining: remainingActions(next.actionsSpentToday) };
}

// --- Zod input validation --------------------------------------------------

export const HOUSE_IDS = Object.keys(HOUSE_START) as [string, ...string[]];

export const createCharacterSchema = z.object({
  houseId: z.enum(HOUSE_IDS),
  classId: z.enum(CLASS_IDS),
});
export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

// Full sheet returned by the API (derived fields included). `base` is the stored
// stat columns; `effective` = base + trait statMods (computed on read).
export type CharacterSheet = {
  id: string;
  playerId: string;
  worldId: string;
  houseId: string;
  classId: ClassId;
  base: CharacterStats;
  effective: CharacterStats;
  drachmae: number;
  ideology: number;
  party: Party;
  composure: number;
  // True while under a break (withdrawn from public life until breakUntil).
  withdrawn: boolean;
  growthMultiplier: number;
  actionsSpentToday: number;
  remainingActions: number;
  lastActionReset: string | null;
  createdAt: string;
  traits: HeldTrait[];
  // Active party censure (ideology drift). null when not censured.
  censured: boolean;
  censureExpiresAt: string | null;
};
