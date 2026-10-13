import { formatClock } from "../dashboard/shared.js";

// The clocks the force picker and the League's order sheet label a march with,
// mirroring battle.json (the server decides; these only label what is shown).

// A scouting party needs a man at this speed or more.
export const FAST_SPD = 6;
// Travel for a move, mirroring battle.json's move block.
export const MOVE_MINUTES_PER_STEP = 30;
export const MOVE_MINUTES_WITHIN = 10;
// The road for an action, mirroring battle.json's march block.
export const MARCH_CLOCK = { minutesPerStep: 30, minutesWithinRegion: 10 };

// The travel a move takes from one base, from its steps: within one region,
// one land step, or the seas crossed.
export function moveTravel(steps: { landSteps: number | null; seaSteps: number | null } | undefined): { route: "within" | "land" | "sea"; steps: number; minutes: number } | null {
  if (!steps) return null;
  if (steps.landSteps === 0) return { route: "within", steps: 0, minutes: MOVE_MINUTES_WITHIN };
  if (steps.landSteps === 1) return { route: "land", steps: 1, minutes: MOVE_MINUTES_PER_STEP };
  if (steps.seaSteps !== null) return { route: "sea", steps: steps.seaSteps, minutes: steps.seaSteps * MOVE_MINUTES_PER_STEP };
  return null;
}
export const travelClock = (minutes: number) => formatClock(minutes * 60);
