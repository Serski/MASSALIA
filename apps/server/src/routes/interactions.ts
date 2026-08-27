import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { assassinateAttempt, giveDrachmae, poisonAttempt, publicProfile, setSpymasterPosture, treat } from "../services/interactions.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function interactionRoutes(app: FastifyInstance) {
  // The public character profile — public facts + the viewer's interaction gates.
  app.get("/profile/:characterId", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { characterId } = request.params as { characterId: string };
    const profile = await publicProfile(acting.row, characterId);
    if (!profile) {
      reply.code(404);
      return { error: "No such citizen." };
    }
    return profile;
  });

  // Send drachmae to another citizen (the first player→player action).
  app.post("/give", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { targetCharacterId?: string; amount?: number } | undefined;
    if (!body?.targetCharacterId || typeof body.amount !== "number") {
      reply.code(400);
      return { error: "A target and an amount are required." };
    }
    const result = await giveDrachmae(acting.row, body.targetCharacterId, body.amount);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Poison another citizen (the first hostile action). Only the actor learns the outcome.
  app.post("/poison", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { targetCharacterId?: string } | undefined;
    if (!body?.targetCharacterId) {
      reply.code(400);
      return { error: "A target is required." };
    }
    const result = await poisonAttempt(acting.row, body.targetCharacterId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Assassinate another citizen (the second hostile action). Success is death.
  app.post("/assassinate", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { targetCharacterId?: string } | undefined;
    if (!body?.targetCharacterId) {
      reply.code(400);
      return { error: "A target is required." };
    }
    const result = await assassinateAttempt(acting.row, body.targetCharacterId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Switch the retained spymaster's posture (guard ⇄ hunt); one switch per season.
  app.post("/spymaster-posture", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const posture = (request.body as { posture?: string } | undefined)?.posture;
    if (posture !== "guard" && posture !== "hunt") {
      reply.code(400);
      return { error: "A posture of 'guard' or 'hunt' is required." };
    }
    const result = await setSpymasterPosture(acting.row, posture);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Treat your own poisoning (self-action): consume a remedy, purge the affliction.
  app.post("/treat", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const result = await treat(acting.row);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
