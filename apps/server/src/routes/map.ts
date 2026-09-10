import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { gameDate, type ReachForceRow, type ReachShip } from "@massalia/shared";
import { publishMapChange, subscribeMap } from "../services/mapRealtime.js";
import { canActAs, canConquer } from "../services/mapWar.js";

// The province/map system API. Isolated from the older world.ts prototype. Reads
// the map_ tables seeded by @massalia/db seedMap.ts. Geometry/terrain/rivers stay
// static files on the client — this API is only ownership state + polities + towns.
//
// @massalia/db opens a connection at module load, so it is imported lazily inside
// handlers (mirrors routes/league.ts): the pool is created on first request and
// cached thereafter.
type Db = ReturnType<typeof import("@massalia/db").createDb>;
let _db: Db | null = null;

// The map is a single global season for now — a text scope key, decoupled from the
// uuid worlds table (see migration 0034). A constant today, a parameter later.
const MAP_WORLD_ID = "season-1";
const MAP_MUTATIONS_ENABLED = process.env.MAP_MUTATIONS_ENABLED === "true";

// Only these two changes are legal. 'occupy' = wartime control (controller only,
// since_tick untouched); 'annex' = peace annexation (owner + controller, since_tick
// reset to now). This keeps the schema's owner/controller split meaningful.
type ChangeType = "occupy" | "annex";

// World 2 military read payload (see GET /military). "home" = live pool of a
// Massalia-owned target, visible to every player; "intel" = the requester's own
// dynasty's scouting snapshot. Anything without an entry is simply unknown.
const HOME_POLITY = "massalia";
type MilitarySource = "home" | "intel";
interface MilitaryPayload {
  towns: Record<string, { garrison: number; pentekonters: number; triremes: number; source: MilitarySource; scoutedGameDate?: string }>;
  regions: Record<string, { warband: number; source: MilitarySource; scoutedGameDate?: string }>;
}

// Open /stream connections per user id. A user may hold at most MAX_STREAMS_PER_USER
// at once (a few tabs); the next attempt is refused with 429 rather than letting a
// runaway client pin connections. Decremented when the socket closes.
export const MAX_STREAMS_PER_USER = 3;
const openStreams = new Map<string, number>();
export function openStreamCount(userId: string): number {
  return openStreams.get(userId) ?? 0;
}

// Heartbeat cadence: an SSE comment line every 25s keeps proxies/load balancers
// (which cut idle connections around 30–60s) from dropping a quiet stream.
export const STREAM_HEARTBEAT_MS = 25_000;

interface StateProvince {
  provinceId: string;
  type: string;
  terrain: string;
  coastal: boolean;
  ownerPolityId: string | null;
  controllerPolityId: string | null;
  sinceTick: number;
}
interface MapState {
  worldId: string;
  tick: number;
  polities: { id: string; name: string; color: string }[];
  provinces: StateProvince[];
  towns: { id: string; name: string; provinceId: string | null; polityId: string | null; lon: number; lat: number; pxX: number; pxY: number }[];
}

// The integer game tick. Derived from the active world's calendar (seasons elapsed
// since it started — one per real day), the same source league.ts/diplomacy use, so
// map history lines up with the rest of the game clock. Seed baseline is tick 0
// (opening Winter). No active world yet -> 0.
async function currentTick(db: Db): Promise<number> {
  const { getActiveWorldId } = await import("../services/character.js");
  const worldId = await getActiveWorldId();
  if (!worldId) return 0;
  const rows = await db.execute(sql`SELECT started_at FROM worlds WHERE id = ${worldId} LIMIT 1`);
  const startedAt = (rows.rows as { started_at: string | Date }[])[0]?.started_at;
  if (!startedAt) return 0;
  return gameDate(Date.now(), new Date(startedAt).getTime()).seasonIndex;
}

