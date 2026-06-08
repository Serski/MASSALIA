import type { FastifyInstance } from "fastify";
import { createCharacterSchema } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import {
  createCharacterRow,
  ensureCharacterRow,
  findCharacterRow,
  getActivePlayer,
  getActiveWorldId,
  toCharacterSheet,
  withDailyReset,
} from "../services/character.js";
import { getHeldTraits } from "../services/traits.js";

export async function characterSheetRoutes(app: FastifyInstance) {
  // Create the character sheet: choose house + class. Rejects if one exists.
  app.post("/", async (request, reply) => {
    const user = await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }
    const player = await getActivePlayer(user.id, worldId);
    if (!player) {
      reply.code(404);
      return { error: "Create your character in the world first." };
    }

    const parsed = createCharacterSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid character input." };
    }

    const existing = await findCharacterRow(player.id, worldId);
    if (existing) {
      reply.code(409);
      return { error: "You already have a character in this world." };
    }

    const row = await createCharacterRow(player.id, worldId, parsed.data.houseId, parsed.data.classId);
    reply.code(201);
    return { character: toCharacterSheet(row, await getHeldTraits(row.id)) };
  });

  // Full character sheet incl. derived values (remaining actions).
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

    const row = await withDailyReset(await ensureCharacterRow(player, worldId), new Date());
    return { character: toCharacterSheet(row, await getHeldTraits(row.id)) };
  });
}
