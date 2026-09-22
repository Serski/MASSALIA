import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, exists, sql } from "drizzle-orm";
import { createDb, effectLog, festivalChoregos, festivalEvents, playerCharacters, stories, storyProgress, worlds } from "@massalia/db";
import {
  datedSeasonIndex,
  fillStoryText,
  gameDate,
  parseStoryTree,
  requirementLabel,
  requirementMet,
  storyCover,
  storyHouseName,
  validateStoryGraph,
  type EventEffect,
  type NodeBody,
  type StoryNode,
  type StoryTree,
} from "@massalia/shared";
import { applyEffectsInTx, getCityDefaults, getFactionDefaults } from "./eventEngine.js";
import { getBuildingsContent } from "./buildings.js";
import { applyChangeTrait, getTraitDef, TraitRuleError } from "./traits.js";
import { applyComposureDelta, recoverComposure } from "./composure.js";
import { onIdeologyChanged } from "./politics.js";
import { broadcastState } from "./worldState.js";
import { lockCharacterOwner } from "./lock.js";

// ---------------------------------------------------------------------------
// The story play service (Story Engine Phase 4): start · resume · advance ·
// complete, atomic. Rewards flow ONLY through the existing machinery — in-tx
// effects via applyEffectsInTx, traits post-tx via applyChangeTrait, explicit
// composure post-tx via applyComposureDelta (the same fn the events route uses).
// No new stat/drachmae/trait/composure mutation logic lives here. The
// story_progress row is the provenance record; there are no hidden flags.
// ---------------------------------------------------------------------------

const db = createDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storiesDir = path.resolve(__dirname, "../../../..", "content/stories");

// Domain error signalled to routes, mirroring TraitRuleError's shape (reason +
// derived statusCode). The next pack's route maps these to 4xx/5xx.
export type StoryRuleReason = "unknown_story" | "not_started" | "unknown_choice" | "not_eligible" | "locked" | "invariant";
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
          : reason === "not_eligible" || reason === "locked"
            ? 403
            : 500;
  }
}

// What makes a story eligible to be offered. Two kinds: "festival" offers the
// story once the named festival's instance has closed for a character who
// attended it; "class" offers it to every character of a class, optionally not
// before a GAME date (like a dated event card, so a future world opens it on its
// own calendar). A `trigger` column on `stories` is the eventual home — the
// registry is still deliberate (do not add a column).
export type StoryTrigger =
  | { kind: "festival"; festivalId: string }
  | { kind: "class"; classId: string; opensAt?: { yearBC: number; season: number } };
export const STORY_TRIGGERS: Record<string, StoryTrigger> = {
  "artemisia-silver": { kind: "festival", festivalId: "fest-artemisia" },
  // Winter 298 BC is seasonIndex 8 — the ninth day of a world's run.
  "house-of-roses": { kind: "class", classId: "hetaira", opensAt: { yearBC: 298, season: 1 } },
};

// Boot-time content load: validate + upsert every authored story. A directory read
// so the next story is a file-drop. Each file is a `{ id, version, tree }` wrapper —
// id/version by hand, `tree` via parseStoryTree — then validateStoryGraph, failing
// LOUD with the filename + every problem (mirrors listEvents' per-file throw). The
// upsert is idempotent: every boot re-asserts the deployed content, which is how a
// content edit ships (edit file → deploy → boot upsert).
export async function loadStories(): Promise<void> {
  const files = (await fs.readdir(storiesDir)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const raw = await fs.readFile(path.join(storiesDir, file), "utf8");
    let id: string;
    let version: number;
    let tree: StoryTree;
    try {
      const parsed = JSON.parse(raw) as { id?: unknown; version?: unknown; tree?: unknown };
      if (typeof parsed.id !== "string") throw new Error("missing string `id`");
      if (typeof parsed.version !== "number") throw new Error("missing numeric `version`");
      id = parsed.id;
      version = parsed.version;
      tree = parseStoryTree(parsed.tree);
    } catch (error) {
      throw new Error(`Invalid story content in ${file}: ${(error as Error).message}`);
    }
    const problems = validateStoryGraph(tree);
    if (problems.length > 0) throw new Error(`Invalid story graph in ${file}: ${problems.join("; ")}`);
    const treeJson = tree as unknown as Record<string, unknown>;
    await db
      .insert(stories)
      .values({ id, version, tree: treeJson })
      .onConflictDoUpdate({ target: stories.id, set: { tree: treeJson, version } });
  }
}

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

