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

  it("with the fleet given, a hull shortage for the whole roster does not grey the buttons: a one-man party could sail", () => {
    const buttons = mapActionButtons({ kind: "region", hasTown: false, ownerId: "carthage" });
    // Balari: two seas out, the whole roster of 60 short of the 28 space aboard.
    const hulls = "Not enough hulls: 60 space needed, 28 aboard.";
    const entry = { landSteps: null, seaSteps: 2, byBase: { R060: { landSteps: null, seaSteps: 2 } }, attack: { ok: false, reason: hulls }, raid: { ok: false, reason: hulls }, colonise: { ok: false, reason: hulls } };
    const fleet = { ships: { "trade-ship": 1, galley: 2 }, range: 7, space: 28, tiers: [{ range: 7, space: 20 }, { range: 4, space: 8 }] };
    const lit = withReach(buttons, entry, fleet);
    expect(lit.buttons.filter((b) => b.enabled).map((b) => b.type)).toEqual(["attack", "raid", "scout", "colonise"]);
    expect(lit.caption).toBeNull();
    // Without the fleet the server's verdict stands, as before.
    expect(withReach(buttons, entry).buttons.every((b) => !b.enabled)).toBe(true);
    // Reasons no selection could mend still grey: the fleet's range, and no men at all.
    const far = withReach(buttons, { ...entry, seaSteps: 9, byBase: { R060: { landSteps: null, seaSteps: 9 } } }, fleet);
    expect(far.buttons.every((b) => !b.enabled)).toBe(true);
    expect(far.caption).toBe("Beyond the fleet's range (9 seas, fleet reaches 7).");
    const noMen = { ...entry, attack: { ok: false, reason: "No men under arms." }, raid: { ok: false, reason: "No men under arms." } };
    expect(withReach(buttons, noMen, fleet).buttons.find((b) => b.type === "raid")!.title).toBe("No men under arms.");
  });
});
