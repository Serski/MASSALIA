import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { createDb, playerCharacters } from "@massalia/db";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId } from "../services/character.js";

const db = createDb();

// TODO: TUNING — rejoin cooldown after leaving a party. Default 10s for now;
// override with PARTY_REJOIN_COOLDOWN_SECONDS. Real value to be designed.
const REJOIN_COOLDOWN_SECONDS = Number(process.env.PARTY_REJOIN_COOLDOWN_SECONDS ?? 10);
// Ideology needed toward a side to join its party.
// Reformist (+) -> Dynatoi; Traditionalist (-) -> Palaioi.
const IDEOLOGY_THRESHOLD = 10;

type PartySlug = "dynatoi" | "palaioi";

function normalizeParty(value: unknown): PartySlug | null {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  return slug === "dynatoi" || slug === "palaioi" ? slug : null;
}

export async function partyRoutes(app: FastifyInstance) {
  app.post("/join", async (request, reply) => {
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
    const character = await ensureCharacterRow(player, worldId);

    const party = normalizeParty((request.body as { party?: string } | undefined)?.party);
    if (!party) {
      reply.code(400);
      return { error: "Choose the Dynatoi or the Palaioi." };
    }

    if (character.party !== "none") {
      reply.code(409);
      return { error: "You are already in a party. Leave it before joining another." };
    }

    const now = new Date();
    if (character.partyCooldownUntil && character.partyCooldownUntil.getTime() > now.getTime()) {
      reply.code(429);
      return {
        error: "You recently left a party. Wait for the cooldown to pass before applying again.",
        partyCooldownUntil: character.partyCooldownUntil.toISOString(),
      };
    }

    // Dynatoi = Reformist (ideology >= +10); Palaioi = Traditionalist (ideology <= -10).
    const qualifies =
      party === "dynatoi" ? character.ideology >= IDEOLOGY_THRESHOLD : character.ideology <= -IDEOLOGY_THRESHOLD;
    if (!qualifies) {
      const side = party === "dynatoi" ? "Reformist" : "Traditionalist";
      reply.code(400);
      return {
        error: `Joining the ${party === "dynatoi" ? "Dynatoi" : "Palaioi"} requires at least ${IDEOLOGY_THRESHOLD}% ${side} ideology.`,
      };
    }

    await db
      .update(playerCharacters)
      .set({ party, partyCooldownUntil: null })
      .where(eq(playerCharacters.id, character.id));
    return { party, partyCooldownUntil: null };
  });

  app.post("/leave", async (request, reply) => {
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
    const character = await ensureCharacterRow(player, worldId);

    if (character.party === "none") {
      reply.code(400);
      return { error: "You are not in a party." };
    }

    const cooldownUntil = new Date(Date.now() + REJOIN_COOLDOWN_SECONDS * 1000);
    await db
      .update(playerCharacters)
      .set({ party: "none", partyCooldownUntil: cooldownUntil })
      .where(eq(playerCharacters.id, character.id));

    // TODO (event engine): expulsion-on-drift will reuse this leave path — when a
    // member's ideology crosses the opposing threshold, force them out here and
    // apply the same rejoin cooldown. No system moves ideology yet.
    return { party: "none", partyCooldownUntil: cooldownUntil.toISOString() };
  });
}
