import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { marchMinutes, parseBattleContent, parseUnitsContent, raidAngers, raidPlunder, raidTurnout, rateBounds, regrownPool, rollRate, type UnitStats } from "./barracks.js";
import { resolveBattle, SKIRMISH_MSL, type BattleConfig, type BattleRow } from "./battle.js";
import { parseBuildingsContent } from "./buildings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));
const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
const units = parseUnitsContent(read("content/military/units.json"), goods);
const battle = parseBattleContent(read("content/military/battle.json"), goods);

const unit = (id: string, count: number): BattleRow => ({ id, label: id, count, stats: units.units[id]!.stats });
const warband = (count: number): BattleRow => ({ id: "warband", label: "warband", count, stats: battle.npc.warband.stats });
const row = (id: string, count: number, stats: Partial<UnitStats>): BattleRow => ({ id, label: id, count, stats: { atk: 0, def: 0, msl: 0, mor: 10, spd: 1, space: 1, ...stats } });
// A config where casualties come out whole: lethality 1, no defense floor, and
// rows whose def is 1, so Σ(count × atk) casualties land exactly.
const exact: BattleConfig = { ...battle, rounds: 1, lethality: 1, defenseFloor: 0, moraleStep: 0.05, pursuitLoss: 0.25 };

describe("battle content", () => {
  it("parses the real file and rejects an unknown key", () => {
    expect(battle.rounds).toBe(3);
    expect(battle.npc.warband.stats.spd).toBe(6);
    expect(battle.raid).toEqual({ rounds: 2, turnout: { floorOneIn: 50, capOneIn: 4 }, plunderPerKill: { min: 20, max: 30 }, grainPerKill: { min: 1, max: 3 }, spoilPerKill: { min: 1, max: 3 }, spoilGoods: ["oliveoil", "leather", "salt", "wool"], townPlunderMultiplier: 2, opinion: { chance: 0.33, loss: 1 } });
    expect(battle.alert).toEqual({ share: 0.5 });
    // 3c: towns, tribute, region tribute and moves.
    expect(battle.regen).toEqual({ warbandShare: 0.3, garrisonShare: 0.3 });
    expect(battle.town).toEqual({ wallsDefCap: 3 });
    expect(battle.tribute).toEqual({ perPopulation: 0.08, minGarrisonPerPopulation: 0.01 });
    expect(battle.holdings).toEqual({ maxPerHouse: 2 });
    expect(battle.regionTribute).toEqual({ grainPerWarband: 0.05, timberPerWarband: 0.025, minGrain: 15, minTimber: 8, levyPerYear: 5 });
    expect(battle.move).toEqual({ minutesPerStep: 30, minutesWithinRegion: 10 });
    // The road (raids prompt 4): whole minutes each way.
    expect(battle.march).toEqual({ minutesPerStep: 30, minutesWithinRegion: 10 });
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), march: { minutesPerStep: 0, minutesWithinRegion: 10 } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), march: { minutesPerStep: 30, minutesWithinRegion: 7.5 } }, goods)).toThrow();
    // The altar: two seasons, a bull +3 and a chicken +1; every good a vendor good.
    expect(battle.altar.seasons).toBe(2);
    expect(battle.altar.goods).toEqual({ bull: 3, chicken: 1 });
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), move: { minutesPerStep: 0, minutesWithinRegion: 10 } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), extra: 1 }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), pursuitLoss: 2 }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), altar: { seasons: 2, goods: { unicorn: 3 } } }, goods)).toThrow(/altar\.goods: unknown good/);
    // The raid's third good: every id a vendor good, none twice; a share of the warband in (0, 1].
    const raid = battle.raid;
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, spoilGoods: ["oliveoil", "unicorn"] } }, goods)).toThrow(/raid\.spoilGoods: unknown good/);
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, spoilGoods: ["salt", "wool", "salt"] } }, goods)).toThrow(/raid\.spoilGoods: .*salt.* twice/);
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, spoilGoods: [] } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, turnout: { floorOneIn: 0, capOneIn: 4 } } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, turnout: { floorOneIn: 50, capOneIn: 1.5 } } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, turnout: { floorOneIn: 50, capOneIn: 4, extra: 1 } } }, goods)).toThrow();
    // The grudge: a chance in [0, 1] and a whole, positive loss.
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, opinion: { chance: 1.5, loss: 1 } } }, goods)).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), raid: { ...raid, opinion: { chance: 0.33, loss: 0 } } }, goods)).toThrow();
  });
});

