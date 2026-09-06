#!/usr/bin/env -S pnpm --filter @massalia/db exec tsx
// One-off admin bootstrap: set (or revoke) users.is_admin for an email.
//
//   DATABASE_URL=postgres://… pnpm --filter @massalia/db exec tsx ../../scripts/make-admin.ts you@example.com
//   DATABASE_URL=postgres://… pnpm --filter @massalia/db exec tsx ../../scripts/make-admin.ts you@example.com --revoke
//
// Run by hand against the target database (locally, or via `railway run` for
// production). There is no API to grant the flag on purpose: an admin is made
// only by someone holding the database URL.
import { createRequire } from "node:module";

// `pg` is a dependency of @massalia/db, not of the repo root: resolve it from there.
const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { Client } = require("pg") as typeof import("pg");

const [, , rawEmail, flag] = process.argv;
const email = rawEmail?.trim().toLowerCase();
const grant = flag !== "--revoke";
if (!email || !email.includes("@") || (flag && flag !== "--revoke")) {
  console.error("usage: make-admin.ts <email> [--revoke]");
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query<{ id: string; email: string; is_admin: boolean }>(
    "UPDATE users SET is_admin = $2 WHERE email = $1 AND deleted_at IS NULL RETURNING id, email, is_admin",
    [email, grant],
  );
  const row = result.rows[0];
  if (!row) {
    console.error(`No live account with email ${email}`);
    process.exit(1);
  }
  console.log(`${row.email} (${row.id}): is_admin = ${row.is_admin}`);
} finally {
  await client.end();
}
