import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The public town survey (apps/web/public/map2/townstats.json): population and
// walls per town, read once. It is public data already — the secret military
// numbers live in content/map/town-military.json and never pass through here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const statsFile = path.join(repoRoot, "apps/web/public/map2/townstats.json");

export type TownStats = { population: number; walls: number };
let stats: Record<string, TownStats> | null = null;

export async function loadTownStats(): Promise<Record<string, TownStats>> {
  if (stats) return stats;
  const raw = JSON.parse(await fs.readFile(statsFile, "utf8")) as { towns?: Record<string, { population?: unknown; walls?: unknown }> };
  const out: Record<string, TownStats> = {};
  for (const [id, t] of Object.entries(raw.towns ?? {})) {
    const population = typeof t.population === "number" && t.population >= 0 ? t.population : 0;
    const walls = typeof t.walls === "number" && t.walls >= 0 ? Math.floor(t.walls) : 0;
    out[id] = { population, walls };
  }
  stats = out;
  return out;
}

// A town's survey figures; zeros for a town the survey does not list.
export async function townStats(townId: string): Promise<TownStats> {
  return (await loadTownStats())[townId] ?? { population: 0, walls: 0 };
}
