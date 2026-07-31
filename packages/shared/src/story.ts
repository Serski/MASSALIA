import { z } from "zod";
import { effectSchema, type EventEffect } from "./events.js";

// ---------------------------------------------------------------------------
// Authored branching stories (Story Engine). The content shape stored in
// stories.tree (see migration 0040). Pure: zod validation + a graph validator,
// no DB / IO. Rewards reuse the EXISTING event effect union (effectSchema /
// EventEffect from events.ts) — story rewards are just arrays of that type; this
// module never redefines or extends the effect vocabulary.
//
// Mirrors the events.ts house idiom: hand-written interfaces alongside parallel
// zod schemas, with a named parse wrapper that casts the parsed value.
// ---------------------------------------------------------------------------

// Structured prose for a node. `paragraphs` is nonempty. These are rendered at
// display time — never pre-rendered HTML.
export interface NodeBody {
  eyebrow?: string;
  paragraphs: string[];
}

export interface StoryChoice {
  id: string;
  text: string;
  // Interstitial blurb shown after picking, before the next node.
  result?: string;
  next: string;
  // Optional pass-through grant applied when this choice resolves.
  rewards?: EventEffect[];
}

export type StoryNode =
  | { type: "scene"; id: string; body: NodeBody; image?: string; choices: StoryChoice[] }
  | { type: "terminal"; id: string; body: NodeBody; image?: string; rewards: EventEffect[] };

export interface StoryTree {
  title: string;
  start: string; // node id
  nodes: StoryNode[];
}

// --- Zod validation --------------------------------------------------------

const nodeBodySchema = z.object({
  eyebrow: z.string().optional(),
  paragraphs: z.array(z.string()).min(1),
});

const storyChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  result: z.string().optional(),
  next: z.string(),
  rewards: z.array(effectSchema).optional(),
});

const storyNodeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scene"),
    id: z.string(),
    body: nodeBodySchema,
    image: z.string().optional(),
    choices: z.array(storyChoiceSchema).min(1),
  }),
  z.object({
    type: z.literal("terminal"),
    id: z.string(),
    body: nodeBodySchema,
    image: z.string().optional(),
    // Required field, but may be empty (a terminal that grants nothing).
    rewards: z.array(effectSchema),
  }),
]);

export const storyTreeSchema = z.object({
  title: z.string(),
  start: z.string(),
  nodes: z.array(storyNodeSchema),
});

export function parseStoryTree(data: unknown): StoryTree {
  return storyTreeSchema.parse(data) as StoryTree;
}

// --- Graph validation ------------------------------------------------------

// Structural problems in a (already schema-valid) tree, each naming the offending
// id. Empty array = a sound graph. Effect contents are NOT re-checked here — the
// effect schema already validated them during parseStoryTree.
export function validateStoryGraph(tree: StoryTree): string[] {
  const problems: string[] = [];

  // 3. Duplicate node ids.
  const seen = new Set<string>();
  const reportedDupes = new Set<string>();
  for (const node of tree.nodes) {
    if (seen.has(node.id) && !reportedDupes.has(node.id)) {
      problems.push(`Duplicate node id: "${node.id}"`);
      reportedDupes.add(node.id);
    }
    seen.add(node.id);
  }

  // Index by id (first-wins; duplicates already reported above).
  const byId = new Map<string, StoryNode>();
  for (const node of tree.nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  // 4. Duplicate choice ids within a single node.
  for (const node of tree.nodes) {
    if (node.type !== "scene") continue;
    const choiceSeen = new Set<string>();
    const choiceReported = new Set<string>();
    for (const choice of node.choices) {
      if (choiceSeen.has(choice.id) && !choiceReported.has(choice.id)) {
        problems.push(`Duplicate choice id "${choice.id}" in node "${node.id}"`);
        choiceReported.add(choice.id);
      }
      choiceSeen.add(choice.id);
    }
  }

  // 1. start resolves to a real node.
  if (!byId.has(tree.start)) problems.push(`start node "${tree.start}" does not exist`);

  // 2. Every choice.next resolves to a real node.
  for (const node of tree.nodes) {
    if (node.type !== "scene") continue;
    for (const choice of node.choices) {
      if (!byId.has(choice.next)) {
        problems.push(`Choice "${choice.id}" in node "${node.id}" points to missing node "${choice.next}"`);
      }
    }
  }

  // Reachability from start (BFS over declared nodes only).
  const reachable = new Set<string>();
  if (byId.has(tree.start)) {
    const queue: string[] = [tree.start];
    reachable.add(tree.start);
    while (queue.length > 0) {
      const node = byId.get(queue.shift()!)!;
      if (node.type !== "scene") continue;
      for (const choice of node.choices) {
        if (byId.has(choice.next) && !reachable.has(choice.next)) {
          reachable.add(choice.next);
          queue.push(choice.next);
        }
      }
    }
  }

  // 5. At least one terminal is reachable from start.
  const terminalReachable = tree.nodes.some((node) => node.type === "terminal" && reachable.has(node.id));
  if (!terminalReachable) problems.push(`No terminal node is reachable from start "${tree.start}"`);

  // 6. Every declared node is reachable from start (orphans are authoring bugs).
  for (const node of tree.nodes) {
    if (!reachable.has(node.id)) {
      problems.push(`Node "${node.id}" is unreachable from start "${tree.start}"`);
    }
  }

  return problems;
}
