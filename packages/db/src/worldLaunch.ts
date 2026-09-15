// ---------------------------------------------------------------------------
// world:launch — the core of packages/db/scripts/world-launch.ts (World 2
// launch, prompt 1), kept under src so the DB-gated test can import it and the
// package build stays inside its rootDir. See the script for the operator's
// usage; every rule lives here.
// ---------------------------------------------------------------------------
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { parsePoliticsConfig } from "@massalia/shared";
import { ensureChamberSeats } from "./chamber.js";
import { type DbExec, type DbHandle } from "./client.js";
import { ensureRegionMilitary, ensureTownMilitary } from "./military.js";
import { oligarchSeats, players, regionMilitary, townMilitary, users, worlds } from "./schema.js";

const DAY = 86_400_000;
const DEFAULT_DAYS = 182;

export type LaunchOptions = { name: string; tagline: string; start: Date | null; days: number; dryRun: boolean };

export function parseArgs(argv: string[]): LaunchOptions {
  const opts: LaunchOptions = { name: "", tagline: "", start: null, days: DEFAULT_DAYS, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue; // pnpm passes its separator through
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--name") opts.name = next().trim();
    else if (arg === "--tagline") opts.tagline = next().trim();
    else if (arg === "--start") {
      const start = new Date(next());
      if (Number.isNaN(start.getTime())) throw new Error("--start must be an ISO instant");
      opts.start = start;
    } else if (arg === "--days") {
      opts.days = Number(next());
      if (!Number.isInteger(opts.days) || opts.days < 1) throw new Error("--days must be a whole number of days");
    } else if (arg === "--dry-run") opts.dryRun = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.name) throw new Error("--name is required");
  if (!opts.tagline) throw new Error("--tagline is required");
  return opts;
}

// The seed, from the name: "Massalia Season Two" → "massalia-season-two".
export function seedFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "world";
}

export class LaunchRefused extends Error {}

export type LaunchReport = {
  before: { id: string; name: string; startedAt: string; players: number; toStamp: number };
  after: null | {
    old: { id: string; name: string; status: string; endsAt: string };
    fresh: { id: string; name: string; status: string; startedAt: string; endsAt: string; seed: string };
    seats: number;
    towns: number;
    regions: number;
    stamped: number;
  };
};

async function chamberConfig() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return parsePoliticsConfig(JSON.parse(await readFile(path.join(repoRoot, "content/politics/politics-config.json"), "utf8"))).chamber;
}

const seatCount = async (exec: DbExec, worldId: string) => (await exec.select({ n: count() }).from(oligarchSeats).where(eq(oligarchSeats.worldId, worldId)))[0]!.n;
const townCount = async (exec: DbExec, worldId: string) => (await exec.select({ n: count() }).from(townMilitary).where(eq(townMilitary.worldId, worldId)))[0]!.n;
const regionCount = async (exec: DbExec, worldId: string) => (await exec.select({ n: count() }).from(regionMilitary).where(eq(regionMilitary.worldId, worldId)))[0]!.n;

// Users with a player row in `worldId` (active or not) and no stamp yet.
const unstampedIn = (exec: DbExec, worldId: string) =>
  exec
    .select({ id: users.id })
    .from(users)
    .where(and(isNull(users.betaAt), inArray(users.id, exec.select({ userId: players.userId }).from(players).where(eq(players.worldId, worldId)))));

function expectCount(what: string, got: number, want: number) {
  if (got !== want) throw new Error(`${what}: expected ${want}, got ${got} — rolled back`);
}

