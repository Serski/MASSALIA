import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { board, cancelContract, collectForeign, takeContract } from "../services/merc.js";
import { isHoplite } from "../services/service.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

// The hoplite's mercenary hiring board + go/return lifecycle (Hoplite Step 2).
// requireAuth + ownership, world-scoped. Non-hoplites get 403 everywhere. Voting
// is untouched — a character on contract still votes (status stays "alive").
export async function mercRoutes(app: FastifyInstance) {
  app.get("/board", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    if (!isHoplite(acting.row)) {
      reply.code(403);
      return { error: "Only hoplites take mercenary contracts." };
    }
    return board(acting.row, new Date());
  });

  app.post("/take", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const contractId = (request.body as { contractId?: string } | undefined)?.contractId;
    if (!contractId) {
      reply.code(400);
      return { error: "A contractId is required." };
    }
    const result = await takeContract(acting.row, contractId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  app.post("/cancel", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const result = await cancelContract(acting.row, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  app.post("/collect", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const result = await collectForeign(acting.row, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
