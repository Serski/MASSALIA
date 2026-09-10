import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBattleContent, parseUnitsContent, type UnitStats } from "./barracks.js";
import { resolveBattle, SKIRMISH_MSL, type BattleConfig, type BattleRow } from "./battle.js";
import { parseBuildingsContent } from "./buildings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));
const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
const units = parseUnitsContent(read("content/military/units.json"), goods);
const battle = parseBattleContent(read("content/military/battle.json"));

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
    expect(battle.raid).toEqual({ rounds: 1, plunderPerKill: 20, grainPerKill: 5 });
    expect(battle.recovery).toEqual({ hoursPerStep: 3 });
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), recovery: { hoursPerStep: 0 } })).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), extra: 1 })).toThrow();
    expect(() => parseBattleContent({ ...read("content/military/battle.json"), pursuitLoss: 2 })).toThrow();
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
