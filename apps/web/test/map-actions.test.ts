import { describe, expect, it } from "vitest";
import { MAP_ACTIONS, mapActionButtons, withReach } from "../src/map/mapActions.js";

// The button row the town and region panels render, driven by the shared matrix.
describe("mapActionButtons", () => {
  it("keeps the four actions in display order with their labels", () => {
    expect(MAP_ACTIONS.map((a) => a.label)).toEqual(["Attack", "Raid", "Scout", "Colonise"]);
  });

  it("a townless non-Massaliote region yields all four enabled", () => {
    const row = mapActionButtons({ kind: "region", hasTown: false, ownerId: "boii" });
    expect(row.map((b) => b.enabled)).toEqual([true, true, true, true]);
    expect(row.every((b) => b.title === undefined)).toBe(true);
  });

  it("a foreign town yields three enabled and Colonise disabled with its reason", () => {
    const row = mapActionButtons({ kind: "town", hasTown: true, ownerId: "carthage" });
    expect(row.filter((b) => b.enabled).map((b) => b.label)).toEqual(["Attack", "Raid", "Scout"]);
    const colonise = row.find((b) => b.type === "colonise")!;
    expect(colonise.enabled).toBe(false);
    expect(colonise.title).toBe("Colonies are founded in open country");
  });

  it("a Massaliote town yields none, every button explaining why", () => {
    const row = mapActionButtons({ kind: "town", hasTown: true, ownerId: "massalia" });
    expect(row.map((b) => b.enabled)).toEqual([false, false, false, false]);
    expect(new Set(row.map((b) => b.title))).toEqual(new Set(["Massalia does not act against her own"]));
  });

  it("withReach gates Scout on the Raid verdict, with the reason as title and caption", () => {
    const buttons = mapActionButtons({ kind: "region", hasTown: false, ownerId: "boii" });
    const entry = { landSteps: null, seaSteps: 3, byBase: {}, attack: { ok: false, reason: "Beyond the fleet's range (3 seas, fleet reaches 0)." }, raid: { ok: false, reason: "Beyond the fleet's range (3 seas, fleet reaches 0)." }, colonise: { ok: false, reason: "Beyond the fleet's range (3 seas, fleet reaches 0)." } };
    const { buttons: out, caption } = withReach(buttons, entry);
    expect(out.map((b) => b.enabled)).toEqual([false, false, false, false]);
    expect(out.find((b) => b.type === "scout")!.title).toBe(entry.raid.reason);
    expect(caption).toBe("Beyond the fleet's range (3 seas, fleet reaches 0).");
    // Raid ok lights Scout too.
    const lit = withReach(buttons, { ...entry, raid: { ok: true } }).buttons;
    expect(lit.filter((b) => b.enabled).map((b) => b.type)).toEqual(["raid", "scout"]);
    // No entry: the matrix's verdict stands.
    expect(withReach(buttons, undefined).buttons.every((b) => b.enabled)).toBe(true);
  });
});
