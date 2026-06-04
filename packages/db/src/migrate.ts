import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/massalia";
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

const client = new Client({ connectionString: databaseUrl });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS __massalia_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const alreadyApplied = await client.query("SELECT 1 FROM __massalia_migrations WHERE name = $1", [file]);
    if (alreadyApplied.rowCount) {
      console.log(`Skipping ${file}`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO __massalia_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

try {
  await main();
} finally {
  await client.end();
}
