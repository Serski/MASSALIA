import type { FastifyInstance } from "fastify";
import { choiceIdeologyDelta, describeComposureDelta } from "@massalia/shared";
import { applyEventChoice, findChoice, listEvents } from "../services/eventEngine.js";
import { requireAuth } from "../services/auth.js";
import { beginAction, ensureCharacterRow, getActivePlayer, getActiveWorldId } from "../services/character.js";
import { getHeldTraits } from "../services/traits.js";
import { applyComposureDelta, getComposureConfig, recoverComposure } from "../services/composure.js";

async function actingCharacterId(userId: string): Promise<{ characterId: string } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  const character = await ensureCharacterRow(player, worldId);
  return { characterId: character.id };
}

export async function eventRoutes(app: FastifyInstance) {
  // List events with this character's precomputed composure preview per choice
  // — so the client can show the cost before the player commits.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const resolved = await actingCharacterId(user.id);
    if ("error" in resolved) {
      reply.code(resolved.code);
      return { error: resolved.error };
    }
    const traits = await getHeldTraits(resolved.characterId);
    const config = getComposureConfig();
    const events = await listEvents();
    return events.map((event) => ({
      ...event,
      choices: event.choices.map((choice) => {
        const { delta, reason } = describeComposureDelta(traits, choice.tags ?? [], choiceIdeologyDelta(choice), config);
        return { ...choice, composureDelta: delta, composureReason: reason };
      }),
    }));
  });

  app.post("/:eventId/choices/:choiceId", async (request, reply) => {
    const user = await requireAuth(request);
    const resolved = await actingCharacterId(user.id);
    if ("error" in resolved) {
      reply.code(resolved.code);
      return { error: resolved.error };
    }
    const { eventId, choiceId } = request.params as { eventId: string; choiceId: string };

    let choiceData;
    try {
      choiceData = await findChoice(eventId, choiceId);
    } catch {
      reply.code(404);
      return { error: "Unknown event or choice." };
    }

    // Action gate (respects the break/withdrawn state and the daily action cap).
    const gate = await beginAction(resolved.characterId);
    if (!gate.ok) {
      reply.code(gate.code);
      return { error: gate.error };
    }

    // Composure cost for THIS character, then apply it (clamped, logged, break).
    await recoverComposure(resolved.characterId);
    const traits = await getHeldTraits(resolved.characterId);
    const ideologyDelta = choiceIdeologyDelta(choiceData.choice);
    const { delta, reason } = describeComposureDelta(traits, choiceData.choice.tags ?? [], ideologyDelta, getComposureConfig());
    const composure = await applyComposureDelta(resolved.characterId, delta, reason);

    // Apply the choice's gameplay effects (ideology, traits, etc.).
    const result = await applyEventChoice(eventId, choiceId);

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
