import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Queue, Worker } from "bullmq";
import { completionDelayMs, parseAgeConfig, parseCalendarConfig, parseFamilyConfig, parsePoliticsConfig, type AgeConfig, type CalendarConfig, type FamilyConfig, type PoliticsConfig } from "@massalia/shared";
import { advanceElections, advanceOlympiads, closeDueChamberVotes, closeDueFestivals, deliverOlympicNominationToAll, drawFamilyCandidates, fireFestivalsForAll, openChamberVoteIfDue, openElectionsIfDue, resolveCensureIfExpired, rollChildrenDue, sweepSpouseDeaths } from "@massalia/db";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};

export const scheduledResolutionQueue = new Queue("scheduled-resolution", { connection });

// Config (same source-of-truth files the server validates at boot), memoized.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
let familyCfg: FamilyConfig | null = null;
let ageCfg: AgeConfig | null = null;
let calendarCfg: CalendarConfig | null = null;
async function configs(): Promise<{ familyCfg: FamilyConfig; ageCfg: AgeConfig }> {
  if (!familyCfg) familyCfg = parseFamilyConfig(JSON.parse(await fs.readFile(path.join(repoRoot, "content/family/family-config.json"), "utf8")));
  if (!ageCfg) ageCfg = parseAgeConfig(JSON.parse(await fs.readFile(path.join(repoRoot, "content/age/age-config.json"), "utf8")));
  return { familyCfg, ageCfg };
}
async function calendarConfig(): Promise<CalendarConfig> {
  if (!calendarCfg) calendarCfg = parseCalendarConfig(JSON.parse(await fs.readFile(path.join(repoRoot, "content/calendar/calendar-config.json"), "utf8")));
  return calendarCfg;
}
let politicsCfg: PoliticsConfig | null = null;
async function politicsConfig(): Promise<PoliticsConfig> {
  if (!politicsCfg) politicsCfg = parsePoliticsConfig(JSON.parse(await fs.readFile(path.join(repoRoot, "content/politics/politics-config.json"), "utf8")));
  return politicsCfg;
}
async function bothConfigs(): Promise<{ calendar: CalendarConfig; politics: PoliticsConfig }> {
  return { calendar: await calendarConfig(), politics: await politicsConfig() };
}

// Festival sweep cadence: well under a season so boundaries are caught promptly.
const FESTIVAL_SWEEP_MS = 6 * 60 * 60 * 1000;
// Spouse-death sweep cadence: same belt-and-suspenders rhythm as the festival sweep.
const SPOUSE_SWEEP_MS = 6 * 60 * 60 * 1000;
// Olympiad sweep cadence: the cycle windows are real-days long, so an hourly tick
// catches the nomination/voting/payoff boundaries promptly.
const OLYMPIAD_SWEEP_MS = 60 * 60 * 1000;
// Chamber sweep cadence: the yearly vote is open a whole season (a real day), so
// an hourly tick opens/closes promptly at the boundaries.
const CHAMBER_SWEEP_MS = 60 * 60 * 1000;
// Election sweep cadence: declaration/voting windows are seasons (real days) long,
// so an hourly tick catches the season boundaries promptly. Idempotent + season-
// correct: it never retro-fires a cycle whose window already passed.
const ELECTION_SWEEP_MS = 60 * 60 * 1000;

// --- Recurring sweeps: self-healing job SCHEDULERS --------------------------
// Each sweep runs on a fixed cadence via a BullMQ job scheduler. The scheduler
// emits the next occurrence regardless of whether the current run throws, so a
// transient failure (e.g. the DB/migration race at deploy time) self-heals on the
// next tick instead of wedging. This replaces the old "re-arm with a fixed jobId
// at the end of the handler" pattern, which BullMQ dedupes against the still-active
// job — so it NEVER re-fired, leaving every sweep running only once per boot.
type Sweep = { name: string; every: number; run: () => Promise<string> };