// --- The reading character's context ------------------------------------------

// What a projection needs about the character: the house her {house} token must
// avoid, and the three values a requirement can ask for. Composure comes from
// recoverComposure so a locked choice reflects the composure she actually has
// now, not the last persisted value. `exec` runs it inside a caller's tx.
export type StoryContext = { houseSlug: string; composure: number; prestige: number; drachmae: number };
type Exec = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export async function storyContext(characterId: string, now: Date = new Date(), exec: Exec = db): Promise<StoryContext> {
  const composure = await recoverComposure(characterId, now, exec);
  const rows = await exec
    .select({ houseSlug: playerCharacters.houseSlug, prestige: playerCharacters.prestige, drachmae: playerCharacters.drachmae })
    .from(playerCharacters)
    .where(eq(playerCharacters.id, characterId))
    .limit(1);
  const row = rows[0];
  return { houseSlug: row?.houseSlug ?? "", composure, prestige: row?.prestige ?? 0, drachmae: row?.drachmae ?? 0 };
}

// --- Projections (never expose next / rewards / result via inspection) --------

// Everything a projection needs beyond the node itself: the rival house this
// character's {house} token names (fixed for her, for this story) and the values
// her locks are judged against.
type Projection = { house: string; ctx: StoryContext };
const fill = (p: Projection, text: string) => fillStoryText(text, { house: p.house });

async function projectionFor(characterId: string, storyId: string, now: Date = new Date(), exec: Exec = db): Promise<Projection> {
  const ctx = await storyContext(characterId, now, exec);
  return { house: storyHouseName(characterId, storyId, ctx.houseSlug), ctx };
}

type NodeView = { id: string; type: StoryNode["type"]; body: NodeBody; image?: string };
const bodyView = (body: NodeBody, p: Projection): NodeBody => ({
  ...(body.eyebrow !== undefined ? { eyebrow: fill(p, body.eyebrow) } : {}),
  paragraphs: body.paragraphs.map((text) => fill(p, text)),
});
const nodeView = (node: StoryNode, p: Projection): NodeView =>
  node.image !== undefined
    ? { id: node.id, type: node.type, body: bodyView(node.body, p), image: node.image }
    : { id: node.id, type: node.type, body: bodyView(node.body, p) };

// A choice as the player sees it. A choice with a FALLBACK never carries any of
// the three: it cannot lock, and its requirement is a hidden fork, not a price
// list. A choice without one locks when unmet (the server refuses it too) and
// always shows a drachmae requirement as its price.
type ChoiceView = { id: string; text: string; locked?: true; requirement?: string; price?: number };
const sceneChoices = (node: StoryNode, p: Projection): ChoiceView[] | undefined =>
  node.type !== "scene"
    ? undefined
    : node.choices.map((c) => {
        const view: ChoiceView = { id: c.id, text: fill(p, c.text) };
        if (!c.requires || c.otherwise) return view;
        if (!requirementMet(c.requires, p.ctx)) {
          view.locked = true;
          view.requirement = requirementLabel(c.requires);
        }
        if (c.requires.drachmae !== undefined) view.price = c.requires.drachmae;
        return view;
      });

// The node-now-current projection returned by advanceStory: the view plus its
// choices when it is (still) a scene.
function projectNode(node: StoryNode, p: Projection) {
  const choices = sceneChoices(node, p);
  return choices ? { ...nodeView(node, p), choices } : nodeView(node, p);
}

type ProgressRow = typeof storyProgress.$inferSelect;
function projectState(storyId: string, tree: StoryTree, row: ProgressRow, p: Projection) {
  const node = mustNode(tree, row.currentNode);
  const choices = sceneChoices(node, p);
  return { storyId, status: row.status, node: nodeView(node, p), ...(choices ? { choices } : {}) };
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
  return projectState(storyId, tree, row, await projectionFor(characterId, storyId));
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
  return projectState(storyId, tree, row, await projectionFor(characterId, storyId));
}

