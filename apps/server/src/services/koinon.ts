import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, max, ne, notInArray, sql } from "drizzle-orm";
import { createDb, dailyDecisions, effectLog, houses, koina, koinonDeposits, koinonInvites, koinonMembers, koinonPosts, playerCharacters, playerLevy, playerUnits, players, resources } from "@massalia/db";
import { bandDef, cleanKoinonName, cleanKoinonPost, formatGameDate, gameDate, hallCap, parseKoinonContent, sanitizeDisplayName, seasonIndexAt, settleHall, unitDef, type HallPhase, type HallSettle, type HallState, type KoinonChronicle, type KoinonContent, type KoinonDepositDetail, type KoinonEvent } from "@massalia/shared";
import { agedPortraitFor } from "./age.js";
import { getBandsContent, getUnitsContent } from "./barracks.js";
import { creditWorldTreasury, debitDrachmae, spendTransaction, SpendRejected, type ActingContext } from "./buildings.js";
import { findCharacterRow } from "./character.js";
import { lockPlayer } from "./lock.js";
import { getTopology } from "./mapGraph.js";
import { regionDisplayName, townDisplayName } from "./mapNames.js";

// ---------------------------------------------------------------------------
// The koinon (koinon prompt 1): a player-made company of citizens. One leader,
// at most one vice, up to `memberCap` members; the leader and the vice invite by
// name and post to a board the members read. Numbers live in
// content/koinon/koinon.json.
//
// Concurrency. Every write that changes a koinon's membership, roles, invites or
// posts runs in one transaction that first locks the koinon row (lockKoinon:
// SELECT … FOR UPDATE on the live row), so two accepts for the last seat, a
// leave against an expel, or a post against a dissolve run one after another.
// Founding spends, so it runs in spendTransaction (lockPlayer first). Accepting
// takes the caller's player lock and then the koinon row: the player lock is
// what serialises one player accepting two koina at once. No transaction takes
// a player lock after a koinon lock, and none holds two koinon locks.
//
// A member whose account was deleted (players.is_active = false) is removed
// under the same koinon lock at the start of every read and write, as if he had
// left: the lead passes, with no cooldown and no line for him.
// ---------------------------------------------------------------------------

const db = createDb();
type DbTx = Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0];
type Exec = DbTx | typeof db;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const koinonFile = path.join(repoRoot, "content/koinon/koinon.json");

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
// How many of the newest gifts the page lists.
const RECENT_GIFTS = 10;

let content: KoinonContent | null = null;

export async function loadKoinonContent(): Promise<KoinonContent> {
  content = parseKoinonContent(JSON.parse(await fs.readFile(koinonFile, "utf8")));
  return content;
}

export function getKoinonContent(): KoinonContent {
  if (!content) throw new Error("Koinon content not loaded. Call loadKoinonContent() at boot.");
  return content;
}

export type KoinonError = { ok: false; code: number; error: string };
type KoinonRow = typeof koina.$inferSelect;
export type KoinonRole = "leader" | "vice" | "member";

const fail = (code: number, error: string): KoinonError => ({ ok: false, code, error });
const NOT_MEMBER = fail(403, "You are not in a koinon.");
const INVITE_GONE = fail(404, "That invitation is gone.");
const NO_MEMBER = fail(404, "No such member.");

// A wait, for refusal messages: "22h 14m", "45m", or "less than a minute".
function remainingText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function roleOf(k: KoinonRow, playerId: string): KoinonRole {
  return k.leaderPlayerId === playerId ? "leader" : k.vicePlayerId === playerId ? "vice" : "member";
}

function gameLabel(at: Date, ctx: ActingContext): string {
  return formatGameDate(gameDate(at.getTime(), ctx.worldStartedMs));
}

// --- Locks and shared steps --------------------------------------------------

// LOCK ORDER: a player lock (lockPlayer) may be taken before a koinon lock,
// never after one. Founding and accepting take the caller's player lock first;
// every other path takes the koinon lock alone. A transaction that held a
// koinon lock and then waited for a player lock could deadlock against an
// accept, which waits the other way round.
//
// The koinon lock: the live row, FOR UPDATE. null when the koinon is unknown or
// dissolved. Emits
//   SELECT … FROM koina WHERE id = $1 AND dissolved_at IS NULL FOR UPDATE
async function lockKoinon(tx: DbTx, koinonId: string): Promise<KoinonRow | null> {
  const rows = await tx.select().from(koina).where(and(eq(koina.id, koinonId), isNull(koina.dissolvedAt))).for("update");
  return rows[0] ?? null;
}

// The seats taken: SELECT count(*) FROM koinon_members WHERE koinon_id = $1.
// Read under the koinon lock, so it cannot move before the caller's own write.
async function seatCount(exec: Exec, koinonId: string): Promise<number> {
  const rows = await exec.select({ n: count() }).from(koinonMembers).where(eq(koinonMembers.koinonId, koinonId));
  return rows[0]?.n ?? 0;
}

async function memberRow(exec: Exec, playerId: string, worldId: string) {
  const rows = await exec
    .select()
    .from(koinonMembers)
    .where(and(eq(koinonMembers.worldId, worldId), eq(koinonMembers.playerId, playerId)))
    .limit(1);
  return rows[0] ?? null;
}

// The members in standing order: earliest joined_at, then player id.
async function membersInOrder(exec: Exec, koinonId: string) {
  return exec
    .select({ playerId: koinonMembers.playerId, joinedAt: koinonMembers.joinedAt })
    .from(koinonMembers)
    .where(eq(koinonMembers.koinonId, koinonId))
    .orderBy(asc(koinonMembers.joinedAt), asc(koinonMembers.playerId));
}

// One Chronicle line on the player's own current character (effect_log kind
// "koinon", read through detail.chronicle).
async function logKoinon(tx: DbTx, playerId: string, worldId: string, event: KoinonEvent, koinonName: string, now: Date): Promise<void> {
  const character = await findCharacterRow(playerId, worldId, tx);
  if (!character) return;
  const chronicle: KoinonChronicle = { event, koinonName };
  await tx.insert(effectLog).values({ characterId: character.id, kind: "koinon", detail: { chronicle, source: "koinon" }, createdAt: now });
}

// Take a member out (ruling 7). The vice seat empties with its holder. When the
// leader goes the lead passes to the vice, else to the longest-standing member,
// who gets the Chronicle line. When no one is left the koinon is dissolved: its
// invites and posts go and its name is free again. Returns the row as it stands.
async function removeMember(tx: DbTx, k: KoinonRow, playerId: string, now: Date): Promise<KoinonRow> {
  await tx.delete(koinonMembers).where(and(eq(koinonMembers.koinonId, k.id), eq(koinonMembers.playerId, playerId)));
  const rest = await membersInOrder(tx, k.id);
  if (rest.length === 0) return (await dissolve(tx, k, now)).row;
  let vice = k.vicePlayerId === playerId ? null : k.vicePlayerId;
  if (k.leaderPlayerId !== playerId) {
    if (vice === k.vicePlayerId) return k;
    return (await tx.update(koina).set({ vicePlayerId: vice }).where(eq(koina.id, k.id)).returning())[0]!;
  }
  const successor = vice ?? rest[0]!.playerId;
  if (successor === vice) vice = null;
  const updated = (await tx.update(koina).set({ leaderPlayerId: successor, vicePlayerId: vice, leaderSince: now }).where(eq(koina.id, k.id)).returning())[0]!;
  await logKoinon(tx, successor, k.worldId, "leader", k.name, now);
  return updated;
}

