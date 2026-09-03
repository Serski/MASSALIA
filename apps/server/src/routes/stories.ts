import type { FastifyInstance } from "fastify";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, getActivePlayer, getActiveWorldId, type CharacterRow } from "../services/character.js";
import { advanceStory, getStoryState, startStory, StoryRuleError } from "../services/story.js";

// A dumb shell: every gate/rule lives in the story service (start eligibility,
// completed-replay no-op, projection discipline). Handlers just resolve the acting
// character, cast params, and map StoryRuleError -> its own statusCode (party.ts idiom).
async function actingRow(userId: string): Promise<{ row: CharacterRow } | { error: string; code: number }> {
  const worldId = await getActiveWorldId();
  if (!worldId) return { error: "No active world exists.", code: 503 };
  const player = await getActivePlayer(userId, worldId);
  if (!player) return { error: "No active character found.", code: 404 };
  return { row: await ensureCharacterRow(player, worldId) };
}

// Route params are validated up front (400 on a malformed id, before any DB read).
// stories.id is a TEXT slug ("artemisia-silver"), not a uuid — so the check is the
// slug shape, bounded in length; choice ids follow the same content-id shape.
const SLUG = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" } as const;
const storyParams = { params: { type: "object", required: ["storyId"], properties: { storyId: SLUG } } } as const;
const storyChoiceParams = {
  params: { type: "object", required: ["storyId", "choiceId"], properties: { storyId: SLUG, choiceId: SLUG } },
} as const;

export async function storyRoutes(app: FastifyInstance) {
  // Start (or resume) a story. Gated: an unoffered story throws not_eligible (403);
  // an existing run (active/completed) resumes idempotently.
  app.post("/:storyId/start", { schema: storyParams }, async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { storyId } = request.params as { storyId: string };
    if (!storyId) {
      reply.code(400);
      return { error: "storyId is required." };
    }
    try {
      return await startStory(acting.row.id, storyId);
    } catch (error) {
      if (error instanceof StoryRuleError) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });

  // Advance by resolving a choice. The completed-replay no-op is a normal 200 with
  // the completed state (a result, not an exception) — do not convert it to an error.
  app.post("/:storyId/choices/:choiceId", { schema: storyChoiceParams }, async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { storyId, choiceId } = request.params as { storyId: string; choiceId: string };
    if (!storyId || !choiceId) {
      reply.code(400);
      return { error: "storyId and choiceId are required." };
    }
    try {
      return await advanceStory(acting.row.id, storyId, choiceId);
    } catch (error) {
      if (error instanceof StoryRuleError) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });

  // Read-only state projection (not_started / unknown_story -> 404 via statusCode).
  app.get("/:storyId", { schema: storyParams }, async (request, reply) => {
    const user = await requireAuth(request);
    const acting = await actingRow(user.id);
    if ("error" in acting) {
      reply.code(acting.code);
      return { error: acting.error };
    }
    const { storyId } = request.params as { storyId: string };
    if (!storyId) {
      reply.code(400);
      return { error: "storyId is required." };
    }
    try {
      return await getStoryState(acting.row.id, storyId);
    } catch (error) {
      if (error instanceof StoryRuleError) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });
}
