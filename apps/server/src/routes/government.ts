import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId } from "../services/character.js";
import { governmentView } from "../services/government.js";

// The Government tab (government prompt 1): the sitting Archons, Ephors and
// Strategoi get their seats, the League treasury's books and the League docket.
// Anyone else gets `{ member: false }`. The acting character is found as
// routes/agenda.ts finds it: 503 without an active world, 404 without a
// character in it.
export async function governmentRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }
    const player = await getActivePlayer(user.id, worldId);
    if (!player) {
      reply.code(404);
      return { error: "No active character found." };
    }
    const row = await ensureCharacterRow(player, worldId);
    return governmentView(row, new Date());
  });
}