// A post-grant summary of what an advance just applied — NEVER a pre-choice preview
// (the spoiler discipline: state/node projections still carry no rewards).
export type StoryReward =
  | { kind: "stat"; stat: string; amount: number }
  | { kind: "drachmae"; amount: number }
  | { kind: "trait"; traitId: string; name: string }
  | { kind: "composure"; amount: number }
  | { kind: "good"; good: string; name: string; amount: number };

// Summarize the effects THIS advance actually applied (choice layer then, if a
// terminal was reached, terminal layer — the order `applied` was built in).
// Amounts are NOMINAL (as authored in the tree): change_stat's real applied value
// after the growth multiplier + age cap may differ; it is not recomputed for display.
// Effect types outside the four below are still applied — just not summarized.
function summarizeRewards(applied: EventEffect[]): StoryReward[] {
  const out: StoryReward[] = [];
  for (const e of applied) {
    switch (e.type) {
      case "change_stat":
        out.push({ kind: "stat", stat: e.stat, amount: e.amount });
        break;
      case "change_drachmae":
        out.push({ kind: "drachmae", amount: e.amount });
        break;
      case "change_composure":
        out.push({ kind: "composure", amount: e.amount });
        break;
      case "change_trait": {
        if (e.operation !== "add") break; // only a grant is a reward
        const def = getTraitDef(e.traitId);
        if (def) out.push({ kind: "trait", traitId: e.traitId, name: def.name }); // omit unknown ids (the swallow path)
        break;
      }
      case "gain_good":
        // The good's display name comes from the buildings catalog, which the
        // market and the Inventory already read; an unlabelled id shows as itself.
        out.push({ kind: "good", good: e.good, name: getBuildingsContent().goodLabels?.[e.good] ?? e.good, amount: e.amount });
        break;
      default:
        break;
    }
  }
  return out;
}

