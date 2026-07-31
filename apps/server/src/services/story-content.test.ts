import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { parseStoryTree, parseTraitsFile, validateStoryGraph, type StoryTree } from "@massalia/shared";

// Cross-content integrity for the authored Artemisia story + the seed loader.
// The content-integrity block is pure (no DB) and runs always; the seed block is
// DB-gated like the other integration suites.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const storyFile = resolve(root, "content/stories/artemisia-silver.json");
const traitsFile = resolve(root, "content/traits/traits.json");

function readStory(): { id: string; version: number; tree: StoryTree } {
  const raw = JSON.parse(readFileSync(storyFile, "utf8")) as { id: string; version: number; tree: unknown };
  return { id: raw.id, version: raw.version, tree: parseStoryTree(raw.tree) };
}
function traitIdsInTree(tree: StoryTree): string[] {
  const ids: string[] = [];
  for (const node of tree.nodes) {
    const effects = node.type === "scene" ? node.choices.flatMap((c) => c.rewards ?? []) : node.rewards;
    for (const e of effects) if (e.type === "change_trait") ids.push(e.traitId);
  }
  return ids;
}

describe("Artemisia story content integrity (pure)", () => {
  it("1. the real content parses via parseStoryTree and validateStoryGraph returns []", () => {
    const { tree } = readStory();
    expect(validateStoryGraph(tree)).toEqual([]);
  });

  it("2. every change_trait traitId in the tree exists in traits.json (the typo tripwire)", () => {
    const { tree } = readStory();
    const known = new Set(parseTraitsFile(JSON.parse(readFileSync(traitsFile, "utf8"))).map((t) => t.id));
    const referenced = traitIdsInTree(tree);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(known.has(id), `trait "${id}" referenced by the tree is missing from traits.json`).toBe(true);
  });

  it("4. shape sanity: start P1, 15 nodes, E1/E2/E3 each carry exactly one change_trait + one change_drachmae", () => {
    const { tree } = readStory();
    expect(tree.start).toBe("P1");
    expect(tree.nodes.length).toBe(15);
    for (const id of ["E1", "E2", "E3"]) {
      const node = tree.nodes.find((n) => n.id === id);
      expect(node, `terminal ${id} exists`).toBeTruthy();
      expect(node!.type).toBe("terminal");
      const rewards = node!.type === "terminal" ? node!.rewards : [];
      expect(rewards.filter((e) => e.type === "change_trait").length).toBe(1);
      expect(rewards.filter((e) => e.type === "change_drachmae").length).toBe(1);
    }
  });
});

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

async function loadModules() {
  const dbPkg = await import("@massalia/db");
  const story = await import("./story.js");
  return { dbPkg, story };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;

suite("loadStories seed (integration)", () => {
  let m: Mods;
  let db: ReturnType<Mods["dbPkg"]["createDb"]>;

  beforeAll(async () => {
    m = await loadModules();
    db = m.dbPkg.createDb();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE story_progress, stories CASCADE`);
  });

  it("3. running twice upserts exactly one row per file; version + tree intact", async () => {
    await m.story.loadStories();
    await m.story.loadStories(); // idempotent re-assert

    const rows = await db.select().from(m.dbPkg.stories).where(eq(m.dbPkg.stories.id, "artemisia-silver"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.version).toBe(1);
    const tree = rows[0]!.tree as { start: string; nodes: unknown[] };
    expect(tree.start).toBe("P1"); // spot-check start
    expect(tree.nodes.length).toBe(15); // spot-check node count
  });
});
