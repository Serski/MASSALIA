import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { buySeat, castChamberBallot, chamberView, chamberVotesView, syncChamberVotes } from "../services/oligarchy.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function oligarchyRoutes(app: FastifyInstance) {
  // The chamber: all 300 seats (the hemicycle), composition counts, your status.
  app.get("/chamber", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    await syncChamberVotes();
    return chamberView(acting.row);
  });

  // Buy the lowest-index empty seat — 300 dr., dynastic, wakes the council events.
  app.post("/buy-seat", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const result = await buySeat(acting.row);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // The open chamber vote + the public ledger of past votes.
  app.get("/votes", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return chamberVotesView(acting.row);
  });

  // Cast or change your ballot on the open vote (seat-holders only).
  app.post("/vote", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const choice = (request.body as { choice?: string } | undefined)?.choice;
    if (choice !== "yes" && choice !== "no") {
      reply.code(400);
      return { error: "A choice of 'yes' or 'no' is required." };
    }
    const result = await castChamberBallot(acting.row, choice);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