// Advance the run by resolving choiceId on the current scene, applying rewards, and
// (if the next node is a terminal) flipping to completed — all in one transaction.
export async function advanceStory(characterId: string, storyId: string, choiceId: string, now: Date = new Date()) {
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
      // Either branch may be the one taken, so the pre-tx load considers both.
      const branches = choice.otherwise ? [choice, choice.otherwise] : [choice];
      const rewards = branches.flatMap((b) => {
        const nextNode = findNode(tree, b.next);
        return [...(b.rewards ?? []), ...(nextNode?.type === "terminal" ? nextNode.rewards : [])];
      });
      if (rewards.some(isWorldEffect)) {
        cityDef = await getCityDefaults();
        factionDef = await getFactionDefaults();
      }
    }
  }

  let ideologyTouched = false;
  const applied: EventEffect[] = []; // effects actually applied, for the post-tx passes
  // What the transaction decided. The node is named, not projected, here: its locks
  // are read again AFTER the post-tx passes, so they reflect the wallet and the
  // composure this very choice just moved.
  let outcome: { resultText: string | null; completed: boolean; nodeId: string };

  await db.transaction(async (tx) => {
    // 0. Serialize against every other mutation of this player (rewards touch the
    //    wallet/stats) — the per-player advisory lock comes before the row lock.
    await lockCharacterOwner(tx, characterId);
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
      outcome = { resultText: null, completed: true, nodeId: mustNode(tree, prog.currentNode).id };
      return;
    }

    // 3. currentNode must be a scene (a completed terminal is flipped in step 5's tx).
    const current = mustNode(tree, prog.currentNode);
    if (current.type !== "scene") throw new StoryRuleError("invariant", `Active row on non-scene node: ${current.id}`);

    // 4. Resolve the choice.
    const choice = current.choices.find((c) => c.id === choiceId);
    if (!choice) throw new StoryRuleError("unknown_choice", `Unknown choice ${choiceId} on node ${current.id}`);

    // 5. Requirements, read inside the lock so nothing can move under them. With no
    //    fallback an unmet requirement is a refusal BEFORE any write; with one it
    //    silently becomes the fallback branch, whose rewards and result replace the
    //    choice's own (the choice never resolved).
    let branch: { result?: string; next: string; rewards?: EventEffect[] } = choice;
    if (choice.requires) {
      const ctx = await storyContext(characterId, now, tx);
      if (!requirementMet(choice.requires, ctx)) {
        if (!choice.otherwise) throw new StoryRuleError("locked", "That choice is closed to you.");
        branch = choice.otherwise;
      }
    }

    // 6. Apply the branch's pass-through rewards, then move onto its next node.
    const choiceRewards = branch.rewards ?? [];
    if (choiceRewards.length) {
      const r = await applyEffectsInTx(tx, { characterId, eventId: `story:${storyId}:${choiceId}`, effects: choiceRewards, cityDef, factionDef });
      ideologyTouched = ideologyTouched || r.ideologyTouched;
      applied.push(...choiceRewards);
    }

    const next = mustNode(tree, branch.next);
    if (next.type === "scene") {
      await tx.update(storyProgress).set({ currentNode: next.id }).where(eq(storyProgress.id, prog.id));
      outcome = { resultText: branch.result ?? null, completed: false, nodeId: next.id };
    } else {
      const termRewards = next.rewards;
      if (termRewards.length) {
        const r = await applyEffectsInTx(tx, { characterId, eventId: `story:${storyId}:${next.id}`, effects: termRewards, cityDef, factionDef });
        ideologyTouched = ideologyTouched || r.ideologyTouched;
        applied.push(...termRewards);
      }
      // The terminal's Chronicle lines, in the same transaction and after its
      // rewards. The line is stored as prose (already filled), because the web
      // ships no story content to render it from; createdAt is nudged by the
      // line's index so several lines keep their authored order.
      if (next.chronicle?.length) {
        const house = storyHouseName(characterId, storyId, (await storyContext(characterId, now, tx)).houseSlug);
        const at = new Date();
        await tx.insert(effectLog).values(
          next.chronicle.map((line, index) => ({
            characterId,
            kind: "story_line",
            detail: { chronicle: { storyId, line: fillStoryText(line, { house }) } },
            createdAt: new Date(at.getTime() + index),
          })),
        );
      }
      await tx
        .update(storyProgress)
        .set({ currentNode: next.id, status: "completed", completedAt: new Date() })
        .where(eq(storyProgress.id, prog.id));
      outcome = { resultText: branch.result ?? null, completed: true, nodeId: next.id };
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

  // The projection is built LAST, so the node now current shows its locks against
  // the composure and the wallet this advance left behind.
  const p = await projectionFor(characterId, storyId, now);
  // Post-grant summary only — describes effects THIS advance applied (empty for the
  // completed-replay no-op, since `applied` stays empty). Never a pre-choice preview.
  return {
    resultText: outcome!.resultText === null ? null : fill(p, outcome!.resultText),
    completed: outcome!.completed,
    node: projectNode(mustNode(tree, outcome!.nodeId), p),
    rewardsGranted: summarizeRewards(applied),
  };
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

// One PK read of a story's tree, projected to what an offer card shows: the title
// and the art of the node it starts on. null when the story is not seeded, which
// is also the "is it seeded?" answer the class trigger needs.
async function storyCard(storyId: string): Promise<{ title: string; image?: string } | null> {
  const rows = await db.select({ tree: stories.tree }).from(stories).where(eq(stories.id, storyId)).limit(1);
  return rows[0] ? storyCover(parseStoryTree(rows[0].tree)) : null;
}

// The lazy, read-side eligibility check (Pack 2 Phase A). For each registered
// story: an in-flight run resumes as "active"; a completed run is omitted;
// otherwise the trigger decides. A "festival" story is "offered" iff it is seeded
// AND the character attended a now-closed instance of the trigger festival (any
// game year — the offer persists until played). Attendance counts however the
// festival_events row resolved, incl. the offline auto-resolve to "attend"
// (closeInstance writes the festival_choregos guard row unconditionally, even
// winnerless). A "class" story is "offered" iff it is seeded, the character's
// class matches, and the world has reached the trigger's game date — read lazily
// here, so a deploy after the opening season still offers it to everyone.
//
// Per registered story: one progress lookup (unique index on character_id,
// story_id), and — only when there is no progress row — one guard query that is a
// single row from `stories` (PK) with an EXISTS over the festival_events ⋈
// festival_choregos join (both sides index-covered). No scans. The class and the
// world start are read ONCE per call, and only when a class trigger is registered.
export async function availableStories(
  characterId: string,
  registry: Record<string, StoryTrigger> = STORY_TRIGGERS,
  now: Date = new Date(),
): Promise<Array<{ storyId: string; status: "offered" | "active"; title: string; image?: string }>> {
  const out: Array<{ storyId: string; status: "offered" | "active"; title: string; image?: string }> = [];
  // The story's display title, extracted from the jsonb tree. Never break the payload
  // over a display string: a null/empty extraction falls back to the storyId.
  const titleExpr = sql<string | null>`${stories.tree}->>'title'`;
  const titleOr = (raw: string | null | undefined, storyId: string) => (raw && raw.length > 0 ? raw : storyId);
  const entry = (storyId: string, status: "offered" | "active", title: string, card: { image?: string } | null) => {
    out.push({ storyId, status, title, ...(card?.image ? { image: card.image } : {}) });
  };

  const trigs = Object.entries(registry);
  const character = trigs.some(([, t]) => t.kind === "class")
    ? (
        await db
          .select({ classId: playerCharacters.classId, startedAt: worlds.startedAt })
          .from(playerCharacters)
          .innerJoin(worlds, eq(worlds.id, playerCharacters.worldId))
          .where(eq(playerCharacters.id, characterId))
          .limit(1)
      )[0] ?? null
    : null;

  for (const [storyId, trigger] of trigs) {
    // In-flight / finished short-circuits the offer check.
    const prog = (
      await db
        .select({ status: storyProgress.status })
        .from(storyProgress)
        .where(and(eq(storyProgress.characterId, characterId), eq(storyProgress.storyId, storyId)))
        .limit(1)
    )[0];
    if (prog) {
      if (prog.status === "active") {
        // One PK read on `stories` for the card (the offer query is skipped here).
        const card = await storyCard(storyId);
        entry(storyId, "active", titleOr(card?.title, storyId), card);
      }
      continue; // "completed" (or any non-active) → omit
    }

    if (trigger.kind === "class") {
      if (!character || character.classId !== trigger.classId) continue;
      if (trigger.opensAt && gameDate(now.getTime(), character.startedAt.getTime()).seasonIndex < datedSeasonIndex(trigger.opensAt)) continue;
      const card = await storyCard(storyId); // the PK read IS the seeded check
      if (!card) continue;
      entry(storyId, "offered", titleOr(card.title, storyId), card);
      continue;
    }

    // No progress row: seeded story AND an attended, closed instance → offered.
    // The guard query also pulls the title (same single, index-friendly query).
    const seededAndAttended = await db
      .select({ id: stories.id, title: titleExpr })
      .from(stories)
      .where(
        and(
          eq(stories.id, storyId),
          exists(
            db
              .select({ id: festivalEvents.id })
              .from(festivalEvents)
              .innerJoin(playerCharacters, eq(playerCharacters.id, festivalEvents.characterId))
              .innerJoin(
                festivalChoregos,
                and(
                  eq(festivalChoregos.worldId, playerCharacters.worldId),
                  eq(festivalChoregos.festivalId, festivalEvents.festivalId),
                  eq(festivalChoregos.gameYear, festivalEvents.gameYear),
                ),
              )
              .where(and(eq(festivalEvents.characterId, characterId), eq(festivalEvents.festivalId, trigger.festivalId))),
          ),
        ),
      )
      .limit(1);
    // The guard query decides; a second PK read gives the offer card its art.
    if (seededAndAttended.length > 0) entry(storyId, "offered", titleOr(seededAndAttended[0]!.title, storyId), await storyCard(storyId));
  }
  return out;
}
