import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { ballotView, castVote, olympiadStatus, resolveOlympicEvent } from "../services/olympiad.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function olympiadRoutes(app: FastifyInstance) {
  // The Olympiad status for the HUD (phase, badges, live event, city-wide victor).
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return { olympiad: await olympiadStatus(acting.row) };
  });

  // The voting ballot: candidates (live standings HIDDEN), your changeable vote.
  app.get("/ballot", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return ballotView(acting.row, new Date());
  });

  // Cast or change your vote — one per voter, replaceable until close.
  app.post("/vote", async (request, reply) => {
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
    const result = await castVote(acting.row, candidateId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Resolve the live Olympic event (nominate / the Games) — a free civic event.
  app.post("/resolve", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const choiceId = (request.body as { choiceId?: string } | undefined)?.choiceId;
    if (!choiceId) {
      reply.code(400);
      return { error: "A choiceId is required." };
    }
    const result = await resolveOlympicEvent(acting.row, choiceId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
