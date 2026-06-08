import { Queue } from "bullmq";

// Producer side of the shared "scheduled-resolution" queue (the worker consumes).
// Best-effort: if Redis is unavailable, enqueue is skipped — the server's
// lazy-on-read resolution is the safety net.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  // Fail fast (don't block request handlers) when Redis is unavailable: reject
  // commands instead of buffering, and stop reconnecting after a few attempts.
  enableOfflineQueue: false,
  connectTimeout: 1000,
  retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 100, 500)),
};

let queue: Queue | null = null;
function getQueue(): Queue {
  if (!queue) {
    queue = new Queue("scheduled-resolution", { connection });
    queue.on("error", () => {
      /* swallow connection errors; resolution also happens lazily on read */
    });
  }
  return queue;
}

export async function enqueueCensureResolution(characterId: string, delayMs: number) {
  try {
    await getQueue().add(
      "censure-resolve",
      { characterId },
      { delay: Math.max(0, delayMs), removeOnComplete: true, removeOnFail: 100 },
    );
  } catch (error) {
    console.warn(`Could not enqueue censure resolution (Redis down?): ${(error as Error).message}`);
  }
}
