import { seededRoll, type BattleContent, type UnitStats } from "./barracks.js";

// ---------------------------------------------------------------------------
// Battle — the pure, deterministic resolver for Raid and Attack (barracks spec
// §10 as ruled in prompt 3b). Two sides of rows fight simultaneous phases:
//
//   missile  round 1 only: each side inflicts Σ(count × msl) × lethality /
//            (enemy avgDef + defenseFloor) casualties on the other.
//   melee    every round, the same with atk.
//   morale   after each round a row breaks when its losses exceed
//            mor × moraleStep of its start; a broken row leaves the fight and,
//            if the enemy is faster (headcount-weighted spd), suffers pursuit
//            losses of count × pursuitLoss.
//
// Casualties are fractional until applied: a side's total is spread across its
// participating rows by headcount and each row's fractional share is rounded
// with seededRoll([seed, round, phase, side, rowId]). Everything derives from
// the input and the seed — no Math.random, no clock.
//
// Attack runs `rounds` rounds or until a side breaks; the side still standing
// wins, both standing is "stand" (the attacker withdraws). Raid runs
// raid.rounds rounds; the attacker wins if unbroken and it inflicted a larger
// share of losses than it took, else the defender — never "stand".
// ---------------------------------------------------------------------------

export type BattleRow = { id: string; label: string; count: number; stats: UnitStats };
export type BattleMode = "attack" | "raid";
export type BattleConfig = BattleContent;
export type BattleInput = { attacker: BattleRow[]; defender: BattleRow[]; seed: string; config: BattleConfig; mode: BattleMode };

export type BattleSideName = "attacker" | "defender";
export type BattlePhase = "missile" | "melee" | "pursuit";
export type BattleRound = {
  round: number;
  /** casualties suffered by each side in the phase (missile only in round 1) */
  missile: { attacker: number; defender: number } | null;
  melee: { attacker: number; defender: number };
  /** row ids that broke after this round's morale check */
  broke: { attacker: string[]; defender: string[] };
  pursuit: { attacker: number; defender: number };
};
export type BattleSideRow = { id: string; label: string; start: number; end: number; broke: boolean };
export type BattleSide = { rows: BattleSideRow[]; losses: number; broke: boolean };
export type BattleWinner = BattleSideName | "stand";
export type BattleResult = { winner: BattleWinner; rounds: BattleRound[]; attacker: BattleSide; defender: BattleSide };

type Live = { id: string; label: string; start: number; count: number; stats: UnitStats; broke: boolean };

const participants = (side: Live[]) => side.filter((r) => r.count > 0 && !r.broke);
const headcount = (rows: Live[]) => rows.reduce((n, r) => n + r.count, 0);
const power = (rows: Live[], stat: keyof UnitStats) => rows.reduce((n, r) => n + r.count * r.stats[stat], 0);
// Headcount-weighted average of a stat; 0 with nobody on the field.
function weighted(rows: Live[], stat: keyof UnitStats): number {
  const h = headcount(rows);
  return h > 0 ? power(rows, stat) / h : 0;
}

// Casualties one side inflicts on the other in a phase, before rounding.
function inflicted(from: Live[], onto: Live[], stat: "msl" | "atk", cfg: BattleConfig): number {
  if (from.length === 0 || onto.length === 0) return 0;
  return (power(from, stat) * cfg.lethality) / (weighted(onto, "def") + cfg.defenseFloor);
}

// Stochastic rounding of `value` on the row's own seed: the integer part always,
// the fractional part when the roll lands under it.
function roundOn(value: number, seedParts: string[]): number {
  const whole = Math.floor(value);
  const frac = value - whole;
  return whole + (frac > 0 && seededRoll(seedParts) < frac ? 1 : 0);
}

// Apply `total` casualties to a side: spread across participating rows by
// headcount, each share rounded on its own seed, clamped to [0, count].
// Returns the men actually lost.
function applyCasualties(side: Live[], total: number, seed: string, round: number, phase: BattlePhase, sideName: BattleSideName): number {
  const rows = participants(side);
  const h = headcount(rows);
  if (total <= 0 || h === 0) return 0;
  let lost = 0;
  for (const r of rows) {
    const share = (total * r.count) / h;
    const n = Math.min(r.count, Math.max(0, roundOn(share, [seed, String(round), phase, sideName, r.id])));
    r.count -= n;
    lost += n;
  }
  return lost;
}

