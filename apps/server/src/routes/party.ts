import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createDb, players, worlds } from "@massalia/db";
import { requireAuth } from "../services/auth.js";

const db = createDb();

// TODO: TUNING — rejoin cooldown after leaving a party. Default 10s for now;
// override with PARTY_REJOIN_COOLDOWN_SECONDS. Real value to be designed.
const REJOIN_COOLDOWN_SECONDS = Number(process.env.PARTY_REJOIN_COOLDOWN_SECONDS ?? 10);
// Alignment needed toward a side to join its party (|alignment| >= threshold).
const ALIGNMENT_THRESHOLD = 10;

type PartySlug = "dynatoi" | "palaioi";

function normalizeParty(value: unknown): PartySlug | null {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  return slug === "dynatoi" || slug === "palaioi" ? slug : null;
}

async function getActivePlayer(userId: string) {
  const worldRows = await db.select().from(worlds).where(eq(worlds.status, "active")).limit(1);
  const world = worldRows[0];
  if (!world) {
    const error = new Error("No active world exists.");
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }
  const rows = await db
    .select()
    .from(players)
    .where(and(eq(players.userId, userId), eq(players.worldId, world.id), eq(players.isActive, true)))
    .limit(1);
  const player = rows[0];
  if (!player) {
    const error = new Error("No active character found.");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
  return player;
}

export async function partyRoutes(app: FastifyInstance) {
  app.post("/join", async (request, reply) => {
    const user = await requireAuth(request);
    const player = await getActivePlayer(user.id);

    const party = normalizeParty((request.body as { party?: string } | undefined)?.party);
    if (!party) {
      reply.code(400);
      return { error: "Choose the Dynatoi or the Palaioi." };
    }

    if (player.party !== "unaligned") {
      reply.code(409);
      return { error: "You are already in a party. Leave it before joining another." };
    }

    const now = new Date();
    if (player.partyCooldownUntil && player.partyCooldownUntil.getTime() > now.getTime()) {
      reply.code(429);
      return {
        error: "You recently left a party. Wait for the cooldown to pass before applying again.",
        partyCooldownUntil: player.partyCooldownUntil.toISOString(),
      };
    }

    // Dynatoi = Reformist (negative alignment); Palaioi = Conservative (positive).
    const qualifies =
      party === "dynatoi" ? player.alignment <= -ALIGNMENT_THRESHOLD : player.alignment >= ALIGNMENT_THRESHOLD;
    if (!qualifies) {
      const side = party === "dynatoi" ? "Reformist" : "Conservative";
      reply.code(400);
      return {
        error: `Joining the ${party === "dynatoi" ? "Dynatoi" : "Palaioi"} requires at least ${ALIGNMENT_THRESHOLD}% ${side} alignment.`,
      };
    }

    await db.update(players).set({ party, partyCooldownUntil: null }).where(eq(players.id, player.id));
    return { party, partyCooldownUntil: null };
  });

  app.post("/leave", async (request, reply) => {
    const user = await requireAuth(request);
    const player = await getActivePlayer(user.id);

    if (player.party === "unaligned") {
      reply.code(400);
      return { error: "You are not in a party." };
    }

    const cooldownUntil = new Date(Date.now() + REJOIN_COOLDOWN_SECONDS * 1000);
    await db
      .update(players)
      .set({ party: "unaligned", partyCooldownUntil: cooldownUntil })
      .where(eq(players.id, player.id));

    // TODO (event engine): expulsion-on-drift will reuse this leave path —
    // when a member's alignment crosses the opposing threshold, force them out
    // here and apply the same rejoin cooldown. No system moves alignment yet.
    return { party: "unaligned", partyCooldownUntil: cooldownUntil.toISOString() };
  });
}