async function buildState(db: Db): Promise<MapState> {
  const polities = await db.execute(sql`SELECT id, name, color FROM map_polities ORDER BY id`);
  const provinces = await db.execute(sql`
    SELECT s.province_id, p.type, p.terrain, p.coastal, s.owner_polity_id, s.controller_polity_id, s.since_tick
    FROM map_province_state s
    JOIN map_provinces p ON p.id = s.province_id
    WHERE s.world_id = ${MAP_WORLD_ID}
  `);
  const towns = await db.execute(sql`
    SELECT id, name, province_id, polity_id, lon, lat, px_x, px_y FROM map_towns ORDER BY name
  `);
  return {
    worldId: MAP_WORLD_ID,
    tick: await currentTick(db),
    polities: polities.rows as MapState["polities"],
    provinces: (provinces.rows as Record<string, unknown>[]).map((r) => ({
      provinceId: r.province_id as string,
      type: r.type as string,
      terrain: r.terrain as string,
      coastal: r.coastal as boolean,
      ownerPolityId: (r.owner_polity_id as string | null) ?? null,
      controllerPolityId: (r.controller_polity_id as string | null) ?? null,
      sinceTick: Number(r.since_tick),
    })),
    towns: (towns.rows as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      provinceId: (r.province_id as string | null) ?? null,
      polityId: (r.polity_id as string | null) ?? null,
      lon: Number(r.lon),
      lat: Number(r.lat),
      pxX: Number(r.px_x),
      pxY: Number(r.px_y),
    })),
  };
}