// End a koinon. The hall is settled first, then whatever is left in the
// treasury goes to the city (the world treasury) and the purse is zeroed
// (ruling 7). Every member row, invite and post goes; the row stays, marked,
// and its gifts stay on record. Returns the row and what the city received.
async function dissolve(tx: DbTx, k: KoinonRow, now: Date): Promise<{ row: KoinonRow; treasuryToCity: number }> {
  const { k: settled } = await settleHallLocked(tx, k, now);
  const treasuryToCity = settled.treasury;
  await creditWorldTreasury(tx, settled.worldId, treasuryToCity);
  await tx.delete(koinonMembers).where(eq(koinonMembers.koinonId, k.id));
  await tx.delete(koinonInvites).where(eq(koinonInvites.koinonId, k.id));
  await tx.delete(koinonPosts).where(eq(koinonPosts.koinonId, k.id));
  const row = (await tx.update(koina).set({ dissolvedAt: now, vicePlayerId: null, treasury: 0 }).where(eq(koina.id, k.id)).returning())[0]!;
  return { row, treasuryToCity };
}

// Ruling 9, under the koinon lock: members whose account is gone leave, in
// standing order. Returns the row as it stands, or null once it is dissolved.
async function purgeInactive(tx: DbTx, k: KoinonRow, now: Date): Promise<KoinonRow | null> {
  const gone = await tx
    .select({ playerId: koinonMembers.playerId })
    .from(koinonMembers)
    .innerJoin(players, eq(players.id, koinonMembers.playerId))
    .where(and(eq(koinonMembers.koinonId, k.id), eq(players.isActive, false)))
    .orderBy(asc(koinonMembers.joinedAt), asc(koinonMembers.playerId));
  let row = k;
  for (const g of gone) {
    row = await removeMember(tx, row, g.playerId, now);
    if (row.dissolvedAt !== null) return null;
  }
  return row;
}

// The same for every koinon of the world that holds such a member, each under
// its own lock. The reads call it first; a koinon whose only members are gone
// has nobody left to read it, so the sweep is by world and not by caller.
async function sweepInactive(worldId: string, now: Date): Promise<void> {
  const stale = await db
    .selectDistinct({ koinonId: koinonMembers.koinonId })
    .from(koinonMembers)
    .innerJoin(players, eq(players.id, koinonMembers.playerId))
    .where(and(eq(koinonMembers.worldId, worldId), eq(players.isActive, false)));
  for (const { koinonId } of stale) {
    await db.transaction(async (tx) => {
      const k = await lockKoinon(tx, koinonId);
      if (k) await purgeInactive(tx, k, now);
    });
  }
}

// The hall as the pure settle reads it, from a koinon row.
function hallStateOf(k: KoinonRow): HallState {
  return { completesAt: k.lescheCompletesAt?.getTime() ?? null, paidUntil: k.leschePaidUntil?.getTime() ?? null, shut: k.lescheShut, treasury: k.treasury };
}

// The hall's phase at `now`, read-only: what a locked settle would find.
function hallPhaseAt(k: KoinonRow, now: Date): HallPhase {
  return settleHall(hallStateOf(k), now.getTime(), getKoinonContent().lesche.upkeepPerDay).phase;
}

// The Lesche's upkeep, applied to a locked koinon row (koinon prompt 2): the
// whole days due are paid from the treasury, the hall shuts when a day cannot
// be paid and reopens when one can. The debit is relative and guarded, with
// lesche_paid_until and lesche_shut beside it. Returns the row as it stands and
// the settle (its phase decides the member cap in force). Runs under the
// koinon lock in every path that touches the koinon's state, so the read-only
// view, which calls the same pure settleHall, always agrees with it.
async function settleHallLocked(tx: DbTx, k: KoinonRow, now: Date): Promise<{ k: KoinonRow; settle: HallSettle }> {
  const before = hallStateOf(k);
  const settle = settleHall(before, now.getTime(), getKoinonContent().lesche.upkeepPerDay);
  const after = settle.state;
  if (settle.spent === 0 && after.shut === before.shut && after.paidUntil === before.paidUntil) return { k, settle };
  const updated = await tx
    .update(koina)
    .set({ treasury: sql`${koina.treasury} - ${settle.spent}`, leschePaidUntil: after.paidUntil === null ? null : new Date(after.paidUntil), lescheShut: after.shut })
    .where(and(eq(koina.id, k.id), gte(koina.treasury, settle.spent)))
    .returning();
  if (!updated[0]) throw new Error(`koinon: upkeep of ${settle.spent} failed its guard under the koinon lock`);
  return { k: updated[0], settle };
}

// The locked body every member write shares: lock the caller's koinon, drop
// the members whose accounts are gone, settle the hall, confirm the caller
// still sits in it, then run `fn` with the row, the caller's role and the
// settle. `fn` checks before it writes, so a refusal it returns leaves nothing
// half done. The caller owns the transaction (and any player lock, taken
// before this).
async function inOwnKoinon<T>(tx: DbTx, ctx: ActingContext, now: Date, fn: (tx: DbTx, k: KoinonRow, role: KoinonRole, settle: HallSettle) => Promise<T | KoinonError>): Promise<T | KoinonError> {
  const mine = await memberRow(tx, ctx.playerId, ctx.worldId);
  if (!mine) return NOT_MEMBER;
  const locked = await lockKoinon(tx, mine.koinonId);
  const purged = locked ? await purgeInactive(tx, locked, now) : null;
  if (!purged) return NOT_MEMBER;
  const { k, settle } = await settleHallLocked(tx, purged, now);
  const still = await memberRow(tx, ctx.playerId, ctx.worldId);
  if (!still || still.koinonId !== k.id) return NOT_MEMBER;
  return fn(tx, k, roleOf(k, ctx.playerId), settle);
}

// One locked transaction on the caller's own koinon, around inOwnKoinon.
async function withOwnKoinon<T>(ctx: ActingContext, now: Date, fn: (tx: DbTx, k: KoinonRow, role: KoinonRole, settle: HallSettle) => Promise<T | KoinonError>): Promise<T | KoinonError> {
  return db.transaction((tx) => inOwnKoinon(tx, ctx, now, fn));
}

async function cooldownUntil(exec: Exec, playerId: string, now: Date): Promise<Date | null> {
  const rows = await exec.select({ until: players.koinonCooldownUntil }).from(players).where(eq(players.id, playerId)).limit(1);
  const until = rows[0]?.until ?? null;
  return until && until.getTime() > now.getTime() ? until : null;
}

async function liveNameTaken(exec: Exec, worldId: string, name: string, exceptKoinonId: string | null): Promise<boolean> {
  const rows = await exec
    .select({ id: koina.id })
    .from(koina)
    .where(and(eq(koina.worldId, worldId), isNull(koina.dissolvedAt), sql`lower(${koina.name}) = lower(${name})`, ...(exceptKoinonId ? [ne(koina.id, exceptKoinonId)] : [])))
    .limit(1);
  return rows.length > 0;
}

