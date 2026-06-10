import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Queue, Worker } from "bullmq";
import { completionDelayMs, parseAgeConfig, parseCalendarConfig, parseFamilyConfig, type AgeConfig, type CalendarConfig, type FamilyConfig } from "@massalia/shared";
import { closeDueFestivals, drawFamilyCandidates, fireFestivalsForAll, resolveCensureIfExpired, rollChildrenDue } from "@massalia/db";

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

// Festival sweep cadence: well under a season so boundaries are caught promptly.
const FESTIVAL_SWEEP_MS = 6 * 60 * 60 * 1000;

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
  },
  { connection },
);

// Kick off the recurring festival sweep on worker start (best-effort).
scheduledResolutionQueue
  .add("festival-sweep", {}, { delay: 0, removeOnComplete: true, removeOnFail: 100, jobId: "festival-sweep" })
  .catch((error) => console.warn(`Could not schedule festival sweep (Redis down?): ${(error as Error).message}`));
