import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { adminAudit, authEvents, createDb, effectLog, interactions, playerCharacters, playerLevy, playerPops, playerUnits, players, resources, sessions, users, type DbExec } from "@massalia/db";
import { bandDef, hasLetter, sanitizeDisplayName, unitDef, type PopType } from "@massalia/shared";
import { requireAdmin } from "../services/auth.js";
import { gateFor, getBandsContent, getBattleContent, getUnitsContent, isPledged, massaliaRegionId, PLEDGED_REFUSAL, seasonFor } from "../services/barracks.js";
import { referralsOf } from "../services/referrals.js";
import { buildingContext, creditResource, debitResource, getBuildingsContent, getOrCreateResource, getPopsContent, settleAll, type ActingContext } from "../services/buildings.js";
import { applyComposureDelta } from "../services/composure.js";
import { getActiveWorldId } from "../services/character.js";
import { adminDissolveKoinon, adminKoinaList, adminRenameKoinon } from "../services/koinon.js";
import { lockPlayer } from "../services/lock.js";
import { nameTaken } from "../services/playerNames.js";

// ---------------------------------------------------------------------------
// Admin API (/admin/*). Every route: requireAdmin (is_admin + a valid, unbanned
// session), the global limiter's mutation budget (rateLimit.ts covers /admin/),
// and ONE admin_audit row per call — reads included — written in the same
// transaction as the change where there is one.
// ---------------------------------------------------------------------------

const db = createDb();

const CLUSTER_WINDOW_DAYS = 30;
const LIST_LIMIT = 100;
const LOG_LIMIT = 200;

// The four leadership stats (CHECK 0..100 since migration 0014).
const STATS = ["prestige", "devotion", "militia", "intelligence"] as const;
type Stat = (typeof STATS)[number];
const STAT_MIN = 0;
const STAT_MAX = 100;

function httpError(message: string, statusCode: number): never {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  throw error;
}

async function audit(exec: DbExec, adminUserId: string, action: string, targetUserId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await exec.insert(adminAudit).values({ adminUserId, action, targetUserId, detail });
}

const uuidParam = (name: string) => ({
  params: { type: "object", required: [name], properties: { [name]: { type: "string", format: "uuid" } } },
}) as const;
const uuidParams = (...names: string[]) => ({
  params: { type: "object", required: names, properties: Object.fromEntries(names.map((name) => [name, { type: "string", format: "uuid" }])) },
}) as const;

type UserRow = typeof users.$inferSelect;

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt,
    emailVerifiedAt: row.emailVerifiedAt,
    deletedAt: row.deletedAt,
    isAdmin: row.isAdmin,
    bannedAt: row.bannedAt,
    banReason: row.banReason,
  };
}

type AdminCharacterRow = { characterId: string; playerId: string; worldId: string; name: string; drachmae: number; status: string; isActive: boolean } & Record<Stat, number>;

// The character rows (player + character) behind a set of users, for the list view.
async function charactersOf(userIds: string[]) {
  if (!userIds.length) return new Map<string, AdminCharacterRow[]>();
  const rows = await db
    .select({
      userId: players.userId,
      playerId: players.id,
      worldId: players.worldId,
      name: players.name,
      isActive: players.isActive,
      characterId: playerCharacters.id,
      drachmae: playerCharacters.drachmae,
      status: playerCharacters.status,
      prestige: playerCharacters.prestige,
      devotion: playerCharacters.devotion,
      militia: playerCharacters.militia,
      intelligence: playerCharacters.intelligence,
    })
    .from(players)
    .innerJoin(playerCharacters, eq(playerCharacters.playerId, players.id))
    .where(inArray(players.userId, userIds));
  const byUser = new Map<string, AdminCharacterRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push({
      characterId: row.characterId, playerId: row.playerId, worldId: row.worldId, name: row.name, drachmae: row.drachmae, status: row.status, isActive: row.isActive,
      prestige: row.prestige, devotion: row.devotion, militia: row.militia, intelligence: row.intelligence,
    });
    byUser.set(row.userId, list);
  }
  return byUser;
}

