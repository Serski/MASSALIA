import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBattleContent } from "./barracks.js";
import { parseBuildingsContent } from "./buildings.js";
import { allowedMapActions, atHoldingsCap, HOME_POLITY_ID, holdingsCapLine, holdingsCapTurnedBackLine, MAP_ACTION_TYPES, type MapActionType } from "./mapActions.js";

const sorted = (a: MapActionType[]) => [...a].sort();

describe("allowedMapActions", () => {
  it("a townless foreign region allows every action, colonise included", () => {
    expect(sorted(allowedMapActions({ kind: "region", hasTown: false, ownerId: "carthage" }))).toEqual(sorted([...MAP_ACTION_TYPES]));
  });

  it("a townless unclaimed region allows every action", () => {
    expect(sorted(allowedMapActions({ kind: "region", hasTown: false, ownerId: "unclaimed" }))).toEqual(["attack", "colonise", "raid", "scout"]);
  });

  it("ownerless land (null owner) still allows every action", () => {
    expect(sorted(allowedMapActions({ kind: "region", hasTown: false, ownerId: null }))).toEqual(["attack", "colonise", "raid", "scout"]);
  });

  it("a region holding a town is never colonised", () => {
    expect(sorted(allowedMapActions({ kind: "region", hasTown: true, ownerId: "roman_republic" }))).toEqual(["attack", "raid", "scout"]);
  });

  it("a foreign town allows attack, raid and scout but never colonise", () => {
    expect(sorted(allowedMapActions({ kind: "town", hasTown: true, ownerId: "carthage" }))).toEqual(["attack", "raid", "scout"]);
  });

  it("a town target ignores a stray hasTown=false — colonise stays illegal", () => {
    expect(allowedMapActions({ kind: "town", hasTown: false, ownerId: "etruscans" })).not.toContain("colonise");
  });

  it("nothing is legal against Massalia's own holdings, town or region", () => {
    expect(allowedMapActions({ kind: "town", hasTown: true, ownerId: HOME_POLITY_ID })).toEqual([]);
    expect(allowedMapActions({ kind: "region", hasTown: false, ownerId: HOME_POLITY_ID })).toEqual([]);
    expect(allowedMapActions({ kind: "region", hasTown: true, ownerId: "massalia" })).toEqual([]);
  });

  it("returns actions in the canonical order attack, raid, scout, colonise", () => {
    expect(allowedMapActions({ kind: "region", hasTown: false, ownerId: "boii" })).toEqual(["attack", "raid", "scout", "colonise"]);
  });
});

// Military 6a, ruling 5: a house holds at most two places.
describe("the holdings cap", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));
  const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
  const file = read("content/military/battle.json");
  const max = parseBattleContent(file, goods).holdings.maxPerHouse;

  it("reads the cap from content: a whole, positive number", () => {
    expect(max).toBe(2);
    for (const bad of [0, -1, 1.5]) expect(() => parseBattleContent({ ...file, holdings: { maxPerHouse: bad } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...file, holdings: { maxPerHouse: 2, extra: 1 } }, goods)).toThrow();
  });

  it("a house at or above the cap is at it; below it is not", () => {
    expect([0, 1, 2, 3].map((held) => atHoldingsCap(held, max))).toEqual([false, false, true, true]);
  });

  it("the lines carry the number from content", () => {
    expect(holdingsCapLine(max)).toBe("Your house holds all it can: 2 places.");
    expect(holdingsCapTurnedBackLine("Reii", max)).toBe("Turned back from Reii. Your house holds all it can: 2 places.");
    expect(holdingsCapLine(1)).toBe("Your house holds all it can: 1 place.");
  });
});
