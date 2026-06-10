import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, findCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { advanceChildren, ensureFreshDraw, familyState, marry, nameChild } from "../services/family.js";

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
    const now = new Date();
    // Lazy-on-read: keep an offer fresh, and run the due child rolls + coming-of-age.
    await ensureFreshDraw(acting.row, now);
    await advanceChildren(acting.row.id, now);
    // Reload — a child roll can have ended the marriage (death in childbirth).
    const fresh = (await findCharacterRow(acting.row.playerId, acting.row.worldId)) ?? acting.row;
    return familyState(fresh, now);
  });

  // Name a newborn (the birth event's free-text input).
  app.post("/children/:childId/name", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { childId } = request.params as { childId: string };
    const name = (request.body as { name?: string } | undefined)?.name ?? "";
    const result = await nameChild(acting.row, childId, name);
    if (!result.ok) {
      reply.code(404);
      return { error: "No such child." };
    }
    return result;
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
