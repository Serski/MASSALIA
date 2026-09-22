import { z } from "zod";
import { effectSchema, type EventEffect } from "./events.js";
import { nobleHouses, type House } from "./league.js";

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

// What a choice asks of the character before it will resolve. Every listed key is
// a MINIMUM. A requirement with no `otherwise` locks the choice (shown locked,
// refused by the server); one with an `otherwise` never locks — an unmet minimum
// routes the player down the fallback branch instead.
export interface StoryRequirement {
  composure?: number;
  prestige?: number;
  drachmae?: number;
}

export interface StoryChoice {
  id: string;
  text: string;
  // Interstitial blurb shown after picking, before the next node.
  result?: string;
  next: string;
  // Optional pass-through grant applied when this choice resolves.
  rewards?: EventEffect[];
  // Minimums this choice asks of the character.
  requires?: StoryRequirement;
  // The branch taken when `requires` is not met. Its rewards replace the choice's
  // own (the choice never resolved) and its result replaces the choice's result.
  otherwise?: { result?: string; next: string; rewards?: EventEffect[] };
}

export type StoryNode =
  | { type: "scene"; id: string; body: NodeBody; image?: string; choices: StoryChoice[] }
  // A terminal's `chronicle` lines are written to the player's Chronicle when the
  // story ends here — the one place the engine authors prose.
  | { type: "terminal"; id: string; body: NodeBody; image?: string; rewards: EventEffect[]; chronicle?: string[] };

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

// .strict() so a misspelt key ("prestiege") fails the boot instead of silently
// asking nothing; .refine() so an empty object cannot pass for a requirement.
const storyRequirementSchema = z
  .object({
    composure: z.number().int().min(0).max(100).optional(),
    prestige: z.number().int().min(0).max(100).optional(),
    drachmae: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((r) => r.composure !== undefined || r.prestige !== undefined || r.drachmae !== undefined, {
    message: "a requirement must name at least one minimum",
  });

const storyChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  result: z.string().optional(),
  next: z.string(),
  rewards: z.array(effectSchema).optional(),
  requires: storyRequirementSchema.optional(),
  otherwise: z
    .object({
      result: z.string().optional(),
      next: z.string(),
      rewards: z.array(effectSchema).optional(),
    })
    .optional(),
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
    chronicle: z.array(z.string().min(1)).optional(),
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

  // 2. Every choice.next — and every otherwise.next — resolves to a real node.
  for (const node of tree.nodes) {
    if (node.type !== "scene") continue;
    for (const choice of node.choices) {
      if (!byId.has(choice.next)) {
        problems.push(`Choice "${choice.id}" in node "${node.id}" points to missing node "${choice.next}"`);
      }
      if (choice.otherwise && !byId.has(choice.otherwise.next)) {
        problems.push(`Choice "${choice.id}" in node "${node.id}" falls back to missing node "${choice.otherwise.next}"`);
      }
      // 7. A fallback with nothing to fall back FROM is an authoring slip: the
      //    branch would be dead content.
      if (choice.otherwise && !choice.requires) {
        problems.push(`Choice "${choice.id}" in node "${node.id}" has an otherwise branch but no requires`);
      }
    }
    // 8. A scene where every choice can lock and none has a fallback strands the
    //    player: there would be nothing left to press.
    if (node.choices.every((c) => c.requires) && !node.choices.some((c) => c.otherwise)) {
      problems.push(`Node "${node.id}" can lock every choice`);
    }
  }

  // 9. The only token the projection fills is {house}; any other {…} would reach
  //    the player verbatim.
  for (const node of tree.nodes) {
    const texts: string[] = [...(node.body.eyebrow ? [node.body.eyebrow] : []), ...node.body.paragraphs];
    if (node.type === "scene") {
      for (const choice of node.choices) {
        texts.push(choice.text);
        if (choice.result) texts.push(choice.result);
        if (choice.otherwise?.result) texts.push(choice.otherwise.result);
      }
    } else if (node.chronicle) {
      texts.push(...node.chronicle);
    }
    const reported = new Set<string>();
    for (const text of texts) {
      for (const match of text.matchAll(/\{[^}]*\}/g)) {
        const token = match[0];
        if (token === "{house}" || reported.has(token)) continue;
        reported.add(token);
        problems.push(`Unknown token "${token}" in node "${node.id}"`);
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
        // A fallback branch is a real path through the story, so it counts for
        // reachability exactly like `next`.
        for (const target of choice.otherwise ? [choice.next, choice.otherwise.next] : [choice.next]) {
          if (byId.has(target) && !reachable.has(target)) {
            reachable.add(target);
            queue.push(target);
          }
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

// --- Projection helpers (pure) ----------------------------------------------

// The rival house a story's {house} token names for one character: any noble
// house but her own, picked by hashing the character and story ids, so the same
// player always reads the same house and two players rarely read the same one.
// FNV-1a, 32-bit — small, stable, and not a security primitive.
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function storyHouseName(characterId: string, storyId: string, ownHouseSlug: string, houses: House[] = nobleHouses): string {
  const others = houses.filter((h) => h.slug !== ownHouseSlug).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (others.length === 0) return "";
  return others[fnv1a32(`${characterId}:${storyId}`) % others.length]!.name;
}

// The one token the engine fills. Authored text carries "{house}"; every other
// "{…}" was rejected by validateStoryGraph at boot.
export function fillStoryText(text: string, vars: { house: string }): string {
  return text.split("{house}").join(vars.house);
}

// Every listed minimum is at most the character's value.
export function requirementMet(req: StoryRequirement, ctx: { composure: number; prestige: number; drachmae: number }): boolean {
  if (req.composure !== undefined && ctx.composure < req.composure) return false;
  if (req.prestige !== undefined && ctx.prestige < req.prestige) return false;
  if (req.drachmae !== undefined && ctx.drachmae < req.drachmae) return false;
  return true;
}

// The player-facing wording of a requirement, in a fixed order so the same
// requirement always reads the same way.
export function requirementLabel(req: StoryRequirement): string {
  const parts: string[] = [];
  if (req.composure !== undefined) parts.push(`Composure ${req.composure}`);
  if (req.prestige !== undefined) parts.push(`Prestige ${req.prestige}`);
  if (req.drachmae !== undefined) parts.push(`${req.drachmae} drachmae`);
  return parts.join(" · ");
}

// What an offer card shows before the story is opened: its title and the art of
// the node it starts on. The `image` key is omitted when the start node has none.
export function storyCover(tree: StoryTree): { title: string; image?: string } {
  const start = tree.nodes.find((n) => n.id === tree.start);
  return start?.image !== undefined ? { title: tree.title, image: start.image } : { title: tree.title };
}
