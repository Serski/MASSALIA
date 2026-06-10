import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Queue, Worker } from "bullmq";
import { completionDelayMs, parseAgeConfig, parseFamilyConfig, type AgeConfig, type FamilyConfig } from "@massalia/shared";
import { drawFamilyCandidates, resolveCensureIfExpired } from "@massalia/db";

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
async function configs(): Promise<{ familyCfg: FamilyConfig; ageCfg: AgeConfig }> {
  if (!familyCfg) familyCfg = parseFamilyConfig(JSON.parse(await fs.readFile(path.join(repoRoot, "content/family/family-config.json"), "utf8")));
  if (!ageCfg) ageCfg = parseAgeConfig(JSON.parse(await fs.readFile(path.join(repoRoot, "content/age/age-config.json"), "utf8")));
  return { familyCfg, ageCfg };
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
    }
  },
  { connection },
);
