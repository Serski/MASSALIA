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
    if (job.name === "festival-sweep") {
      const cfg = await calendarConfig();
      const fired = await fireFestivalsForAll(cfg);
      const closed = await closeDueFestivals(cfg);
      console.log(`Festival sweep: fired to ${fired} living characters, closed ${closed} instance(s)`);
      // Re-arm the recurring sweep.
      await scheduledResolutionQueue.add(
        "festival-sweep",
        {},
        { delay: FESTIVAL_SWEEP_MS, removeOnComplete: true, removeOnFail: 100, jobId: "festival-sweep" },
      );
    }
    if (job.name === "spouse-death-sweep") {
      const { familyCfg: fc, ageCfg: ac } = await configs();
      const deaths = await sweepSpouseDeaths({ familyCfg: fc, ageCfg: ac });
      console.log(`Spouse-death sweep: ended ${deaths.length} marriage(s) of old age`);
      // Re-arm the recurring sweep.
      await scheduledResolutionQueue.add(
        "spouse-death-sweep",
        {},
        { delay: SPOUSE_SWEEP_MS, removeOnComplete: true, removeOnFail: 100, jobId: "spouse-death-sweep" },
      );
    }
    if (job.name === "chamber-sweep") {
      const cfg = await politicsConfig();
      const opened = await openChamberVoteIfDue(cfg);
      const closed = await closeDueChamberVotes(cfg);
      console.log(`Chamber sweep: ${opened ? `opened "${opened.title}" (year ${opened.gameYear})` : "no vote opened"}, closed ${closed.length} vote(s)`);
      // Re-arm the recurring sweep.
      await scheduledResolutionQueue.add(
        "chamber-sweep",
        {},
        { delay: CHAMBER_SWEEP_MS, removeOnComplete: true, removeOnFail: 100, jobId: "chamber-sweep" },
      );
    }
    if (job.name === "election-sweep") {
      const { calendar, politics } = await bothConfigs();
      const opened = await openElectionsIfDue(calendar);
      const advanced = await advanceElections(calendar, politics);
      console.log(
        `Election sweep: opened ${opened.length} declaration(s), ${advanced.toVoting.length} to voting, resolved ${advanced.resolved.length}` +
          (advanced.resolved.length ? ` (${advanced.resolved.map((r) => r.office).join(", ")})` : ""),
      );
      await scheduledResolutionQueue.add(
        "election-sweep",
        {},
        { delay: ELECTION_SWEEP_MS, removeOnComplete: true, removeOnFail: 100, jobId: "election-sweep" },
      );
    }
    if (job.name === "olympiad-sweep") {
      const cfg = await calendarConfig();
      const delivered = await deliverOlympicNominationToAll(cfg);
      const advanced = await advanceOlympiads(cfg);
      console.log(`Olympiad sweep: delivered ${delivered} nominate card(s), advanced ${advanced.length} cycle(s)`);
      // Re-arm the recurring sweep.
      await scheduledResolutionQueue.add(
        "olympiad-sweep",
        {},
        { delay: OLYMPIAD_SWEEP_MS, removeOnComplete: true, removeOnFail: 100, jobId: "olympiad-sweep" },
      );
    }
  },
  { connection },
);

// Kick off the recurring festival sweep on worker start (best-effort).
scheduledResolutionQueue
  .add("festival-sweep", {}, { delay: 0, removeOnComplete: true, removeOnFail: 100, jobId: "festival-sweep" })
  .catch((error) => console.warn(`Could not schedule festival sweep (Redis down?): ${(error as Error).message}`));

// Kick off the recurring spouse-death sweep on worker start (best-effort).
scheduledResolutionQueue
  .add("spouse-death-sweep", {}, { delay: 0, removeOnComplete: true, removeOnFail: 100, jobId: "spouse-death-sweep" })
  .catch((error) => console.warn(`Could not schedule spouse-death sweep (Redis down?): ${(error as Error).message}`));

// Kick off the recurring Olympiad sweep on worker start (best-effort).
scheduledResolutionQueue
  .add("olympiad-sweep", {}, { delay: 0, removeOnComplete: true, removeOnFail: 100, jobId: "olympiad-sweep" })
  .catch((error) => console.warn(`Could not schedule Olympiad sweep (Redis down?): ${(error as Error).message}`));

// Kick off the recurring chamber sweep on worker start (best-effort).
scheduledResolutionQueue
  .add("chamber-sweep", {}, { delay: 0, removeOnComplete: true, removeOnFail: 100, jobId: "chamber-sweep" })
  .catch((error) => console.warn(`Could not schedule chamber sweep (Redis down?): ${(error as Error).message}`));

// Kick off the recurring election sweep on worker start (best-effort).
scheduledResolutionQueue
  .add("election-sweep", {}, { delay: 0, removeOnComplete: true, removeOnFail: 100, jobId: "election-sweep" })
  .catch((error) => console.warn(`Could not schedule election sweep (Redis down?): ${(error as Error).message}`));
