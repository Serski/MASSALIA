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

  // Buy the lowest-index empty seat — 200 dr., dynastic, wakes the council events.
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
    const body = request.body as { choice?: string; voteId?: unknown } | undefined;
    const choice = body?.choice;
    if (choice !== "yes" && choice !== "no") {
      reply.code(400);
      return { error: "A choice of 'yes' or 'no' is required." };
    }
    // The vote the ballot is for (government prompt 3: several can be open at
    // once); an old client sends none and gets the first open vote.
    const voteId = typeof body?.voteId === "string" && /^[0-9a-f-]{36}$/i.test(body.voteId) ? body.voteId : undefined;
    const result = await castChamberBallot(acting.row, choice, new Date(), voteId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
