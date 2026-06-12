import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { agendaScopeView, draftCard, endorse, partyLeadersView, vetoCard } from "../services/agenda.js";
import type { AgendaScope } from "@massalia/shared";

async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

function parseScope(value: unknown): AgendaScope | null {
  return value === "league" || value === "palaioi" || value === "dynatoi" ? value : null;
}

export async function agendaRoutes(app: FastifyInstance) {
  // The three governments: the league agenda + treasury, both party agendas, the
  // for-life leaders.
  app.get("/", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const now = new Date();
    return {
      league: await agendaScopeView(acting.row, "league", now),
      palaioi: await agendaScopeView(acting.row, "palaioi", now),
      dynatoi: await agendaScopeView(acting.row, "dynatoi", now),
      leaders: await partyLeadersView(acting.row),
    };
  });

  // An Archon of the scope drafts a card to the chamber.
  app.post("/draft", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { scope?: string; cardId?: string } | undefined;
    const scope = parseScope(body?.scope);
    if (!scope || !body?.cardId) {
      reply.code(400);
      return { error: "scope and cardId are required." };
    }
    const result = await draftCard(acting.row, scope, body.cardId, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // An Ephor of the scope vetoes the drafted card (one per term).
  app.post("/veto", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const scope = parseScope((request.body as { scope?: string } | undefined)?.scope);
    if (!scope) {
      reply.code(400);
      return { error: "scope is required." };
    }
    const result = await vetoCard(acting.row, scope, new Date());
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });

  // A party leader endorses a candidate in a league election (shifts swing weight).
  app.post("/endorse", async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const body = request.body as { electionId?: string; candidateCharacterId?: string } | undefined;
    if (!body?.electionId || !body?.candidateCharacterId) {
      reply.code(400);
      return { error: "electionId and candidateCharacterId are required." };
    }
    const result = await endorse(acting.row, body.electionId, body.candidateCharacterId);
    if (!result.ok) {
      reply.code(result.code);
      return { error: result.error };
    }
    return result;
  });
}
