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
    // Koinon prompt 2: the most one gift may be, and the Lesche (the koinon's
    // hall): its price from the treasury, its build time, its daily upkeep and
    // the member cap while it stands open.
    deposit: z.object({ max: positiveInt }),
    lesche: z.object({ cost: positiveInt, buildDays: positiveInt, upkeepPerDay: positiveInt, memberCap: positiveInt }),
    // Koinon prompt 3: how far ahead a muster may be set to march. One season
    // is 24 hours, so maxLeadHours 24 is "at most one season ahead".
    muster: z.object({ minLeadMinutes: positiveInt, maxLeadHours: positiveInt }),
  })
  .refine((c) => c.name.min <= c.name.max, { path: ["name"], message: "name.min must not exceed name.max" })
  .refine((c) => c.lesche.memberCap > c.memberCap, { path: ["lesche", "memberCap"], message: "lesche.memberCap must be above memberCap" })
  .refine((c) => c.muster.minLeadMinutes <= c.muster.maxLeadHours * 60, { path: ["muster", "minLeadMinutes"], message: "muster.minLeadMinutes must not exceed maxLeadHours" });

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
export const KOINON_EVENTS = ["founded", "joined", "left", "expelled", "leader", "lesche"] as const;
export type KoinonEvent = (typeof KOINON_EVENTS)[number];
export type KoinonChronicle = { event: KoinonEvent; koinonName: string };

// A gift to the koinon's treasury: a plain effect_log row (kind
// "koinon_deposit") on the giver's character, with no chronicle block, as a
// market trade is. `treasuryAfter` is the treasury once the gift has settled.
export type KoinonDepositDetail = { koinonId: string; koinonName: string; amount: number; treasuryAfter: number };

// --- The Lesche's upkeep -------------------------------------------------------
// The hall costs `upkeepPerDay` from the treasury from the instant it stands,
// each day paid at its start. Settled closed-form in whole days, DB-free and
// clock-free: the locked write and the read-only view both call this, so they
// agree. A hall whose day cannot be paid shuts at that moment; a shut hall owes
// nothing, and reopens at the first settle where the treasury holds a day's
// upkeep, which is paid at once.

const DAY_MS = 86_400_000;

// Instants are ms. `paidUntil` is the end of the last paid day; it starts at
// `completesAt` (null reads as that).
export type HallState = { completesAt: number | null; paidUntil: number | null; shut: boolean; treasury: number };
export type HallPhase = "none" | "building" | "open" | "shut";
export type HallSettle = { state: HallState; spent: number; open: boolean; phase: HallPhase };

export function settleHall(s: HallState, nowMs: number, upkeepPerDay: number): HallSettle {
  if (s.completesAt === null) return { state: s, spent: 0, open: false, phase: "none" };
  if (nowMs < s.completesAt) return { state: s, spent: 0, open: false, phase: "building" };
  if (s.shut) {
    if (s.treasury < upkeepPerDay) return { state: s, spent: 0, open: false, phase: "shut" };
    return { state: { ...s, paidUntil: nowMs + DAY_MS, shut: false, treasury: s.treasury - upkeepPerDay }, spent: upkeepPerDay, open: true, phase: "open" };
  }
  const paidUntil = s.paidUntil ?? s.completesAt;
  if (nowMs < paidUntil) return { state: s, spent: 0, open: true, phase: "open" };
  const needed = Math.floor((nowMs - paidUntil) / DAY_MS) + 1;
  const affordable = Math.floor(s.treasury / upkeepPerDay);
  const days = Math.min(needed, affordable);
  const spent = days * upkeepPerDay;
  const shut = affordable < needed;
  return { state: { ...s, paidUntil: paidUntil + days * DAY_MS, shut, treasury: s.treasury - spent }, spent, open: !shut, phase: shut ? "shut" : "open" };
}

// The member cap in force: the Lesche's while it stands open, else the plain one.
export function hallCap(phase: HallPhase, content: KoinonContent): number {
  return phase === "open" ? content.lesche.memberCap : content.memberCap;
}
