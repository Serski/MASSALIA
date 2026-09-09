import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bandDef, parseBandsContent, parseUnitsContent, seededRoll, sha256Words, unitDef, UNIT_ROLES } from "./barracks.js";
import { parseBuildingsContent } from "./buildings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

// The vendor band in buildings.json is the source of truth for good ids.
const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
const unitsRaw = read("content/military/units.json");
const bandsRaw = read("content/military/bands.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("units.json", () => {
  const units = parseUnitsContent(unitsRaw, goods);

  it("parses the real file: four units, gate militia 20, levy 100 +10/4 seasons", () => {
    expect(Object.keys(units.units)).toEqual(["peltast", "ekdromos", "hoplite", "hippeis"]);
    expect(units.gate).toEqual({ militia: 20 });
    expect(units.levy).toEqual({ startMen: 100, growthPerYear: 10, seasonsPerYear: 4 });
    expect(units.minServiceSeasons).toBe(2);
    expect(unitDef(units, "hoplite")!.gear).toEqual({ timber: 1, iron: 1, tin: 2 });
    expect(unitDef(units, "hippeis")!.stats.space).toBe(3);
    expect(unitDef(units, "nope")).toBeNull();
  });

  it("every gear and upkeep key is a vendor good; drachmae is never allowed on the trained side", () => {
    for (const u of Object.values(units.units)) {
      for (const g of [...Object.keys(u.gear), ...Object.keys(u.upkeepPerDay)]) expect(goods).toContain(g);
      expect(UNIT_ROLES).toContain(u.role);
    }
    const bad = clone(unitsRaw);
    bad.units.peltast.gear.drachmae = 5;
    expect(() => parseUnitsContent(bad, goods)).toThrow(/unknown good.*drachmae/);
  });

  it("rejects an unknown good", () => {
    const bad = clone(unitsRaw);
    bad.units.peltast.gear.adamantium = 1;
    expect(() => parseUnitsContent(bad, goods)).toThrow(/unknown good.*adamantium/);
  });

  it("rejects a missing stat, an out-of-range stat and a bad space", () => {
    const missing = clone(unitsRaw);
    delete missing.units.hoplite.stats.mor;
    expect(() => parseUnitsContent(missing, goods)).toThrow();
    const big = clone(unitsRaw);
    big.units.hoplite.stats.atk = 11;
    expect(() => parseUnitsContent(big, goods)).toThrow();
    const space = clone(unitsRaw);
    space.units.hoplite.stats.space = 2;
    expect(() => parseUnitsContent(space, goods)).toThrow();
  });

  it("rejects unknown keys, a bad role and a non-kebab id", () => {
    const extra = clone(unitsRaw);
    extra.units.peltast.cost = 10;
    expect(() => parseUnitsContent(extra, goods)).toThrow();
    const role = clone(unitsRaw);
    role.units.peltast.role = "chariot";
    expect(() => parseUnitsContent(role, goods)).toThrow();
    const id = clone(unitsRaw);
    id.units["Heavy Hoplite"] = clone(unitsRaw.units.hoplite);
    expect(() => parseUnitsContent(id, goods)).toThrow(/kebab-case/);
  });
});

describe("bands.json", () => {
  const bands = parseBandsContent(bandsRaw, goods);

  it("parses the real file: 20 bands, 3 offers a season, 2 active max, 2-season term, 0.8 default renew", () => {
    expect(Object.keys(bands.bands)).toHaveLength(20);
    expect(bands.market).toEqual({ offersPerSeason: 3, maxActiveBands: 2 });
    expect(bands.contract).toEqual({ termSeasons: 2, renewDefault: 0.8 });
    expect(bandDef(bands, "spartan-hoplites")!.renew).toBe(0.9);
    expect(bandDef(bands, "samnite-infantry")!.renew).toBeUndefined();
    expect(bandDef(bands, "nope")).toBeNull();
  });

  it("role coverage is 8 line, 5 skirmish, 3 missile, 4 mounted", () => {
    const count = (role: string) => Object.values(bands.bands).filter((b) => b.role === role).length;
    expect([count("line"), count("skirmish"), count("missile"), count("mounted")]).toEqual([8, 5, 3, 4]);
  });

  it("upkeep keys are vendor goods plus drachmae; men 10..40; renew 0..1", () => {
    for (const b of Object.values(bands.bands)) {
      for (const g of Object.keys(b.upkeepPerDay)) expect([...goods, "drachmae"]).toContain(g);
      expect(b.men).toBeGreaterThanOrEqual(10);
      expect(b.men).toBeLessThanOrEqual(40);
    }
    const men = clone(bandsRaw);
    men.bands["volcae-irregulars"].men = 50;
    expect(() => parseBandsContent(men, goods)).toThrow();
    const renew = clone(bandsRaw);
    renew.bands["volcae-irregulars"].renew = 1.5;
    expect(() => parseBandsContent(renew, goods)).toThrow();
  });

  it("rejects an unknown good and a missing stat", () => {
    const bad = clone(bandsRaw);
    bad.bands["cretan-archers"].upkeepPerDay.ambrosia = 1;
    expect(() => parseBandsContent(bad, goods)).toThrow(/unknown good.*ambrosia/);
    const missing = clone(bandsRaw);
    delete missing.bands["cretan-archers"].stats.spd;
    expect(() => parseBandsContent(missing, goods)).toThrow();
  });

  it("needs at least offersPerSeason bands in the catalogue", () => {
    const few = clone(bandsRaw);
    few.bands = { "volcae-irregulars": few.bands["volcae-irregulars"] };
    expect(() => parseBandsContent(few, goods)).toThrow(/offersPerSeason/);
  });
});

describe("seededRoll", () => {
  it("sha256 matches node:crypto on known and arbitrary inputs", () => {
    const hex = (w: Uint32Array) => Array.from(w, (x) => x.toString(16).padStart(8, "0")).join("");
    expect(hex(sha256Words("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256Words(""))).toBe(createHash("sha256").update("").digest("hex"));
    for (const msg of ["a|b|c", "x".repeat(55), "y".repeat(56), "z".repeat(64), "ελληνικά".repeat(20), "w".repeat(1000)]) {
      expect(hex(sha256Words(msg))).toBe(createHash("sha256").update(msg).digest("hex"));
    }
  });

  it("is deterministic, in [0, 1), and order-sensitive", () => {
    const r = seededRoll(["world", "player", "3", "0"]);
    expect(r).toBe(seededRoll(["world", "player", "3", "0"]));
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    expect(r).not.toBe(seededRoll(["world", "player", "3", "1"]));
    expect(r).not.toBe(seededRoll(["player", "world", "3", "0"]));
    expect(seededRoll(["abc"])).toBe(0xba7816bf / 2 ** 32);
  });
});
