import { and, eq, exists } from "drizzle-orm";
import { createDb, festivalChoregos, festivalEvents, stories, storyProgress } from "@massalia/db";
import { parseStoryTree, type EventEffect, type NodeBody, type StoryNode, type StoryTree } from "@massalia/shared";
import { applyEffectsInTx, getCityDefaults, getFactionDefaults } from "./eventEngine.js";
import { applyChangeTrait, TraitRuleError } from "./traits.js";
import { applyComposureDelta } from "./composure.js";
import { onIdeologyChanged } from "./politics.js";
import { broadcastState } from "./worldState.js";

// ---------------------------------------------------------------------------
// The story play service (Story Engine Phase 4): start · resume · advance ·
// complete, atomic. Rewards flow ONLY through the existing machinery — in-tx
// effects via applyEffectsInTx, traits post-tx via applyChangeTrait, explicit
// composure post-tx via applyComposureDelta (the same fn the events route uses).
// No new stat/drachmae/trait/composure mutation logic lives here. The
// story_progress row is the provenance record; there are no hidden flags.
// ---------------------------------------------------------------------------

const db = createDb();

// Domain error signalled to routes, mirroring TraitRuleError's shape (reason +
// derived statusCode). The next pack's route maps these to 4xx/5xx.
export type StoryRuleReason = "unknown_story" | "not_started" | "unknown_choice" | "not_eligible" | "invariant";
export class StoryRuleError extends Error {
  reason: StoryRuleReason;
  statusCode: number;
  constructor(reason: StoryRuleReason, message: string) {
    super(message);
    this.reason = reason;
    this.statusCode =
      reason === "unknown_story" || reason === "not_started"
        ? 404
        : reason === "unknown_choice"
          ? 400
          : reason === "not_eligible"
            ? 403
            : 500;
  }
}

// What makes a story eligible to be offered. Only "festival" exists today: the
// story is offered once the named festival's instance has closed for a character
// who attended it. A `trigger` column on `stories` is the eventual home if a
// second kind ever appears — a registry is deliberate for now (do not add a column).
export type StoryTrigger = { kind: "festival"; festivalId: string };
export const STORY_TRIGGERS: Record<string, StoryTrigger> = {
  "artemisia-silver": { kind: "festival", festivalId: "fest-artemisia" },
};

// World-scoped effect types (the pre-tx dance mirrors applyChoiceEffects: load the
// content defaults only when a reward actually targets a city/faction).
const WORLD_EFFECT_TYPES = new Set(["change_city_stat", "change_faction_stance", "set_faction_vassal"]);
const isWorldEffect = (e: EventEffect) => WORLD_EFFECT_TYPES.has(e.type);

// --- Tree loading (parse per call; trees are small, no cache this phase) ------

async function loadTree(storyId: string): Promise<StoryTree> {
  const rows = await db.select({ tree: stories.tree }).from(stories).where(eq(stories.id, storyId)).limit(1);
  if (!rows[0]) throw new StoryRuleError("unknown_story", `Unknown story: ${storyId}`);
  // Graph validity is a seed-time concern (next pack) — not re-checked per request.
  return parseStoryTree(rows[0].tree);
}

const findNode = (tree: StoryTree, id: string): StoryNode | undefined => tree.nodes.find((n) => n.id === id);
function mustNode(tree: StoryTree, id: string): StoryNode {
  const node = findNode(tree, id);
  if (!node) throw new StoryRuleError("invariant", `Story node not found: ${id}`);
  return node;
}

// --- Projections (never expose next / rewards / result via inspection) --------

type NodeView = { id: string; type: StoryNode["type"]; body: NodeBody; image?: string };
const nodeView = (node: StoryNode): NodeView =>
  node.image !== undefined
    ? { id: node.id, type: node.type, body: node.body, image: node.image }
    : { id: node.id, type: node.type, body: node.body };
const sceneChoices = (node: StoryNode): { id: string; text: string }[] | undefined =>
  node.type === "scene" ? node.choices.map((c) => ({ id: c.id, text: c.text })) : undefined;

// The node-now-current projection returned by advanceStory: the view plus its
// choices when it is (still) a scene.
function projectNode(node: StoryNode) {
  const choices = sceneChoices(node);
  return choices ? { ...nodeView(node), choices } : nodeView(node);
}

type ProgressRow = typeof storyProgress.$inferSelect;
function projectState(storyId: string, tree: StoryTree, row: ProgressRow) {
  const node = mustNode(tree, row.currentNode);
  const choices = sceneChoices(node);
  return { storyId, status: row.status, node: nodeView(node), ...(choices ? { choices } : {}) };
}

const readRow = async (characterId: string, storyId: string): Promise<ProgressRow | undefined> =>
  (
    await db
      .select()
      .from(storyProgress)
      .where(and(eq(storyProgress.characterId, characterId), eq(storyProgress.storyId, storyId)))
      .limit(1)
  )[0];

