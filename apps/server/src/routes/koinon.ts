import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { buildingContext, type ActingContext } from "../services/buildings.js";
import {
  acceptInvite,
  buildLesche,
  declineInvite,
  deletePost,
  expel,
  foundKoinon,
  giveToKoinon,
  handOver,
  invite,
  koinonView,
  leave,
  markRead,
  memberArmies,
  post,
  setVice,
  takeLead,
  withdrawInvite,
  type KoinonError,
} from "../services/koinon.js";

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

// The koinon (koinon prompt 1): a player-made company of citizens.
export async function koinonRoutes(app: FastifyInstance) {
  // One write route: resolve the caller, read the body field, run the service.
  // `field` names a uuid in the body (null: the route takes none); a route that
  // reads something else passes its own reader.
  function write(
    url: string,
    run: (ctx: ActingContext, body: Record<string, unknown>, now: Date) => Promise<KoinonError | { ok: true }>,
    field: string | null = null,
  ) {
    app.post(url, async (request, reply: FastifyReply) => {
      const user = await requireAuth(request);
      const a = await acting(user.id);
      if ("error" in a) {
        reply.code(a.code);
        return { error: a.error };
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (field !== null && (typeof body[field] !== "string" || !UUID.test(body[field] as string))) {
        reply.code(400);
        return { error: `${field === "inviteId" ? "An" : "A"} ${field} is required.` };
      }
      const result = await run(a.ctx, body, new Date());
      if (!result.ok) {
        reply.code(result.code);
        return { error: result.error };
      }
      return result;
    });
  }

  // The page: rules, the caller's standing, the world's koina, his invites or his koinon.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    return koinonView(a.ctx, new Date());
  });

  // Leader only: every member's soldiers, levy and fleet, live and read-only.
  app.get("/armies", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const result = await memberArmies(a.ctx, new Date());
    if ("error" in result) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Body: { name }. Costs the founding fee; the founder leads.
  write("/found", (ctx, body, now) => foundKoinon(ctx, body.name, now));
  // Body: { name }. The leader or the vice invites a citizen by name.
  write("/invite", (ctx, body, now) => invite(ctx, body.name, now));
  // Body: { inviteId }.
  write("/withdraw", (ctx, body, now) => withdrawInvite(ctx, body.inviteId as string, now), "inviteId");
  write("/accept", (ctx, body, now) => acceptInvite(ctx, body.inviteId as string, now), "inviteId");
  write("/decline", (ctx, body) => declineInvite(ctx, body.inviteId as string), "inviteId");

  write("/leave", (ctx, _body, now) => leave(ctx, now));
  // Body: { playerId }.
  write("/expel", (ctx, body, now) => expel(ctx, body.playerId as string, now), "playerId");
  write("/handover", (ctx, body, now) => handOver(ctx, body.playerId as string, now), "playerId");
  write("/take-lead", (ctx, _body, now) => takeLead(ctx, now));

  // Body: { playerId } names the vice; { playerId: null } clears the seat.
  app.post("/vice", async (request, reply) => {
    const user = await requireAuth(request);
    const a = await acting(user.id);
    if ("error" in a) {
      reply.code(a.code);
      return { error: a.error };
    }
    const body = (request.body ?? {}) as { playerId?: unknown };
    if (body.playerId !== null && (typeof body.playerId !== "string" || !UUID.test(body.playerId))) {
      reply.code(400);
      return { error: "A playerId, or null, is required." };
    }
    const result = await setVice(a.ctx, body.playerId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // Body: { body }. The leader or the vice posts to the board.
  write("/post", (ctx, body, now) => post(ctx, body.body, now));
  // Body: { postId }.
  write("/post/delete", (ctx, body, now) => deletePost(ctx, body.postId as string, now), "postId");
  write("/read", (ctx, _body, now) => markRead(ctx, now));

  // Body: { amount }. A member gives drachmae into the koinon's treasury.
  write("/give", (ctx, body, now) => giveToKoinon(ctx, body.amount, now));
  // The leader orders the Lesche, paid from the treasury.
  write("/lesche", (ctx, _body, now) => buildLesche(ctx, now));
}