function summarise(side: Live[]): BattleSide {
  return {
    rows: side.map((r) => ({ id: r.id, label: r.label, start: r.start, end: r.count, broke: r.broke })),
    losses: side.reduce((n, r) => n + (r.start - r.count), 0),
    broke: participants(side).length === 0,
  };
}

export function resolveBattle(input: BattleInput): BattleResult {
  const cfg = input.config;
  const live = (rows: BattleRow[]): Live[] => rows.filter((r) => r.count > 0).map((r) => ({ id: r.id, label: r.label, start: r.count, count: r.count, stats: r.stats, broke: false }));
  const att = live(input.attacker);
  const def = live(input.defender);
  const rounds: BattleRound[] = [];
  const maxRounds = input.mode === "raid" ? cfg.raid.rounds : cfg.rounds;

  for (let round = 1; round <= maxRounds; round++) {
    if (participants(att).length === 0 || participants(def).length === 0) break;
    const entry: BattleRound = { round, missile: null, melee: { attacker: 0, defender: 0 }, broke: { attacker: [], defender: [] }, pursuit: { attacker: 0, defender: 0 } };

    // Missile (round 1) and melee: both sides compute from the same pre-phase
    // state, then both apply — simultaneous.
    const phases: ("missile" | "melee")[] = round === 1 ? ["missile", "melee"] : ["melee"];
    for (const phase of phases) {
      const stat = phase === "missile" ? "msl" : "atk";
      const a = participants(att);
      const d = participants(def);
      const onDef = inflicted(a, d, stat, cfg);
      const onAtt = inflicted(d, a, stat, cfg);
      const losses = {
        attacker: applyCasualties(att, onAtt, input.seed, round, phase, "attacker"),
        defender: applyCasualties(def, onDef, input.seed, round, phase, "defender"),
      };
      if (phase === "missile") entry.missile = losses;
      else entry.melee = losses;
    }

    // Morale, both sides from the post-melee state: a row breaks when its losses
    // exceed mor × moraleStep of its start; pursuit if the enemy still on the
    // field is faster than the row.
    const enemySpd = { attacker: weighted(participants(def), "spd"), defender: weighted(participants(att), "spd") };
    for (const [sideName, side] of [["attacker", att], ["defender", def]] as const) {
      for (const r of participants(side)) {
        if ((r.start - r.count) / r.start <= r.stats.mor * cfg.moraleStep) continue;
        r.broke = true;
        entry.broke[sideName].push(r.id);
        if (enemySpd[sideName] > r.stats.spd) {
          const n = Math.min(r.count, Math.max(0, roundOn(r.count * cfg.pursuitLoss, [input.seed, String(round), "pursuit", sideName, r.id])));
          r.count -= n;
          entry.pursuit[sideName] += n;
        }
      }
    }
    rounds.push(entry);
    if (participants(att).length === 0 || participants(def).length === 0) break;
  }

  const attacker = summarise(att);
  const defender = summarise(def);
  let winner: BattleWinner;
  if (input.mode === "raid") {
    // The attacker wins a raid unbroken and with the better exchange (losses as
    // a share of starting headcount); a side with nobody on the field loses.
    const attStart = headcount(att.map((r) => ({ ...r, count: r.start })));
    const defStart = headcount(def.map((r) => ({ ...r, count: r.start })));
    const attShare = attStart > 0 ? attacker.losses / attStart : 1;
    const defShare = defStart > 0 ? defender.losses / defStart : 1;
    winner = attStart === 0 ? "defender" : defStart === 0 ? "attacker" : !attacker.broke && defShare > attShare ? "attacker" : "defender";
  } else if (defender.broke && !attacker.broke) winner = "attacker";
  else if (attacker.broke) winner = "defender"; // including both broken: the attack failed
  else winner = "stand";
  return { winner, rounds, attacker, defender };
}