// --- Public API ---------------------------------------------------------------

// Resume if a row exists, else start at tree.start. onConflictDoNothing + re-read
// makes a concurrent double-start race-safe (never resets an existing run).
export async function getOrStartStory(characterId: string, storyId: string) {
  const tree = await loadTree(storyId);
  await db
    .insert(storyProgress)
    .values({ characterId, storyId, status: "active", currentNode: tree.start })
    .onConflictDoNothing();
  const row = await readRow(characterId, storyId);
  if (!row) throw new StoryRuleError("invariant", `story_progress vanished for ${storyId}`);
  return projectState(storyId, tree, row);
}

// Gated start (Pack 2 Phase B): "you cannot start what was never offered."
// Idempotent — an existing run (active OR completed) is returned as-is via
// getOrStartStory, never reset and never an error. A fresh start is allowed only
// when availableStories currently lists the story as "offered" for this character.
export async function startStory(characterId: string, storyId: string, registry: Record<string, StoryTrigger> = STORY_TRIGGERS) {
  const existing = await readRow(characterId, storyId);
  if (existing) return getOrStartStory(characterId, storyId); // resume / completed projection
  const offered = (await availableStories(characterId, registry)).some((s) => s.storyId === storyId && s.status === "offered");
  if (!offered) throw new StoryRuleError("not_eligible", `Story not offered: ${storyId}`);
  return getOrStartStory(characterId, storyId);
}

// Read-only projection. No row → not_started (call getOrStartStory first).
export async function getStoryState(characterId: string, storyId: string) {
  const tree = await loadTree(storyId);
  const row = await readRow(characterId, storyId);
  if (!row) throw new StoryRuleError("not_started", `Story not started: ${storyId}`);
  return projectState(storyId, tree, row);
}

// Advance the run by resolving choiceId on the current scene, applying rewards, and
// (if the next node is a terminal) flipping to completed — all in one transaction.
export async function advanceStory(characterId: string, storyId: string, choiceId: string) {
  const tree = await loadTree(storyId);

  // Pre-tx (non-authoritative) read to mirror the wrapper's pre-tx dance: resolve
  // the world-effect content defaults only if a reward on the taken path needs them.
  // Expected null for all near-term content. The authoritative read is locked below.
  const pre = await readRow(characterId, storyId);
  let cityDef: Awaited<ReturnType<typeof getCityDefaults>> | null = null;
  let factionDef: Awaited<ReturnType<typeof getFactionDefaults>> | null = null;
  if (pre && pre.status !== "completed") {
    const node = findNode(tree, pre.currentNode);
    const choice = node?.type === "scene" ? node.choices.find((c) => c.id === choiceId) : undefined;
    if (choice) {
      const nextNode = findNode(tree, choice.next);
      const rewards = [...(choice.rewards ?? []), ...(nextNode?.type === "terminal" ? nextNode.rewards : [])];
      if (rewards.some(isWorldEffect)) {
        cityDef = await getCityDefaults();
        factionDef = await getFactionDefaults();
      }
    }
  }

  let ideologyTouched = false;
  const applied: EventEffect[] = []; // effects actually applied, for the post-tx passes
  let result: { resultText: string | null; completed: boolean; node: ReturnType<typeof projectNode> };

  await db.transaction(async (tx) => {
    // 1. Lock the authoritative row.
    const rows = await tx
      .select()
      .from(storyProgress)
      .where(and(eq(storyProgress.characterId, characterId), eq(storyProgress.storyId, storyId)))
      .limit(1)
      .for("update");
    const prog = rows[0];
    if (!prog) throw new StoryRuleError("not_started", `Story not started: ${storyId}`); // advance never auto-starts

    // 2. Completed → no-op replay (before choice validation): return completed state.
    if (prog.status === "completed") {
      result = { resultText: null, completed: true, node: projectNode(mustNode(tree, prog.currentNode)) };
      return;
    }

    // 3. currentNode must be a scene (a completed terminal is flipped in step 5's tx).
    const current = mustNode(tree, prog.currentNode);
    if (current.type !== "scene") throw new StoryRuleError("invariant", `Active row on non-scene node: ${current.id}`);

    // 4. Resolve the choice.
    const choice = current.choices.find((c) => c.id === choiceId);
    if (!choice) throw new StoryRuleError("unknown_choice", `Unknown choice ${choiceId} on node ${current.id}`);

    // 5. Apply the choice's pass-through rewards, then move onto choice.next.
    const choiceRewards = choice.rewards ?? [];
    if (choiceRewards.length) {
      const r = await applyEffectsInTx(tx, { characterId, eventId: `story:${storyId}:${choiceId}`, effects: choiceRewards, cityDef, factionDef });
      ideologyTouched = ideologyTouched || r.ideologyTouched;
      applied.push(...choiceRewards);
    }

    const next = mustNode(tree, choice.next);
    if (next.type === "scene") {
      await tx.update(storyProgress).set({ currentNode: next.id }).where(eq(storyProgress.id, prog.id));
      result = { resultText: choice.result ?? null, completed: false, node: projectNode(next) };
    } else {
      const termRewards = next.rewards;
      if (termRewards.length) {
        const r = await applyEffectsInTx(tx, { characterId, eventId: `story:${storyId}:${next.id}`, effects: termRewards, cityDef, factionDef });
        ideologyTouched = ideologyTouched || r.ideologyTouched;
        applied.push(...termRewards);
      }
      await tx
        .update(storyProgress)
        .set({ currentNode: next.id, status: "completed", completedAt: new Date() })
        .where(eq(storyProgress.id, prog.id));
      result = { resultText: choice.result ?? null, completed: true, node: projectNode(next) };
    }
  });

  // Post-tx, mirroring applyChoiceEffects's wrapper exactly.
  // Trait changes (idempotent; cap/opposite enforced) — swallow TraitRuleError.
  for (const effect of applied) {
    if (effect.type !== "change_trait") continue;
    try {
      await applyChangeTrait(effect.characterId ?? characterId, effect.traitId, effect.operation);
    } catch (error) {
      if (!(error instanceof TraitRuleError)) throw error;
      console.warn(`change_trait skipped (${error.reason}): ${error.message}`);
    }
  }
  // Explicit composure (stories have no tags, so no tag/ideology-derived layer).
  const composureDelta = applied
    .filter((e): e is Extract<EventEffect, { type: "change_composure" }> => e.type === "change_composure")
    .reduce((sum, e) => sum + e.amount, 0);
  if (composureDelta !== 0) await applyComposureDelta(characterId, composureDelta, `story:${storyId}`);

  if (ideologyTouched) await onIdeologyChanged(characterId);
  await broadcastState();

  return result!;
}

