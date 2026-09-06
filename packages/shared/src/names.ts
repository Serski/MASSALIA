// ---------------------------------------------------------------------------
// Player-typed display names (character names today; the same rules apply to any
// party or house name a player may one day type). Pure and DB-free: the route
// sanitises and validates with these, and the database adds the case-insensitive
// per-world uniqueness (migration 0050).
// ---------------------------------------------------------------------------

export const DISPLAY_NAME_MAX = 64;

// Control characters (\p{Cc}) and format characters (\p{Cf}: zero-width joiners /
// spaces, bidi overrides and isolates, soft hyphens, BOM, ...) are stripped outright
// -- they are invisible, break sorting and let a name impersonate another.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

// Trim, drop invisible characters, collapse runs of whitespace, cap the length.
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, DISPLAY_NAME_MAX).trim();
}

// A name must contain at least one letter in any script -- digits, punctuation or
// symbols alone are not a name.
export function hasLetter(name: string): boolean {
  return /\p{L}/u.test(name);
}

// The comparison key matching the database's lower(name) uniqueness.
export function displayNameKey(name: string): string {
  return name.toLowerCase();
}
