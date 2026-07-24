import type { FastifyInstance } from "fastify";
import {
  choiceComposureEffectDelta,
  choiceIdeologyDelta,
  describeChoiceCosts,
  describeComposureDelta,
  gameDate,
  isCalendarEvent,
  isEventEligible,
  isWithdrawn,
  type ComposureConfig,
  type EligibilityContext,
  type EventChoice,
  type EventDefinition,
  type Trait,
} from "@massalia/shared";
import { applyChoiceEffects, findChoice, listEvents } from "../services/eventEngine.js";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorld, type CharacterRow } from "../services/character.js";
import { familyEligibilityContext } from "../services/family.js";
import { getHeldTraits } from "../services/traits.js";
import { applyComposureDelta, getComposureConfig, recoverComposure } from "../services/composure.js";
import { ensureDailySet, findDailyCard, getDailySet, markCardResolved } from "../services/dailyDecisions.js";

async function actingCharacter(userId: string): Promise<{ row: CharacterRow; startedMs: number } | { error: string; code: number }> {
  const world = await getActiveWorld();
  if (!world) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, world.id);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, world.id), startedMs: world.startedMs };
}

// The eligibility context. Family fields default to unmarried/childless and are
// filled only when `enrich` is set — the daily draw enriches ONLY on the winter
// day so a non-winter draw pays zero spouse/children queries.
async function contextFor(row: CharacterRow, traitIds: string[], now: Date, enrich: boolean): Promise<EligibilityContext> {
  const base: EligibilityContext = {
    classId: row.classId,
    party: row.party,
    isCouncilor: row.isCouncilor,
    stats: { prestige: row.prestige, devotion: row.devotion, militia: row.militia, intelligence: row.intelligence },
    traitIds,
    married: false,
    spouseTraitIds: [],
    livingChildren: [],
  };
  return enrich ? { ...base, ...(await familyEligibilityContext(row, now)) } : base;
}

function isWinterDay(now: Date, startedMs: number): boolean {
  return gameDate(now.getTime(), startedMs).seasonOfYear === 0;
}

// Net composure change for a choice = the trait/ideology-driven layer PLUS any
// explicit change_composure effects. Combined so the preview equals what resolving
// actually applies — never a hidden composure cost.
function composurePreview(choice: EventChoice, traits: Trait[], config: ComposureConfig): { delta: number; reason: string } {
  const tag = describeComposureDelta(traits, choice.tags ?? [], choiceIdeologyDelta(choice), config);
  const explicit = choiceComposureEffectDelta(choice);
  const delta = tag.delta + explicit;
  const reason = tag.delta !== 0 ? tag.reason : explicit !== 0 ? "the toll of the act itself" : tag.reason;
  return { delta, reason };
}

function withPreviews(event: EventDefinition, traits: Trait[]) {
  const config = getComposureConfig();
  return {
    ...event,
    choices: event.choices.map((choice: EventChoice) => {
      const { delta, reason } = composurePreview(choice, traits, config);
      return { ...choice, composureDelta: delta, composureReason: reason, costs: describeChoiceCosts(choice) };
    }),
  };
}

export async function eventRoutes(app: FastifyInstance) {
  // Full eligible list (debug / future use).
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingCharacter(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const traits = await getHeldTraits(acting.row.id);
    // Debug/future-use list: enrich so family events reflect real eligibility.
    const ctx = await contextFor(acting.row, traits.map((t) => t.id), new Date(), true);
    return (await listEvents()).filter((event) => !isCalendarEvent(event) && isEventEligible(event, ctx)).map((event) => withPreviews(event, traits));
  });

  // The curated daily decision set: one card per arena (class/general/council/party),
  // stable for the UTC day, each resolvable once.
  app.get("/daily", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingCharacter(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const now = new Date();
    const traits = await getHeldTraits(acting.row.id);
    // The family arena fires only on the winter day; enrich (spouse/children) only
    // then so non-winter draws pay zero extra queries.
    const winter = isWinterDay(now, acting.startedMs);
    const ctx = await contextFor(acting.row, traits.map((t) => t.id), now, winter);
    const set = await ensureDailySet(acting.row.id, ctx, now, acting.startedMs);
    const events = await listEvents();

    const cards = set
      .map((card) => {
        const event = events.find((e) => e.id === card.eventId);
        if (!event) return null;
        const resolvedChoice = card.resolvedChoiceId
          ? event.choices.find((c) => c.id === card.resolvedChoiceId)
          : undefined;
        return {
          arena: card.arena,
          resolved: card.resolved,
          resolvedChoiceId: card.resolvedChoiceId,
          resolvedResult: resolvedChoice?.resultText ?? null,
          event: withPreviews(event, traits),
        };
      })
      .filter((card): card is NonNullable<typeof card> => card !== null);

    return {
      withdrawn: isWithdrawn(acting.row.breakUntil, now),
      remaining: cards.filter((c) => !c.resolved).length,
      cards,
    };
  });

  app.post("/:eventId/choices/:choiceId", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingCharacter(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { eventId, choiceId } = request.params as { eventId: string; choiceId: string };
    const now = new Date();

    let found;
    try {
      found = await findChoice(eventId, choiceId);
    } catch {
      reply.code(404);
      return { error: "Unknown event or choice." };
    }

    // Gate: a composure break locks the day; otherwise the card must be one of
    // today's unresolved decisions.
    if (isWithdrawn(acting.row.breakUntil, now)) {
      reply.code(423);
      return { error: "You have withdrawn from public life and cannot act today." };
    }
    // Make sure today's set exists (so direct resolves are validated against it).
    const traits = await getHeldTraits(acting.row.id);
    const winter = isWinterDay(now, acting.startedMs);
    const ctx = await contextFor(acting.row, traits.map((t) => t.id), now, winter);
    await ensureDailySet(acting.row.id, ctx, now, acting.startedMs);
    const card = await findDailyCard(acting.row.id, eventId, now);
    if (!card) {
      reply.code(409);
      return { error: "That decision is not part of today's set." };
    }
    if (card.resolved) {
      reply.code(409);
      return { error: "You have already resolved that decision today." };
    }

    // Combined composure cost for THIS character (trait/ideology layer + explicit
    // change_composure effects), applied once so it matches the preview exactly.
    await recoverComposure(acting.row.id);
    const { delta, reason } = composurePreview(found.choice, traits, getComposureConfig());
    const composure = await applyComposureDelta(acting.row.id, delta, reason);

    // Gameplay effects (atomic), then mark the card resolved.
    const result = await applyChoiceEffects(acting.row.id, eventId, found.choice);
    await markCardResolved(card.id, choiceId);

    const remaining = (await getDailySet(acting.row.id, now)).filter((c) => !c.resolved).length;
    return {
      ...result,
      arena: card.arena,
      composureDelta: delta,
      composureReason: reason,
      composure: composure.composure,
      broke: composure.broke,
      grantedTrait: composure.grantedTrait,
      remaining,
    };
  });
}