// Ruling 8: the leader has led for the content's days and his current character
// has had no daily hand dealt in as long (the dashboard deals it on every load).
async function leaderIsAbsent(exec: Exec, k: KoinonRow, now: Date): Promise<boolean> {
  if (!k.leaderPlayerId) return false;
  const windowMs = getKoinonContent().absentLeaderDays * MS_PER_DAY;
  if (now.getTime() - k.leaderSince.getTime() < windowMs) return false;
  const rows = await exec
    .select({ last: max(dailyDecisions.createdAt) })
    .from(dailyDecisions)
    .innerJoin(playerCharacters, eq(playerCharacters.id, dailyDecisions.characterId))
    .where(and(eq(playerCharacters.playerId, k.leaderPlayerId), eq(playerCharacters.worldId, k.worldId)));
  const last = rows[0]?.last ?? null;
  return last === null || now.getTime() - last.getTime() >= windowMs;
}

// Who may take an absent leader's place: the vice; with no vice, the
// longest-standing member other than the leader.
async function leadClaimant(exec: Exec, k: KoinonRow): Promise<string | null> {
  if (k.vicePlayerId) return k.vicePlayerId;
  return (await membersInOrder(exec, k.id)).find((m) => m.playerId !== k.leaderPlayerId)?.playerId ?? null;
}

// --- The page ------------------------------------------------------------------

export type KoinonMemberView = {
  playerId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  professionSlug: string | null;
  faceId: string | null;
  portrait: string | null;
  party: string;
  joinedLabel: string;
  role: KoinonRole;
};

export type KoinonView = {
  now: string;
  rules: { foundCost: number; foundPrestige: number; memberCap: number; nameMin: number; nameMax: number; postMaxChars: number; cooldownHours: number; absentLeaderDays: number; depositMax: number; lescheCost: number; lescheBuildDays: number; lescheUpkeep: number; lescheCap: number };
  me: { playerId: string; role: KoinonRole | null; cooldownUntil: string | null; prestige: number; drachmae: number };
  koina: { id: string; name: string; leaderName: string; members: number; cap: number }[];
  invites: { id: string; koinonId: string; koinonName: string; inviterName: string; expiresAt: string }[];
  koinon: null | {
    id: string;
    name: string;
    foundedLabel: string;
    cap: number;
    leaderPlayerId: string | null;
    vicePlayerId: string | null;
    leaderAbsent: boolean;
    canTakeLead: boolean;
    members: KoinonMemberView[];
    pending: { id: string; playerName: string; expiresAt: string }[];
    posts: { id: string; authorName: string; body: string; label: string; canDelete: boolean }[];
    unread: number;
    // The treasury as a settle at `now` would leave it, every giver with his
    // total (largest first), and the 10 newest gifts. Members only.
    treasury: number;
    // The Lesche as it stands at `now`: `daysCovered` is the whole days of
    // upkeep the treasury still holds for an open hall, 0 otherwise.
    hall: { phase: HallPhase; startedAt: string | null; completesAt: string | null; paidUntil: string | null; daysCovered: number };
    givers: { playerId: string; name: string; total: number }[];
    gifts: { id: string; name: string; amount: number; label: string }[];
  };
};

// The members of one koinon with their display facts, in the page's order:
// leader, vice, then by standing.
async function memberViews(exec: Exec, k: KoinonRow, ctx: ActingContext, now: Date): Promise<KoinonMemberView[]> {
  const rows = await exec
    .select({ member: koinonMembers, player: players, character: playerCharacters, houseName: houses.name })
    .from(koinonMembers)
    .innerJoin(players, eq(players.id, koinonMembers.playerId))
    .leftJoin(playerCharacters, and(eq(playerCharacters.playerId, players.id), eq(playerCharacters.worldId, koinonMembers.worldId)))
    .leftJoin(houses, eq(houses.slug, sql`coalesce(${playerCharacters.houseSlug}, ${players.houseSlug})`))
    .where(eq(koinonMembers.koinonId, k.id))
    .orderBy(asc(koinonMembers.joinedAt), asc(koinonMembers.playerId));
  const rank = (playerId: string) => (playerId === k.leaderPlayerId ? 0 : playerId === k.vicePlayerId ? 1 : 2);
  return rows
    .map((r, index) => ({ r, index }))
    .sort((a, b) => rank(a.r.member.playerId) - rank(b.r.member.playerId) || a.index - b.index)
    .map(({ r }) => {
      const houseSlug = r.character?.houseSlug ?? r.player.houseSlug ?? "";
      return {
        playerId: r.member.playerId,
        name: r.player.name,
        houseSlug,
        houseName: r.houseName ?? houseSlug,
        professionSlug: r.player.professionSlug,
        faceId: r.player.faceId,
        portrait: agedPortraitFor(r.character, now.getTime()),
        party: r.character?.party ?? "none",
        joinedLabel: gameLabel(r.member.joinedAt, ctx),
        role: roleOf(k, r.member.playerId),
      };
    });
}

// A member's unread posts: other players' posts newer than his last_read_at.
async function unreadPosts(exec: Exec, playerId: string, worldId: string): Promise<number> {
  const rows = await exec
    .select({ n: count() })
    .from(koinonPosts)
    .innerJoin(koinonMembers, eq(koinonMembers.koinonId, koinonPosts.koinonId))
    .where(and(eq(koinonMembers.worldId, worldId), eq(koinonMembers.playerId, playerId), ne(koinonPosts.authorPlayerId, playerId), gt(koinonPosts.createdAt, koinonMembers.lastReadAt)));
  return rows[0]?.n ?? 0;
}

