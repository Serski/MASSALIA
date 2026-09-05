import { describe, expect, it } from "vitest";
import { allowedMapActions, HOME_POLITY_ID, MAP_ACTION_TYPES, type MapActionType } from "./mapActions.js";

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