// All stories joined against this character's progress, dropping completed runs.
// The primitive the next pack's eligibility check builds on (no eligibility here).
export async function listPlayableStories(characterId: string): Promise<{ storyId: string; status: "unstarted" | "active" }[]> {
  const allStories = await db.select({ id: stories.id }).from(stories);
  const progress = await db
    .select({ storyId: storyProgress.storyId, status: storyProgress.status })
    .from(storyProgress)
    .where(eq(storyProgress.characterId, characterId));
  const statusById = new Map(progress.map((p) => [p.storyId, p.status]));
  const out: { storyId: string; status: "unstarted" | "active" }[] = [];
  for (const s of allStories) {
    const status = statusById.get(s.id);
    if (status === "completed") continue;
    out.push({ storyId: s.id, status: status === "active" ? "active" : "unstarted" });
  }
  return out;
}

// The lazy, read-side eligibility check (Pack 2 Phase A). For each registered
// festival-triggered story: an in-flight run resumes as "active"; a completed run
// is omitted; otherwise it is "offered" iff the story is seeded AND the character
// attended a now-closed instance of the trigger festival (any game year — the
// offer persists until played). Attendance counts however the festival_events row
// resolved, incl. the offline auto-resolve to "attend" (closeInstance writes the
// festival_choregos guard row unconditionally, even winnerless).
//
// Per registered story: one progress lookup (unique index on character_id,
// story_id), and — only when there is no progress row — one guard query that is a
// single row from `stories` (PK) with an EXISTS over the festival_events ⋈
// festival_choregos join (both sides index-covered). No scans.
export async function availableStories(
  characterId: string,
  registry: Record<string, StoryTrigger> = STORY_TRIGGERS,
): Promise<Array<{ storyId: string; status: "offered" | "active" }>> {
  const out: Array<{ storyId: string; status: "offered" | "active" }> = [];
  for (const [storyId, trigger] of Object.entries(registry)) {
    if (trigger.kind !== "festival") continue;

    // In-flight / finished short-circuits the offer check.
    const prog = (
      await db
        .select({ status: storyProgress.status })
        .from(storyProgress)
        .where(and(eq(storyProgress.characterId, characterId), eq(storyProgress.storyId, storyId)))
        .limit(1)
    )[0];
    if (prog) {
      if (prog.status === "active") out.push({ storyId, status: "active" });
      continue; // "completed" (or any non-active) → omit
    }

    // No progress row: seeded story AND an attended, closed instance → offered.
    const seededAndAttended = await db
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(
          eq(stories.id, storyId),
          exists(
            db
              .select({ id: festivalEvents.id })
              .from(festivalEvents)
              .innerJoin(
                festivalChoregos,
                and(
                  eq(festivalChoregos.festivalId, festivalEvents.festivalId),
                  eq(festivalChoregos.gameYear, festivalEvents.gameYear),
                ),
              )
              .where(and(eq(festivalEvents.characterId, characterId), eq(festivalEvents.festivalId, trigger.festivalId))),
          ),
        ),
      )
      .limit(1);
    if (seededAndAttended.length > 0) out.push({ storyId, status: "offered" });
  }
  return out;
}
