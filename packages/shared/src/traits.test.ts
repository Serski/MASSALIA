import { describe, expect, it } from "vitest";
import { canAddTrait, effectiveStats, parseTraitsFile, type Trait } from "./traits.js";

const bold: Trait = { id: "bold", name: "Bold", description: "x", category: "personality", opposite: "cautious", statMod: { militia: 1 } };
const cautious: Trait = { id: "cautious", name: "Cautious", description: "x", category: "personality", opposite: "bold" };
const shrewd: Trait = { id: "shrewd", name: "Shrewd", description: "x", category: "personality", statMod: { intelligence: 1 } };
const proud: Trait = { id: "proud", name: "Proud", description: "x", category: "personality" };
const harborBorn: Trait = { id: "harbor-born", name: "Harbor-Born", description: "x", category: "upbringing", statMod: { intelligence: 1 } };
const renowned: Trait = { id: "renowned", name: "Renowned", description: "x", category: "reputation", statMod: { prestige: 2 } };

describe("canAddTrait — personality cap", () => {
  it("rejects a 4th personality trait", () => {
    const held = [bold, shrewd, proud]; // 3 personality
    const fourth: Trait = { id: "humble", name: "Humble", description: "x", category: "personality" };
    expect(canAddTrait(held, fourth)).toEqual({ ok: false, reason: "personality_cap" });
  });

  it("still allows a non-personality trait when 3 personality are held", () => {
    const held = [bold, shrewd, proud];
    expect(canAddTrait(held, harborBorn)).toEqual({ ok: true });
    expect(canAddTrait(held, renowned)).toEqual({ ok: true });
  });
});

describe("canAddTrait — opposites", () => {
  it("rejects adding the opposite of a held trait (both directions)", () => {
    expect(canAddTrait([bold], cautious)).toEqual({ ok: false, reason: "opposite" });
    expect(canAddTrait([cautious], bold)).toEqual({ ok: false, reason: "opposite" });
  });

  it("rejects duplicates", () => {
    expect(canAddTrait([bold], bold)).toEqual({ ok: false, reason: "duplicate" });
  });

  it("allows an unrelated trait", () => {
    expect(canAddTrait([bold], shrewd)).toEqual({ ok: true });
  });
});

describe("effectiveStats — derived math", () => {
  it("adds trait statMods onto base without mutating base", () => {
    const base = { prestige: 2, devotion: 0, militia: 0, intelligence: 1 };
    const eff = effectiveStats(base, [bold, shrewd, renowned]);
    // militia +1 (bold), intelligence +1 (shrewd), prestige +2 (renowned)
    expect(eff).toEqual({ prestige: 4, devotion: 0, militia: 1, intelligence: 2 });
    expect(base).toEqual({ prestige: 2, devotion: 0, militia: 0, intelligence: 1 });
  });

  it("returns base unchanged when no traits have statMods", () => {
    const base = { prestige: 1, devotion: 1, militia: 1, intelligence: 1 };
    expect(effectiveStats(base, [cautious, proud])).toEqual(base);
  });
});

describe("parseTraitsFile", () => {
  it("validates a well-formed trait array", () => {
    const parsed = parseTraitsFile([{ id: "a", name: "A", description: "d", category: "class", statMod: { militia: 2 } }]);
    expect(parsed).toHaveLength(1);
  });

  it("rejects an unknown category", () => {
    expect(() => parseTraitsFile([{ id: "a", name: "A", description: "d", category: "bogus" }])).toThrow();
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseTraitsFile([
        { id: "a", name: "A", description: "d", category: "class" },
        { id: "a", name: "A2", description: "d2", category: "class" },
      ]),
    ).toThrow();
  });
});