// Strikes prompt 1, ruling 1: a pool regrows 30% of its full strength a season, rounded up.
describe("regrowth", () => {
  const share = battle.regen.garrisonShare;
  it("a 2,300 garrison at 0 reads 690 after a season, 1,380 after two, and 2,300 after four", () => {
    expect([1, 2, 3, 4, 10].map((s) => regrownPool(0, 2300, s, share))).toEqual([690, 1380, 2070, 2300, 2300]);
  });
  it("a 25 warband regrows 8 a season (7.5 rounded up)", () => {
    expect(regrownPool(0, 25, 1, battle.regen.warbandShare)).toBe(8);
    expect(regrownPool(10, 25, 1, battle.regen.warbandShare)).toBe(18);
    expect(regrownPool(10, 25, 2, battle.regen.warbandShare)).toBe(25);
  });
  it("never above full, a full pool as it is, and no whole season adds nothing", () => {
    expect(regrownPool(2200, 2300, 1, share)).toBe(2300);
    expect(regrownPool(2400, 2300, 3, share)).toBe(2400);
    expect(regrownPool(100, 2300, 0, share)).toBe(100);
  });
});

describe("the road", () => {
  it("marchMinutes: within the base's region, a land step, and seas crossed", () => {
    expect(marchMinutes(battle.march, { route: "land", steps: 0 })).toBe(10);
    expect(marchMinutes(battle.march, { route: "within", steps: 0 })).toBe(10);
    expect(marchMinutes(battle.march, { route: "land", steps: 1 })).toBe(30);
    expect(marchMinutes(battle.march, { route: "sea", steps: 2 })).toBe(60);
    expect(marchMinutes(battle.march, { route: "sea", steps: 5 })).toBe(150);
  });
});

