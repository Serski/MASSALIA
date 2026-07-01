import { z } from "zod";
import type { CharacterStats } from "./character.js";

// ---------------------------------------------------------------------------
// Age, stat cap, and old-age decay. The life-arc rides the season clock: age
// rises one game year every cfg.realMsPerGameYear (4 real days). A hard cap of
// 100 ceilings every stat; age-driven decay slides the body (and, later, the
// mind) down a slope once old. PRESTIGE never decays — reputation outlives the
// man. All constants come from content/age/age-config.json. Pure + injectable.
// ---------------------------------------------------------------------------

export const AGE_STAT_KEYS = ["prestige", "devotion", "militia", "intelligence"] as const;

// A partial per-stat map (e.g. a decay band or a creation start bonus). Empty {}
// and single-key {militia:2} must both validate — so it is NOT a full record.
const statMapSchema = z
  .object({
    prestige: z.number().optional(),
    devotion: z.number().optional(),
    militia: z.number().optional(),
    intelligence: z.number().optional(),
  })
  .strict();

export type StatMap = z.infer<typeof statMapSchema>;

export const ageConfigSchema = z
  .object({
    realMsPerGameYear: z.number(),
    statCap: z.number(),
    statFloor: z.number(),
    ageOptions: z.array(
      z.object({ age: z.number(), label: z.string(), note: z.string(), startBonus: statMapSchema }),
    ),
    avatars: z.array(
      z.object({
        id: z.string(),
        // Sex-tags the pool so marriage/succession draws can match by sex. Optional
        // with a "male" default so the pre-existing male entries (no field) validate.
        sex: z.enum(["male", "female"]).default("male"),
        startAge: z.number(),
        label: z.string(),
        portraits: z.record(z.string(), z.string()),
      }),
    ),
    portraitStages: z.array(z.object({ fromAge: z.number(), stage: z.string() })),
    deathAge: z.object({ min: z.number(), max: z.number() }),
    lifeStages: z.array(z.object({ fromAge: z.number(), name: z.string() })),
    decayBands: z.array(z.object({ fromAge: z.number(), perYear: statMapSchema })),
  })
  .strict();

export type AgeConfig = z.infer<typeof ageConfigSchema>;
export type AgeAvatar = AgeConfig["avatars"][number];

export function parseAgeConfig(data: unknown): AgeConfig {
  return ageConfigSchema.parse(data);
}

// The highest entry whose fromAge <= age (entries need not be pre-sorted).
function highestByFromAge<T extends { fromAge: number }>(items: T[], age: number): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (item.fromAge <= age && (best === undefined || item.fromAge > best.fromAge)) best = item;
  }
  return best;
}

// 3. Age = startAge + whole game years elapsed since creation.
export function currentAge(startAge: number, createdAtMs: number, nowMs: number, cfg: AgeConfig): number {
  const elapsed = Math.max(0, nowMs - createdAtMs);
  return startAge + Math.floor(elapsed / cfg.realMsPerGameYear);
}

// 4. Life stage name (Prime / Middle Age / Old / Venerable).
export function lifeStage(age: number, cfg: AgeConfig): string {
  return highestByFromAge(cfg.lifeStages, age)?.name ?? cfg.lifeStages[0]?.name ?? "Prime";
}

// 5. The per-year decay map for the band the age falls in ({} below the first band).
export function decayBandFor(age: number, cfg: AgeConfig): StatMap {
  return highestByFromAge(cfg.decayBands, age)?.perYear ?? {};
}

// 7. Clamp a stat to [statFloor, statCap]. Use EVERYWHERE a stat is written.
export function capStat(value: number, cfg: AgeConfig): number {
  return Math.min(cfg.statCap, Math.max(cfg.statFloor, value));
}

// 6. Subtract decayBandFor(age).perYear * gameYearsElapsed per stat; clamp.
// gameYearsElapsed may be fractional. Prestige is in no band → never decays.
export function applyDecay(stats: CharacterStats, age: number, gameYearsElapsed: number, cfg: AgeConfig): CharacterStats {
  const band = decayBandFor(age, cfg);
  const out: CharacterStats = { ...stats };
  for (const key of AGE_STAT_KEYS) {
    const perYear = band[key] ?? 0;
    if (perYear !== 0) out[key] = capStat(stats[key] - perYear * gameYearsElapsed, cfg);
  }
  return out;
}

// 8. Portrait stage (young / prime / old) for an age.
export function stageFor(age: number, cfg: AgeConfig): string {
  return highestByFromAge(cfg.portraitStages, age)?.stage ?? cfg.portraitStages[0]?.stage ?? "young";
}

// 9. Portrait image path for an avatar at an age. If the age's stage image is
// missing, fall back to the nearest EARLIER available stage, then any available.
export function portraitFor(avatarId: string, age: number, cfg: AgeConfig): string | null {
  const avatar = cfg.avatars.find((candidate) => candidate.id === avatarId);
  if (!avatar) return null;
  const stage = stageFor(age, cfg);
  if (avatar.portraits[stage]) return avatar.portraits[stage]!;

  const ordered = [...cfg.portraitStages].sort((a, b) => a.fromAge - b.fromAge);
  const idx = ordered.findIndex((entry) => entry.stage === stage);
  for (let i = idx - 1; i >= 0; i--) {
    const earlier = ordered[i]!.stage;
    if (avatar.portraits[earlier]) return avatar.portraits[earlier]!;
  }
  return Object.values(avatar.portraits).find(Boolean) ?? null;
}

// 10. Death helper. Defined now; NOT enforced — succession comes in a later pack.
export function isDeceased(age: number, deathAge: number): boolean {
  return age >= deathAge;
}

// --- Creation helpers ------------------------------------------------------

export function avatarById(avatarId: string, cfg: AgeConfig): AgeAvatar | undefined {
  return cfg.avatars.find((avatar) => avatar.id === avatarId);
}

export function startAgeForAvatar(avatarId: string, cfg: AgeConfig): number | null {
  return avatarById(avatarId, cfg)?.startAge ?? null;
}

export function startBonusForAge(age: number, cfg: AgeConfig): StatMap {
  return cfg.ageOptions.find((option) => option.age === age)?.startBonus ?? {};
}

// Roll a death age uniformly in [min, max] (inclusive). rng injectable for tests.
export function rollDeathAge(cfg: AgeConfig, rng: () => number = Math.random): number {
  const { min, max } = cfg.deathAge;
  return min + Math.floor(rng() * (max - min + 1));
}

export type AgeSummary = {
  age: number;
  lifeStage: string;
  decaying: StatMap;
  deceased: boolean;
};

// Convenience bundle for the read path (age + stage + which stats are decaying).
export function ageSummary(
  startAge: number,
  createdAtMs: number,
  nowMs: number,
  deathAge: number,
  cfg: AgeConfig,
): AgeSummary {
  const age = currentAge(startAge, createdAtMs, nowMs, cfg);
  return { age, lifeStage: lifeStage(age, cfg), decaying: decayBandFor(age, cfg), deceased: isDeceased(age, deathAge) };
}
