import type { FastifyInstance } from "fastify";
import type { LeagueOffice } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { castVote, declareCandidacy, electionsView } from "../services/elections.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

const OFFICES = new Set(["archon", "ephor"]);

export async function electionRoutes(app: FastifyInstance) {
  // The full election status + voting ballot (candidates grouped by office/side,
  // your own changeable vote, declaration eligibility) — NO running tallies.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return electionsView(acting.row);
  });

  // Declare your candidacy (Spring). Side inferred from party; independents pick.
  app.post("/declare", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { office?: string; side?: string } | undefined;
    if (!body?.office || !OFFICES.has(body.office)) {
      reply.code(400);
      return { error: "A valid office (archon or ephor) is required." };
    }
    const result = await declareCandidacy(acting.row, body.office as LeagueOffice, body.side);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Cast or change your vote (Winter). Every living player; one per office; secret.
  app.post("/vote", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { office?: string; candidateCharacterId?: string } | undefined;
    if (!body?.office || !OFFICES.has(body.office)) {
      reply.code(400);
      return { error: "A valid office is required." };
    }
    if (!body.candidateCharacterId) {
      reply.code(400);
      return { error: "A candidateCharacterId is required." };
    }
    const result = await castVote(acting.row, body.office as LeagueOffice, body.candidateCharacterId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