// Last login/register event per user (time + ip), for the list view.
async function lastSeenOf(userIds: string[]) {
  if (!userIds.length) return new Map<string, { at: Date; ip: string | null }>();
  const rows = await db
    .select({ userId: authEvents.userId, at: sql<Date>`max(${authEvents.createdAt})`, ip: sql<string | null>`(array_agg(host(${authEvents.ip}) ORDER BY ${authEvents.createdAt} DESC))[1]` })
    .from(authEvents)
    .where(and(inArray(authEvents.userId, userIds), inArray(authEvents.kind, ["register", "login"])))
    .groupBy(authEvents.userId);
  return new Map(rows.map((row) => [row.userId, { at: row.at, ip: row.ip }]));
}

// A character's player row (for the lock) — 404 when unknown.
async function characterOwner(characterId: string) {
  const rows = await db
    .select({ characterId: playerCharacters.id, playerId: playerCharacters.playerId, worldId: playerCharacters.worldId, userId: players.userId, name: players.name })
    .from(playerCharacters)
    .innerJoin(players, eq(players.id, playerCharacters.playerId))
    .where(eq(playerCharacters.id, characterId))
    .limit(1);
  return rows[0] ?? httpError("No such character.", 404);
}

async function userById(userId: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? httpError("No such user.", 404);
}

function reasonOf(request: FastifyRequest, required: boolean): string {
  const body = request.body as { reason?: unknown } | undefined;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (required && !reason) httpError("A reason is required.", 400);
  return reason;
}

// A relative adjustment: a non-zero whole number within ±max.
function deltaOf(request: FastifyRequest, max: number): number {
  const body = request.body as { delta?: unknown } | undefined;
  const delta = body?.delta;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > max) {
    httpError(`delta must be a non-zero whole number within ±${max.toLocaleString("en-US")}.`, 400);
  }
  return delta;
}

function bodyText(request: FastifyRequest, key: string): string {
  const value = (request.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

const capitalise = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const goodLabel = (good: string) => getBuildingsContent().goodLabels?.[good] ?? capitalise(good);

type Owner = Awaited<ReturnType<typeof characterOwner>>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A goods or household edit is a checkpoint, as hire and dismiss are: the player's
// economy settles up to now under the lock first, so pending output banks and past
// wages and food are charged at the pre-edit counts; the edit applies on top, in the
// same transaction. Shrine composure banked by the settle is applied after the
// transaction, break-aware, as collect does.
async function settledEdit<T>(owner: Owner, edit: (tx: Tx, now: Date, ctx: ActingContext) => Promise<T>): Promise<T> {
  const ctx = (await buildingContext(owner.playerId, owner.worldId)) ?? httpError("No such world.", 404);
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    await lockPlayer(tx, owner.playerId);
    const settled = await settleAll(tx, ctx, now);
    return { composureDays: settled.composureDays, result: await edit(tx, now, ctx) };
  });
  if (outcome.composureDays > 0) await applyComposureDelta(owner.characterId, outcome.composureDays, "building:shrine", now);
  return outcome.result;
}

// The sheet's Military block, as stored (no settle): the levy, the altar and every
// unit row with its state in a fixed precedence. A row that has arrived since the
// player's last load reads as home and editable, standing where it was bound; the
// edit's own settle lands it first. A muster mission is "pledged"; every other
// mission travels with movingTo until the settle clears both.
async function militaryBlock(owner: Owner, now: Date) {
  const unitsC = getUnitsContent();
  const bandsC = getBandsContent();
  const rows = await db
    .select()
    .from(playerUnits)
    .where(and(eq(playerUnits.worldId, owner.worldId), eq(playerUnits.ownerPlayerId, owner.playerId)))
    .orderBy(playerUnits.createdAt);
  const units = rows.map((r) => {
    const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
    const marching = r.movingTo !== null && r.arrivesAt !== null && r.arrivesAt.getTime() > now.getTime();
    const state: "pledged" | "moving" | "training" | "ready" = isPledged(r)
      ? "pledged"
      : marching
        ? "moving"
        : r.source === "trained" && r.readyAt !== null && r.readyAt.getTime() > now.getTime()
          ? "training"
          : "ready";
    return {
      id: r.id,
      source: r.source,
      unitId: r.unitId,
      label: def?.label ?? r.unitId,
      count: r.count,
      startCount: r.startCount,
      state,
      readyAt: r.readyAt?.toISOString() ?? null,
      contractEndAt: r.contractEndAt?.toISOString() ?? null,
      basedAt: !marching && r.movingTo !== null ? r.movingTo : r.basedAt,
      movingTo: r.movingTo,
      arrivesAt: r.arrivesAt?.toISOString() ?? null,
      editable: state !== "pledged" && state !== "moving",
    };
  });
  const [levy] = await db.select({ men: playerLevy.men }).from(playerLevy).where(and(eq(playerLevy.worldId, owner.worldId), eq(playerLevy.ownerPlayerId, owner.playerId))).limit(1);
  const [player] = await db.select({ altarUntil: players.altarUntil, altarGood: players.altarGood }).from(players).where(eq(players.id, owner.playerId)).limit(1);
  const lit = player?.altarUntil && player.altarGood && player.altarUntil.getTime() > now.getTime();
  const altar = lit ? { good: player.altarGood!, mor: getBattleContent().altar.goods[player.altarGood!] ?? 0, until: player.altarUntil!.toISOString() } : null;
  return { levy: { men: levy?.men ?? 0 }, altar, units };
}