export async function mapRoutes(app: FastifyInstance) {
  // Full map ownership state: polities + per-province state + towns. Geometry is
  // loaded separately by the client from static files.
  // World 2 military read (infrastructure only, no actions). Returns ONLY what the
  // requester is entitled to see: live pools for anything Massalia owns ("home",
  // visible to every authenticated player) and the requester's own dynasty's intel
  // snapshots ("intel", frozen numbers + the game date scouted). Nothing else is
  // ever included — no other dynasty's intel, no foreign live pool. Read-only, so
  // it is deliberately NOT behind MAP_MUTATIONS_ENABLED.
  app.get("/military", async (request, reply) => {
    const { createDb, townIntel, regionIntel, townMilitary, regionMilitary } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const { ensureCharacterRow, getActivePlayer, getActiveWorldId } = await import("../services/character.js");
    const { loadMilitaryOwners } = await import("../services/mapMilitary.js");
    const { and, eq, inArray } = await import("drizzle-orm");
    const db = (_db ??= createDb());
    const user = await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }
    const player = await getActivePlayer(user.id, worldId);
    if (!player) {
      reply.code(404);
      return { error: "No active character found." };
    }
    const character = await ensureCharacterRow(player, worldId);
    const dynastyId = character.dynastyId;
    const owners = await loadMilitaryOwners();
    const homeTowns = Object.entries(owners.towns).filter(([, o]) => o === HOME_POLITY).map(([id]) => id);
    const homeRegions = Object.entries(owners.regions).filter(([, o]) => o === HOME_POLITY).map(([id]) => id);

    const towns: MilitaryPayload["towns"] = {};
    const regions: MilitaryPayload["regions"] = {};
    if (homeTowns.length) {
      const rows = await db.select().from(townMilitary).where(and(eq(townMilitary.worldId, worldId), inArray(townMilitary.townId, homeTowns)));
      for (const r of rows) towns[r.townId] = { garrison: r.garrison, pentekonters: r.pentekonters, triremes: r.triremes, source: "home" };
    }
    if (homeRegions.length) {
      const rows = await db.select().from(regionMilitary).where(and(eq(regionMilitary.worldId, worldId), inArray(regionMilitary.regionId, homeRegions)));
      for (const r of rows) regions[r.regionId] = { warband: r.warband, source: "home" };
    }
    if (dynastyId) {
      const tRows = await db.select().from(townIntel).where(and(eq(townIntel.worldId, worldId), eq(townIntel.dynastyId, dynastyId)));
      for (const r of tRows) {
        if (towns[r.townId]) continue; // home outranks a stale snapshot
        towns[r.townId] = { garrison: r.garrison, pentekonters: r.pentekonters, triremes: r.triremes, source: "intel", scoutedGameDate: r.scoutedGameDate };
      }
      const rRows = await db.select().from(regionIntel).where(and(eq(regionIntel.worldId, worldId), eq(regionIntel.dynastyId, dynastyId)));
      for (const r of rRows) {
        if (regions[r.regionId]) continue;
        regions[r.regionId] = { warband: r.warband, source: "intel", scoutedGameDate: r.scoutedGameDate };
      }
    }
    return { towns, regions } satisfies MilitaryPayload;
  });

  // Reach (barracks prompt 3a): which land provinces the player's force can
  // Attack, Raid or Colonise from its bases, and why not. Read-only, so like
  // /military it is NOT behind MAP_MUTATIONS_ENABLED. It settles the player
  // under the lock first (rows may have finished training or arrived), then
  // reads the roster, holdings and ship stock and runs the pure library.
  app.get("/reach", async (request, reply) => {
    const { createDb, playerHoldings, playerUnits, resources } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const { ensureCharacterRow, getActivePlayer, getActiveWorldId } = await import("../services/character.js");
    const { loadMilitaryOwners } = await import("../services/mapMilitary.js");
    const { buildingContext, settleAll } = await import("../services/buildings.js");
    const { applyComposureDelta } = await import("../services/composure.js");
    const { lockPlayer } = await import("../services/lock.js");
    const { getTopology } = await import("../services/mapGraph.js");
    const { getBandsContent, getShipsContent, getUnitsContent, isActive } = await import("../services/barracks.js");
    const { bandDef, computeReach, fleetStats, forceStats, unitDef } = await import("@massalia/shared");
    const { and, eq, inArray } = await import("drizzle-orm");
    const db = (_db ??= createDb());
    const user = await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }
    const player = await getActivePlayer(user.id, worldId);
    if (!player) {
      reply.code(404);
      return { error: "No active character found." };
    }
    const character = await ensureCharacterRow(player, worldId);
    const ctx = await buildingContext(player.id, worldId);
    if (!ctx) {
      reply.code(503);
      return { error: "No active world exists." };
    }
    const topology = getTopology();
    const shipsC = getShipsContent();
    const shipIds = Object.keys(shipsC.ships);
    const now = new Date();

    const { composureDays, rows, holdings, stock } = await db.transaction(async (tx) => {
      await lockPlayer(tx, player.id);
      const settled = await settleAll(tx, ctx, now);
      const rows = await tx.select().from(playerUnits).where(and(eq(playerUnits.worldId, worldId), eq(playerUnits.ownerPlayerId, player.id)));
      const holdings = await tx.select().from(playerHoldings).where(and(eq(playerHoldings.worldId, worldId), eq(playerHoldings.ownerPlayerId, player.id)));
      const stock = await tx
        .select({ type: resources.type, amount: resources.amount })
        .from(resources)
        .where(and(eq(resources.scope, "player"), eq(resources.scopeId, player.id), inArray(resources.type, shipIds)));
      return { composureDays: settled.composureDays, rows, holdings, stock };
    });
    if (composureDays > 0) await applyComposureDelta(character.id, composureDays, "building:shrine", now);

    // Bases: the Massalia region plus every holding. Force: active rows standing
    // at a base (training or mid-move excluded). Fleet: the ship goods in stock.
    const bases = [{ regionId: topology.massaliaRegion, kind: "massalia" as const }, ...holdings.map((h) => ({ regionId: h.regionId, kind: h.kind }))];
    const baseIds = new Set(bases.map((b) => b.regionId));
    const unitsC = getUnitsContent();
    const bandsC = getBandsContent();
    const force: ReachForceRow[] = [];
    for (const r of rows) {
      if (!isActive(r, now) || r.movingTo !== null || !baseIds.has(r.basedAt)) continue;
      const def = r.source === "trained" ? unitDef(unitsC, r.unitId) : bandDef(bandsC, r.unitId);
      if (!def) continue;
      force.push({ spd: def.stats.spd, space: def.stats.space, count: r.count });
    }
    const counts: Record<string, number> = Object.fromEntries(shipIds.map((id) => [id, 0]));
    for (const s of stock) counts[s.type] = Math.max(0, Math.floor(Number(s.amount)));
    const fleet: ReachShip[] = shipIds.map((id) => ({ shipId: id, count: counts[id]!, range: shipsC.ships[id]!.range, troopSpace: shipsC.ships[id]!.troopSpace }));

    const owners = await loadMilitaryOwners();
    const homeRegions = new Set<string>();
    for (const [id, o] of Object.entries(owners.regions)) if (o === HOME_POLITY) homeRegions.add(id);
    for (const [town, o] of Object.entries(owners.towns)) {
      if (o !== HOME_POLITY) continue;
      const region = topology.townRegion.get(town);
      if (region) homeRegions.add(region);
    }

    const reach = computeReach({ topology, bases: [...baseIds], force, fleet, homeRegions });
    return { bases, force: forceStats(force), fleet: { ships: counts, ...fleetStats(fleet) }, reach };
  });

  app.get("/state", async (request) => {
    const { createDb } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const db = (_db ??= createDb());
    await requireAuth(request);
    return buildState(db);
  });

  // Change one province's ownership. Body: { polityId, changeType: 'occupy' | 'annex' }.
  // Validation is a placeholder for the real war system, isolated in services/mapWar.ts.
  // map_provinces.id is a TEXT slug, so the param check is the slug shape (400 on
  // anything else, before the handler runs).
  const provinceParams = {
    params: { type: "object", required: ["provinceId"], properties: { provinceId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" } } },
  } as const;
  app.post("/state/:provinceId", { schema: provinceParams }, async (request, reply) => {
    // The theatre launches read-only. This explicit server-side gate prevents the
    // unfinished war seam from becoming reachable merely because a client knows
    // the route. Enabling it later still requires replacing mapWar's placeholders.
    if (!MAP_MUTATIONS_ENABLED) {
      reply.code(404);
      return { error: "Map mutations are not available." };
    }
    const { createDb } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const db = (_db ??= createDb());
    const user = await requireAuth(request);

    const { provinceId } = request.params as { provinceId: string };
    const body = (request.body ?? {}) as { polityId?: unknown; changeType?: unknown };
    const polityId = typeof body.polityId === "string" ? body.polityId : "";
    const changeType = body.changeType as ChangeType;
    if (!polityId || (changeType !== "occupy" && changeType !== "annex")) {
      reply.code(400);
      return { error: "polityId (string) and changeType ('occupy' | 'annex') are required." };
    }

    // The acting polity must be one the user may command (placeholder — see mapWar.ts).
    if (!canActAs(user.id, polityId)) {
      reply.code(403);
      return { error: "You may not act as that polity." };
    }

    // The polity must exist (FK would catch it, but return a clean 400).
    const polity = await db.execute(sql`SELECT 1 FROM map_polities WHERE id = ${polityId} LIMIT 1`);
    if (polity.rows.length === 0) {
      reply.code(400);
      return { error: `Unknown polity '${polityId}'.` };
    }

    // War-system seam: is this conquest legal? (Placeholder: adjacency control.)
    if (!(await canConquer(db, MAP_WORLD_ID, provinceId, polityId))) {
      reply.code(409);
      return { error: "That polity controls no province adjacent to the target." };
    }

    const tick = await currentTick(db);
    const changed = await db.transaction(async (tx) => {
      // 'annex' resets owner + controller + since_tick; 'occupy' takes control only.
      const update =
        changeType === "annex"
          ? tx.execute(sql`
              UPDATE map_province_state
              SET owner_polity_id = ${polityId}, controller_polity_id = ${polityId}, since_tick = ${tick}
              WHERE world_id = ${MAP_WORLD_ID} AND province_id = ${provinceId}
              RETURNING owner_polity_id, controller_polity_id, since_tick
            `)
          : tx.execute(sql`
              UPDATE map_province_state
              SET controller_polity_id = ${polityId}
              WHERE world_id = ${MAP_WORLD_ID} AND province_id = ${provinceId}
              RETURNING owner_polity_id, controller_polity_id, since_tick
            `);
      const result = await update;
      const row = (result.rows as { owner_polity_id: string | null; controller_polity_id: string | null; since_tick: number }[])[0];
      if (!row) return null; // no state row: province is sea/wasteland or unknown.

      await tx.execute(sql`
        INSERT INTO map_province_history (world_id, province_id, polity_id, change_type, tick)
        VALUES (${MAP_WORLD_ID}, ${provinceId}, ${polityId}, ${changeType}, ${tick})
      `);
      return row;
    });

    if (!changed) {
      reply.code(409);
      return { error: `Province '${provinceId}' has no conquerable state (sea/wasteland or unknown).` };
    }

    // Publish a per-change diff to every subscriber (never a full-state re-push).
    const change = {
      provinceId,
      ownerPolityId: changed.owner_polity_id ?? null,
      controllerPolityId: changed.controller_polity_id ?? null,
      sinceTick: Number(changed.since_tick),
      tick,
      changeType,
    };
    publishMapChange(change);
    return { ok: true, change };
  });

  // Realtime: full state once on connect, then one 'change' event per conquest.
  app.get("/stream", async (request, reply) => {
    const { createDb } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const db = (_db ??= createDb());
    const user = await requireAuth(request);

    const open = openStreamCount(user.id);
    if (open >= MAX_STREAMS_PER_USER) {
      reply.code(429);
      return { error: `You already have ${MAX_STREAMS_PER_USER} map streams open. Close one and try again.` };
    }
    openStreams.set(user.id, open + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = openStreamCount(user.id) - 1;
      if (remaining <= 0) openStreams.delete(user.id);
      else openStreams.set(user.id, remaining);
    };
    // Teardown on disconnect, registered BEFORE the first await so a client that
    // drops while the snapshot query runs still frees its slot. The request
    // socket's 'close' is the reliable signal for a dropped in-flight response;
    // the response's own 'close' covers server-side shutdown. Idempotent.
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    const teardown = () => {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      release();
    };
    request.raw.once("close", teardown);
    reply.raw.once("close", teardown);
    const gone = () => request.raw.destroyed || reply.raw.destroyed || reply.raw.writableEnded;

    // The stream writes to reply.raw directly, which bypasses @fastify/cors' onSend
    // hook — so echo the CORS headers here or the browser blocks the cross-origin
    // EventSource/fetch. The preflight (handled by @fastify/cors) already enforced
    // the allowed origin, so echoing request.origin here is safe.
    // KEEP IN SYNC with the @fastify/cors config in apps/server/src/index.ts: because
    // this path opts out of the plugin, any change there (allowed origin, credentials)
    // must be mirrored here by hand — the plugin will NOT cover this response.
    const origin = request.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" } : {}),
    });

    // Initial snapshot (full state) — the only full-state push per connection.
    const state = await buildState(db);
    if (gone()) return; // client left during the query; teardown already ran
    reply.raw.write(`event: state\n`);
    reply.raw.write(`data: ${JSON.stringify(state)}\n\n`);

    // Thereafter, one small diff per province change.
    unsubscribe = subscribeMap((change) => {
      reply.raw.write(`event: change\n`);
      reply.raw.write(`data: ${JSON.stringify(change)}\n\n`);
    });
    // Comment lines are ignored by EventSource but count as traffic for proxies.
    heartbeat = setInterval(() => reply.raw.write(`: keep-alive\n\n`), STREAM_HEARTBEAT_MS);
  });
}
