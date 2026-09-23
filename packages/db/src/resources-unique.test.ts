import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 0061 folds duplicate resources rows and keys the table unique on
// (scope, scope_id, type). The migrated test database already carries the index,
// so each case runs the migration's SQL against an index-free copy of the table in
// a scratch schema, inside a transaction that is rolled back. Integration test
// against a REAL Postgres, guarded to a *_test database (mirrors festival.test.ts).

const dbUrl = process.env.DATABASE_URL ?? "";
const suite = describe.runIf(dbUrl.includes("_test"));

const migration = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../migrations/0061_resources_unique.sql"), "utf8");

type Row = { id: string; scope: string; scope_id: string; type: string; amount: number };

suite("migration 0061: one resources row per (scope, scope_id, type) (integration)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  async function inScratch(fn: () => Promise<void>): Promise<void> {
    await client.query("BEGIN");
    try {
      await client.query("CREATE SCHEMA mig0061_test");
      await client.query("SET LOCAL search_path = mig0061_test");
      await client.query("CREATE TABLE resources (LIKE public.resources INCLUDING DEFAULTS)");
      await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  }
  const insert = async (scope: string, scopeId: string, type: string, amount: number, at: string): Promise<string> =>
    (await client.query<{ id: string }>("INSERT INTO resources (scope, scope_id, type, amount, rate_per_second, last_updated_at) VALUES ($1, $2, $3, $4, 0, $5) RETURNING id", [scope, scopeId, type, amount, at])).rows[0]!.id;
  const rows = async (): Promise<Row[]> =>
    (await client.query<Row>("SELECT id, scope, scope_id, type, amount::float8 AS amount FROM resources ORDER BY scope, scope_id, type, id")).rows;
  const hasUniqueIndex = async (): Promise<boolean> =>
    (await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = 'mig0061_test' AND indexname = 'resources_scope_type_uq' AND indexdef LIKE 'CREATE UNIQUE INDEX%(scope, scope_id, type)'")).rowCount === 1;

  it("sums a duplicate pair into the row with the latest last_updated_at, breaks a tie on id, and leaves single rows alone", async () => {
    await inScratch(async () => {
      await insert("player", "p1", "grain", 3, "2026-09-01T00:00:00Z");
      const latest = await insert("player", "p1", "grain", 10, "2026-09-02T00:00:00Z");
      const tieA = await insert("player", "p3", "timber", 1, "2026-09-05T00:00:00Z");
      const tieB = await insert("player", "p3", "timber", 2, "2026-09-05T00:00:00Z");
      const wine = await insert("player", "p1", "wine", 5, "2026-09-01T00:00:00Z");
      const other = await insert("player", "p2", "grain", 7, "2026-09-01T00:00:00Z");
      const province = await insert("province", "p1", "grain", 2, "2026-09-01T00:00:00Z");

      await client.query(migration);

      const after = await rows();
      expect(after).toHaveLength(5);
      const find = (scope: string, scopeId: string, type: string) => after.filter((r) => r.scope === scope && r.scope_id === scopeId && r.type === type);
      expect(find("player", "p1", "grain")).toEqual([{ id: latest, scope: "player", scope_id: "p1", type: "grain", amount: 13 }]);
      expect(find("player", "p3", "timber")).toEqual([{ id: tieA > tieB ? tieA : tieB, scope: "player", scope_id: "p3", type: "timber", amount: 3 }]);
      expect(find("player", "p1", "wine")).toEqual([{ id: wine, scope: "player", scope_id: "p1", type: "wine", amount: 5 }]);
      expect(find("player", "p2", "grain")).toEqual([{ id: other, scope: "player", scope_id: "p2", type: "grain", amount: 7 }]);
      expect(find("province", "p1", "grain")).toEqual([{ id: province, scope: "province", scope_id: "p1", type: "grain", amount: 2 }]);

      // The index now refuses a second row for a key.
      expect(await hasUniqueIndex()).toBe(true);
      await client.query("SAVEPOINT dup");
      await expect(insert("player", "p1", "grain", 1, "2026-09-03T00:00:00Z")).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK TO SAVEPOINT dup");
    });
  });

  it("changes nothing on a table without duplicates, and runs twice", async () => {
    await inScratch(async () => {
      await insert("player", "p1", "grain", 10, "2026-09-01T00:00:00Z");
      await insert("player", "p1", "wine", 4, "2026-09-01T00:00:00Z");
      await insert("province", "p1", "grain", 2, "2026-09-01T00:00:00Z");
      const before = await rows();

      await client.query(migration);
      expect(await rows()).toEqual(before);
      expect(await hasUniqueIndex()).toBe(true);

      await client.query(migration);
      expect(await rows()).toEqual(before);
      expect(await hasUniqueIndex()).toBe(true);
    });
  });
});