describe("raid rules", () => {
  it("raidTurnout: half to all of the men sent, between one in fifty and one in four of the pool", () => {
    // Fixed by the bounds alone, so the same on every seed.
    const fixed: [number, number, number][] = [[40, 20, 5], [20, 6000, 120], [50, 3, 1], [1, 100, 2], [10, 0, 0], [120, 33000, 660], [50, 25500, 510]];
    for (let i = 0; i < 100; i++) for (const [men, pool, met] of fixed) expect(raidTurnout(battle.raid, men, pool, `s${i}`), `${men} vs ${pool} s${i}`).toBe(met);
    // Rolled within the bounds: half to all of the men sent, a flat draw.
    const tally = (men: number, pool: number) => {
      const out: Record<number, number> = {};
      for (let i = 0; i < 400; i++) {
        const met = raidTurnout(battle.raid, men, pool, `s${i}`);
        out[met] = (out[met] ?? 0) + 1;
      }
      return out;
    };
    expect(tally(10, 100)).toEqual({ 5: 66, 6: 64, 7: 65, 8: 68, 9: 63, 10: 74 });
    expect(tally(5, 100)).toEqual({ 2: 98, 3: 97, 4: 96, 5: 109 });
    // Never above the pool, never below one in fifty of it.
    for (let pool = 0; pool <= 500; pool++) {
      for (const men of [1, 5, 20, 60]) {
        const met = raidTurnout(battle.raid, men, pool, `p${pool}`);
        expect(met, `${men} vs ${pool}`).toBeLessThanOrEqual(pool);
        if (pool > 0) expect(met, `${men} vs ${pool}`).toBeGreaterThanOrEqual(Math.ceil(pool / 50));
      }
    }
  });

  it("raidAngers: one roll per raid on the seed, a third of the time", () => {
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (raidAngers(battle.raid, `s${i}`)) hits++;
    expect(hits).toBe(314);
    expect(raidAngers(battle.raid, "s0")).toBe(raidAngers(battle.raid, "s0"));
  });

  it("raidPlunder: 20 to 30 drachmae, 1 to 3 grain and 1 to 3 of one good per kill, rolled once per raid, doubled for a town, the good fixed by the seed", () => {
    const region = raidPlunder(battle.raid, 10, false, "s");
    const rateOf = (amount: number, bounds: { min: number; max: number }) => {
      const rate = amount / 10;
      expect(Number.isInteger(rate), `${amount} for ten kills`).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(bounds.min);
      expect(rate).toBeLessThanOrEqual(bounds.max);
    };
    rateOf(region.drachmae, { min: 20, max: 30 });
    rateOf(region.grain, { min: 1, max: 3 });
    rateOf(region.spoil.amount, { min: 1, max: 3 });
    expect(battle.raid.spoilGoods).toContain(region.spoil.good);
    const town = raidPlunder(battle.raid, 10, true, "s");
    expect(town).toEqual({ drachmae: region.drachmae * 2, grain: region.grain * 2, spoil: { good: region.spoil.good, amount: region.spoil.amount * 2 } });
    expect(raidPlunder(battle.raid, 0, false, "s")).toEqual({ drachmae: 0, grain: 0, spoil: { good: region.spoil.good, amount: 0 } });
    expect(raidPlunder(battle.raid, 3, true, "s")).toEqual(raidPlunder(battle.raid, 3, true, "s"));
    // Over 400 seeds each of the four goods is drawn at least 80 times.
    const drawn: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const good = raidPlunder(battle.raid, 1, false, `s${i}`).spoil.good;
      drawn[good] = (drawn[good] ?? 0) + 1;
    }
    expect(Object.keys(drawn).sort()).toEqual([...battle.raid.spoilGoods].sort());
    for (const good of battle.raid.spoilGoods) expect(drawn[good], good).toBeGreaterThanOrEqual(80);
  });

  // Government prompt 4: on the land of a nation at war the plunder is multiplied
  // once more, after the rolls.
  it("raidPlunder at war: the same rates and the same good as at peace, times the war's multiplier", () => {
    for (const seed of ["s", "s1", "s2", "s3", "s4"]) {
      const peace = raidPlunder(battle.raid, 3, true, seed);
      const atWar = raidPlunder(battle.raid, 3, true, seed, 1.5);
      // 3 kills × the town's 2 × 1.5 × a whole rate: whole, and exactly half again the peace amounts.
      expect(atWar).toEqual({ drachmae: peace.drachmae * 1.5, grain: peace.grain * 1.5, spoil: { good: peace.spoil.good, amount: peace.spoil.amount * 1.5 } });
      for (const amount of [atWar.drachmae, atWar.grain, atWar.spoil.amount]) expect(Number.isInteger(amount)).toBe(true);
      // A multiplier of 1 pays as before, in a region and at a town.
      expect(raidPlunder(battle.raid, 3, true, seed, 1)).toEqual(peace);
      expect(raidPlunder(battle.raid, 4, false, seed, 1)).toEqual(raidPlunder(battle.raid, 4, false, seed));
    }
  });

  // Raids prompt 6: a per-kill rate may be a range, rolled once per raid.
  it("raidPlunder with ranges: each rate rolls once per raid to a whole number from min to max, untied from the good", () => {
    const ranged = { ...battle.raid, plunderPerKill: { min: 20, max: 30 }, grainPerKill: { min: 1, max: 3 }, spoilPerKill: { min: 1, max: 3 } };
    const plunderRates = new Set<number>();
    const grainRates = new Set<number>();
    const spoilRates = new Set<number>();
    const goodWithRate = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const p = raidPlunder(ranged, 1, false, `s${i}`);
      plunderRates.add(p.drachmae);
      grainRates.add(p.grain);
      spoilRates.add(p.spoil.amount);
      goodWithRate.add(`${p.spoil.good}:${p.spoil.amount}`);
    }
    // Every value from min to max is drawn for each rate, and nothing outside it.
    expect([...plunderRates].sort((a, b) => a - b)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect([...grainRates].sort()).toEqual([1, 2, 3]);
    expect([...spoilRates].sort()).toEqual([1, 2, 3]);
    // Every good comes in every spoil amount: the good's roll and the rate's are separate.
    expect(goodWithRate.size).toBe(ranged.spoilGoods.length * 3);
    // The same seed always pays the same.
    expect(raidPlunder(ranged, 7, true, "s3")).toEqual(raidPlunder(ranged, 7, true, "s3"));
    // One roll per raid, not per kill: five kills at a town pay 10, 20 or 30 grain, never 17.
    for (let i = 0; i < 100; i++) expect([10, 20, 30]).toContain(raidPlunder(ranged, 5, true, `t${i}`).grain);
    // A range of one value pays as the plain number.
    const fixed = { ...ranged, grainPerKill: 2 };
    const narrow = { ...ranged, grainPerKill: { min: 2, max: 2 } };
    for (let i = 0; i < 20; i++) expect(raidPlunder(narrow, 4, false, `n${i}`).grain).toBe(raidPlunder(fixed, 4, false, `n${i}`).grain);
    expect(rollRate(5, ["x"])).toBe(5);
    expect(rollRate({ min: 2, max: 2 }, ["x"])).toBe(2);
    // The bounds of a number and of a range.
    expect(rateBounds(50)).toEqual({ min: 50, max: 50 });
    expect(rateBounds({ min: 20, max: 30 })).toEqual({ min: 20, max: 30 });
    // The schema: a range parses; min above max, a fraction and a stray key are refused.
    const file = read("content/military/battle.json");
    const withRate = (plunderPerKill: unknown) => parseBattleContent({ ...file, raid: { ...file.raid, plunderPerKill } }, goods);
    expect(withRate({ min: 20, max: 30 }).raid.plunderPerKill).toEqual({ min: 20, max: 30 });
    expect(withRate(50).raid.plunderPerKill).toBe(50);
    expect(() => withRate({ min: 30, max: 20 })).toThrow();
    expect(() => withRate({ min: 1.5, max: 3 })).toThrow();
    expect(() => withRate({ min: 1, max: 3, mode: 2 })).toThrow();
    expect(() => withRate(-1)).toThrow();
  });
});