// GET /api/koinon — the page: the rules, the caller's standing, every live
// koinon of the world, and either his invitations or his own koinon.
export async function koinonView(ctx: ActingContext, now: Date): Promise<KoinonView> {
  const c = getKoinonContent();
  await sweepInactive(ctx.worldId, now);

  const character = await findCharacterRow(ctx.playerId, ctx.worldId);
  const mine = await memberRow(db, ctx.playerId, ctx.worldId);
  const own = mine ? ((await db.select().from(koina).where(and(eq(koina.id, mine.koinonId), isNull(koina.dissolvedAt))).limit(1))[0] ?? null) : null;
  const cooldown = await cooldownUntil(db, ctx.playerId, now);

  const live = await db
    .select({ row: koina, leaderName: players.name, members: sql<number>`(SELECT count(*)::int FROM koinon_members m WHERE m.koinon_id = ${koina.id})` })
    .from(koina)
    .leftJoin(players, eq(players.id, koina.leaderPlayerId))
    .where(and(eq(koina.worldId, ctx.worldId), isNull(koina.dissolvedAt)))
    .orderBy(sql`lower(${koina.name})`, asc(koina.id));

  const invites = own
    ? []
    : await db
        .select({ id: koinonInvites.id, koinonId: koina.id, koinonName: koina.name, inviterName: players.name, expiresAt: koinonInvites.expiresAt })
        .from(koinonInvites)
        .innerJoin(koina, eq(koina.id, koinonInvites.koinonId))
        .innerJoin(players, eq(players.id, koinonInvites.inviterPlayerId))
        .where(and(eq(koinonInvites.worldId, ctx.worldId), eq(koinonInvites.playerId, ctx.playerId), gt(koinonInvites.expiresAt, now), isNull(koina.dissolvedAt)))
        .orderBy(asc(koinonInvites.createdAt), asc(koinonInvites.id));

  let koinon: KoinonView["koinon"] = null;
  if (own) {
    const role = roleOf(own, ctx.playerId);
    const leads = role === "leader" || role === "vice";
    const absent = await leaderIsAbsent(db, own, now);
    const pending = leads
      ? await db
          .select({ id: koinonInvites.id, playerName: players.name, expiresAt: koinonInvites.expiresAt })
          .from(koinonInvites)
          .innerJoin(players, eq(players.id, koinonInvites.playerId))
          .where(and(eq(koinonInvites.koinonId, own.id), gt(koinonInvites.expiresAt, now)))
          .orderBy(asc(koinonInvites.createdAt), asc(koinonInvites.id))
      : [];
    const posts = await db
      .select({ id: koinonPosts.id, authorPlayerId: koinonPosts.authorPlayerId, authorName: players.name, body: koinonPosts.body, createdAt: koinonPosts.createdAt })
      .from(koinonPosts)
      .innerJoin(players, eq(players.id, koinonPosts.authorPlayerId))
      .where(eq(koinonPosts.koinonId, own.id))
      .orderBy(desc(koinonPosts.createdAt), desc(koinonPosts.id));
    // Read-only: the hall is derived with the pure settle, never written here.
    // Every change to the treasury settles first, so this is what a locked
    // settle at `now` would store.
    const hall = settleHall(hallStateOf(own), now.getTime(), c.lesche.upkeepPerDay);
    const total = sql<number>`sum(${koinonDeposits.amount})::int`;
    const givers = await db
      .select({ playerId: koinonDeposits.playerId, name: players.name, total })
      .from(koinonDeposits)
      .innerJoin(players, eq(players.id, koinonDeposits.playerId))
      .where(eq(koinonDeposits.koinonId, own.id))
      .groupBy(koinonDeposits.playerId, players.name)
      .orderBy(desc(total), asc(players.name), asc(koinonDeposits.playerId));
    const gifts = await db
      .select({ id: koinonDeposits.id, name: players.name, amount: koinonDeposits.amount, createdAt: koinonDeposits.createdAt })
      .from(koinonDeposits)
      .innerJoin(players, eq(players.id, koinonDeposits.playerId))
      .where(eq(koinonDeposits.koinonId, own.id))
      .orderBy(desc(koinonDeposits.createdAt), desc(koinonDeposits.id))
      .limit(RECENT_GIFTS);
    koinon = {
      id: own.id,
      name: own.name,
      foundedLabel: gameLabel(own.foundedAt, ctx),
      cap: hallCap(hall.phase, c),
      leaderPlayerId: own.leaderPlayerId,
      vicePlayerId: own.vicePlayerId,
      leaderAbsent: absent,
      canTakeLead: absent && role !== "leader" && (await leadClaimant(db, own)) === ctx.playerId,
      members: await memberViews(db, own, ctx, now),
      pending: pending.map((p) => ({ id: p.id, playerName: p.playerName, expiresAt: p.expiresAt.toISOString() })),
      posts: posts.map((p) => ({ id: p.id, authorName: p.authorName, body: p.body, label: gameLabel(p.createdAt, ctx), canDelete: role === "leader" || p.authorPlayerId === ctx.playerId })),
      unread: await unreadPosts(db, ctx.playerId, ctx.worldId),
      treasury: hall.state.treasury,
      hall: {
        phase: hall.phase,
        startedAt: own.lescheStartedAt?.toISOString() ?? null,
        completesAt: own.lescheCompletesAt?.toISOString() ?? null,
        paidUntil: hall.state.paidUntil === null ? null : new Date(hall.state.paidUntil).toISOString(),
        daysCovered: hall.phase === "open" ? Math.floor(hall.state.treasury / c.lesche.upkeepPerDay) : 0,
      },
      givers: givers.map((g) => ({ playerId: g.playerId, name: g.name, total: Number(g.total) })),
      gifts: gifts.map((g) => ({ id: g.id, name: g.name, amount: g.amount, label: gameLabel(g.createdAt, ctx) })),
    };
  }

  return {
    now: now.toISOString(),
    rules: { foundCost: c.foundCost, foundPrestige: c.foundPrestige, memberCap: c.memberCap, nameMin: c.name.min, nameMax: c.name.max, postMaxChars: c.post.maxChars, cooldownHours: c.cooldownHours, absentLeaderDays: c.absentLeaderDays, depositMax: c.deposit.max, lescheCost: c.lesche.cost, lescheBuildDays: c.lesche.buildDays, lescheUpkeep: c.lesche.upkeepPerDay, lescheCap: c.lesche.memberCap },
    me: { playerId: ctx.playerId, role: own ? roleOf(own, ctx.playerId) : null, cooldownUntil: cooldown?.toISOString() ?? null, prestige: character?.prestige ?? 0, drachmae: character?.drachmae ?? 0 },
    // Each koinon's cap as it stands now (ruling 8): the Lesche's with an open hall.
    koina: live.map((k) => ({ id: k.row.id, name: k.row.name, leaderName: k.leaderName ?? "—", members: Number(k.members), cap: hallCap(hallPhaseAt(k.row, now), c) })),
    invites: invites.map((i) => ({ id: i.id, koinonId: i.koinonId, koinonName: i.koinonName, inviterName: i.inviterName, expiresAt: i.expiresAt.toISOString() })),
    koinon,
  };
}

// The Politics nav count (ruling 11), for /me/state: two lean counts and nothing
// else. A member's unread posts; a non-member's unexpired invites.
export async function koinonPendingCount(playerId: string, worldId: string, now: Date): Promise<number> {
  const unread = await unreadPosts(db, playerId, worldId);
  const invited = await db
    .select({ n: count() })
    .from(koinonInvites)
    .innerJoin(koina, eq(koina.id, koinonInvites.koinonId))
    .where(
      and(
        eq(koinonInvites.worldId, worldId),
        eq(koinonInvites.playerId, playerId),
        gt(koinonInvites.expiresAt, now),
        isNull(koina.dissolvedAt),
        sql`NOT EXISTS (SELECT 1 FROM koinon_members m WHERE m.world_id = ${worldId} AND m.player_id = ${playerId})`,
      ),
    );
  return unread + (invited[0]?.n ?? 0);
}

// --- Founding ------------------------------------------------------------------

export type FoundResult = KoinonError | { ok: true; koinonId: string; name: string; wallet: number };

// POST /api/koinon/found — ruling 2. Prestige is checked, not spent; the fee is
// a guarded debit paid into the world treasury. A refusal after the debit
// throws SpendRejected so nothing is written.
export async function foundKoinon(ctx: ActingContext, rawName: unknown, now: Date): Promise<FoundResult> {
  const c = getKoinonContent();
  return spendTransaction(ctx.playerId, async (tx) => {
    const character = await findCharacterRow(ctx.playerId, ctx.worldId, tx);
    if (!character) return fail(404, "No active character found.");
    if (character.classId === "slave") return fail(403, "The unfree may not found a koinon.");
    if (character.prestige < c.foundPrestige) return fail(403, `Founding a koinon needs prestige ${c.foundPrestige}.`);
    if (await memberRow(tx, ctx.playerId, ctx.worldId)) return fail(409, "You are already in a koinon.");
    const cooldown = await cooldownUntil(tx, ctx.playerId, now);
    if (cooldown) return fail(409, `You left a koinon too recently. You may found another in ${remainingText(cooldown.getTime() - now.getTime())}.`);
    const name = cleanKoinonName(rawName, c);
    if (!name) return fail(400, `A koinon's name runs ${c.name.min} to ${c.name.max} characters and needs a letter.`);
    const taken = fail(409, "A koinon already bears that name.");
    if (await liveNameTaken(tx, ctx.worldId, name, null)) return taken;

    const wallet = await debitDrachmae(tx, ctx.playerId, c.foundCost);
    if (wallet === null) throw new SpendRejected(fail(402, `You need ${c.foundCost} drachmae to found a koinon.`));
    await creditWorldTreasury(tx, ctx.worldId, c.foundCost);
    // Two founders racing for one name: the live-name index lets one row in.
    const founded = (await tx.insert(koina).values({ worldId: ctx.worldId, name, leaderPlayerId: ctx.playerId, leaderSince: now, foundedAt: now }).onConflictDoNothing().returning())[0];
    if (!founded) throw new SpendRejected(taken);
    const seated = await tx.insert(koinonMembers).values({ worldId: ctx.worldId, playerId: ctx.playerId, koinonId: founded.id, joinedAt: now, lastReadAt: now }).onConflictDoNothing().returning();
    if (!seated[0]) throw new SpendRejected(fail(409, "You are already in a koinon."));
    await tx.delete(koinonInvites).where(and(eq(koinonInvites.worldId, ctx.worldId), eq(koinonInvites.playerId, ctx.playerId)));
    await logKoinon(tx, ctx.playerId, ctx.worldId, "founded", name, now);
    return { ok: true as const, koinonId: founded.id, name, wallet };
  });
}