const SWEEPS: Sweep[] = [
  {
    name: "festival-sweep",
    every: FESTIVAL_SWEEP_MS,
    run: async () => {
      const cfg = await calendarConfig();
      const fired = await fireFestivalsForAll(cfg);
      const closed = await closeDueFestivals(cfg);
      return `Festival sweep: fired to ${fired} living characters, closed ${closed} instance(s)`;
    },
  },
  {
    name: "spouse-death-sweep",
    every: SPOUSE_SWEEP_MS,
    run: async () => {
      const { familyCfg: fc, ageCfg: ac } = await configs();
      const deaths = await sweepSpouseDeaths({ familyCfg: fc, ageCfg: ac });
      return `Spouse-death sweep: ended ${deaths.length} marriage(s) of old age`;
    },
  },
  {
    name: "chamber-sweep",
    every: CHAMBER_SWEEP_MS,
    run: async () => {
      const cfg = await politicsConfig();
      const opened = await openChamberVoteIfDue(cfg);
      const closed = await closeDueChamberVotes(cfg);
      return `Chamber sweep: ${opened ? `opened "${opened.title}" (year ${opened.gameYear})` : "no vote opened"}, closed ${closed.length} vote(s)`;
    },
  },
  {
    name: "election-sweep",
    every: ELECTION_SWEEP_MS,
    run: async () => {
      const { calendar, politics } = await bothConfigs();
      const opened = await openElectionsIfDue(calendar);
      const advanced = await advanceElections(calendar, politics);
      return (
        `Election sweep: opened ${opened.length} declaration(s), ${advanced.toVoting.length} to voting, resolved ${advanced.resolved.length}` +
        (advanced.resolved.length ? ` (${advanced.resolved.map((r) => r.office).join(", ")})` : "")
      );
    },
  },
  {
    name: "olympiad-sweep",
    every: OLYMPIAD_SWEEP_MS,
    run: async () => {
      const cfg = await calendarConfig();
      const delivered = await deliverOlympicNominationToAll(cfg);
      const advanced = await advanceOlympiads(cfg);
      return `Olympiad sweep: delivered ${delivered} nominate card(s), advanced ${advanced.length} cycle(s)`;
    },
  },
];
const SWEEP_BY_NAME = new Map(SWEEPS.map((sweep) => [sweep.name, sweep]));

// Install (idempotent) every sweep's scheduler on boot, and clear any stale
// fixed-jobId sweep job left by the previous manual-rearm scheme so it can't
// linger wedged in the failed set and block its name.
async function installSweepSchedulers() {
  for (const sweep of SWEEPS) {
    try {
      const stale = await scheduledResolutionQueue.getJob(sweep.name);
      if (stale) await stale.remove();
      await scheduledResolutionQueue.upsertJobScheduler(sweep.name, { every: sweep.every }, { name: sweep.name });
    } catch (error) {
      console.warn(`Could not install ${sweep.name} scheduler (Redis down?): ${(error as Error).message}`);
    }
  }
}

export async function scheduleBuildingCompletion(buildingId: string, completesAt: number) {
  await scheduledResolutionQueue.add(
    "building-complete",
    { buildingId },
    {
      delay: completionDelayMs(Date.now(), completesAt),
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

new Worker(
  "scheduled-resolution",
  async (job) => {
    if (job.name === "building-complete") {
      // TODO: Mark the queued building complete in Postgres inside a transaction.
      console.log(`Resolved building completion for ${job.data.buildingId}`);
      return;
    }
    if (job.name === "censure-resolve") {
      const outcome = await resolveCensureIfExpired(job.data.characterId as string);
      console.log(`Resolved censure for ${job.data.characterId}: ${outcome}`);
      return;
    }
    if (job.name === "family-candidate-draw") {
      const characterId = job.data.characterId as string;
      const { familyCfg: fc, ageCfg: ac } = await configs();
      const drawn = await drawFamilyCandidates(characterId, { familyCfg: fc, ageCfg: ac });
      console.log(`Drew ${drawn.length} family candidates for ${characterId}`);
      // Re-schedule next game year (1 game year = 4 real days).
      await scheduledResolutionQueue.add(
        "family-candidate-draw",
        { characterId },
        { delay: ac.realMsPerGameYear * fc.candidates.drawCadenceGameYears, removeOnComplete: true, removeOnFail: 100, jobId: `family-draw:${characterId}` },
      );
      return;
    }
    if (job.name === "family-child-roll") {
      const characterId = job.data.characterId as string;
      const { familyCfg: fc, ageCfg: ac } = await configs();
      const births = await rollChildrenDue(characterId, { familyCfg: fc, ageCfg: ac });
      console.log(`Child roll for ${characterId}: ${births.length} birth(s)`);
      await scheduledResolutionQueue.add(
        "family-child-roll",
        { characterId },
        { delay: ac.realMsPerGameYear * fc.candidates.drawCadenceGameYears, removeOnComplete: true, removeOnFail: 100, jobId: `family-child-roll:${characterId}` },
      );
      return;
    }
    // Recurring sweeps run via their scheduler. The scheduler guarantees the next
    // occurrence regardless of the outcome here, so a throw is logged (not re-armed
    // by hand) and swallowed to avoid noisy failed-job stacks — it self-heals next tick.
    const sweep = SWEEP_BY_NAME.get(job.name);
    if (sweep) {
      try {
        console.log(await sweep.run());
      } catch (error) {
        console.error(`${job.name} failed (self-heals next interval): ${(error as Error).message}`);
      }
      return;
    }
  },
  { connection },
);

// Install the self-healing sweep schedulers on worker start (best-effort). Idempotent
// across restarts; clears any stale fixed-jobId sweep job from the old scheme.
void installSweepSchedulers();