describe("resolveBattle", () => {
  it("is deterministic: the same input twice is identical, and a different seed may differ", () => {
    const input = { attacker: [unit("hoplite", 20), unit("peltast", 20)], defender: [warband(60)], seed: "det", config: battle, mode: "attack" as const };
    expect(resolveBattle(input)).toEqual(resolveBattle(input));
    expect(resolveBattle({ ...input, seed: "det-2" })).toEqual(resolveBattle({ ...input, seed: "det-2" }));
  });

  it("a side with no rows loses without a round fought", () => {
    const noAtt = resolveBattle({ attacker: [], defender: [warband(40)], seed: "s", config: battle, mode: "attack" });
    expect(noAtt.winner).toBe("defender");
    expect(noAtt.rounds).toHaveLength(0);
    const noDef = resolveBattle({ attacker: [unit("hoplite", 20)], defender: [], seed: "s", config: battle, mode: "attack" });
    expect(noDef.winner).toBe("attacker");
    expect(noDef.defender.broke).toBe(true);
    // Rows at 0 count do not take part either.
    expect(resolveBattle({ attacker: [unit("hoplite", 0)], defender: [warband(40)], seed: "s", config: battle, mode: "raid" }).winner).toBe("defender");
  });

  it("morale breaks a row only when its losses exceed mor × moraleStep — not at the boundary", () => {
    // The defender kills exactly 1 of 10 per round (1 man × atk 1 × lethality 1 / (def 1 + floor 0)) and cannot be hurt.
    const killer = row("killer", 1, { atk: 1, def: 1, mor: 10, spd: 1 });
    const boundary = resolveBattle({ attacker: [row("a", 10, { def: 1, mor: 2, spd: 1 })], defender: [killer], seed: "m", config: exact, mode: "attack" });
    expect(boundary.attacker.rows[0]).toMatchObject({ start: 10, end: 9, broke: false }); // 10% is not > 2 × 0.05
    expect(boundary.winner).toBe("stand");
    const breaks = resolveBattle({ attacker: [row("a", 10, { def: 1, mor: 1, spd: 1 })], defender: [killer], seed: "m", config: exact, mode: "attack" });
    expect(breaks.attacker.rows[0]!.broke).toBe(true); // 10% > 1 × 0.05
    expect(breaks.rounds[0]!.broke.attacker).toEqual(["a"]);
    expect(breaks.winner).toBe("defender");
  });

  it("pursuit applies only when the enemy on the field is faster", () => {
    const slowKiller = row("killer", 1, { atk: 2, def: 1, mor: 10, spd: 1 });
    const fastKiller = row("killer", 1, { atk: 2, def: 1, mor: 10, spd: 5 });
    // 2 of 10 fall, the row breaks (20% > 5%); 8 remain × pursuitLoss 0.25 = 2 more if pursued.
    const unpursued = resolveBattle({ attacker: [row("a", 10, { def: 1, mor: 1, spd: 3 })], defender: [slowKiller], seed: "p", config: exact, mode: "attack" });
    expect(unpursued.attacker.rows[0]).toMatchObject({ end: 8, broke: true });
    expect(unpursued.rounds[0]!.pursuit.attacker).toBe(0);
    const pursued = resolveBattle({ attacker: [row("a", 10, { def: 1, mor: 1, spd: 3 })], defender: [fastKiller], seed: "p", config: exact, mode: "attack" });
    expect(pursued.attacker.rows[0]).toMatchObject({ end: 6, broke: true });
    expect(pursued.rounds[0]!.pursuit.attacker).toBe(2);
  });

  it("casualties spread across rows by headcount and never exceed a row's count", () => {
    const r = resolveBattle({ attacker: [unit("hoplite", 10), unit("peltast", 30)], defender: [warband(200)], seed: "c", config: battle, mode: "attack" });
    for (const x of r.attacker.rows) {
      expect(x.end).toBeGreaterThanOrEqual(0);
      expect(x.end).toBeLessThanOrEqual(x.start);
    }
    expect(r.attacker.losses).toBe(r.attacker.rows.reduce((n, x) => n + (x.start - x.end), 0));
  });

  it("skirmish: a fast row with msl >= 4 fires every round and is neither hit nor hits in melee; a slow one does not", () => {
    // Skirmisher: msl 4, spd 5 vs an enemy at spd 1; atk 0 so any enemy loss is missile fire.
    const sk = row("sk", 10, { msl: SKIRMISH_MSL, spd: 5, def: 1, mor: 10 });
    // Enemy: a big, slow melee block with no missiles; it would kill in melee if it could reach.
    const brute = row("brute", 300, { atk: 1, def: 1, msl: 0, mor: 10, spd: 1 });
    const cfg: BattleConfig = { ...exact, rounds: 3 };
    const r = resolveBattle({ attacker: [sk], defender: [brute], seed: "sk", config: cfg, mode: "attack" });
    expect(r.rounds.map((x) => x.skirmish.attacker)).toEqual([["sk"], ["sk"], ["sk"]]);
    // Fires every round: 10 × 4 × 1 / (1 + 0) = 40 casualties a round, 120 over three; never touched in melee.
    for (const x of r.rounds) {
      expect(x.missile).toEqual({ attacker: 0, defender: 40 });
      expect(x.melee).toEqual({ attacker: 0, defender: 0 });
    }
    expect(r.attacker.rows[0]).toMatchObject({ start: 10, end: 10 });
    expect(r.defender.rows[0]).toMatchObject({ start: 300, end: 180, broke: false });
    expect(r.winner).toBe("stand");
    // The same row at spd 1 (not faster) melees: round 1 it fires once, then the brute reaches it.
    // Three brutes kill 3 a round in melee; the fight lasts into round 2, where nobody fires.
    const slow = resolveBattle({ attacker: [row("sk", 10, { msl: SKIRMISH_MSL, spd: 1, def: 1, mor: 10 })], defender: [row("brute", 3, { atk: 1, def: 100, msl: 0, mor: 10, spd: 1 })], seed: "sk", config: cfg, mode: "attack" });
    expect(slow.rounds[0]!.skirmish.attacker).toEqual([]);
    expect(slow.rounds[0]!.melee.attacker).toBe(3);
    // Round 2 exists (the row breaks only after 6 of 10 fall) and nobody fires in it.
    expect(slow.rounds.length).toBeGreaterThanOrEqual(2);
    expect(slow.rounds[1]!.missile).toBeNull();
    expect(slow.rounds[1]!.melee.attacker).toBe(3);
  });

  it("skirmish is judged against the enemy's headcount-weighted speed, not its fastest row", () => {
    // Enemy: 1 fast scout (spd 9) among 99 slow men → weighted spd ≈ 1.08 < the peltast's 8.
    const r = resolveBattle({ attacker: [unit("peltast", 10)], defender: [row("slow", 99, { atk: 1, def: 3, spd: 1 }), row("scout", 1, { atk: 1, def: 3, spd: 9 })], seed: "w", config: battle, mode: "attack" });
    expect(r.rounds[0]!.skirmish.attacker).toEqual(["peltast"]);
    expect(r.rounds[0]!.melee.attacker).toBe(0);
  });

  // Military 6a, ruling 1: skirmishers cannot hold ground.
  it("an attack that ends in a stand is the attacker's when every defender row on the field skirmished in the last round", () => {
    const cfg: BattleConfig = { ...exact, rounds: 3 };
    // A slow block that cannot hurt anyone, against 10 skirmishers that fire every round and never break.
    const brute = row("brute", 300, { atk: 0, def: 1, msl: 0, mor: 10, spd: 1 });
    const sk = row("sk", 10, { msl: SKIRMISH_MSL, spd: 5, def: 1, mor: 10 });
    const alone = resolveBattle({ attacker: [brute], defender: [sk], seed: "hold", config: cfg, mode: "attack" });
    expect(alone.rounds.map((x) => x.skirmish.defender)).toEqual([["sk"], ["sk"], ["sk"]]);
    expect(alone.attacker.broke).toBe(false);
    expect(alone.defender.broke).toBe(false);
    expect(alone.defender.rows[0]).toMatchObject({ start: 10, end: 10, broke: false });
    expect(alone.winner).toBe("attacker");
    // One row standing in the line keeps the stand.
    const line = row("line", 10, { atk: 0, def: 1, msl: 0, mor: 10, spd: 1 });
    expect(resolveBattle({ attacker: [brute], defender: [sk, line], seed: "hold", config: cfg, mode: "attack" }).winner).toBe("stand");
    // A line row that broke, or fell to the last man, is off the field and keeps nothing.
    const hitter = row("brute", 300, { atk: 1, def: 1, msl: 0, mor: 10, spd: 1 });
    const broken = resolveBattle({ attacker: [hitter], defender: [sk, row("line", 10, { atk: 0, def: 100, msl: 0, mor: 0, spd: 1 })], seed: "hold", config: cfg, mode: "attack" });
    expect(broken.defender.rows.find((x) => x.id === "line")).toMatchObject({ broke: true });
    expect(broken.defender.rows.find((x) => x.id === "line")!.end).toBeGreaterThan(0);
    expect(broken.winner).toBe("attacker");
    const fallen = resolveBattle({ attacker: [hitter], defender: [sk, row("line", 10, { atk: 0, def: 1, msl: 0, mor: 10, spd: 1 })], seed: "hold", config: cfg, mode: "attack" });
    expect(fallen.defender.rows.find((x) => x.id === "line")).toMatchObject({ end: 0 });
    expect(fallen.winner).toBe("attacker");
  });

  it("a defender row that skirmished only in earlier rounds keeps the stand, and an attacker's skirmishers win nothing by it", () => {
    const cfg: BattleConfig = { ...exact, rounds: 3 };
    // Round 1 the skirmishers outpace the attackers' weighted spd 3; the slow row breaks at its
    // first loss and leaves, the fast row's spd 9 is left, and from round 2 they stand in the line.
    const r = resolveBattle({
      attacker: [row("slow", 30, { atk: 0, def: 1, msl: 0, mor: 0, spd: 1 }), row("fast", 10, { atk: 0, def: 1, msl: 0, mor: 20, spd: 9 })],
      defender: [row("sk", 3, { msl: SKIRMISH_MSL, spd: 5, def: 1, mor: 20 })],
      seed: "earlier",
      config: cfg,
      mode: "attack",
    });
    expect(r.rounds[0]!.skirmish.defender).toEqual(["sk"]);
    expect(r.rounds[0]!.broke.attacker).toEqual(["slow"]);
    expect(r.rounds[r.rounds.length - 1]!.skirmish.defender).toEqual([]);
    expect(r.winner).toBe("stand");
    // Calibration #4: 20 peltasts attacking 40 warband skirmish every round and still only stand.
    for (const seed of ["calibration-a", "calibration-b"]) {
      const att = resolveBattle({ attacker: [unit("peltast", 20)], defender: [warband(40)], seed, config: battle, mode: "attack" });
      expect(att.rounds.every((x) => x.skirmish.attacker.includes("peltast"))).toBe(true);
      expect(att.winner).toBe("stand");
    }
  });

  it("with the shipped constants, a strike of 460 warband storms 113 peltasts behind walls 2, and 120 do not", () => {
    const peltasts = (count: number): BattleRow => ({ ...unit("peltast", count), stats: { ...units.units.peltast!.stats, def: units.units.peltast!.stats.def + 2 } });
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const big = resolveBattle({ attacker: [warband(460)], defender: [peltasts(113)], seed, config: battle, mode: "attack" });
      expect(big.defender.broke).toBe(false);
      expect(big.winner).toBe("attacker");
      expect(resolveBattle({ attacker: [warband(120)], defender: [peltasts(113)], seed, config: battle, mode: "attack" }).winner).toBe("defender");
      // Raid mode is unchanged: the same fight as a raid is the defender's.
      expect(resolveBattle({ attacker: [warband(460)], defender: [peltasts(113)], seed, config: battle, mode: "raid" }).winner).toBe("defender");
    }
  });

  it("raid: the attacker wins unbroken with more kills than losses in absolute men", () => {
    // 10 raiders kill 3 and lose 2 → win; kill 2 and lose 2 → defender.
    const cfg: BattleConfig = { ...exact, rounds: 1 };
    const win = resolveBattle({ attacker: [row("r", 10, { atk: 3, def: 10, mor: 10, spd: 1 })], defender: [row("d", 10, { atk: 2, def: 10, mor: 10, spd: 1 })], seed: "raid", config: { ...cfg, raid: { ...cfg.raid, rounds: 1 } }, mode: "raid" });
    expect(win.defender.losses).toBe(3);
    expect(win.attacker.losses).toBe(2);
    expect(win.winner).toBe("attacker");
    const tie = resolveBattle({ attacker: [row("r", 10, { atk: 2, def: 10, mor: 10, spd: 1 })], defender: [row("d", 10, { atk: 2, def: 10, mor: 10, spd: 1 })], seed: "raid", config: { ...cfg, raid: { ...cfg.raid, rounds: 1 } }, mode: "raid" });
    expect(tie.defender.losses).toBe(2);
    expect(tie.attacker.losses).toBe(2);
    expect(tie.winner).toBe("defender");
  });

  it("raid never returns stand and stops after raid.rounds", () => {
    for (const seed of ["r1", "r2", "r3", "r4", "r5"]) {
      for (const [a, d] of [[unit("peltast", 20), warband(40)], [unit("hoplite", 30), warband(40)], [unit("hippeis", 5), warband(500)]] as const) {
        const r = resolveBattle({ attacker: [a], defender: [d], seed, config: battle, mode: "raid" });
        expect(r.winner).not.toBe("stand");
        expect(r.rounds.length).toBeLessThanOrEqual(battle.raid.rounds);
      }
    }
  });

  it("with the shipped constants, 30 hoplites beat 40 warband and 20 hoplites lose to 100", () => {
    for (const seed of ["calibration-a", "calibration-b", "x"]) {
      expect(resolveBattle({ attacker: [unit("hoplite", 30)], defender: [warband(40)], seed, config: battle, mode: "attack" }).winner).toBe("attacker");
      expect(resolveBattle({ attacker: [unit("hoplite", 20)], defender: [warband(100)], seed, config: battle, mode: "attack" }).winner).toBe("defender");
    }
  });
});
