import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createDb, dailyRoutines } from "@massalia/db";
import { isWithdrawn } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { recoverComposure } from "../services/composure.js";
import { getHeldTraits } from "../services/traits.js";
import { ownedBuildingIds } from "../services/buildings.js";
import { utcDayString } from "../services/dailyDecisions.js";
import {
  activePoolCards,
  activePoolKey,
  campaignCardFor,
  getRoutinesConfig,
  ladderStates,
  previewRoutine,
  resolveRoutine,
} from "../services/routines.js";

const db = createDb();

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

export async function routineRoutes(app: FastifyInstance) {
  // The player's routine pool with per-character resolved previews + ladder state.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const now = new Date();
    // Keep composure/recovery current so the preview reflects the live sheet.
    await recoverComposure(acting.row.id, now);

    const cfg = getRoutinesConfig();
    const traits = await getHeldTraits(acting.row.id);
    const owned = await ownedBuildingIds(acting.row.playerId);
    // Source pool: the abroad contract pool while sworn, else the home class pool.
    const pool = activePoolCards(acting.row);
    // The campaign card is surfaced to declared candidates AT HOME only (an abroad
    // character is never a candidate, so the two off-pool overrides never collide).
    const campaign = acting.row.contractId ? null : await campaignCardFor(acting.row.id);
    const cards = campaign ? [...pool, campaign] : pool;

    const utcDay = utcDayString(now);
    const todays = await db
      .select({ routineId: dailyRoutines.routineId })
      .from(dailyRoutines)
      .where(and(eq(dailyRoutines.characterId, acting.row.id), eq(dailyRoutines.utcDay, utcDay)));
    const pickedRoutineId = todays[0]?.routineId ?? null;

    return {
      pool: activePoolKey(acting.row),
      dailyPicks: cfg.dailyPicks,
      withdrawn: isWithdrawn(acting.row.breakUntil, now),
      pickedRoutineId,
      cards: cards.map((card) => previewRoutine(card, acting.row, traits, owned)),
      ladders: ladderStates(acting.row),
    };
  });

  // Pick today's routine. One pick/day; withdrawn-gated; repeat penalty applies.
  app.post("/resolve", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const routineId = (request.body as { routineId?: string } | undefined)?.routineId;
    if (!routineId) {
      reply.code(400);
      return { error: "A routineId is required." };
    }

    const result = await resolveRoutine(acting.row, routineId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