// --- Invites -------------------------------------------------------------------

export type InviteResult = KoinonError | { ok: true; invite: { id: string; playerName: string; expiresAt: string } };

// POST /api/koinon/invite — ruling 5: by exact name (ignoring case) in the world.
export async function invite(ctx: ActingContext, rawName: unknown, now: Date): Promise<InviteResult> {
  const c = getKoinonContent();
  const name = sanitizeDisplayName(rawName);
  if (!name) return fail(400, "Name the citizen to invite.");
  return withOwnKoinon(ctx, now, async (tx, k, role, settle) => {
    if (role === "member") return fail(403, "Only the leader and the vice may invite.");
    const target = (
      await tx
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(and(eq(players.worldId, ctx.worldId), eq(players.isActive, true), sql`lower(${players.name}) = lower(${name})`))
        .limit(1)
    )[0];
    const character = target ? await findCharacterRow(target.id, ctx.worldId, tx) : null;
    if (!target || !character) return fail(404, "No citizen bears that name.");
    if (character.classId === "slave") return fail(409, "The unfree cannot join a koinon.");
    if (await memberRow(tx, target.id, ctx.worldId)) return fail(409, "That citizen is already in a koinon.");
    // An expired invite still holds the (koinon, player) pair: clear it first.
    await tx.delete(koinonInvites).where(and(eq(koinonInvites.koinonId, k.id), eq(koinonInvites.playerId, target.id), lte(koinonInvites.expiresAt, now)));
    const standing = await tx.select({ playerId: koinonInvites.playerId }).from(koinonInvites).where(and(eq(koinonInvites.koinonId, k.id), gt(koinonInvites.expiresAt, now)));
    if (standing.some((s) => s.playerId === target.id)) return fail(409, "That citizen already holds your invitation.");
    // The cap in force: the Lesche's while the hall stands open (ruling 6).
    const cap = hallCap(settle.phase, c);
    if ((await seatCount(tx, k.id)) + standing.length >= cap) {
      // A shut hall may hold more than the plain cap: say why no one new is taken.
      if (settle.phase === "shut") return fail(409, `The Lesche is shut, so the koinon takes no one new past ${c.memberCap}.`);
      return fail(409, `The koinon is full: its members and standing invitations already number ${cap}.`);
    }
    const expiresAt = new Date(now.getTime() + c.inviteHours * MS_PER_HOUR);
    const row = (await tx.insert(koinonInvites).values({ worldId: ctx.worldId, koinonId: k.id, playerId: target.id, inviterPlayerId: ctx.playerId, createdAt: now, expiresAt }).returning())[0]!;
    return { ok: true as const, invite: { id: row.id, playerName: target.name, expiresAt: expiresAt.toISOString() } };
  });
}

export type OkResult = KoinonError | { ok: true };

// POST /api/koinon/withdraw — the leader or the vice takes back a pending invite.
export async function withdrawInvite(ctx: ActingContext, inviteId: string, now: Date): Promise<OkResult> {
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    if (role === "member") return fail(403, "Only the leader and the vice may withdraw an invitation.");
    const gone = await tx.delete(koinonInvites).where(and(eq(koinonInvites.id, inviteId), eq(koinonInvites.koinonId, k.id))).returning({ id: koinonInvites.id });
    return gone[0] ? { ok: true as const } : INVITE_GONE;
  });
}

async function ownInvite(exec: Exec, ctx: ActingContext, inviteId: string) {
  const rows = await exec
    .select()
    .from(koinonInvites)
    .where(and(eq(koinonInvites.id, inviteId), eq(koinonInvites.playerId, ctx.playerId), eq(koinonInvites.worldId, ctx.worldId)))
    .limit(1);
  return rows[0] ?? null;
}

export type AcceptResult = KoinonError | { ok: true; koinonId: string; name: string };

// POST /api/koinon/accept — ruling 5. The caller's player lock first (one player
// accepting two koina at once runs one after the other), then the koinon lock
// (two players accepting the last seat run one after the other). Under both the
// invite is read again, the seats are counted and the member row goes in; the
// (world_id, player_id) primary key is the last guard on one koinon per player.
export async function acceptInvite(ctx: ActingContext, inviteId: string, now: Date): Promise<AcceptResult> {
  const c = getKoinonContent();
  return db.transaction(async (tx) => {
    await lockPlayer(tx, ctx.playerId);
    const seen = await ownInvite(tx, ctx, inviteId);
    if (!seen) return INVITE_GONE;
    const locked = await lockKoinon(tx, seen.koinonId);
    const purged = locked ? await purgeInactive(tx, locked, now) : null;
    if (!purged) return fail(404, "That koinon is no more.");
    const { k, settle } = await settleHallLocked(tx, purged, now);
    // Read again under the lock: a withdraw or a dissolve may have run first.
    const invite = await ownInvite(tx, ctx, inviteId);
    if (!invite) return INVITE_GONE;
    if (invite.expiresAt.getTime() <= now.getTime()) return fail(409, "That invitation has expired.");
    const cooldown = await cooldownUntil(tx, ctx.playerId, now);
    if (cooldown) return fail(409, `You left a koinon too recently. You may join another in ${remainingText(cooldown.getTime() - now.getTime())}.`);
    if (await memberRow(tx, ctx.playerId, ctx.worldId)) return fail(409, "You are already in a koinon.");
    if ((await seatCount(tx, k.id)) >= hallCap(settle.phase, c)) return fail(409, "That koinon is full.");
    const seated = await tx.insert(koinonMembers).values({ worldId: ctx.worldId, playerId: ctx.playerId, koinonId: k.id, joinedAt: now, lastReadAt: now }).onConflictDoNothing().returning();
    if (!seated[0]) return fail(409, "You are already in a koinon.");
    // Every invite of this player goes, this one and the others.
    await tx.delete(koinonInvites).where(and(eq(koinonInvites.worldId, ctx.worldId), eq(koinonInvites.playerId, ctx.playerId)));
    await logKoinon(tx, ctx.playerId, ctx.worldId, "joined", k.name, now);
    return { ok: true as const, koinonId: k.id, name: k.name };
  });
}

