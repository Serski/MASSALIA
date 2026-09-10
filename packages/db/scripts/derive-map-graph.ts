import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Derive the server-side map topology from the hand-drawn World 2 file.
//
//   content/map/graph.json        one entry per province: type, coastal, neighbors,
//                                 towns — copied verbatim; no paths, no pixels.
//   content/map/coast-links.json  land → sea adjacency, which world2.json lacks
//                                 (land neighbours only land, sea only sea).
//
// Coast links come from the polygon geometry: every M/L vertex of every province
// path, rounded to one decimal; a land and a sea province are linked when they
// share at least SHARED_VERTICES vertices. Coastal-flagged land provinces left
// without a link get a tolerance pass (any land vertex within TOLERANCE_PX of any
// sea vertex). The `manual` block of coast-links.json is hand-maintained and
// preserved across runs; `derived` is rewritten every time.
//
// Run: pnpm --filter @massalia/db map:graph
// Never modifies world2.json.
// ---------------------------------------------------------------------------

const SHARED_VERTICES = 2;
const TOLERANCE_PX = 1.5;
const MASSALIA_TOWN = "massalia";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const worldFile = path.join(repoRoot, "apps/web/public/map2/world2.json");
const graphFile = path.join(repoRoot, "content/map/graph.json");
const linksFile = path.join(repoRoot, "content/map/coast-links.json");

type Province = { id: string; type: "land" | "sea" | "fog"; path: string; towns: string[]; neighbors: string[]; coastal: boolean };
type World = { provinces: Province[] };

const world = JSON.parse(readFileSync(worldFile, "utf8")) as World;
const provinces = [...world.provinces].sort((a, b) => a.id.localeCompare(b.id));

// --- graph.json --------------------------------------------------------------
const massalia = provinces.find((p) => p.type === "land" && p.towns.includes(MASSALIA_TOWN));
if (!massalia) throw new Error(`no land province holds the town "${MASSALIA_TOWN}"`);

const graph = {
  version: 1,
  source: "derived from apps/web/public/map2/world2.json by packages/db/scripts/derive-map-graph.ts; do not hand-edit provinces",
  massaliaRegion: massalia.id,
  provinces: Object.fromEntries(
    provinces.map((p) => [p.id, { type: p.type, coastal: p.coastal, neighbors: [...p.neighbors], towns: [...p.towns] }]),
  ),
};

// --- coast-links.json --------------------------------------------------------
type Pt = { x: number; y: number };
const VERTEX_RE = /[ML]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;

function vertices(d: string): Pt[] {
  const out: Pt[] = [];
  for (const m of d.matchAll(VERTEX_RE)) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}
const key = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

const land = provinces.filter((p) => p.type === "land");
const sea = provinces.filter((p) => p.type === "sea");
const verts = new Map(provinces.map((p) => [p.id, vertices(p.path)]));
const keys = new Map(provinces.map((p) => [p.id, new Set(verts.get(p.id)!.map(key))]));

const derived: Record<string, string[]> = {};
const link = (landId: string, seaId: string) => {
  const list = (derived[landId] ??= []);
  if (!list.includes(seaId)) list.push(seaId);
};

// Pass 1: shared vertices.
for (const l of land) {
  const lk = keys.get(l.id)!;
  for (const s of sea) {
    let shared = 0;
    for (const k of keys.get(s.id)!) if (lk.has(k) && ++shared >= SHARED_VERTICES) break;
    if (shared >= SHARED_VERTICES) link(l.id, s.id);
  }
}

// Pass 2: tolerance, only for coastal-flagged land provinces that got nothing.
const tolerance: Record<string, string[]> = {};
for (const l of land) {
  if (!l.coastal || derived[l.id]) continue;
  const lv = verts.get(l.id)!;
  for (const s of sea) {
    const sv = verts.get(s.id)!;
    const near = lv.some((a) => sv.some((b) => Math.hypot(a.x - b.x, a.y - b.y) <= TOLERANCE_PX));
    if (near) {
      link(l.id, s.id);
      (tolerance[l.id] ??= []).push(s.id);
    }
  }
}

for (const id of Object.keys(derived)) derived[id]!.sort();
const derivedSorted = Object.fromEntries(Object.keys(derived).sort().map((id) => [id, derived[id]!]));

const previous = existsSync(linksFile) ? (JSON.parse(readFileSync(linksFile, "utf8")) as { manual?: Record<string, string[]> }) : {};
const links = {
  version: 1,
  source: "derived by packages/db/scripts/derive-map-graph.ts; the manual block is hand-maintained",
  derived: derivedSorted,
  manual: previous.manual ?? {},
};

writeFileSync(graphFile, JSON.stringify(graph, null, 2) + "\n");
writeFileSync(linksFile, JSON.stringify(links, null, 2) + "\n");

// --- Report ------------------------------------------------------------------
const coastalWithout = land.filter((p) => p.coastal && !derived[p.id]).map((p) => p.id);
const nonCoastalWith = land.filter((p) => !p.coastal && derived[p.id]).map((p) => `${p.id} → ${derived[p.id]!.join(",")}`);
console.log(`provinces: ${provinces.length} (${land.length} land, ${sea.length} sea, ${provinces.length - land.length - sea.length} fog); massaliaRegion ${massalia.id}`);
console.log(`coast links: ${Object.keys(derived).length} land provinces linked (${Object.values(derived).reduce((n, l) => n + l.length, 0)} links); manual block entries: ${Object.keys(links.manual).length}`);
console.log(`tolerance pass linked: ${Object.keys(tolerance).length ? Object.entries(tolerance).map(([l, s]) => `${l} → ${s.join(",")}`).join("; ") : "(none)"}`);
console.log(`coastal-flagged without a link: ${coastalWithout.length ? coastalWithout.join(", ") : "(none)"}`);
console.log(`non-coastal with a link (must be empty): ${nonCoastalWith.length ? nonCoastalWith.join("; ") : "(none)"}`);
if (nonCoastalWith.length) process.exitCode = 1;
