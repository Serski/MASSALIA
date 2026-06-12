import type { FastifyInstance } from "fastify";
import type { OfficeSide } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { appointEphor, appointStrategos, eligibleAppointees, officesView } from "../services/elections.js";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function officeRoutes(app: FastifyInstance) {
  // The current Archons/Ephors/Strategoi by side + party, the public ledger, and
  // the House tallies ("House Leonidas: 3 Archonships").
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    return officesView(acting.row);
  });

  // The eligible appointees for a side (for the appointment picker).
  app.get("/appointees", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const sideParam = (request.query as { side?: string } | undefined)?.side;
    const side = sideParam === "palaioi" || sideParam === "dynatoi" ? (sideParam as OfficeSide) : null;
    return { appointees: await eligibleAppointees(side) };
  });

  // The sitting same-side Archon appoints a replacement Ephor (death/forfeit cascade).
  app.post("/appoint-ephor", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { side?: string; candidateCharacterId?: string } | undefined;
    if (body?.side !== "palaioi" && body?.side !== "dynatoi") {
      reply.code(400);
      return { error: "A valid side is required." };
    }
    if (!body.candidateCharacterId) {
      reply.code(400);
      return { error: "A candidateCharacterId is required." };
    }
    const result = await appointEphor(acting.row, body.side, body.candidateCharacterId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // The four sitting officials appoint a Strategos (title-only; cross-party balance).
  app.post("/appoint-strategos", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { candidateCharacterId?: string } | undefined;
    if (!body?.candidateCharacterId) {
      reply.code(400);
      return { error: "A candidateCharacterId is required." };
    }
    const result = await appointStrategos(acting.row, body.candidateCharacterId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
