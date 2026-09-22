import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { parseStoryTree, parseTraitsFile, validateStoryGraph, type EventEffect, type StoryTree } from "@massalia/shared";

// Cross-content integrity for the authored stories + the seed loader.
// The content-integrity block is pure (no DB) and runs always; the seed block is
// DB-gated like the other integration suites.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const storyFile = resolve(root, "content/stories/artemisia-silver.json");
const rosesFile = resolve(root, "content/stories/house-of-roses.json");
const traitsFile = resolve(root, "content/traits/traits.json");
const buildingsFile = resolve(root, "content/buildings/buildings.json");

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

  it("5. every image path in every story tree resolves to a real file (path-typo tripwire)", () => {
    const storiesDir = resolve(root, "content/stories");
    const files = readdirSync(storiesDir).filter((f) => f.endsWith(".json"));
    let checked = 0;
    for (const file of files) {
      const tree = parseStoryTree((JSON.parse(readFileSync(resolve(storiesDir, file), "utf8")) as { tree: unknown }).tree);
      for (const node of tree.nodes) {
        if (!node.image) continue;
        // node.image is a web-origin path ("/stories/<file>"): the art ships with the
        // web build under apps/web/public, never through the API's /content/ mount.
        expect(node.image, `${file}: image "${node.image}" must live under /stories/`).toMatch(/^\/stories\//);
        const physical = resolve(root, "apps/web/public", node.image.replace(/^\//, ""));
        expect(existsSync(physical), `${file}: image "${node.image}" missing at ${physical}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // the Artemisia P1/P6/P8 images must actually be present to check
  });
});

describe("House of Roses story content integrity (pure)", () => {
  function readRoses(): { id: string; version: number; tree: StoryTree } {
    const raw = JSON.parse(readFileSync(rosesFile, "utf8")) as { id: string; version: number; tree: unknown };
    return { id: raw.id, version: raw.version, tree: parseStoryTree(raw.tree) };
  }

  // Every effect the tree can apply, from both branches of every choice and from
  // every terminal.
  function effectsInTree(tree: StoryTree) {
    return tree.nodes.flatMap((node) =>
      node.type === "scene"
        ? node.choices.flatMap((c) => [...(c.rewards ?? []), ...(c.otherwise?.rewards ?? [])])
        : node.rewards,
    );
  }

  it("6. the real content parses and validateStoryGraph returns []", () => {
    expect(validateStoryGraph(readRoses().tree)).toEqual([]);
  });

  it("7. shape sanity: start OPEN, 35 nodes — 31 scenes and 4 terminals", () => {
    const { tree } = readRoses();
    expect(tree.start).toBe("OPEN");
    expect(tree.nodes.length).toBe(35);
    expect(tree.nodes.filter((n) => n.type === "scene").length).toBe(31);
    expect(tree.nodes.filter((n) => n.type === "terminal").length).toBe(4);
  });

  it("8. every gain_good names a good the buildings catalog labels (the typo tripwire)", () => {
    const { tree } = readRoses();
    const labels = (JSON.parse(readFileSync(buildingsFile, "utf8")) as { goodLabels: Record<string, string> }).goodLabels;
    const goods = effectsInTree(tree).flatMap((e) => (e.type === "gain_good" ? [e.good] : []));
    expect(goods.length).toBeGreaterThan(0);
    for (const good of goods) expect(labels[good], `good "${good}" is not in buildings.json goodLabels`).toBeTruthy();
  });

  it("9. every path ends, credits 2 remedies and the vial unless the watch took it, and only `name` reaches END-full", () => {
    const { tree } = readRoses();
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const paths: { terminal: string; goods: Record<string, number>; namedTheHouse: boolean }[] = [];

    // Exhaustive walk: every choice, and every fallback branch, from OPEN. The tree
    // is a DAG (the graph validator proves every path terminates), so this halts.
    const walk = (nodeId: string, goods: Record<string, number>, namedTheHouse: boolean) => {
      const node = byId.get(nodeId)!;
      const credit = (into: Record<string, number>, rewards: EventEffect[] | undefined) => {
        const out = { ...into };
        for (const e of rewards ?? []) if (e.type === "gain_good") out[e.good] = (out[e.good] ?? 0) + e.amount;
        return out;
      };
      if (node.type === "terminal") {
        paths.push({ terminal: node.id, goods: credit(goods, node.rewards), namedTheHouse });
        return;
      }
      for (const choice of node.choices) {
        const branches = choice.otherwise ? [choice, choice.otherwise] : [choice];
        for (const branch of branches) {
          walk(branch.next, credit(goods, branch.rewards), namedTheHouse || choice.id === "name");
        }
      }
    };
    walk(tree.start, {}, false);

    expect(paths.length).toBe(12_636);
    for (const path of paths) {
      expect(path.goods.remedy, `${path.terminal}: the two remedies come home on every path`).toBe(2);
      expect(path.goods.poison ?? 0, `${path.terminal}: the vial`).toBe(path.terminal === "END-watch" ? 0 : 1);
      expect(path.terminal === "END-full", `${path.terminal}: the full solve is exactly the "name" choice`).toBe(path.namedTheHouse);
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
    expect(rows[0]!.version).toBe(readStory().version); // read the expected version from the file's own wrapper
    const tree = rows[0]!.tree as { start: string; nodes: unknown[] };
    expect(tree.start).toBe("P1"); // spot-check start
    expect(tree.nodes.length).toBe(15); // spot-check node count
  });

  it("10. the House of Roses is seeded too, and its trigger opens it to the Hetaira in Winter 298 BC", async () => {
    await m.story.loadStories();

    const rows = await db.select().from(m.dbPkg.stories).where(eq(m.dbPkg.stories.id, "house-of-roses"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.version).toBe(1);
    expect((rows[0]!.tree as { nodes: unknown[] }).nodes.length).toBe(35);

    expect(m.story.STORY_TRIGGERS["house-of-roses"]).toEqual({
      kind: "class",
      classId: "hetaira",
      opensAt: { yearBC: 298, season: 1 },
    });
  });
});
