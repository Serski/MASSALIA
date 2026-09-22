import { describe, expect, it } from "vitest";
import {
  fillStoryText,
  parseStoryTree,
  requirementLabel,
  requirementMet,
  storyCover,
  storyHouseName,
  validateStoryGraph,
} from "./story.js";
import { nobleHouses } from "./league.js";

// Pure tests — no DB, run always.

describe("parseStoryTree + validateStoryGraph", () => {
  it("accepts a small valid tree (scene → pass-through reward → terminal) with zero problems", () => {
    const tree = parseStoryTree({
      title: "The Silver Vein",
      start: "intro",
      nodes: [
        {
          type: "scene",
          id: "intro",
          body: { eyebrow: "Agora", paragraphs: ["A trader offers you a stake in a silver mine."] },
          image: "stories/silver-intro.webp",
          choices: [
            {
              id: "invest",
              text: "Invest 10 drachmae",
              result: "The shares are yours.",
              next: "payoff",
              rewards: [{ type: "change_drachmae", amount: -10 }],
            },
          ],
        },
        {
          type: "terminal",
          id: "payoff",
          body: { paragraphs: ["The vein runs rich."] },
          rewards: [{ type: "change_stat", stat: "prestige", amount: 5 }],
        },
      ],
    });

    expect(validateStoryGraph(tree)).toEqual([]);
  });

  it("flags a dangling choice.next", () => {
    const tree = parseStoryTree({
      title: "Dangling",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["Choose."] },
          choices: [
            { id: "good", text: "Go on", next: "end" },
            { id: "bad", text: "Wander off", next: "ghost" },
          ],
        },
        { type: "terminal", id: "end", body: { paragraphs: ["Done."] }, rewards: [] },
      ],
    });

    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("ghost"))).toBe(true);
  });

  it("flags a duplicate node id", () => {
    const tree = parseStoryTree({
      title: "Dup node",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["Choose."] },
          choices: [{ id: "c", text: "Go", next: "end" }],
        },
        { type: "terminal", id: "end", body: { paragraphs: ["First."] }, rewards: [] },
        { type: "terminal", id: "end", body: { paragraphs: ["Second — same id."] }, rewards: [] },
      ],
    });

    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("Duplicate node id") && p.includes("end"))).toBe(true);
  });

  it("flags a duplicate choice id within one node", () => {
    const tree = parseStoryTree({
      title: "Dup choice",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["Choose."] },
          choices: [
            { id: "c1", text: "One", next: "end" },
            { id: "c1", text: "One again", next: "end" },
          ],
        },
        { type: "terminal", id: "end", body: { paragraphs: ["Done."] }, rewards: [] },
      ],
    });

    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("Duplicate choice id") && p.includes("c1") && p.includes("a"))).toBe(true);
  });

  it("flags an orphan node (declared but unreachable from start)", () => {
    const tree = parseStoryTree({
      title: "Orphan",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["Choose."] },
          choices: [{ id: "c", text: "Go", next: "end" }],
        },
        { type: "terminal", id: "end", body: { paragraphs: ["Reachable end."] }, rewards: [] },
        { type: "terminal", id: "lonely", body: { paragraphs: ["Nobody points here."] }, rewards: [] },
      ],
    });

    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("lonely") && p.includes("unreachable"))).toBe(true);
  });

  it("rejects a scene with an empty choices array at the schema level", () => {
    expect(() =>
      parseStoryTree({
        title: "No choices",
        start: "a",
        nodes: [{ type: "scene", id: "a", body: { paragraphs: ["Stuck."] }, choices: [] }],
      }),
    ).toThrow();
  });

  it("flags a tree whose paths never reach a terminal", () => {
    const tree = parseStoryTree({
      title: "No exit",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["Loop A."] },
          choices: [{ id: "x", text: "To B", next: "b" }],
        },
        {
          type: "scene",
          id: "b",
          body: { paragraphs: ["Loop B."] },
          choices: [{ id: "y", text: "Back to A", next: "a" }],
        },
      ],
    });

    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("No terminal node is reachable"))).toBe(true);
  });
});

// --- Requirements, fallback branches and the {house} token -------------------

// A minimal two-node tree; `choice` is spread over the one choice on the scene.
function tinyTree(choice: Record<string, unknown>, extra: Record<string, unknown>[] = []) {
  return parseStoryTree({
    title: "Tiny",
    start: "a",
    nodes: [
      { type: "scene", id: "a", body: { paragraphs: ["Choose."] }, choices: [{ id: "c", text: "Go", next: "end", ...choice }] },
      { type: "terminal", id: "end", body: { paragraphs: ["Done."] }, rewards: [] },
      ...extra,
    ],
  });
}

