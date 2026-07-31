import { describe, expect, it } from "vitest";
import { parseStoryTree, validateStoryGraph } from "./story.js";

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
