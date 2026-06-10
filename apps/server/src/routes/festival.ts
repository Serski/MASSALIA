import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { liveFestivalForCharacter, resolveFestival } from "../services/festival.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function festivalRoutes(app: FastifyInstance) {
  // The festival live for the player right now (with previewed choices), or null.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return { festival: await liveFestivalForCharacter(acting.row) };
  });

  // Resolve the live festival with a chosen tier (free civic event — no decision spent).
  app.post("/resolve", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { festivalId?: string; choiceId?: string } | undefined;
    if (!body?.festivalId || !body?.choiceId) {
      reply.code(400);
      return { error: "festivalId and choiceId are required." };
    }
    const result = await resolveFestival(acting.row, body.festivalId, body.choiceId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
