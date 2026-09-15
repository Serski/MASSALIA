import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { buildingContext, type ActingContext } from "../services/buildings.js";
import { buyListing, cancelListing, listGood, marketView } from "../services/market.js";

// A malformed id would reach Postgres as an invalid uuid cast (a 500); refuse it here.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// The player market (market prompt 1): sell-only stalls between citizens.
export async function marketRoutes(app: FastifyInstance) {
  // Every open stall in the world, the viewer's open count, the cap, tax exemption.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    return marketView(a.ctx, new Date());
  });

  // Body: { good, qty, price }. Escrows the stock at once.
  app.post("/list", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = request.body as { good?: unknown; qty?: unknown; price?: unknown } | undefined;
    if (typeof body?.good !== "string" || !body.good) {
      reply.code(400);
      return { error: "good, qty and price are required." };
    }
    const result = await listGood(a.ctx, body.good, body.qty, body.price, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Body: { listingId, qty }. Pays the seller at once, less the agora tax.
  app.post("/buy", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = request.body as { listingId?: unknown; qty?: unknown } | undefined;
    if (typeof body?.listingId !== "string" || !UUID.test(body.listingId)) {
      reply.code(400);
      return { error: "listingId and qty are required." };
    }
    const result = await buyListing(a.ctx, body.listingId, body.qty, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Body: { listingId }. Closes your own stall and returns what remains.
  app.post("/cancel", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = request.body as { listingId?: unknown } | undefined;
    if (typeof body?.listingId !== "string" || !UUID.test(body.listingId)) {
      reply.code(400);
      return { error: "A listingId is required." };
    }
    const result = await cancelListing(a.ctx, body.listingId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
