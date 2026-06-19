import type { FastifyInstance } from "fastify";
import type { VendorAction } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import {
  build,
  buildingContext,
  catalog,
  collect,
  craft,
  dismissPops,
  hirePops,
  listPops,
  mine,
  upgrade,
  vendorTrade,
  type ActingContext,
} from "../services/buildings.js";

type Acting = { row: CharacterRow; ctx: ActingContext };

async function acting(userId: string): Promise<Acting | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  const row = await ensureCharacterRow(player, worldId);
  const ctx = await buildingContext(player.id, worldId);
  if (!ctx) return { error: "No active world exists.", code: 503 };
  return { row, ctx };
}

export async function buildingRoutes(app: FastifyInstance) {
  // The catalog: every tier's resolved cost/yield/buildDays/upkeep + the current
  // season multiplier. Class building is present only for classes with a line.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    return catalog(a.row.classId, a.ctx, new Date());
  });

  // Owned buildings: status, completesAt, current (seasonal) yield, accrued-but-
  // uncollected income/goods, upkeep owed, and the class-section slot.
  app.get("/mine", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    return mine(a.row.classId, a.ctx, new Date());
  });

  app.post("/build", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const buildingId = (request.body as { buildingId?: string } | undefined)?.buildingId;
    if (!buildingId) {
      reply.code(400);
      return { error: "A buildingId is required." };
    }
    const result = await build(a.row.classId, a.ctx, buildingId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  app.post("/upgrade", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const buildingId = (request.body as { buildingId?: string } | undefined)?.buildingId;
    if (!buildingId) {
      reply.code(400);
      return { error: "A buildingId is required." };
    }
    const result = await upgrade(a.ctx, buildingId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  app.post("/collect", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    return collect(a.ctx, new Date());
  });

  app.post("/vendor", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = request.body as { action?: VendorAction; type?: string; qty?: number } | undefined;
    if (!body?.action || (body.action !== "buy" && body.action !== "sell") || !body.type || body.qty === undefined) {
      reply.code(400);
      return { error: "action ('buy'|'sell'), type, and qty are required." };
    }
    const result = await vendorTrade(a.ctx, body.action, body.type, body.qty, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // The People market: list the hireable pop types + their content numbers (read).
  app.get("/people", async (request) => {
    await requireAuth(request);
    return listPops();
  });

  // Craft a shop good from content.craft (Phase 4). Body: { good }.
  app.post("/craft", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const good = (request.body as { good?: string } | undefined)?.good;
    if (!good) {
      reply.code(400);
      return { error: "A good to craft is required." };
    }
    const result = await craft(a.ctx, good, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Hire pops into the shared staffing pool (Phase 3). Body: { popType, count }.
  app.post("/hire", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = request.body as { popType?: string; count?: number } | undefined;
    if (!body?.popType || body.count === undefined) {
      reply.code(400);
      return { error: "popType and count are required." };
    }
    const result = await hirePops(a.ctx, body.popType, body.count, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Dismiss/disband owned pops (no refund — stops upkeep). Body: { popType, count }.
  app.post("/dismiss", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = request.body as { popType?: string; count?: number } | undefined;
    if (!body?.popType || body.count === undefined) {
      reply.code(400);
      return { error: "popType and count are required." };
    }
    const result = await dismissPops(a.ctx, body.popType, body.count, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