// POST /api/koinon/decline — the invitee turns an invite down.
export async function declineInvite(ctx: ActingContext, inviteId: string): Promise<OkResult> {
  const seen = await ownInvite(db, ctx, inviteId);
  if (!seen) return INVITE_GONE;
  return db.transaction(async (tx) => {
    if (!(await lockKoinon(tx, seen.koinonId))) return INVITE_GONE;
    const gone = await tx.delete(koinonInvites).where(and(eq(koinonInvites.id, inviteId), eq(koinonInvites.playerId, ctx.playerId))).returning({ id: koinonInvites.id });
    return gone[0] ? { ok: true as const } : INVITE_GONE;
  });
}

// --- Leaving, expulsion and the lead -------------------------------------------

async function startCooldown(tx: DbTx, playerId: string, now: Date): Promise<Date> {
  const until = new Date(now.getTime() + getKoinonContent().cooldownHours * MS_PER_HOUR);
  await tx.update(players).set({ koinonCooldownUntil: until }).where(eq(players.id, playerId));
  return until;
}

export type LeaveResult = KoinonError | { ok: true; dissolved: boolean; cooldownUntil: string };

// POST /api/koinon/leave — rulings 6 and 7.
export async function leave(ctx: ActingContext, now: Date): Promise<LeaveResult> {
  return withOwnKoinon(ctx, now, async (tx, k) => {
    const after = await removeMember(tx, k, ctx.playerId, now);
    const until = await startCooldown(tx, ctx.playerId, now);
    await logKoinon(tx, ctx.playerId, ctx.worldId, "left", k.name, now);
    return { ok: true as const, dissolved: after.dissolvedAt !== null, cooldownUntil: until.toISOString() };
  });
}

// POST /api/koinon/expel — the leader removes another member.
export async function expel(ctx: ActingContext, playerId: string, now: Date): Promise<OkResult> {
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    if (role !== "leader") return fail(403, "Only the leader may expel.");
    if (playerId === ctx.playerId) return fail(409, "The leader cannot expel himself.");
    const target = await memberRow(tx, playerId, ctx.worldId);
    if (!target || target.koinonId !== k.id) return NO_MEMBER;
    await removeMember(tx, k, playerId, now);
    await startCooldown(tx, playerId, now);
    await logKoinon(tx, playerId, ctx.worldId, "expelled", k.name, now);
    return { ok: true as const };
  });
}

// POST /api/koinon/vice — the leader names a member vice, or clears the seat.
export async function setVice(ctx: ActingContext, playerId: string | null, now: Date): Promise<OkResult> {
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    if (role !== "leader") return fail(403, "Only the leader names the vice.");
    if (playerId !== null) {
      if (playerId === ctx.playerId) return fail(409, "The leader cannot be his own vice.");
      const target = await memberRow(tx, playerId, ctx.worldId);
      if (!target || target.koinonId !== k.id) return NO_MEMBER;
    }
    await tx.update(koina).set({ vicePlayerId: playerId }).where(eq(koina.id, k.id));
    return { ok: true as const };
  });
}

// POST /api/koinon/handover — the leader makes another member the leader and
// stays on as a member.
export async function handOver(ctx: ActingContext, playerId: string, now: Date): Promise<OkResult> {
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    if (role !== "leader") return fail(403, "Only the leader may hand over the lead.");
    if (playerId === ctx.playerId) return fail(409, "You already lead.");
    const target = await memberRow(tx, playerId, ctx.worldId);
    if (!target || target.koinonId !== k.id) return NO_MEMBER;
    await tx.update(koina).set({ leaderPlayerId: playerId, vicePlayerId: k.vicePlayerId === playerId ? null : k.vicePlayerId, leaderSince: now }).where(eq(koina.id, k.id));
    await logKoinon(tx, playerId, ctx.worldId, "leader", k.name, now);
    return { ok: true as const };
  });
}

// POST /api/koinon/take-lead — ruling 8: the vice (with no vice, the
// longest-standing other member) replaces a leader absent for the content's days.
export async function takeLead(ctx: ActingContext, now: Date): Promise<OkResult> {
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    if (role === "leader" || (await leadClaimant(tx, k)) !== ctx.playerId) return fail(403, "The lead is not yours to take.");
    if (!(await leaderIsAbsent(tx, k, now))) return fail(409, "The leader has been seen too recently.");
    await tx.update(koina).set({ leaderPlayerId: ctx.playerId, vicePlayerId: k.vicePlayerId === ctx.playerId ? null : k.vicePlayerId, leaderSince: now }).where(eq(koina.id, k.id));
    await logKoinon(tx, ctx.playerId, ctx.worldId, "leader", k.name, now);
    return { ok: true as const };
  });
}

// --- The board -----------------------------------------------------------------

export type PostResult = KoinonError | { ok: true; postId: string };

// POST /api/koinon/post — ruling 10. The koinon keeps its newest `post.kept`.
export async function post(ctx: ActingContext, rawBody: unknown, now: Date): Promise<PostResult> {
  const c = getKoinonContent();
  const body = cleanKoinonPost(rawBody, c);
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    if (role === "member") return fail(403, "Only the leader and the vice may post.");
    if (!body) return fail(400, `A post runs 1 to ${c.post.maxChars} characters.`);
    const row = (await tx.insert(koinonPosts).values({ koinonId: k.id, authorPlayerId: ctx.playerId, body, createdAt: now }).returning({ id: koinonPosts.id }))[0]!;
    const kept = await tx
      .select({ id: koinonPosts.id })
      .from(koinonPosts)
      .where(eq(koinonPosts.koinonId, k.id))
      .orderBy(desc(koinonPosts.createdAt), desc(koinonPosts.id))
      .limit(c.post.kept);
    await tx.delete(koinonPosts).where(and(eq(koinonPosts.koinonId, k.id), notInArray(koinonPosts.id, kept.map((p) => p.id))));
    return { ok: true as const, postId: row.id };
  });
}

// POST /api/koinon/post/delete — an author deletes his own post; the leader any.
export async function deletePost(ctx: ActingContext, postId: string, now: Date): Promise<OkResult> {
  return withOwnKoinon(ctx, now, async (tx, k, role) => {
    const found = (await tx.select().from(koinonPosts).where(and(eq(koinonPosts.id, postId), eq(koinonPosts.koinonId, k.id))).limit(1))[0];
    if (!found) return fail(404, "That post is gone.");
    if (role !== "leader" && found.authorPlayerId !== ctx.playerId) return fail(403, "That post is not yours to delete.");
    await tx.delete(koinonPosts).where(eq(koinonPosts.id, postId));
    return { ok: true as const };
  });
}

// --- The treasury --------------------------------------------------------------

export type GiveResult = KoinonError | { ok: true; wallet: number; treasury: number };

