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
} from "../services/character.js";
import { getHeldTraits } from "../services/traits.js";
import { activeCensure } from "../services/politics.js";
import { recoverComposure } from "../services/composure.js";
import { decayCharacter } from "../services/age.js";

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
    // (a fresh character can have no censure)
  });

  // Full character sheet incl. derived values.
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

    const ensured = await ensureCharacterRow(player, worldId);
    // Resolve any expired censure first (it may flip party), then read the row.
    const censure = await activeCensure(ensured.id);
    // Lazy composure recovery + old-age decay (accrue + persist), then read.
    await recoverComposure(ensured.id);
    await decayCharacter(ensured.id);
    const row = (await findCharacterRow(ensured.playerId, ensured.worldId)) ?? ensured;
    return { character: toCharacterSheet(row, await getHeldTraits(row.id), censure ? censure.expiresAt.toISOString() : null) };
  });
}