export async function launchWorld(db: DbHandle, opts: LaunchOptions, log: (line: string) => void = console.log, now: Date = new Date()): Promise<LaunchReport> {
  const active = await db.select().from(worlds).where(eq(worlds.status, "active"));
  if (active.length !== 1) throw new LaunchRefused(`Refused: ${active.length} active worlds (exactly one is required).`);
  const old = active[0]!;
  const sameName = await db.select({ id: worlds.id }).from(worlds).where(eq(worlds.name, opts.name)).limit(1);
  if (sameName[0]) throw new LaunchRefused(`Refused: a world named "${opts.name}" already exists (${sameName[0].id}).`);

  const playerCount = (await db.select({ n: count() }).from(players).where(eq(players.worldId, old.id)))[0]!.n;
  const toStamp = (await unstampedIn(db, old.id)).length;
  const before = { id: old.id, name: old.name, startedAt: old.startedAt.toISOString(), players: playerCount, toStamp };
  log(`BEFORE active world ${old.id} "${old.name}" started ${before.startedAt}: ${playerCount} player(s), ${toStamp} user(s) to stamp`);

  const startedAt = opts.start ?? now;
  const endsAt = new Date(startedAt.getTime() + opts.days * DAY);
  const seed = seedFor(opts.name);
  const chamber = await chamberConfig();
  log(`PLAN end "${old.name}" at ${now.toISOString()}; insert "${opts.name}" (${seed}) active ${startedAt.toISOString()} → ${endsAt.toISOString()}; ${chamber.capacity} seats; town + region pools; stamp ${toStamp} user(s)`);
  if (opts.dryRun) {
    log("DRY RUN: nothing written");
    return { before, after: null };
  }

  const after = await db.transaction(async (tx) => {
    const ended = await tx.update(worlds).set({ status: "ended", endsAt: now }).where(and(eq(worlds.id, old.id), eq(worlds.status, "active"))).returning({ id: worlds.id });
    expectCount("worlds ended", ended.length, 1);

    const fresh = (await tx.insert(worlds).values({ name: opts.name, tagline: opts.tagline, seed, startedAt, endsAt, status: "active" }).returning())[0]!;
    const stillActive = (await tx.select({ n: count() }).from(worlds).where(eq(worlds.status, "active")))[0]!.n;
    expectCount("active worlds after the flip", stillActive, 1);

    await ensureChamberSeats(fresh.id, chamber, tx);
    const seats = await seatCount(tx, fresh.id);
    expectCount("chamber seats", seats, chamber.capacity);

    const townsInContent = await ensureTownMilitary(tx, fresh.id);
    const towns = await townCount(tx, fresh.id);
    expectCount("town military rows", towns, townsInContent);
    const regionsInContent = await ensureRegionMilitary(tx, fresh.id);
    const regions = await regionCount(tx, fresh.id);
    expectCount("region military rows", regions, regionsInContent);

    const stamped = await tx
      .update(users)
      .set({ betaAt: now })
      .where(and(isNull(users.betaAt), inArray(users.id, tx.select({ userId: players.userId }).from(players).where(eq(players.worldId, old.id)))))
      .returning({ id: users.id });
    expectCount("users stamped", stamped.length, toStamp);
    // Nothing else may have changed in the users table.
    const stampedTotal = (await tx.select({ n: count() }).from(users).where(sql`${users.betaAt} = ${now.toISOString()}::timestamptz`))[0]!.n;
    expectCount("users carrying this run's stamp", stampedTotal, toStamp);

    return { freshId: fresh.id, seats, towns, regions, stamped: stamped.length };
  });

  const oldRow = (await db.select().from(worlds).where(eq(worlds.id, old.id)))[0]!;
  const freshRow = (await db.select().from(worlds).where(eq(worlds.id, after.freshId)))[0]!;
  const report: LaunchReport = {
    before,
    after: {
      old: { id: oldRow.id, name: oldRow.name, status: oldRow.status, endsAt: oldRow.endsAt.toISOString() },
      fresh: { id: freshRow.id, name: freshRow.name, status: freshRow.status, startedAt: freshRow.startedAt.toISOString(), endsAt: freshRow.endsAt.toISOString(), seed: freshRow.seed },
      seats: await seatCount(db, freshRow.id),
      towns: await townCount(db, freshRow.id),
      regions: await regionCount(db, freshRow.id),
      stamped: after.stamped,
    },
  };
  const a = report.after!;
  log(`AFTER  ${a.old.id} "${a.old.name}" ${a.old.status}, ends ${a.old.endsAt}`);
  log(`AFTER  ${a.fresh.id} "${a.fresh.name}" ${a.fresh.status}, ${a.fresh.startedAt} → ${a.fresh.endsAt}, seed ${a.fresh.seed}`);
  log(`AFTER  seats ${a.seats}, town pools ${a.towns}, region pools ${a.regions}, users stamped ${a.stamped}`);
  return report;
}
