import { z } from "zod";

// ---------------------------------------------------------------------------
// Manumission — the slave's path out. A slave who has earned the freedman trait
// may buy into a citizen class, switching classId from "slave" to a chosen
// citizen class. That single switch flips every slave-locked system (routines,
// family, citizen-gated events) because they all key off the live classId.
//
// All tuning is config-driven (the manumission block in family-config.json) —
// no hardcoded class lists here.
// ---------------------------------------------------------------------------

export const manumissionConfigSchema = z
  .object({
    // The citizen classes a freedman may choose (never hetaira, never slave).
    eligibleClasses: z.array(z.string()),
    // The trait that unlocks the choice (earned via the manumission event).
    requiresTrait: z.string(),
  })
  .strict();

export type ManumissionConfig = z.infer<typeof manumissionConfigSchema>;

// Classes manumission may NEVER target, whatever the config says — a freed slave
// becomes a male citizen, not a hetaira and not a slave again.
const NEVER_ELIGIBLE = new Set(["hetaira", "slave"]);

// Eligible ONLY while still a slave who holds the required trait. Because it is
// gated on classId === "slave", a freed citizen is no longer eligible — so
// manumission cannot re-trigger once taken.
export function canManumit(classId: string, heldTraitIds: string[], cfg: ManumissionConfig): boolean {
  return classId === "slave" && heldTraitIds.includes(cfg.requiresTrait);
}

// The citizen classes a freedman may buy into — the configured set, with hetaira
// and slave defensively filtered out even if a config ever listed them.
export function manumissionChoices(cfg: ManumissionConfig): string[] {
  return cfg.eligibleClasses.filter((classId) => !NEVER_ELIGIBLE.has(classId));
}

// Whether a target class is a valid manumission destination.
export function isManumissionTarget(classId: string, cfg: ManumissionConfig): boolean {
  return manumissionChoices(cfg).includes(classId);
}
