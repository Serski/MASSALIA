import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { manumissionOptions, manumit } from "../services/manumission.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function manumissionRoutes(app: FastifyInstance) {
  // Eligibility + the citizen classes a freedman may buy into (with stat previews).
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return manumissionOptions(acting.row);
  });

  // Claim freedom: switch into the chosen citizen class.
  app.post("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const classId = (request.body as { classId?: string } | undefined)?.classId;
    if (!classId) {
      reply.code(400);
      return { error: "A classId is required." };
    }
    const result = await manumit(acting.row, classId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
