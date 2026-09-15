// ---------------------------------------------------------------------------
// world:launch — the switch from one world to the next (World 2 launch, prompt 1).
//
//   pnpm --filter @massalia/db world:launch -- --name "<name>" --tagline "<tagline>" [--start <ISO>] [--days 182] [--dry-run]
//
// A status flip and an insert, never a truncation. Refuses unless exactly one
// world is active and no world already carries the new name. BEFORE: the active
// world, its player count, the users there not yet stamped. One transaction: the
// active world → ended (ends_at = now); the new world inserted active; its 300
// chamber seats and its town/region military pools seeded; users.beta_at stamped
// on every user with a player in the old world. Every row count is checked and a
// surprise rolls the whole thing back. AFTER: both world rows, the seat count, the
// pool counts, the number stamped. --dry-run prints BEFORE and the plan only.
//
// Run by hand against the target database — locally, or through `railway run`
// for production with only DATABASE_URL in the environment. `--start` is the
// season boundary for the whole round (gameDate floors whole days from
// started_at): the operator decides where the daily rollover lands.
// ---------------------------------------------------------------------------
import { createDb, endDbPools } from "../src/client.js";
import { LaunchRefused, launchWorld, parseArgs } from "../src/worldLaunch.js";

let code = 0;
try {
  const opts = parseArgs(process.argv.slice(2));
  await launchWorld(createDb(), opts);
} catch (error) {
  console.error((error as Error).message);
  code = error instanceof LaunchRefused ? 1 : 2;
} finally {
  await endDbPools();
}
process.exit(code);
