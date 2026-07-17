import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { gameDate } from "@massalia/shared";
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

// Only these two changes are legal. 'occupy' = wartime control (controller only,
// since_tick untouched); 'annex' = peace annexation (owner + controller, since_tick
// reset to now). This keeps the schema's owner/controller split meaningful.
type ChangeType = "occupy" | "annex";

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
  app.get("/state", async (request) => {
    const { createDb } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const db = (_db ??= createDb());
    await requireAuth(request);
    return buildState(db);
  });

  // Change one province's ownership. Body: { polityId, changeType: 'occupy' | 'annex' }.
  // Validation is a placeholder for the real war system, isolated in services/mapWar.ts.
  app.post("/state/:provinceId", async (request, reply) => {
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
    await requireAuth(request);

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
    reply.raw.write(`event: state\n`);
    reply.raw.write(`data: ${JSON.stringify(await buildState(db))}\n\n`);

    // Thereafter, one small diff per province change.
    const unsubscribe = subscribeMap((change) => {
      reply.raw.write(`event: change\n`);
      reply.raw.write(`data: ${JSON.stringify(change)}\n\n`);
    });
    reply.raw.on("close", unsubscribe);
  });
}
