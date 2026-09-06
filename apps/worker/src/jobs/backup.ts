import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Nightly Postgres backup (03:30 UTC via the worker's job scheduler).
//   pg_dump --format=custom DATABASE_URL | gzip  ->  s3://BUCKET/massalia-YYYY-MM-DD.dump.gz
// then delete objects older than RETENTION_DAYS. Configured by four variables
// (BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET);
// when any is unset the job logs one line and skips. Restore drill: scripts/restore.sh.
// ---------------------------------------------------------------------------

export const BACKUP_JOB_NAME = "nightly-backup";
export const BACKUP_SCHEDULE = { pattern: "30 3 * * *", tz: "UTC" } as const;
export const RETENTION_DAYS = 30;
export const KEY_PREFIX = "massalia-";

export type BackupEnv = Partial<Record<"BACKUP_S3_ENDPOINT" | "BACKUP_S3_BUCKET" | "BACKUP_S3_KEY_ID" | "BACKUP_S3_SECRET" | "BACKUP_S3_REGION", string>>;

export type BackupConfig = {
  endpoint: string;
  bucket: string;
  keyId: string;
  secret: string;
  region: string;
};

// The four required variables, or null (skip) when any is missing/blank.
export function backupConfig(env: BackupEnv): BackupConfig | null {
  const endpoint = env.BACKUP_S3_ENDPOINT?.trim();
  const bucket = env.BACKUP_S3_BUCKET?.trim();
  const keyId = env.BACKUP_S3_KEY_ID?.trim();
  const secret = env.BACKUP_S3_SECRET?.trim();
  if (!endpoint || !bucket || !keyId || !secret) return null;
  return { endpoint, bucket, keyId, secret, region: env.BACKUP_S3_REGION?.trim() || "auto" };
}

// massalia-YYYY-MM-DD.dump.gz for the UTC calendar day of `date`.
export function backupKey(date: Date): string {
  return `${KEY_PREFIX}${date.toISOString().slice(0, 10)}.dump.gz`;
}

// The UTC day encoded in a backup key, or null for anything else in the bucket.
export function backupKeyDate(key: string): Date | null {
  const match = /^massalia-(\d{4}-\d{2}-\d{2})\.dump\.gz$/.exec(key);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Older than the retention window, judged in whole UTC days from the day in the
// key (deterministic, independent of upload timestamps): on day D, backups from
// D-30 are kept and D-31 and earlier go. Non-backup keys are never expired.
export function isExpiredBackupKey(key: string, now: Date, retentionDays = RETENTION_DAYS): boolean {
  const day = backupKeyDate(key);
  if (!day) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return today - day.getTime() > retentionDays * 86_400_000;
}

// The object-store surface the job needs; s3Store() implements it, tests fake it.
export interface ObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  list(prefix: string): Promise<string[]>;
  remove(keys: string[]): Promise<void>;
}

export function s3Store(cfg: BackupConfig): ObjectStore {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.secret },
    // Path-style addressing works with every S3-compatible store (MinIO, R2, B2, ...).
    forcePathStyle: true,
  });
  return {
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: "application/gzip" }));
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async remove(keys) {
      // DeleteObjects takes at most 1000 keys per call.
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
}

// pg_dump in custom format (pg_restore-able, parallel-restorable), gzipped, as one
// buffer. Rejects with pg_dump's stderr on a non-zero exit.
export function dumpDatabase(databaseUrl: string, pgDump = process.env.PG_DUMP ?? "pg_dump"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(pgDump, ["--format=custom", "--no-owner", "--no-acl", "--dbname", databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
    const gzip = createGzip({ level: 6 });
    const chunks: Buffer[] = [];
    let stderr = "";
    // The gzip stream ends (stdout closed) and the child reports its exit code in
    // no fixed order — a failed pg_dump can flush an empty archive before 'close'.
    // Settle only once BOTH are known, and only resolve on a zero exit.
    let exitCode: number | null = null;
    let gzipEnded = false;
    let settled = false;
    const settle = () => {
      if (settled || exitCode === null || !gzipEnded) return;
      settled = true;
      if (exitCode === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${pgDump} exited with ${exitCode}: ${stderr.trim()}`));
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      gzip.destroy();
      reject(error);
    };
    child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
    child.on("error", (error) => fail(new Error(`${pgDump} could not be started: ${error.message}`)));
    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("error", fail);
    child.stdout.pipe(gzip);
    child.on("close", (code) => {
      exitCode = code ?? 1; // killed by a signal: no code, treat as failure
      settle();
    });
    gzip.on("end", () => {
      gzipEnded = true;
      settle();
    });
  });
}

export type RunBackupOptions = {
  env?: BackupEnv;
  databaseUrl?: string;
  now?: Date;
  dump?: (databaseUrl: string) => Promise<Buffer>;
  store?: (cfg: BackupConfig) => ObjectStore;
  retentionDays?: number;
};

// One backup run. Returns the log line the worker prints.
export async function runBackup(options: RunBackupOptions = {}): Promise<string> {
  const cfg = backupConfig(options.env ?? process.env);
  if (!cfg) return "Nightly backup skipped: BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET / BACKUP_S3_KEY_ID / BACKUP_S3_SECRET not all set";
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the nightly backup");

  const now = options.now ?? new Date();
  const store = (options.store ?? s3Store)(cfg);
  const key = backupKey(now);
  const body = await (options.dump ?? dumpDatabase)(databaseUrl);
  await store.put(key, body);

  const expired = (await store.list(KEY_PREFIX)).filter((existing) => isExpiredBackupKey(existing, now, options.retentionDays ?? RETENTION_DAYS));
  if (expired.length) await store.remove(expired);

  return `Nightly backup: uploaded ${key} (${(body.length / 1024).toFixed(1)} KiB) to ${cfg.bucket}, pruned ${expired.length} older than ${options.retentionDays ?? RETENTION_DAYS} days`;
}
