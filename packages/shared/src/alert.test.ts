import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aboveAlertAt, alertLine, onAlert } from "./alert.js";
import { parseBattleContent } from "./barracks.js";
import { parseBuildingsContent } from "./buildings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));
const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
const battle = parseBattleContent(read("content/military/battle.json"), goods);
const share = battle.alert.share;

// Military 6a, ruling 2: a place at or below half its full strength is on alert.
describe("the alert", () => {
  it("reads its share from content: a fraction strictly between 0 and 1, and nothing else in the block", () => {
    expect(battle.alert).toEqual({ share: 0.5 });
    const file = read("content/military/battle.json");
    for (const bad of [0, 1, -0.5, 1.5]) expect(() => parseBattleContent({ ...file, alert: { share: bad } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...file, alert: { share: 0.5, extra: 1 } }, goods)).toThrow();
    const { alert: _alert, ...without } = file;
    expect(() => parseBattleContent(without, goods)).toThrow();
  });

  it("at or below half is on alert, above it is not", () => {
    expect(onAlert(50, 100, share)).toBe(true);
    expect(onAlert(51, 100, share)).toBe(false);
    expect(onAlert(0, 100, share)).toBe(true);
    // An odd full strength: 73 of 147 is at or below 73.5, 74 is above it.
    expect(onAlert(73, 147, share)).toBe(true);
    expect(onAlert(74, 147, share)).toBe(false);
    // Full, or above full, is never on alert.
    expect(onAlert(147, 147, share)).toBe(false);
    expect(onAlert(6000, 100, share)).toBe(false);
  });

  it("a place with no full strength is never on alert, and the share is read within a hair", () => {
    expect(onAlert(0, 0, share)).toBe(false);
    // 0.29 × 100 is 28.999999999999996 in floating point: 29 is still at the share.
    expect(onAlert(29, 100, 0.29)).toBe(true);
    expect(onAlert(30, 100, 0.29)).toBe(false);
  });

  it("a pool on alert comes off it at the first whole day of its own clock whose regrowth takes it above half", () => {
    const DAY = 86_400_000;
    const marker = Date.UTC(2000, 0, 10, 10, 30);
    const regen = battle.regen.warbandShare; // 30 of 100 a day
    // 20 reads 50 a day on (still at half) and 80 two days on.
    expect(aboveAlertAt(20, 100, marker, regen, share)).toBe(marker + 2 * DAY);
    expect(aboveAlertAt(50, 100, marker, regen, share)).toBe(marker + DAY);
    expect(aboveAlertAt(0, 100, marker, regen, share)).toBe(marker + 2 * DAY);
    // 150 of 400 regrows 120 a day: 270 a day on.
    expect(aboveAlertAt(150, 400, marker, regen, share)).toBe(marker + DAY);
    // Not on alert, a place with no full strength included: its marker. No regrowth: never.
    expect(aboveAlertAt(51, 100, marker, regen, share)).toBe(marker);
    expect(aboveAlertAt(20, 100, marker, 0, share)).toBeNull();
    expect(aboveAlertAt(0, 0, marker, regen, share)).toBe(marker);
  });

  it("the lines: a town shuts its gates, a land drives its herds into the hills", () => {
    expect(alertLine("Reii", "town")).toBe("Reii is on alert, gates are shut.");
    expect(alertLine("Salyes", "land")).toBe("Salyes is on alert, the herds are driven into the hills.");
  });
});
