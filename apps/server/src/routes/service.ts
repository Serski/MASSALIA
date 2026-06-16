import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { collectSalary, enlist, isHoplite, performReclass, promote, serviceStatus } from "../services/service.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

// The hoplite's home army: rank ladder + salary (Hoplite Step 1). World-scoped,
// requireAuth + ownership. Non-hoplites get 403 on every route — the Strategos
// office (elections) is untouched here.
export async function serviceRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    if (!isHoplite(acting.row)) {
      reply.code(403);
      return { error: "Only hoplites serve in the home army." };
    }
    return serviceStatus(acting.row, new Date());
  });

  app.post("/enlist", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const result = await enlist(acting.row, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  app.post("/promote", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const result = await promote(acting.row, new Date());
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
    const result = await collectSalary(acting.row, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Re-class (Step 5 capstone): the hoplite hangs up the spear for a new trade.
  // ONE-WAY — the engine validates eligibility (wounded or aged-out) + the target.
  app.post("/reclass", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const targetClass = (request.body as { targetClass?: string } | undefined)?.targetClass;
    if (!targetClass) {
      reply.code(400);
      return { error: "A targetClass is required." };
    }
    const result = await performReclass(acting.row, targetClass, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
