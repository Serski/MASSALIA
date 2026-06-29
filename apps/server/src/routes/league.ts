import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import {
  opinionBand,
  parseCitiesContent,
  parseFactionsContent,
  stanceValue,
  type CitiesContent,
  type CityGroup,
  type FactionGroup,
  type FactionsContent,
  type OpinionBandId,
} from "@massalia/shared";

// @massalia/db opens a connection at module load, so it is pulled in lazily inside
// the handlers (mirrors routes/standings.ts) — the connection is only created when
// a request actually runs, and on first use it is cached.
type Db = ReturnType<typeof import("@massalia/db").createDb>;
let _db: Db | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const citiesFile = path.join(repoRoot, "content/cities/cities.json");
const factionsFile = path.join(repoRoot, "content/diplomacy/factions.json");

let cities: CitiesContent | null = null;
let factions: FactionsContent | null = null;

// Validate both content files at boot (fail fast on a malformed file); memoized.
export async function loadLeagueContent(): Promise<void> {
  cities = parseCitiesContent(JSON.parse(await readFile(citiesFile, "utf8")));
  factions = parseFactionsContent(JSON.parse(await readFile(factionsFile, "utf8")));
}

function getCities(): CitiesContent {
  if (!cities) throw new Error("League cities content not loaded. Call loadLeagueContent() at boot.");
  return cities;
}

function getFactions(): FactionsContent {
  if (!factions) throw new Error("League factions content not loaded. Call loadLeagueContent() at boot.");
  return factions;
}

// --- Response shapes (real values — this is a visible stats readout) ---------

export type CityView = {
  id: string;
  name: string;
  group: CityGroup;
  population: number;
  tax: number;
  stability: number;
  // 1..5 fortification level (display-only this phase).
  fortifications: number;
  garrison: number;
};

export type FactionView = {
  id: string;
  name: string;
  group: FactionGroup;
  // The −200..+200 opinion bar (Diplomacy D1) — the source of truth.
  opinion: number;
  // The display band computed from opinion, plus a −2..+2 value for colour/order.
  band: OpinionBandId;
  bandLabel: string;
  bandValue: number;
  // Latched status flags (data-only in D1; default false for every faction).
  atWar: boolean;
  allied: boolean;
  vassal: boolean;
};

export async function leagueRoutes(app: FastifyInstance) {
  // The nine League colonies and their five current stats for the active world.
  app.get("/cities", async (request, reply) => {
    const { createDb } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const { getActiveWorldId } = await import("../services/character.js");
    const db = (_db ??= createDb());

    await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }

    const content = getCities();
    // Ensure-on-read: seed the world's rows from content defaults if missing.
    await db.execute(sql`
      INSERT INTO league_cities (world_id, city_id, population, tax, stability, fortifications, garrison)
      VALUES ${sql.join(
        content.cities.map(
          (c) => sql`(${worldId}, ${c.id}, ${c.start.population}, ${c.start.tax}, ${c.start.stability}, ${c.start.fortifications}, ${c.start.garrison})`,
        ),
        sql`, `,
      )}
      ON CONFLICT (world_id, city_id) DO NOTHING
    `);

    const result = await db.execute(sql`
      SELECT city_id, population, tax, stability, fortifications, garrison
      FROM league_cities WHERE world_id = ${worldId}
    `);
    const byId = new Map(
      (result.rows as { city_id: string; population: number; tax: number; stability: number; fortifications: number; garrison: number }[]).map(
        (r) => [r.city_id, r],
      ),
    );

    // Emit in content order so the grouping/sort is stable and content-driven.
    const out: CityView[] = content.cities.map((c) => {
      const row = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        group: c.group,
        population: row?.population ?? c.start.population,
        tax: row?.tax ?? c.start.tax,
        stability: row?.stability ?? c.start.stability,
        fortifications: row?.fortifications ?? c.start.fortifications,
        garrison: row?.garrison ?? c.start.garrison,
      };
    });
    return { cities: out };
  });

  // The nineteen neighbouring factions and their current stance for the world.
  app.get("/diplomacy", async (request, reply) => {
    const { createDb } = await import("@massalia/db");
    const { requireAuth } = await import("../services/auth.js");
    const { getActiveWorldId } = await import("../services/character.js");
    const db = (_db ??= createDb());

    await requireAuth(request);
    const worldId = await getActiveWorldId();
    if (!worldId) {
      reply.code(503);
      return { error: "No active world exists." };
    }

    const content = getFactions();
    // Ensure-on-read: seed the world's rows from content defaults if missing. The
    // legacy `stance` column is NOT NULL, so it is seeded as the opinion's display
    // band id (derived) — `opinion` is the source of truth.
    await db.execute(sql`
      INSERT INTO faction_relations (world_id, faction_id, stance, opinion, at_war, allied, vassal)
      VALUES ${sql.join(
        content.factions.map(
          (f) =>
            sql`(${worldId}, ${f.id}, ${opinionBand(f.start.opinion).id}, ${f.start.opinion}, ${f.start.atWar}, ${f.start.allied}, ${f.start.vassal})`,
        ),
        sql`, `,
      )}
      ON CONFLICT (world_id, faction_id) DO NOTHING
    `);

    const result = await db.execute(sql`
      SELECT faction_id, opinion, at_war, allied, vassal FROM faction_relations WHERE world_id = ${worldId}
    `);
    const byId = new Map(
      (result.rows as { faction_id: string; opinion: number; at_war: boolean; allied: boolean; vassal: boolean }[]).map(
        (r) => [r.faction_id, r],
      ),
    );

    const out: FactionView[] = content.factions.map((f) => {
      const row = byId.get(f.id);
      const opinion = row?.opinion ?? f.start.opinion;
      // The display band is computed from opinion in @massalia/shared (one place).
      const band = opinionBand(opinion);
      return {
        id: f.id,
        name: f.name,
        group: f.group,
        opinion,
        band: band.id,
        bandLabel: band.label,
        // Reuse the matching stance rung's numeric value for the existing colour scale.
        bandValue: stanceValue(band.id),
        atWar: row?.at_war ?? f.start.atWar,
        allied: row?.allied ?? f.start.allied,
        vassal: row?.vassal ?? f.start.vassal,
      };
    });
    return { factions: out };
  });
}
