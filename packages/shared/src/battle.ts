import { seededRoll, type BattleContent, type UnitStats } from "./barracks.js";

// ---------------------------------------------------------------------------
// Battle — the pure, deterministic resolver for Raid and Attack (barracks spec
// §10 as ruled in prompt 3b). Two sides of rows fight simultaneous phases:
//
//   skirmish a participating row with msl >= 4 whose spd strictly exceeds the
//            enemy's headcount-weighted spd skirmishes this round: it fires in
//            the missile phase every round and stays out of melee on both
//            sides (neither hits nor can be hit there).
//   missile  round 1 for every row, every round for skirmishers: the firing
//            rows inflict Σ(count × msl) × lethality / (enemy avgDef +
//            defenseFloor) casualties, spread over every enemy participant.
//   melee    every round between the non-skirmishing rows, the same with atk.
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
// wins, both standing is "stand" (the attacker withdraws), both broken is a
// defender win. Raid runs raid.rounds rounds; the attacker wins if unbroken
// and its kills exceed its losses in absolute men, else the defender — never
// "stand".
// ---------------------------------------------------------------------------

export type BattleRow = { id: string; label: string; count: number; stats: UnitStats };
export type BattleMode = "attack" | "raid";
export type BattleConfig = BattleContent;
export type BattleInput = { attacker: BattleRow[]; defender: BattleRow[]; seed: string; config: BattleConfig; mode: BattleMode };

export type BattleSideName = "attacker" | "defender";
export type BattlePhase = "missile" | "melee" | "pursuit";
export const SKIRMISH_MSL = 4;

export type BattleRound = {
  round: number;
  /** row ids skirmishing this round (firing every round, out of melee) */
  skirmish: { attacker: string[]; defender: string[] };
  /** casualties suffered by each side in the phase (null when nobody fired) */
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

// The rows of `side` that skirmish this round: msl >= SKIRMISH_MSL and spd
// strictly above the enemy's headcount-weighted spd over its participants.
function skirmishers(side: Live[], enemy: Live[]): Live[] {
  const enemySpd = weighted(participants(enemy), "spd");
  return participants(side).filter((r) => r.stats.msl >= SKIRMISH_MSL && r.stats.spd > enemySpd);
}

// Stochastic rounding of `value` on the row's own seed: the integer part always,
// the fractional part when the roll lands under it.
function roundOn(value: number, seedParts: string[]): number {
  const whole = Math.floor(value);
  const frac = value - whole;
  return whole + (frac > 0 && seededRoll(seedParts) < frac ? 1 : 0);
}

// Apply `total` casualties to the given rows (a side's participants, or its
// non-skirmishers in melee): spread by headcount, each share rounded on its own
// seed, clamped to [0, count]. Returns the men actually lost.
function applyCasualties(rows: Live[], total: number, seed: string, round: number, phase: BattlePhase, sideName: BattleSideName): number {
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
    // Who skirmishes this round is fixed from the state at its start.
    const skA = skirmishers(att, def);
    const skD = skirmishers(def, att);
    const isSk = (ids: Live[]) => new Set(ids.map((r) => r.id));
    const skAIds = isSk(skA);
    const skDIds = isSk(skD);
    const entry: BattleRound = {
      round,
      skirmish: { attacker: [...skAIds], defender: [...skDIds] },
      missile: null,
      melee: { attacker: 0, defender: 0 },
      broke: { attacker: [], defender: [] },
      pursuit: { attacker: 0, defender: 0 },
    };

    // Missile: in round 1 every participant fires; afterwards only skirmishers.
    // Targets are every enemy participant. Both sides compute from the same
    // pre-phase state, then both apply — simultaneous.
    {
      const a = participants(att);
      const d = participants(def);
      const firingA = round === 1 ? a : skA;
      const firingD = round === 1 ? d : skD;
      if (firingA.length > 0 || firingD.length > 0) {
        const onDef = inflicted(firingA, d, "msl", cfg);
        const onAtt = inflicted(firingD, a, "msl", cfg);
        entry.missile = {
          attacker: applyCasualties(a, onAtt, input.seed, round, "missile", "attacker"),
          defender: applyCasualties(d, onDef, input.seed, round, "missile", "defender"),
        };
      }
    }

    // Melee: the non-skirmishing rows of each side fight each other; a
    // skirmishing row neither hits nor can be hit here.
    {
      const a = participants(att).filter((r) => !skAIds.has(r.id));
      const d = participants(def).filter((r) => !skDIds.has(r.id));
      const onDef = inflicted(a, d, "atk", cfg);
      const onAtt = inflicted(d, a, "atk", cfg);
      entry.melee = {
        attacker: applyCasualties(a, onAtt, input.seed, round, "melee", "attacker"),
        defender: applyCasualties(d, onDef, input.seed, round, "melee", "defender"),
      };
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
    // The attacker wins a raid unbroken and with more kills than losses in
    // absolute men; a side with nobody on the field loses.
    if (att.length === 0) winner = "defender";
    else if (def.length === 0) winner = "attacker";
    else winner = !attacker.broke && defender.losses > attacker.losses ? "attacker" : "defender";
  } else if (defender.broke && !attacker.broke) winner = "attacker";
  else if (attacker.broke) winner = "defender"; // including both broken: the attack failed
  else winner = "stand";
  return { winner, rounds, attacker, defender };
}
