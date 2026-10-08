import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { buildingContext, type ActingContext } from "../services/buildings.js";
import { barracksView, cancelTraining, disbandRow, hireBand, markReportRead, recruitUnits, sacrifice } from "../services/barracks.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId } from "../services/character.js";

// The Barracks: the player's army (trained units from the levy, hired bands on
// contract). requireAuth + ownership, world-scoped; every handler resolves the
// acting context the way routes/buildings.ts does. GET settles and returns the
// view; every POST returns the same view on success so the tab re-renders from
// one payload. Unit and band definitions reach the client ONLY through here.

async function acting(userId: string): Promise<ActingContext | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  await ensureCharacterRow(player, worldId);
  const ctx = await buildingContext(player.id, worldId);
  if (!ctx) return { error: "No active world exists.", code: 503 };
  return ctx;
}

export async function barracksRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    return barracksView(ctx, new Date());
  });

  app.post("/recruit", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    const body = request.body as { unitId?: unknown; count?: unknown } | undefined;
    if (typeof body?.unitId !== "string" || typeof body.count !== "number") {
      reply.code(400);
      return { error: "unitId and count are required." };
    }
    const now = new Date();
    const result = await recruitUnits(ctx, body.unitId, body.count, now);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return barracksView(ctx, now);
  });

  app.post("/hire", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    const bandId = (request.body as { bandId?: unknown } | undefined)?.bandId;
    if (typeof bandId !== "string" || !bandId) {
      reply.code(400);
      return { error: "A bandId is required." };
    }
    const now = new Date();
    const result = await hireBand(ctx, bandId, now);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return barracksView(ctx, now);
  });

  // The altar: burn one unit of a content good for the morale blessing.
  app.post("/sacrifice", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    const good = (request.body as { good?: unknown } | undefined)?.good;
    if (typeof good !== "string" || !good) {
      reply.code(400);
      return { error: "A good is required." };
    }
    const now = new Date();
    const result = await sacrifice(ctx, good, now);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return barracksView(ctx, now);
  });

  app.post("/cancel", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    const rowId = (request.body as { rowId?: unknown } | undefined)?.rowId;
    if (typeof rowId !== "string" || !rowId) {
      reply.code(400);
      return { error: "A rowId is required." };
    }
    const now = new Date();
    const result = await cancelTraining(ctx, rowId, now);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return barracksView(ctx, now);
  });

  app.post("/disband", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    const rowId = (request.body as { rowId?: unknown } | undefined)?.rowId;
    if (typeof rowId !== "string" || !rowId) {
      reply.code(400);
      return { error: "A rowId is required." };
    }
    const now = new Date();
    const result = await disbandRow(ctx, rowId, now);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return barracksView(ctx, now);
  });

  // A battle report opened for the first time (raids prompt 4): the highlight
  // goes, and stays gone. Answers the view, as the other POSTs do.
  app.post("/report-read", async (request, reply) => {
    const user = await requireAuth(request);
    const ctx = await acting(user.id);
    if ("error" in ctx) {
      reply.code(ctx.code);
      return { error: ctx.error };
    }
    const marchId = (request.body as { marchId?: unknown } | undefined)?.marchId;
    if (typeof marchId !== "string" || !marchId) {
      reply.code(400);
      return { error: "A marchId is required." };
    }
    const now = new Date();
    const result = await markReportRead(ctx, marchId, now);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return barracksView(ctx, now);
  });
}
