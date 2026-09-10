import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBandsContent, parseBattleContent, parseUnitsContent, type UnitStats } from "../src/barracks.js";
import { resolveBattle, type BattleMode, type BattleRow } from "../src/battle.js";
import { parseBuildingsContent } from "../src/buildings.js";

// ---------------------------------------------------------------------------
// Battle calibration: the canonical matchups from prompt 3b against the real
// content, printed as one table per seed so the stochastic rounding's reach is
// visible. Run: pnpm --filter @massalia/shared battle:calibrate
// ---------------------------------------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const goods = Object.keys(parseBuildingsContent(read("content/buildings/buildings.json")).vendor);
const units = parseUnitsContent(read("content/military/units.json"), goods);
const bands = parseBandsContent(read("content/military/bands.json"), goods);
const battle = parseBattleContent(read("content/military/battle.json"));

const unit = (id: string, count: number): BattleRow => ({ id, label: units.units[id]!.label, count, stats: units.units[id]!.stats });
const band = (id: string, count: number): BattleRow => ({ id, label: bands.bands[id]!.label, count, stats: bands.bands[id]!.stats });
const npc = (kind: "warband" | "garrison", count: number): BattleRow => ({ id: kind, label: battle.npc[kind].label, count, stats: battle.npc[kind].stats as UnitStats });

type Matchup = { n: number; attacker: BattleRow[]; defender: BattleRow; mode: BattleMode };
const MATCHUPS: Matchup[] = [
  { n: 1, attacker: [unit("hoplite", 20)], defender: npc("warband", 40), mode: "attack" },
  { n: 2, attacker: [unit("hoplite", 30)], defender: npc("warband", 40), mode: "attack" },
  { n: 3, attacker: [unit("peltast", 20)], defender: npc("warband", 40), mode: "raid" },
  { n: 4, attacker: [unit("peltast", 20)], defender: npc("warband", 40), mode: "attack" },
  { n: 5, attacker: [unit("hippeis", 20)], defender: npc("warband", 40), mode: "attack" },
  { n: 6, attacker: [band("volcae-irregulars", 40)], defender: npc("warband", 40), mode: "attack" },
  { n: 7, attacker: [band("spartan-hoplites", 20)], defender: npc("warband", 80), mode: "attack" },
  { n: 8, attacker: [unit("hoplite", 10), unit("peltast", 20), band("balearic-slingers", 20)], defender: npc("warband", 60), mode: "attack" },
  { n: 9, attacker: [unit("hoplite", 20)], defender: npc("warband", 100), mode: "attack" },
  { n: 10, attacker: [unit("hoplite", 20)], defender: npc("garrison", 100), mode: "attack" },
];

const describe = (rows: BattleRow[]) => rows.map((r) => `${r.count} ${r.label}`).join(" + ");
const pad = (s: string, n: number) => s.padEnd(n);

function table(seed: string) {
  console.log(`\nseed "${seed}"  (rounds ${battle.rounds}, lethality ${battle.lethality}, defenseFloor ${battle.defenseFloor}, moraleStep ${battle.moraleStep}, pursuitLoss ${battle.pursuitLoss}, raid rounds ${battle.raid.rounds})`);
  console.log(`${pad("#", 3)}${pad("attacker", 52)}${pad("defender", 20)}${pad("mode", 8)}${pad("winner", 10)}${pad("att losses", 13)}${pad("def losses", 13)}rounds`);
  for (const m of MATCHUPS) {
    const r = resolveBattle({ attacker: m.attacker, defender: [m.defender], seed, config: battle, mode: m.mode });
    const attStart = m.attacker.reduce((n, x) => n + x.count, 0);
    console.log(
      `${pad(String(m.n), 3)}${pad(describe(m.attacker), 52)}${pad(describe([m.defender]), 20)}${pad(m.mode, 8)}${pad(r.winner, 10)}${pad(`${r.attacker.losses}/${attStart}`, 13)}${pad(`${r.defender.losses}/${m.defender.count}`, 13)}${r.rounds.length}`,
    );
  }
}

table("calibration-a");
table("calibration-b");
