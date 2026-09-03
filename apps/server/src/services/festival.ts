import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  closeDueFestivals as dbCloseDueFestivals,
  createDb,
  creditFestivalDonationCut,
  festivalDonations,
  festivalEvents,
  fireFestivalsForAll as dbFireFestivalsForAll,
  fireFestivalsForCharacterId,
  playerCharacters,
  worldStartedMs,
} from "@massalia/db";
import {
  choiceComposureEffectDelta,
  choiceIdeologyDelta,
  describeChoiceCosts,
  describeComposureDelta,
  festivalById,
  gameDate,
  parseCalendarConfig,
  type CalendarConfig,
  type EventChoice,
  type EventDefinition,
  type Trait,
} from "@massalia/shared";
import { applyChoiceInTx, choiceContentDefaults, finishChoiceEffects, listEvents } from "./eventEngine.js";
import { lockCharacterOwner } from "./lock.js";
import { getPoliticsConfig } from "./oligarchy.js";
import { applyComposureDelta, getComposureConfig, recoverComposure } from "./composure.js";
import { getHeldTraits } from "./traits.js";
import { broadcastState } from "./worldState.js";

const db = createDb();

// Thrown inside the resolve transaction when the claim matched no row (a
// concurrent resolve won); mapped to the same 409 as the pre-check.
class FestivalAlreadyResolved extends Error {
  constructor() {
    super("festival already resolved");
  }
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const configFile = path.join(repoRoot, "content/calendar/calendar-config.json");

let config: CalendarConfig | null = null;

export async function loadCalendarConfig(): Promise<CalendarConfig> {
  config = parseCalendarConfig(JSON.parse(await fs.readFile(configFile, "utf8")));
  return config;
}

export function getCalendarConfig(): CalendarConfig {
  if (!config) throw new Error("Calendar config not loaded. Call loadCalendarConfig() at boot.");
  return config;
}

type CharacterRow = typeof playerCharacters.$inferSelect;

// --- Previews (reuses the event composure-preview path) --------------------

export function composurePreview(choice: EventChoice, traits: Trait[]): { delta: number; reason: string } {
  const config = getComposureConfig();
  const tag = describeComposureDelta(traits, choice.tags ?? [], choiceIdeologyDelta(choice), config);
  const explicit = choiceComposureEffectDelta(choice);
  const delta = tag.delta + explicit;
  const reason = tag.delta !== 0 ? tag.reason : explicit !== 0 ? "the toll of the act itself" : tag.reason;
  return { delta, reason };
}

export function withPreviews(event: EventDefinition, traits: Trait[]) {
  return {
    ...event,
    choices: event.choices.map((choice) => {
      const { delta, reason } = composurePreview(choice, traits);
      return { ...choice, composureDelta: delta, composureReason: reason, costs: describeChoiceCosts(choice) };
    }),
  };
}

// --- Firing + closing (delegate to the shared DB lifecycle) ----------------
// The same functions back the BullMQ worker sweep and the lazy-on-read path.

export async function fireFestivalsForCharacter(character: CharacterRow, now: Date = new Date()): Promise<void> {
  if (character.status !== "alive") return;
  await fireFestivalsForCharacterId(character.id, getCalendarConfig(), now);
}

export async function fireFestivalsForAll(now: Date = new Date()): Promise<number> {
  return dbFireFestivalsForAll(getCalendarConfig(), now);
}

export async function closeDueFestivals(now: Date = new Date()): Promise<void> {
  const closed = await dbCloseDueFestivals(getCalendarConfig(), now);
  if (closed > 0) await broadcastState();
}

// --- The live festival for the HUD -----------------------------------------

export async function liveFestivalForCharacter(character: CharacterRow, now: Date = new Date()) {
  if (character.status !== "alive") return null;
  const started = await worldStartedMs();
  if (started === null) return null;
  const gd = gameDate(now.getTime(), started);
  const cfg = getCalendarConfig();
  const rows = await db
    .select()
    .from(festivalEvents)
    .where(and(eq(festivalEvents.characterId, character.id), eq(festivalEvents.gameYear, gd.yearInGame), eq(festivalEvents.resolved, false)));
  // Donation festivals only — Olympic deliveries (olympiad / olympiad-games) ride
  // the same table but surface through the Olympiad HUD, never this banner.
  const fe = rows.find((row) => festivalById(cfg, row.festivalId)?.type === "donation");
  if (!fe) return null;
  const event = (await listEvents()).find((e) => e.id === fe.eventId);
  if (!event) return null;
  const traits = await getHeldTraits(character.id);
  return { festivalId: fe.festivalId, gameYear: fe.gameYear, event: withPreviews(event, traits) };
}

// --- Resolve a festival choice (free civic event — no daily decision spent) -

export type FestivalResolveResult =
  | { ok: false; code: number; error: string }
  | { ok: true; resultText: string; composureDelta: number; composureReason: string; composure: number; broke: boolean; grantedTrait: string | null };

export async function resolveFestival(character: CharacterRow, festivalId: string, choiceId: string, now: Date = new Date()): Promise<FestivalResolveResult> {
  const started = await worldStartedMs();
  if (started === null) return { ok: false, code: 503, error: "No active world." };
  const gd = gameDate(now.getTime(), started);

  const rows = await db
    .select()
    .from(festivalEvents)
    .where(and(eq(festivalEvents.characterId, character.id), eq(festivalEvents.festivalId, festivalId), eq(festivalEvents.gameYear, gd.yearInGame)))
    .limit(1);
  const fe = rows[0];
  if (!fe) return { ok: false, code: 409, error: "That festival is not live for you." };
  if (fe.resolved) return { ok: false, code: 409, error: "You have already marked this festival." };

  const event = (await listEvents()).find((e) => e.id === fe.eventId);
  const choice = event?.choices.find((c) => c.id === choiceId);
  if (!event || !choice) return { ok: false, code: 404, error: "Unknown festival choice." };

  // A donation you cannot afford is rejected outright — drachmae never goes negative.
  const drachmaeCost = choice.effects
    .filter((e): e is Extract<typeof e, { type: "change_drachmae" }> => e.type === "change_drachmae")
    .reduce((sum, e) => sum + e.amount, 0);
  if (character.drachmae + drachmaeCost < 0) {
    return { ok: false, code: 409, error: "You cannot afford that donation." };
  }

  // The composure preview is judged against the traits as read here (pre-tx),
  // exactly as the HUD previewed them.
  const traits = await getHeldTraits(character.id);
  const { delta, reason } = composurePreview(choice, traits);
  const defs = await choiceContentDefaults(choice);

  // Claim-first, in ONE transaction: lock the player, flip the instance to resolved
  // (UPDATE ... WHERE resolved = false RETURNING), then composure, effects, the
  // choregos donation(s) and the treasury cut — all on the tx handle. A concurrent
  // duplicate loses the claim, rolls back, and gets the same 409 as the pre-check.
  let out: { composure: Awaited<ReturnType<typeof applyComposureDelta>>; ideologyTouched: boolean };
  try {
    out = await db.transaction(async (tx) => {
      await lockCharacterOwner(tx, character.id);
      const claimed = await tx
        .update(festivalEvents)
        .set({ resolved: true, resolvedChoiceId: choiceId })
        .where(and(eq(festivalEvents.id, fe.id), eq(festivalEvents.resolved, false)))
        .returning({ id: festivalEvents.id });
      if (!claimed.length) throw new FestivalAlreadyResolved();

      // Composure (the tag/ideology layer + explicit change_composure), then effects.
      await recoverComposure(character.id, now, tx);
      const composure = await applyComposureDelta(character.id, delta, `festival:${festivalId}`, now, tx);
      const { ideologyTouched } = await applyChoiceInTx(tx, character.id, event.id, choice, defs);

      // Record the choregos donation(s) for this festival instance, and route a cut
      // of each donation to the league treasury (Prompt 3).
      for (const effect of choice.effects) {
        if (effect.type === "register_choregos") {
          await tx.insert(festivalDonations).values({ characterId: character.id, festivalId: effect.festivalId, gameYear: gd.yearInGame, amount: effect.amount });
          await creditFestivalDonationCut(character.worldId, effect.amount, getPoliticsConfig(), now, tx);
        }
      }
      return { composure, ideologyTouched };
    });
  } catch (error) {
    if (error instanceof FestivalAlreadyResolved) return { ok: false, code: 409, error: "You have already marked this festival." };
    throw error;
  }
  const { composure } = out;
  // Post-tx passes: trait service, ideology hook, SSE broadcast.
  await finishChoiceEffects(character.id, choice, out.ideologyTouched);

  return {
    ok: true,
    resultText: choice.resultText,
    composureDelta: delta,
    composureReason: reason,
    composure: composure.composure,
    broke: composure.broke,
    grantedTrait: composure.grantedTrait,
  };
}