// POST /api/koinon/give — ruling 1: a member gives drachmae from his own wallet
// into the treasury. Nothing ever comes back out. The giver's player lock
// first (spendTransaction), then the koinon lock (inOwnKoinon): the order the
// rule above lockKoinon allows. The hall settles before the credit and again
// after it, so a hall that ran dry pays nothing for the days it stood shut and
// reopens on the gift that refills it. A short wallet throws, so nothing is
// written. The gift is a koinon_deposits row and a plain effect_log row with no
// chronicle block, as a market trade is.
export async function giveToKoinon(ctx: ActingContext, amount: unknown, now: Date): Promise<GiveResult> {
  const c = getKoinonContent();
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > c.deposit.max) {
    return fail(400, `Give a whole amount from 1 to ${c.deposit.max.toLocaleString("en-US")} drachmae.`);
  }
  return spendTransaction(ctx.playerId, (tx) =>
    inOwnKoinon(tx, ctx, now, async (tx, k) => {
      const wallet = await debitDrachmae(tx, ctx.playerId, amount);
      if (wallet === null) {
        const held = (await findCharacterRow(ctx.playerId, ctx.worldId, tx))?.drachmae ?? 0;
        throw new SpendRejected(fail(402, `You hold only ${held} drachmae.`));
      }
      const credited = (await tx.update(koina).set({ treasury: sql`${koina.treasury} + ${amount}` }).where(eq(koina.id, k.id)).returning())[0]!;
      const { k: after } = await settleHallLocked(tx, credited, now);
      await tx.insert(koinonDeposits).values({ koinonId: k.id, playerId: ctx.playerId, amount, createdAt: now });
      const character = await findCharacterRow(ctx.playerId, ctx.worldId, tx);
      if (character) {
        const detail: KoinonDepositDetail = { koinonId: k.id, koinonName: k.name, amount, treasuryAfter: after.treasury };
        await tx.insert(effectLog).values({ characterId: character.id, kind: "koinon_deposit", detail, createdAt: now });
      }
      return { ok: true as const, wallet, treasury: after.treasury };
    }),
  );
}

export type BuildLescheResult = KoinonError | { ok: true; completesAt: string; treasury: number };

// POST /api/koinon/lesche — ruling 3: the leader orders the koinon's hall. Paid
// from the treasury at the order (a guarded debit; the money is spent, it goes
// nowhere), standing `buildDays` later. One per koinon, no cancel, no refund.
// Upkeep starts when it stands: lesche_paid_until begins at lesche_completes_at.
export async function buildLesche(ctx: ActingContext, now: Date): Promise<BuildLescheResult> {
  const c = getKoinonContent();
  return withOwnKoinon(ctx, now, async (tx, k, role, settle) => {
    if (role !== "leader") return fail(403, "Only the leader may order the Lesche.");
    if (settle.phase === "building") return fail(409, "The Lesche is already being built.");
    if (settle.phase !== "none") return fail(409, "The koinon already has its Lesche.");
    const short = fail(409, `The treasury holds ${k.treasury} drachmae. The Lesche costs ${c.lesche.cost}.`);
    if (k.treasury < c.lesche.cost) return short;
    const completesAt = new Date(now.getTime() + c.lesche.buildDays * MS_PER_DAY);
    const built = await tx
      .update(koina)
      .set({ treasury: sql`${koina.treasury} - ${c.lesche.cost}`, lescheStartedAt: now, lescheCompletesAt: completesAt, leschePaidUntil: completesAt, lescheShut: false })
      .where(and(eq(koina.id, k.id), gte(koina.treasury, c.lesche.cost)))
      .returning();
    if (!built[0]) return short;
    await logKoinon(tx, ctx.playerId, ctx.worldId, "lesche", k.name, now);
    return { ok: true as const, completesAt: completesAt.toISOString(), treasury: built[0].treasury };
  });
}

// POST /api/koinon/read — the caller has read the board up to now.
export async function markRead(ctx: ActingContext, now: Date): Promise<OkResult> {
  const stamped = await db
    .update(koinonMembers)
    .set({ lastReadAt: now })
    .where(and(eq(koinonMembers.worldId, ctx.worldId), eq(koinonMembers.playerId, ctx.playerId)))
    .returning({ playerId: koinonMembers.playerId });
  return stamped[0] ? { ok: true as const } : NOT_MEMBER;
}

// --- Admin (routes/admin.ts) ---------------------------------------------------
// The list, a rename and a dissolve. `record` writes the admin_audit row inside
// the same transaction as the change. Admin sees no posts.

export type AdminKoinonRow = { id: string; name: string; leaderName: string; members: number; foundedAt: string; treasury: number; hall: HallPhase };

// GET /admin/koina — the world's live koina, by name.
export async function adminKoinaList(worldId: string, now: Date = new Date()): Promise<AdminKoinonRow[]> {
  const upkeep = getKoinonContent().lesche.upkeepPerDay;
  const rows = await db
    .select({ row: koina, leaderName: players.name, members: sql<number>`(SELECT count(*)::int FROM koinon_members m WHERE m.koinon_id = ${koina.id})` })
    .from(koina)
    .leftJoin(players, eq(players.id, koina.leaderPlayerId))
    .where(and(eq(koina.worldId, worldId), isNull(koina.dissolvedAt)))
    .orderBy(sql`lower(${koina.name})`, asc(koina.id));
  // The treasury and the hall's phase as a settle at `now` would leave them; read-only.
  return rows.map((r) => {
    const hall = settleHall(hallStateOf(r.row), now.getTime(), upkeep);
    return { id: r.row.id, name: r.row.name, leaderName: r.leaderName ?? "—", members: Number(r.members), foundedAt: r.row.foundedAt.toISOString(), treasury: hall.state.treasury, hall: hall.phase };
  });
}

const NO_KOINON = fail(404, "No such koinon.");
const NAME_TAKEN = fail(409, "A koinon already bears that name.");

// Postgres unique_violation, bare or wrapped by the driver layer.
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export type AdminRenameResult = KoinonError | { ok: true; from: string; to: string };

