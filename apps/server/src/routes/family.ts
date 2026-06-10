import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { ensureFreshDraw, familyState, marry } from "../services/family.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function familyRoutes(app: FastifyInstance) {
  // The household: locks, current spouse, and open candidate offers (with the
  // cross-house penalty preview on each marriage candidate).
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    // Lazy-on-read: make sure an offer exists (BullMQ keeps it fresh yearly).
    await ensureFreshDraw(acting.row);
    return familyState(acting.row);
  });

  app.post("/marry", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const candidateId = (request.body as { candidateId?: string } | undefined)?.candidateId;
    if (!candidateId) {
      reply.code(400);
      return { error: "A candidateId is required." };
    }
    const result = await marry(acting.row, candidateId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
