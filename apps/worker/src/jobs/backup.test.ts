import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { backupConfig, backupKey, backupKeyDate, dumpDatabase, isExpiredBackupKey, runBackup, type BackupConfig, type ObjectStore } from "./backup.js";

const env = { BACKUP_S3_ENDPOINT: "https://s3.example", BACKUP_S3_BUCKET: "massalia-backups", BACKUP_S3_KEY_ID: "id", BACKUP_S3_SECRET: "secret" };

// An in-memory ObjectStore recording every call.
function fakeStore(initialKeys: string[] = []) {
  const objects = new Map<string, Buffer>(initialKeys.map((key) => [key, Buffer.alloc(0)]));
  const calls: string[] = [];
  const store: ObjectStore = {
    async put(key, body) {
      calls.push(`put ${key}`);
      objects.set(key, body);
    },
    async list(prefix) {
      calls.push(`list ${prefix}`);
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    async remove(keys) {
      calls.push(`remove ${keys.sort().join(",")}`);
      for (const key of keys) objects.delete(key);
    },
  };
  const factory: (cfg: BackupConfig) => ObjectStore = () => store;
  return { store, objects, calls, factory };
}

describe("backup config", () => {
  it("is null unless all four variables are set (blank counts as unset)", () => {
    expect(backupConfig({})).toBeNull();
    expect(backupConfig({ ...env, BACKUP_S3_SECRET: "  " })).toBeNull();
    expect(backupConfig({ ...env, BACKUP_S3_BUCKET: undefined })).toBeNull();
    expect(backupConfig(env)).toEqual({ endpoint: "https://s3.example", bucket: "massalia-backups", keyId: "id", secret: "secret", region: "auto" });
    expect(backupConfig({ ...env, BACKUP_S3_REGION: "eu-central-1" })?.region).toBe("eu-central-1");
  });
});

describe("backup keys", () => {
  it("names the object after the UTC day", () => {
    expect(backupKey(new Date("2026-09-05T03:30:00Z"))).toBe("massalia-2026-09-05.dump.gz");
    // 23:30 in UTC-5 is already the next UTC day.
    expect(backupKey(new Date("2026-09-05T04:30:00Z"))).toBe("massalia-2026-09-05.dump.gz");
  });

  it("parses its own keys and ignores anything else", () => {
    expect(backupKeyDate("massalia-2026-09-05.dump.gz")?.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(backupKeyDate("massalia-2026-13-99.dump.gz")).toBeNull();
    expect(backupKeyDate("notes.txt")).toBeNull();
    expect(backupKeyDate("massalia-2026-09-05.dump")).toBeNull();
  });

  it("expires keys strictly older than the retention window, never foreign keys", () => {
    const now = new Date("2026-09-05T03:30:00Z");
    expect(isExpiredBackupKey("massalia-2026-08-06.dump.gz", now)).toBe(false); // exactly 30 days back: kept
    expect(isExpiredBackupKey("massalia-2026-08-05.dump.gz", now)).toBe(true); // 31 days back: pruned
    expect(isExpiredBackupKey("massalia-2026-09-04.dump.gz", now)).toBe(false);
    expect(isExpiredBackupKey("massalia-2026-08-06.dump.gz", new Date("2026-09-06T00:00:01Z"))).toBe(true);
    expect(isExpiredBackupKey("keep-me.txt", new Date("2099-01-01T00:00:00Z"))).toBe(false);
    expect(isExpiredBackupKey("massalia-2000-01-01.dump.gz", now, 365 * 100)).toBe(false);
  });
});

describe("runBackup", () => {
  it("skips with one log line when the variables are unset and touches nothing", async () => {
    const fake = fakeStore();
    const line = await runBackup({ env: {}, databaseUrl: "postgres://x", store: fake.factory, dump: async () => Buffer.from("nope") });
    expect(line).toMatch(/^Nightly backup skipped: BACKUP_S3_ENDPOINT/);
    expect(fake.calls).toEqual([]);
  });

  it("uploads the dated dump and prunes only backups older than 30 days", async () => {
    const now = new Date("2026-09-05T03:30:00Z");
    const fake = fakeStore(["massalia-2026-08-01.dump.gz", "massalia-2026-08-05.dump.gz", "massalia-2026-08-06.dump.gz", "massalia-2026-09-04.dump.gz", "massalia-notes.txt"]);
    const dumped = Buffer.from("fake gzipped dump");
    const line = await runBackup({ env, databaseUrl: "postgres://x", now, store: fake.factory, dump: async (url) => (url === "postgres://x" ? dumped : Buffer.alloc(0)) });

    expect(fake.calls).toEqual(["put massalia-2026-09-05.dump.gz", "list massalia-", "remove massalia-2026-08-01.dump.gz,massalia-2026-08-05.dump.gz"]);
    expect(fake.objects.get("massalia-2026-09-05.dump.gz")).toBe(dumped);
    expect([...fake.objects.keys()].sort()).toEqual(["massalia-2026-08-06.dump.gz", "massalia-2026-09-04.dump.gz", "massalia-2026-09-05.dump.gz", "massalia-notes.txt"]);
    expect(line).toBe("Nightly backup: uploaded massalia-2026-09-05.dump.gz (0.0 KiB) to massalia-backups, pruned 2 older than 30 days");
  });

  it("does not call remove when nothing is expired", async () => {
    const fake = fakeStore(["massalia-2026-09-04.dump.gz"]);
    await runBackup({ env, databaseUrl: "postgres://x", now: new Date("2026-09-05T03:30:00Z"), store: fake.factory, dump: async () => Buffer.from("x") });
    expect(fake.calls).toEqual(["put massalia-2026-09-05.dump.gz", "list massalia-"]);
  });

  it("propagates a dump failure and uploads nothing", async () => {
    const fake = fakeStore();
    await expect(runBackup({ env, databaseUrl: "postgres://x", store: fake.factory, dump: async () => { throw new Error("pg_dump exited with 1: boom"); } })).rejects.toThrow("pg_dump exited with 1: boom");
    expect(fake.calls).toEqual([]);
  });
});

// Real pg_dump against the *_test database, when both are available.
const dbUrl = process.env.DATABASE_URL ?? "";
const hasPgDump = spawnSync(process.env.PG_DUMP ?? "pg_dump", ["--version"]).status === 0;
describe.runIf(dbUrl.includes("_test") && hasPgDump)("dumpDatabase (integration)", () => {
  it("produces a gzipped custom-format archive", async () => {
    const gz = await dumpDatabase(dbUrl);
    expect(gz.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])); // gzip magic
    const raw = gunzipSync(gz);
    expect(raw.subarray(0, 5).toString("latin1")).toBe("PGDMP"); // pg_dump custom-format magic
  });

  it("rejects with pg_dump's stderr when the database is unreachable", async () => {
    await expect(dumpDatabase("postgres://postgres@127.0.0.1:1/nothing")).rejects.toThrow(/pg_dump exited with \d+: /);
  });
});
