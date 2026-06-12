import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId } from "../services/character.js";
import { joinParty, leaveParty, PartyError } from "../services/politics.js";
import { reconcileOffices } from "../services/elections.js";

type PartySlug = "dynatoi" | "palaioi";

function normalizeParty(value: unknown): PartySlug | null {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  return slug === "dynatoi" || slug === "palaioi" ? slug : null;
}

async function resolveCharacterId(userId: string): Promise<{ characterId: string } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  const character = await ensureCharacterRow(player, worldId);
  return { characterId: character.id };
}

export async function partyRoutes(app: FastifyInstance) {
  app.post("/join", async (request, reply) => {
    const user = await requireAuth(request);
    const resolved = await resolveCharacterId(user.id);
    if ("error" in resolved) {
      reply.code(resolved.code);
      return { error: resolved.error };
    }
    const party = normalizeParty((request.body as { party?: string } | undefined)?.party);
    if (!party) {
      reply.code(400);
      return { error: "Choose the Dynatoi or the Palaioi." };
    }
    try {
      const result = await joinParty(resolved.characterId, party);
      // Joining the opposing party forfeits any office held on the other side.
      await reconcileOffices();
      return result;
    } catch (error) {
      if (error instanceof PartyError) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.post("/leave", async (request, reply) => {
    const user = await requireAuth(request);
    const resolved = await resolveCharacterId(user.id);
    if ("error" in resolved) {
      reply.code(resolved.code);
      return { error: resolved.error };
    }
    try {
      const result = await leaveParty(resolved.characterId);
      // Leaving the party whose side you hold forfeits that office at once.
      await reconcileOffices();
      return result;
    } catch (error) {
      if (error instanceof PartyError) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });
}