export async function adminRoutes(app: FastifyInstance) {
  // --- Users -----------------------------------------------------------------
  // ?q= matches the email or a character name (case-insensitive substring);
  // ?banned=true|false filters; ?verified=true|false filters.
  app.get("/users", async (request) => {
    const admin = await requireAdmin(request);
    const query = request.query as { q?: string; banned?: string; verified?: string; limit?: string };
    const q = (query.q ?? "").trim().slice(0, 100);
    const limit = Math.min(LIST_LIMIT, Math.max(1, Number(query.limit) || LIST_LIMIT));
    const filters = [isNull(users.deletedAt)];
    if (query.banned === "true") filters.push(isNotNull(users.bannedAt));
    if (query.banned === "false") filters.push(isNull(users.bannedAt));
    if (query.verified === "true") filters.push(isNotNull(users.emailVerifiedAt));
    if (query.verified === "false") filters.push(isNull(users.emailVerifiedAt));
    if (q) {
      const named = db.select({ userId: players.userId }).from(players).where(ilike(players.name, `%${q}%`));
      filters.push(or(ilike(users.email, `%${q}%`), inArray(users.id, named))!);
    }
    const rows = await db.select().from(users).where(and(...filters)).orderBy(desc(users.createdAt)).limit(limit);
    const ids = rows.map((row) => row.id);
    const [chars, seen, referred] = await Promise.all([charactersOf(ids), lastSeenOf(ids), referralsOf(ids)]);
    await audit(db, admin.id, "users.list", null, { q, banned: query.banned ?? null, verified: query.verified ?? null, returned: rows.length });
    return {
      users: rows.map((row) => ({
        ...publicUser(row),
        lastSeenAt: seen.get(row.id)?.at ?? null,
        lastIp: seen.get(row.id)?.ip ?? null,
        characters: chars.get(row.id) ?? [],
        // The invite promo: who invited this account, and how many it invited.
        referredBy: referred.get(row.id)?.referredBy ?? null,
        referralsMade: referred.get(row.id)?.referralsMade ?? 0,
      })),
    };
  });

  // Same-IP cluster: every other user who registered or logged in from an IP this
  // user registered or logged in from, within the last 30 days.
  app.get("/users/:userId/cluster", { schema: uuidParam("userId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const user = await userById(userId);
    const window = sql`now() - make_interval(days => ${CLUSTER_WINDOW_DAYS})`;
    const mine = await db
      .selectDistinct({ ip: sql<string>`host(${authEvents.ip})` })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), inArray(authEvents.kind, ["register", "login"]), isNotNull(authEvents.ip), sql`${authEvents.createdAt} > ${window}`));
    const ips = mine.map((row) => row.ip);
    let related: { userId: string; email: string; bannedAt: Date | null; sharedIps: string[]; lastSeenAt: Date }[] = [];
    if (ips.length) {
      const rows = await db.execute(sql`
        SELECT e.user_id AS "userId", u.email, u.banned_at AS "bannedAt",
               array_agg(DISTINCT host(e.ip)) AS "sharedIps", max(e.created_at) AS "lastSeenAt"
        FROM auth_events e
        JOIN users u ON u.id = e.user_id
        WHERE e.user_id <> ${userId}
          AND e.kind IN ('register', 'login')
          AND e.created_at > ${window}
          AND host(e.ip) IN (${sql.join(ips.map((ip) => sql`${ip}`), sql`, `)})
        GROUP BY e.user_id, u.email, u.banned_at
        ORDER BY "lastSeenAt" DESC
        LIMIT ${LIST_LIMIT}
      `);
      related = (rows.rows as unknown as typeof related).map((row) => ({ ...row, bannedAt: row.bannedAt ? new Date(row.bannedAt) : null, lastSeenAt: new Date(row.lastSeenAt) }));
    }
    await audit(db, admin.id, "users.cluster", userId, { ips: ips.length, related: related.length });
    return { user: publicUser(user), windowDays: CLUSTER_WINDOW_DAYS, ips, related };
  });

  app.post("/users/:userId/ban", { schema: uuidParam("userId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const reason = reasonOf(request, true);
    const target = await userById(userId);
    if (target.id === admin.id) httpError("You cannot ban yourself.", 409);
    if (target.isAdmin) httpError("Revoke the admin flag before banning an admin.", 409);
    const bannedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.update(users).set({ bannedAt, banReason: reason }).where(eq(users.id, userId));
      // A ban also ends every live session so the client sees the reason at once.
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await audit(tx, admin.id, "users.ban", userId, { reason, previouslyBannedAt: target.bannedAt });
    });
    return { ok: true, bannedAt, reason };
  });

  app.post("/users/:userId/unban", { schema: uuidParam("userId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const reason = reasonOf(request, false);
    const target = await userById(userId);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ bannedAt: null, banReason: null }).where(eq(users.id, userId));
      await audit(tx, admin.id, "users.unban", userId, { reason, previousReason: target.banReason, previouslyBannedAt: target.bannedAt });
    });
    return { ok: true };
  });

  // Manual email verification, for a player whose verification link expired
  // before they could use it. Idempotent: COALESCE keeps the first timestamp,
  // and a repeat call still writes its audit row.
  app.post("/users/:userId/verify", { schema: uuidParam("userId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const reason = reasonOf(request, false);
    const target = await userById(userId);
    const emailVerifiedAt = await db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({ emailVerifiedAt: sql`COALESCE(${users.emailVerifiedAt}, now())` })
        .where(eq(users.id, userId))
        .returning({ emailVerifiedAt: users.emailVerifiedAt });
      await audit(tx, admin.id, "users.verify", userId, { reason, previouslyVerifiedAt: target.emailVerifiedAt });
      return updated[0]!.emailVerifiedAt;
    });
    return { ok: true, emailVerifiedAt };
  });

  app.post("/users/:userId/sessions/delete", { schema: uuidParam("userId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { userId } = request.params as { userId: string };
    await userById(userId);
    const deleted = await db.transaction(async (tx) => {
      const gone = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
      await audit(tx, admin.id, "users.sessions.delete", userId, { deleted: gone.length });
      return gone.length;
    });
    return { ok: true, deleted };
  });

  // --- Characters --------------------------------------------------------------
  // Relative wallet adjustment under the player lock; never below zero.
  app.post("/characters/:characterId/drachmae", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const delta = deltaOf(request, 1_000_000);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const drachmae = await db.transaction(async (tx) => {
      await lockPlayer(tx, owner.playerId);
      const updated = await tx
        .update(playerCharacters)
        .set({ drachmae: sql`${playerCharacters.drachmae} + ${delta}` })
        .where(and(eq(playerCharacters.id, characterId), sql`${playerCharacters.drachmae} + ${delta} >= 0`))
        .returning({ drachmae: playerCharacters.drachmae });
      if (!updated.length) httpError("That adjustment would take the wallet below zero.", 409);
      await tx.insert(effectLog).values({ characterId, kind: "admin_adjust_drachmae", detail: { delta, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.drachmae", owner.userId, { characterId, delta, reason, drachmae: updated[0]!.drachmae });
      return updated[0]!.drachmae;
    });
    return { ok: true, characterId, drachmae };
  });

  // Rename through the same sanitiser and per-world uniqueness as creation.
  app.post("/characters/:characterId/rename", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const body = request.body as { name?: unknown } | undefined;
    const name = sanitizeDisplayName(body?.name);
    if (!name) httpError("A name is required.", 400);
    if (!hasLetter(name)) httpError("A character name needs at least one letter.", 400);
    const owner = await characterOwner(characterId);
    await db.transaction(async (tx) => {
      await lockPlayer(tx, owner.playerId);
      if (await nameTaken(tx, owner.worldId, name, owner.playerId)) httpError("That name is already taken in this world.", 409);
      await tx.update(players).set({ name }).where(eq(players.id, owner.playerId));
      await audit(tx, admin.id, "characters.rename", owner.userId, { characterId, from: owner.name, to: name });
    });
    return { ok: true, characterId, name };
  });

  app.get("/characters/:characterId/effects", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const owner = await characterOwner(characterId);
    const rows = await db.select().from(effectLog).where(eq(effectLog.characterId, characterId)).orderBy(desc(effectLog.createdAt)).limit(LOG_LIMIT);
    await audit(db, admin.id, "characters.effects", owner.userId, { characterId, returned: rows.length });
    return { characterId, effects: rows };
  });

  app.get("/characters/:characterId/interactions", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const owner = await characterOwner(characterId);
    const rows = await db
      .select()
      .from(interactions)
      .where(or(eq(interactions.actorCharacterId, characterId), eq(interactions.targetCharacterId, characterId)))
      .orderBy(desc(interactions.createdAt))
      .limit(LOG_LIMIT);
    await audit(db, admin.id, "characters.interactions", owner.userId, { characterId, returned: rows.length });
    return { characterId, interactions: rows };
  });

  // --- Stats and inventory -------------------------------------------------------
  // The four stats, every content good and every household pop type, held or not,
  // so a missing one can be granted. Amounts are as stored: like the drachmae
  // column they stand as of the player's last settle, and an edit below settles.
  app.get("/characters/:characterId/sheet", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const owner = await characterOwner(characterId);
    const [character] = await db
      .select({ drachmae: playerCharacters.drachmae, prestige: playerCharacters.prestige, devotion: playerCharacters.devotion, militia: playerCharacters.militia, intelligence: playerCharacters.intelligence })
      .from(playerCharacters)
      .where(eq(playerCharacters.id, characterId))
      .limit(1);
    const held = await db.select({ type: resources.type, amount: resources.amount }).from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, owner.playerId)));
    const kept = await db.select({ popType: playerPops.popType, count: playerPops.count }).from(playerPops).where(and(eq(playerPops.worldId, owner.worldId), eq(playerPops.ownerPlayerId, owner.playerId)));
    const amounts = new Map(held.map((row) => [row.type, Number(row.amount)]));
    const counts = new Map(kept.map((row) => [row.popType, row.count]));
    const goods = Object.keys(getBuildingsContent().vendor)
      .map((type) => ({ type, label: goodLabel(type), amount: amounts.get(type) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const pops = Object.entries(getPopsContent().pops).map(([type, def]) => ({ type, label: def.label, count: counts.get(type) ?? 0, max: def.max ?? null }));
    const military = await militaryBlock(owner, new Date());
    await audit(db, admin.id, "characters.sheet", owner.userId, { characterId });
    const { drachmae, ...stats } = character!;
    return { characterId, name: owner.name, drachmae, stats, goods, pops, military };
  });

  // Relative stat adjustment under the player lock, refused (not clamped) when it
  // would leave 0..100.
  app.post("/characters/:characterId/stats", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const stat = bodyText(request, "stat") as Stat;
    if (!STATS.includes(stat)) httpError(`stat must be one of ${STATS.join(", ")}.`, 400);
    const delta = deltaOf(request, STAT_MAX);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const column = playerCharacters[stat];
    const value = await db.transaction(async (tx) => {
      await lockPlayer(tx, owner.playerId);
      const updated = await tx
        .update(playerCharacters)
        .set({ [stat]: sql`${column} + ${delta}` })
        .where(and(eq(playerCharacters.id, characterId), sql`${column} + ${delta} BETWEEN ${STAT_MIN} AND ${STAT_MAX}`))
        .returning({ value: column });
      if (!updated.length) {
        const [current] = await tx.select({ value: column }).from(playerCharacters).where(eq(playerCharacters.id, characterId));
        httpError(`${capitalise(stat)} is ${current!.value}; ${delta > 0 ? "+" : ""}${delta} would take it outside ${STAT_MIN}–${STAT_MAX}.`, 409);
      }
      await tx.insert(effectLog).values({ characterId, kind: "admin_adjust_stat", detail: { stat, delta, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.stat", owner.userId, { characterId, stat, delta, reason, value: updated[0]!.value });
      return updated[0]!.value;
    });
    return { ok: true, characterId, stat, value };
  });

  // Relative goods adjustment for any content good; a removal is a guarded debit
  // that never takes the stock below zero.
  app.post("/characters/:characterId/goods", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const good = bodyText(request, "good");
    if (!Object.hasOwn(getBuildingsContent().vendor, good)) httpError("No such good.", 400);
    const delta = deltaOf(request, 1_000_000);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const amount = await settledEdit(owner, async (tx, now) => {
      const row = await getOrCreateResource(tx, owner.playerId, good, now);
      const after = delta > 0 ? await creditResource(tx, row.id, delta) : await debitResource(tx, row.id, -delta);
      if (after === null) httpError(`They hold only ${Math.floor(Number(row.amount))} ${goodLabel(good)}.`, 409);
      await tx.insert(effectLog).values({ characterId, kind: "admin_adjust_goods", detail: { good, delta, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.goods", owner.userId, { characterId, good, delta, reason, amount: after });
      return after;
    });
    return { ok: true, characterId, good, amount };
  });

  // Relative household adjustment for any content pop type: never below zero, and
  // never above a type's retention cap (the physician's max 1).
  app.post("/characters/:characterId/pops", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const popType = bodyText(request, "popType");
    const pops = getPopsContent().pops;
    const def = Object.hasOwn(pops, popType) ? pops[popType as PopType] : httpError("No such pop type.", 400);
    const delta = deltaOf(request, 10_000);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const count = await settledEdit(owner, async (tx) => {
      const mine = and(eq(playerPops.worldId, owner.worldId), eq(playerPops.ownerPlayerId, owner.playerId), eq(playerPops.popType, popType));
      const [existing] = await tx.select({ id: playerPops.id, count: playerPops.count }).from(playerPops).where(mine).limit(1);
      const have = existing?.count ?? 0;
      if (have + delta < 0) httpError(`They keep only ${have} ${def.label.toLowerCase()}.`, 409);
      if (def.max !== undefined && have + delta > def.max) httpError(`A household retains at most ${def.max} ${def.label.toLowerCase()}.`, 409);
      let after: number;
      if (existing) {
        const updated = await tx
          .update(playerPops)
          .set({ count: sql`${playerPops.count} + ${delta}` })
          .where(and(eq(playerPops.id, existing.id), sql`${playerPops.count} + ${delta} >= 0`))
          .returning({ count: playerPops.count });
        if (!updated.length) httpError(`They keep only ${have} ${def.label.toLowerCase()}.`, 409);
        after = updated[0]!.count;
      } else {
        await tx.insert(playerPops).values({ worldId: owner.worldId, ownerPlayerId: owner.playerId, popType, count: delta });
        after = delta;
      }
      await tx.insert(effectLog).values({ characterId, kind: "admin_adjust_pops", detail: { popType, delta, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.pops", owner.userId, { characterId, popType, delta, reason, count: after });
      return after;
    });
    return { ok: true, characterId, popType, count };
  });

  // --- Military --------------------------------------------------------------------
  // Each edit settles first (settledEdit), so an arrived row has been landed and a
  // stale pledge released before the row is read. Adding men (a grant, a positive
  // count) is refused below the militia gate: a player under it could neither
  // move nor disband them (ruling, 4 Oct 2026). Pledged and marching rows are
  // refused for every edit: another player's muster, or the settle, owns them.
  const unitRowOf = async (tx: Tx, owner: Owner, unitRowId: string) => {
    const rows = await tx
      .select()
      .from(playerUnits)
      .where(and(eq(playerUnits.id, unitRowId), eq(playerUnits.worldId, owner.worldId), eq(playerUnits.ownerPlayerId, owner.playerId)))
      .limit(1);
    const row = rows[0] ?? httpError("No such unit row.", 404);
    if (isPledged(row)) httpError(PLEDGED_REFUSAL, 409);
    if (row.movingTo !== null) httpError("These men are on the march; wait until they arrive.", 409);
    return row;
  };
  const requireGate = async (tx: Tx, ctx: ActingContext) => {
    const gate = await gateFor(tx, ctx);
    if (!gate.met) httpError(`Militia ${gate.required} required.`, 409);
  };

  // Relative count on a trained row; a row brought to zero is deleted, as a battle
  // deletes a row it wipes out. startCount rises with a positive delta so the
  // progress arithmetic never exceeds 100%.
  app.post("/characters/:characterId/units/:unitRowId/count", { schema: uuidParams("characterId", "unitRowId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId, unitRowId } = request.params as { characterId: string; unitRowId: string };
    const delta = deltaOf(request, 10_000);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const result = await settledEdit(owner, async (tx, _now, ctx) => {
      const row = await unitRowOf(tx, owner, unitRowId);
      if (row.source !== "trained") httpError("A band is a fixed company; remove it or leave it.", 409);
      if (delta > 0) await requireGate(tx, ctx);
      const plural = unitDef(getUnitsContent(), row.unitId)?.plural ?? row.unitId;
      if (row.count + delta < 0) httpError(`They field only ${row.count} ${plural}.`, 409);
      let count: number;
      let removed = false;
      if (row.count + delta === 0) {
        await tx.delete(playerUnits).where(eq(playerUnits.id, row.id));
        count = 0;
        removed = true;
      } else {
        const updated = await tx
          .update(playerUnits)
          .set({ count: sql`${playerUnits.count} + ${delta}`, ...(delta > 0 ? { startCount: sql`${playerUnits.startCount} + ${delta}` } : {}) })
          .where(and(eq(playerUnits.id, row.id), sql`${playerUnits.count} + ${delta} >= 0`))
          .returning({ count: playerUnits.count });
        if (!updated.length) httpError(`They field only ${row.count} ${plural}.`, 409);
        count = updated[0]!.count;
      }
      await tx.insert(effectLog).values({ characterId, kind: "admin_adjust_units", detail: { unitRowId: row.id, unitId: row.unitId, delta, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.units.count", owner.userId, { characterId, unitRowId: row.id, unitId: row.unitId, delta, reason, count, removed });
      return { count, removed, unitId: row.unitId };
    });
    return { ok: true, characterId, unitRowId, ...result };
  });

  // Remove a row outright, trained or band, regardless of the player's release rule.
  app.post("/characters/:characterId/units/:unitRowId/remove", { schema: uuidParams("characterId", "unitRowId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId, unitRowId } = request.params as { characterId: string; unitRowId: string };
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const result = await settledEdit(owner, async (tx) => {
      const row = await unitRowOf(tx, owner, unitRowId);
      await tx.delete(playerUnits).where(eq(playerUnits.id, row.id));
      await tx.insert(effectLog).values({ characterId, kind: "admin_remove_units", detail: { unitRowId: row.id, unitId: row.unitId, source: row.source, count: row.count, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.units.remove", owner.userId, { characterId, unitRowId: row.id, unitId: row.unitId, source: row.source, count: row.count, reason });
      return { removed: true as const, unitId: row.unitId, count: row.count };
    });
    return { ok: true, characterId, unitRowId, ...result };
  });

  // Grant trained men: ready at once, at Massalia, drawing nothing from the levy
  // and costing no gear. Bands come from the market only.
  app.post("/characters/:characterId/units/grant", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const unitId = bodyText(request, "unitId");
    const unitsC = getUnitsContent();
    if (!Object.hasOwn(unitsC.units, unitId)) httpError("No such trained unit.", 400);
    const count = (request.body as { count?: unknown } | undefined)?.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count <= 0 || count > 10_000) httpError("count must be a whole number from 1 to 10,000.", 400);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const result = await settledEdit(owner, async (tx, now, ctx) => {
      await requireGate(tx, ctx);
      const inserted = (
        await tx
          .insert(playerUnits)
          .values({ worldId: owner.worldId, ownerPlayerId: owner.playerId, source: "trained", unitId, count, startCount: count, recruitedSeason: seasonFor(ctx, now), readyAt: now, contractEndAt: null, basedAt: massaliaRegionId(), createdAt: now })
          .returning({ id: playerUnits.id })
      )[0]!;
      await tx.insert(effectLog).values({ characterId, kind: "admin_grant_units", detail: { unitRowId: inserted.id, unitId, count, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.units.grant", owner.userId, { characterId, unitRowId: inserted.id, unitId, count, reason });
      return { unitRowId: inserted.id, unitId, count };
    });
    return { ok: true, characterId, ...result };
  });

  // Relative levy. The settle has already made the levy row, so this is the
  // guarded update alone.
  app.post("/characters/:characterId/levy", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const delta = deltaOf(request, 10_000);
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    const men = await settledEdit(owner, async (tx) => {
      const mine = and(eq(playerLevy.worldId, owner.worldId), eq(playerLevy.ownerPlayerId, owner.playerId));
      const [current] = await tx.select({ men: playerLevy.men }).from(playerLevy).where(mine).limit(1);
      const have = current?.men ?? 0;
      if (have + delta < 0) httpError(`The levy holds only ${have} men.`, 409);
      const updated = await tx
        .update(playerLevy)
        .set({ men: sql`${playerLevy.men} + ${delta}` })
        .where(and(mine, sql`${playerLevy.men} + ${delta} >= 0`))
        .returning({ men: playerLevy.men });
      if (!updated.length) httpError(`The levy holds only ${have} men.`, 409);
      await tx.insert(effectLog).values({ characterId, kind: "admin_adjust_levy", detail: { delta, reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.levy", owner.userId, { characterId, delta, reason, men: updated[0]!.men });
      return updated[0]!.men;
    });
    return { ok: true, characterId, men };
  });

  // Cool a lit altar. An expired altar is already cold, as the sheet shows it.
  app.post("/characters/:characterId/altar/cool", { schema: uuidParam("characterId") }, async (request) => {
    const admin = await requireAdmin(request);
    const { characterId } = request.params as { characterId: string };
    const reason = reasonOf(request, true);
    const owner = await characterOwner(characterId);
    await settledEdit(owner, async (tx, now) => {
      const cooled = await tx
        .update(players)
        .set({ altarUntil: null, altarGood: null })
        .where(and(eq(players.id, owner.playerId), sql`${players.altarUntil} > ${now}`))
        .returning({ id: players.id });
      if (!cooled.length) httpError("The altar is already cold.", 409);
      await tx.insert(effectLog).values({ characterId, kind: "admin_cool_altar", detail: { reason, adminUserId: admin.id } });
      await audit(tx, admin.id, "characters.altar.cool", owner.userId, { characterId, reason });
    });
    return { ok: true, characterId, altar: null };
  });

  // --- Koina -------------------------------------------------------------------
  // The active world's live koina: name, leader, members, founded. No posts.
  app.get("/koina", async (request) => {
    const admin = await requireAdmin(request);
    const worldId = await getActiveWorldId();
    const list = worldId ? await adminKoinaList(worldId) : [];
    await audit(db, admin.id, "koina.list", null, { worldId, returned: list.length });
    return { koina: list };
  });

  // Rename: the same cleaning and uniqueness as founding, under the koinon lock.
  app.post("/koina/:id/rename", { schema: uuidParam("id") }, async (request) => {
    const admin = await requireAdmin(request);
    const { id } = request.params as { id: string };
    const reason = reasonOf(request, true);
    const result = await adminRenameKoinon(id, bodyText(request, "name"), (tx, detail) => audit(tx, admin.id, "koina.rename", null, { koinonId: id, ...detail, reason }));
    if (!result.ok) httpError(result.error, result.code);
    return { ok: true, id, name: result.to };
  });

  // Dissolve: every member is removed, with no cooldown and no Chronicle line.
  // What is left in the treasury goes to the city; the audit detail records it
  // as treasuryToCity.
  app.post("/koina/:id/dissolve", { schema: uuidParam("id") }, async (request) => {
    const admin = await requireAdmin(request);
    const { id } = request.params as { id: string };
    const reason = reasonOf(request, true);
    const result = await adminDissolveKoinon(id, new Date(), (tx, detail) => audit(tx, admin.id, "koina.dissolve", null, { koinonId: id, ...detail, reason }));
    if (!result.ok) httpError(result.error, result.code);
    return { ok: true, id, name: result.name, members: result.memberIds.length };
  });
}
