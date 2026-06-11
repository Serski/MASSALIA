import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canManumit, isManumissionTarget, manumissionChoices, parseFamilyConfig, type ManumissionConfig } from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const familyCfg = parseFamilyConfig(JSON.parse(readFileSync(resolve(root, "content/family/family-config.json"), "utf8")));
const cfg: ManumissionConfig = familyCfg.manumission;

describe("config: manumission block", () => {
  it("parses the six citizen classes and the required trait", () => {
    expect(cfg.requiresTrait).toBe("freedman");
    expect([...cfg.eligibleClasses].sort()).toEqual(["hoplite", "landowner", "philosopher", "priest", "shipbuilder", "trader"]);
  });
});

describe("canManumit", () => {
  it("is true only for a slave who holds the freedman trait", () => {
    expect(canManumit("slave", ["freedman"], cfg)).toBe(true);
    expect(canManumit("slave", ["freedman", "stern"], cfg)).toBe(true);
  });

  it("is false for a slave without the freedman trait", () => {
    expect(canManumit("slave", [], cfg)).toBe(false);
    expect(canManumit("slave", ["dowried"], cfg)).toBe(false);
  });

  it("is false for a citizen, even holding the freedman trait (cannot re-trigger)", () => {
    for (const klass of ["landowner", "trader", "philosopher", "hoplite", "shipbuilder", "priest"]) {
      expect(canManumit(klass, ["freedman"], cfg)).toBe(false);
    }
  });

  it("is false for a hetaira holding freedman", () => {
    expect(canManumit("hetaira", ["freedman"], cfg)).toBe(false);
  });
});

describe("manumissionChoices", () => {
  it("returns exactly the six citizen classes", () => {
    expect([...manumissionChoices(cfg)].sort()).toEqual(["hoplite", "landowner", "philosopher", "priest", "shipbuilder", "trader"]);
  });

  it("never includes hetaira or slave — even if a config listed them", () => {
    const polluted: ManumissionConfig = { requiresTrait: "freedman", eligibleClasses: ["trader", "hetaira", "slave", "priest"] };
    expect(manumissionChoices(polluted)).toEqual(["trader", "priest"]);
  });
});

describe("isManumissionTarget", () => {
  it("accepts a citizen class and rejects hetaira/slave/unknown", () => {
    expect(isManumissionTarget("hoplite", cfg)).toBe(true);
    expect(isManumissionTarget("hetaira", cfg)).toBe(false);
    expect(isManumissionTarget("slave", cfg)).toBe(false);
    expect(isManumissionTarget("archon", cfg)).toBe(false);
  });
});