// POST /admin/koina/:id/rename — the founding's cleaning and uniqueness, under
// the koinon lock. Two renames racing for one name: the live-name index lets one in.
export async function adminRenameKoinon(koinonId: string, rawName: unknown, record: (tx: DbTx, detail: { from: string; to: string }) => Promise<void>): Promise<AdminRenameResult> {
  const c = getKoinonContent();
  const name = cleanKoinonName(rawName, c);
  if (!name) return fail(400, `A koinon's name runs ${c.name.min} to ${c.name.max} characters and needs a letter.`);
  try {
    return await db.transaction(async (tx) => {
      const k = await lockKoinon(tx, koinonId);
      if (!k) return NO_KOINON;
      if (await liveNameTaken(tx, k.worldId, name, k.id)) return NAME_TAKEN;
      await tx.update(koina).set({ name }).where(eq(koina.id, k.id));
      await record(tx, { from: k.name, to: name });
      return { ok: true as const, from: k.name, to: name };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return NAME_TAKEN;
    throw error;
  }
}

export type AdminDissolveResult = KoinonError | { ok: true; name: string; memberIds: string[]; treasuryToCity: number };

// POST /admin/koina/:id/dissolve — ruling 15: every member goes, with no
// cooldown and no Chronicle line.
export async function adminDissolveKoinon(koinonId: string, now: Date, record: (tx: DbTx, detail: { name: string; memberIds: string[]; treasuryToCity: number }) => Promise<void>): Promise<AdminDissolveResult> {
  return db.transaction(async (tx) => {
    const k = await lockKoinon(tx, koinonId);
    if (!k) return NO_KOINON;
    const memberIds = (await membersInOrder(tx, k.id)).map((m) => m.playerId);
    const { treasuryToCity } = await dissolve(tx, k, now);
    await record(tx, { name: k.name, memberIds, treasuryToCity });
    return { ok: true as const, name: k.name, memberIds, treasuryToCity };
  });
}

// --- The leader's view of the members' soldiers --------------------------------
// Ruling 12: live and read-only. Nothing here settles another player or writes
// a row; what the member's own next settle would do (an arrival, a finished
// training, a contract run out, a year of levy growth) is derived at read time.
// A row disbanded for unpaid upkeep stays visible until its owner next opens
// the game: that gap is accepted.

type UnitRow = typeof playerUnits.$inferSelect;
export type ArmyUnitRow = Pick<UnitRow, "source" | "unitId" | "count" | "readyAt" | "contractEndAt" | "basedAt" | "movingTo" | "arrivesAt" | "mission">;

export type DerivedArmyRow =
  | { state: "gone" }
  | { state: "home"; placeId: string }
  | { state: "away"; movingTo: string; arrivesAt: Date }
  | { state: "training"; readyAt: Date | null };

// Where a row stands at `now`, from its own timers:
//   - a band whose contract_end_at has passed is gone (left out);
//   - a row still short of arrives_at is away;
//   - a row whose arrives_at has passed stands at moving_to;
//   - a trained row short of ready_at is in training;
//   - anything else stands at home, at its place.
export function deriveArmyRow(row: ArmyUnitRow, now: Date): DerivedArmyRow {
  const t = now.getTime();
  if (row.count <= 0) return { state: "gone" };
  if (row.source === "band" && row.contractEndAt !== null && row.contractEndAt.getTime() <= t) return { state: "gone" };
  const marching = row.movingTo !== null && row.arrivesAt !== null;
  if (marching && row.arrivesAt!.getTime() > t) return { state: "away", movingTo: row.movingTo!, arrivesAt: row.arrivesAt! };
  if (row.source === "trained" && (row.readyAt === null || row.readyAt.getTime() > t)) return { state: "training", readyAt: row.readyAt };
  return { state: "home", placeId: marching ? row.movingTo! : row.basedAt };
}

// The levy as the member's next settle would leave it: `men` plus the whole
// years of base growth since last_growth_season (ensureLevy's step, without the
// held-region bonus); with no row yet, what ensureLevy would insert.
export function projectLevy(row: { men: number; lastGrowthSeason: number } | null, season: number, levy: { startMen: number; growthPerYear: number; seasonsPerYear: number }): number {
  if (!row) return levy.startMen + levy.growthPerYear * Math.floor(season / levy.seasonsPerYear);
  const years = Math.floor((season - row.lastGrowthSeason) / levy.seasonsPerYear);
  return row.men + Math.max(0, years) * levy.growthPerYear;
}

export type ArmyRow = { unitId: string; label: string; plural: string; icon: string; source: "trained" | "band"; count: number };
// What an away row is doing, in the Barracks' own terms: bound for its target
// (scout, raid, attack, move) or on the way back (`return`, from targetName
// when the mission names one).
export type ArmyMissionKind = "scout" | "raid" | "attack" | "move" | "return";
export type ArmiesView = {
  now: string;
  members: {
    playerId: string;
    name: string;
    levy: number;
    fleet: { pentekonters: number; triremes: number };
    home: { placeId: string; placeName: string; rows: ArmyRow[] }[];
    away: (ArmyRow & { missionKind: ArmyMissionKind; targetName: string | null; arrivesAt: string })[];
    training: (ArmyRow & { readyAt: string | null })[];
  }[];
};

// GET /api/koinon/armies — leader only.
export async function memberArmies(ctx: ActingContext, now: Date): Promise<KoinonError | ArmiesView> {
  await sweepInactive(ctx.worldId, now);
  const mine = await memberRow(db, ctx.playerId, ctx.worldId);
  if (!mine) return NOT_MEMBER;
  const k = (await db.select().from(koina).where(and(eq(koina.id, mine.koinonId), isNull(koina.dissolvedAt))).limit(1))[0];
  if (!k) return NOT_MEMBER;
  if (k.leaderPlayerId !== ctx.playerId) return fail(403, "Only the leader sees the soldiers.");

  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const topology = getTopology();
  const massalia = topology.massaliaRegion;
  const season = seasonIndexAt(now.getTime(), ctx.worldStartedMs);
  const names = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (!names.has(id)) names.set(id, topology.townRegion.has(id) ? await townDisplayName(id) : await regionDisplayName(id));
    return names.get(id)!;
  };
  const armyRow = (r: ArmyUnitRow): ArmyRow => {
    const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
    const label = def?.label ?? r.unitId;
    return { unitId: r.unitId, label, plural: r.source === "trained" ? (unitDef(unitsC, r.unitId)?.plural ?? `${label}s`) : label, icon: def?.icon ?? "", source: r.source, count: r.count };
  };

  const members: ArmiesView["members"] = [];
  for (const m of await memberViews(db, k, ctx, now)) {
    const rows = await db
      .select()
      .from(playerUnits)
      .where(and(eq(playerUnits.worldId, ctx.worldId), eq(playerUnits.ownerPlayerId, m.playerId)))
      .orderBy(asc(playerUnits.createdAt), asc(playerUnits.id));
    const levyRow = (await db.select().from(playerLevy).where(and(eq(playerLevy.worldId, ctx.worldId), eq(playerLevy.ownerPlayerId, m.playerId))).limit(1))[0] ?? null;
    const stock = await db
      .select({ type: resources.type, amount: resources.amount })
      .from(resources)
      .where(and(eq(resources.scope, "player"), eq(resources.scopeId, m.playerId), inArray(resources.type, ["trade-ship", "galley"])));
    const hulls = (type: string) => Math.max(0, Math.floor(Number(stock.find((s) => s.type === type)?.amount ?? 0)));

    const places = new Map<string, ArmyRow[]>();
    const away: ArmiesView["members"][number]["away"] = [];
    const training: ArmiesView["members"][number]["training"] = [];
    for (const r of rows) {
      const d = deriveArmyRow(r, now);
      if (d.state === "gone") continue;
      if (d.state === "training") {
        training.push({ ...armyRow(r), readyAt: d.readyAt?.toISOString() ?? null });
      } else if (d.state === "away") {
        const targetId = r.mission ? (r.mission.townId ?? r.mission.regionId) : null;
        const outbound = r.mission !== null && targetId === d.movingTo;
        away.push({ ...armyRow(r), missionKind: outbound ? r.mission!.kind : "return", targetName: targetId ? await nameOf(targetId) : null, arrivesAt: d.arrivesAt.toISOString() });
      } else {
        // One line per unit at a place, as the owner's settle folds trained rows.
        const here = places.get(d.placeId) ?? [];
        const same = r.source === "trained" ? here.find((x) => x.source === "trained" && x.unitId === r.unitId) : undefined;
        if (same) same.count += r.count;
        else here.push(armyRow(r));
        places.set(d.placeId, here);
      }
    }
    const home: ArmiesView["members"][number]["home"] = [];
    for (const [placeId, placeRows] of places) home.push({ placeId, placeName: await nameOf(placeId), rows: placeRows });
    // Massalia first, then the rest by name: the Barracks' At home order.
    home.sort((a, b) => Number(b.placeId === massalia) - Number(a.placeId === massalia) || a.placeName.localeCompare(b.placeName) || a.placeId.localeCompare(b.placeId));

    members.push({
      playerId: m.playerId,
      name: m.name,
      levy: projectLevy(levyRow, season, unitsC.levy),
      fleet: { pentekonters: hulls("trade-ship"), triremes: hulls("galley") },
      home,
      away,
      training,
    });
  }
  return { now: now.toISOString(), members };
}
