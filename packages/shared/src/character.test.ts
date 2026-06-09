import { describe, expect, it } from "vitest";
import { startingCharacter } from "./character.js";

describe("startingCharacter", () => {
  it("applies house ideology + house bonus + class stats together", () => {
    // Leonidas: ideology -80, +2 devotion. Priest: +3 devotion.
    const c = startingCharacter("leonidas", "priest");
    expect(c.ideology).toBe(-80);
    expect(c.devotion).toBe(5); // 2 (house) + 3 (class)
    expect(c.prestige).toBe(0);
    expect(c.militia).toBe(0);
    expect(c.intelligence).toBe(0);
    expect(c.drachmae).toBe(100);
    expect(c.growthMultiplier).toBe(1.0);
    expect(c.composure).toBe(70);
    expect(c.party).toBe("none");
  });

  it("stacks bonuses across stats (kleitos + shipbuilder)", () => {
    // Kleitos: ideology +60, +2 prestige. Shipbuilder: +2 intelligence +1 militia.
    const c = startingCharacter("kleitos", "shipbuilder");
    expect(c.ideology).toBe(60);
    expect(c.prestige).toBe(2);
    expect(c.intelligence).toBe(2);
    expect(c.militia).toBe(1);
    expect(c.devotion).toBe(0);
  });

  it("gives the slave reduced drachmae and a hidden growth multiplier", () => {
    const c = startingCharacter("xanthippos", "slave");
    expect(c.drachmae).toBe(10);
    expect(c.growthMultiplier).toBe(1.5);
    // xanthippos bonus only: +1 prestige +1 intelligence; slave adds nothing
    expect(c.prestige).toBe(1);
    expect(c.intelligence).toBe(1);
  });

  it("supports the hoplite class (renamed from military-leader)", () => {
    const c = startingCharacter("aristeides", "hoplite");
    expect(c.militia).toBe(5); // 2 (house) + 3 (class)
  });
});
