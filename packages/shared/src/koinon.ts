import { z } from "zod";
import { hasLetter, sanitizeDisplayName } from "./names.js";

// ---------------------------------------------------------------------------
// The koinon (koinon prompt 1): a player-made company of citizens. Its numbers
// live in content/koinon/koinon.json, validated at server boot; the client reads
// them from the `rules` block of GET /api/koinon. Pure and DB-free: the service
// cleans a typed name or post with these, and the database adds the per-world,
// case-insensitive uniqueness of a live koinon's name (migration 0062).
// ---------------------------------------------------------------------------

const positiveInt = z.number().int().positive();

export const koinonContentSchema = z
  .object({
    foundCost: positiveInt,
    foundPrestige: positiveInt,
    memberCap: positiveInt,
    inviteHours: positiveInt,
    cooldownHours: positiveInt,
    absentLeaderDays: positiveInt,
    name: z.object({ min: positiveInt, max: positiveInt }),
    post: z.object({ maxChars: positiveInt, kept: positiveInt }),
  })
  .refine((c) => c.name.min <= c.name.max, { path: ["name"], message: "name.min must not exceed name.max" });

export type KoinonContent = z.infer<typeof koinonContentSchema>;

export function parseKoinonContent(raw: unknown): KoinonContent {
  return koinonContentSchema.parse(raw);
}

// A typed koinon name: the display-name cleaning, then the content's length
// bounds and at least one letter. null when it is not a name.
export function cleanKoinonName(raw: unknown, content: KoinonContent): string | null {
  const name = sanitizeDisplayName(raw);
  if (name.length < content.name.min || name.length > content.name.max) return null;
  return hasLetter(name) ? name : null;
}

// Control and format characters, as names.ts strips them from a display name.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

// A board post: one paragraph. Line breaks and tabs become spaces, invisible
// characters are stripped, runs of whitespace collapse. null when nothing is
// left or the body is over the content's cap (refused, never cut short).
export function cleanKoinonPost(raw: unknown, content: KoinonContent): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/[\r\n\t]+/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (body.length === 0 || body.length > content.post.maxChars) return null;
  return body;
}

// The Chronicle's koinon line (effect_log kind "koinon", detail.chronicle).
export const KOINON_EVENTS = ["founded", "joined", "left", "expelled", "leader"] as const;
export type KoinonEvent = (typeof KOINON_EVENTS)[number];
export type KoinonChronicle = { event: KoinonEvent; koinonName: string };
