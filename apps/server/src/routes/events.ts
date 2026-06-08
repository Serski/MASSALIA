import type { FastifyInstance } from "fastify";
import {
  choiceIdeologyDelta,
  describeComposureDelta,
  drawEvent,
  isEventEligible,
  type EligibilityContext,
  type EventChoice,
  type EventDefinition,
} from "@massalia/shared";
import { applyChoiceEffects, findChoice, listEvents, recentEventIds, recordDraw } from "../services/eventEngine.js";
import { requireAuth } from "../services/auth.js";
import { beginAction, ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { getHeldTraits } from "../services/traits.js";
import { applyComposureDelta, getComposureConfig, recoverComposure } from "../services/composure.js";

async function actingCharacter(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

function contextFor(row: CharacterRow, traitIds: string[]): EligibilityContext {
  return {
    classId: row.classId,
    party: row.party,
    isCouncilor: row.isCouncilor,
    stats: { prestige: row.prestige, devotion: row.devotion, militia: row.militia, intelligence: row.intelligence },
    traitIds,
  };
}

function withPreviews(event: EventDefinition, traits: Awaited<ReturnType<typeof getHeldTraits>>) {
  const config = getComposureConfig();
  return {
    ...event,
    choices: event.choices.map((choice: EventChoice) => {
      const { delta, reason } = describeComposureDelta(traits, choice.tags ?? [], choiceIdeologyDelta(choice), config);
      return { ...choice, composureDelta: delta, composureReason: reason };
    }),
  };
}

export async function eventRoutes(app: FastifyInstance) {
  // Eligible events for this character, each choice with a composure preview.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingCharacter(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const traits = await getHeldTraits(acting.row.id);
    const ctx = contextFor(acting.row, traits.map((t) => t.id));
    const events = (await listEvents()).filter((event) => isEventEligible(event, ctx));
    return events.map((event) => withPreviews(event, traits));
  });

  // Daily draw: one eligible event weighted by `weight`, excluding the last 5 seen.
  app.get("/draw", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingCharacter(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const traits = await getHeldTraits(acting.row.id);
    const ctx = contextFor(acting.row, traits.map((t) => t.id));
    const eligible = (await listEvents()).filter((event) => isEventEligible(event, ctx));
    const recent = await recentEventIds(acting.row.id, 5);
    const drawn = drawEvent(eligible, recent);
    if (!drawn) {
      reply.code(204);
      return null;
    }
    await recordDraw(acting.row.id, drawn.id);
    return withPreviews(drawn, traits);
  });

  app.post("/:eventId/choices/:choiceId", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingCharacter(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { eventId, choiceId } = request.params as { eventId: string; choiceId: string };

    let found;
    try {
      found = await findChoice(eventId, choiceId);
    } catch {
      reply.code(404);
      return { error: "Unknown event or choice." };
    }

    // Action gate (respects break/withdrawn + the daily action cap).
    const gate = await beginAction(acting.row.id);
    if (!gate.ok) {
      reply.code(gate.code);
      return { error: gate.error };
    }

    // Tag-driven composure cost for THIS character, then apply it.
    await recoverComposure(acting.row.id);
    const traits = await getHeldTraits(acting.row.id);
    const { delta, reason } = describeComposureDelta(traits, found.choice.tags ?? [], choiceIdeologyDelta(found.choice), getComposureConfig());
    const composure = await applyComposureDelta(acting.row.id, delta, reason);

    // Gameplay effects (atomic), then drift hook + SSE broadcast (inside).
    const result = await applyChoiceEffects(acting.row.id, eventId, found.choice);

    return {
      ...result,
      composureDelta: delta,
      composureReason: reason,
      composure: composure.composure,
      broke: composure.broke,
      grantedTrait: composure.grantedTrait,
    };
  });
}