describe("story requirements, fallbacks and chronicle lines (schema)", () => {
  it("keeps requires, otherwise and chronicle through parseStoryTree", () => {
    const tree = parseStoryTree({
      title: "Gated",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["Choose."] },
          choices: [
            {
              id: "press",
              text: "Press him",
              next: "end",
              requires: { composure: 50 },
              otherwise: { result: "Your voice shakes.", next: "soft", rewards: [{ type: "change_composure", amount: -5 }] },
            },
            { id: "pay", text: "Pay", next: "end", requires: { drachmae: 5, prestige: 10 } },
          ],
        },
        { type: "terminal", id: "soft", body: { paragraphs: ["A softer end."] }, rewards: [] },
        { type: "terminal", id: "end", body: { paragraphs: ["Done."] }, rewards: [], chronicle: ["The thief was found."] },
      ],
    });
    expect(validateStoryGraph(tree)).toEqual([]);
    const scene = tree.nodes.find((n) => n.id === "a")!;
    const press = scene.type === "scene" ? scene.choices[0]! : null;
    expect(press!.requires).toEqual({ composure: 50 });
    expect(press!.otherwise!.next).toBe("soft");
    expect(press!.otherwise!.rewards).toEqual([{ type: "change_composure", amount: -5 }]);
    const end = tree.nodes.find((n) => n.id === "end")!;
    expect(end.type === "terminal" ? end.chronicle : null).toEqual(["The thief was found."]);
  });

  it("rejects an empty requires and a misspelt requirement key", () => {
    expect(() => tinyTree({ requires: {} })).toThrow();
    expect(() => tinyTree({ requires: { prestiege: 10 } })).toThrow();
  });

  it("flags a fallback that points at no node", () => {
    const tree = tinyTree({ requires: { prestige: 10 }, otherwise: { next: "ghost" } });
    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("falls back to missing node") && p.includes("ghost"))).toBe(true);
  });

  it("flags an otherwise on a choice with no requires", () => {
    const tree = tinyTree({ otherwise: { next: "end" } });
    const problems = validateStoryGraph(tree);
    expect(problems.some((p) => p.includes("otherwise branch but no requires"))).toBe(true);
  });

  it("flags a scene that can lock every choice", () => {
    const tree = tinyTree({ requires: { prestige: 10 } });
    expect(validateStoryGraph(tree)).toContain('Node "a" can lock every choice');
    // The same scene with a fallback on that choice is sound.
    expect(validateStoryGraph(tinyTree({ requires: { prestige: 10 }, otherwise: { next: "end" } }))).toEqual([]);
  });

  it("flags any token but {house}, once per token, and accepts {house}", () => {
    const bad = parseStoryTree({
      title: "Tokens",
      start: "a",
      nodes: [
        {
          type: "scene",
          id: "a",
          body: { paragraphs: ["The steward of {House} waits, and {name} with him."] },
          choices: [{ id: "c", text: "Go", next: "end" }],
        },
        { type: "terminal", id: "end", body: { paragraphs: ["Done."] }, rewards: [], chronicle: ["{house} bought the poison."] },
      ],
    });
    const problems = validateStoryGraph(bad);
    expect(problems.filter((p) => p.includes("Unknown token")).length).toBe(2);
    expect(problems).toContain('Unknown token "{House}" in node "a"');
    expect(problems).toContain('Unknown token "{name}" in node "a"');
  });

  it("does not call a node reachable only through a fallback an orphan", () => {
    const tree = tinyTree({ requires: { composure: 50 }, otherwise: { next: "soft" } }, [
      { type: "terminal", id: "soft", body: { paragraphs: ["The soft end."] }, rewards: [] },
    ]);
    expect(validateStoryGraph(tree)).toEqual([]);
  });
});

describe("story projection helpers (pure)", () => {
  it("storyHouseName never names the character's own house, is stable, and spreads", () => {
    for (const own of nobleHouses) {
      const ids = Array.from({ length: 50 }, (_, i) => `char-${own.slug}-${i}-${Math.random().toString(36).slice(2)}`);
      for (const id of ids) {
        const name = storyHouseName(id, "house-of-roses", own.slug);
        expect(name, `${own.slug} must never be named to its own member`).not.toBe(own.name);
        expect(storyHouseName(id, "house-of-roses", own.slug), "same inputs, same house").toBe(name);
      }
    }
    const spread = new Set(
      Array.from({ length: 200 }, (_, i) => storyHouseName(`spread-${i}`, "house-of-roses", "kleitos")),
    );
    expect(spread.size).toBeGreaterThanOrEqual(5);
  });

  it("fillStoryText replaces every {house}", () => {
    expect(fillStoryText("House {house} buys what House {house} cannot make.", { house: "Timon" })).toBe(
      "House Timon buys what House Timon cannot make.",
    );
    expect(fillStoryText("No token here.", { house: "Timon" })).toBe("No token here.");
  });

  it("requirementMet compares every listed minimum", () => {
    const ctx = { composure: 50, prestige: 10, drachmae: 5 };
    expect(requirementMet({ composure: 50 }, ctx)).toBe(true);
    expect(requirementMet({ composure: 51 }, ctx)).toBe(false);
    expect(requirementMet({ prestige: 10, drachmae: 5 }, ctx)).toBe(true);
    expect(requirementMet({ prestige: 10, drachmae: 6 }, ctx)).toBe(false);
  });

  it("requirementLabel reads composure, then prestige, then drachmae", () => {
    expect(requirementLabel({ composure: 50 })).toBe("Composure 50");
    expect(requirementLabel({ prestige: 10 })).toBe("Prestige 10");
    expect(requirementLabel({ drachmae: 5 })).toBe("5 drachmae");
    expect(requirementLabel({ drachmae: 5, prestige: 10, composure: 50 })).toBe("Composure 50 · Prestige 10 · 5 drachmae");
  });

  it("storyCover carries the start node's image, and omits the key when it has none", () => {
    const withArt = parseStoryTree({
      title: "Covered",
      start: "a",
      nodes: [
        { type: "scene", id: "a", body: { paragraphs: ["Open."] }, image: "/stories/a.webp", choices: [{ id: "c", text: "Go", next: "end" }] },
        { type: "terminal", id: "end", body: { paragraphs: ["Done."] }, rewards: [] },
      ],
    });
    expect(storyCover(withArt)).toEqual({ title: "Covered", image: "/stories/a.webp" });
    const bare = tinyTree({});
    expect(storyCover(bare)).toEqual({ title: "Tiny" });
    expect("image" in storyCover(bare)).toBe(false);
  });
});
