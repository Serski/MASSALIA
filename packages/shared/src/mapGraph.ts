import { z } from "zod";

// ---------------------------------------------------------------------------
// Map graph — the land-and-sea topology the server walks for reach and, later,
// movement. Two content files under content/map/, both derived from the
// hand-drawn World 2 file by packages/db/scripts/derive-map-graph.ts:
//
//   graph.json        every province (R001..R175): type, coastal flag, land or
//                     sea neighbours, towns. No geometry.
//   coast-links.json  land → sea adjacency, which world2.json lacks. `derived`
//                     comes from shared polygon vertices; `manual` is
//                     hand-maintained for coasts the geometry cannot resolve.
//
// buildTopology validates both and returns the sets the reach library uses.
// `fog` provinces are parsed but excluded from every set, and references to
// them are dropped: they are never reachable.
// ---------------------------------------------------------------------------

export const MAP_PROVINCE_TYPES = ["land", "sea", "fog"] as const;
export type MapProvinceType = (typeof MAP_PROVINCE_TYPES)[number];

const regionId = z.string().regex(/^R\d{3}$/, "region id");

const provinceSchema = z
  .object({
    type: z.enum(MAP_PROVINCE_TYPES),
    coastal: z.boolean(),
    neighbors: z.array(regionId),
    towns: z.array(z.string().min(1)),
  })
  .strict();

const graphSchema = z
  .object({
    version: z.literal(1),
    source: z.string(),
    massaliaRegion: regionId,
    provinces: z.record(regionId, provinceSchema),
  })
  .strict();

const linkMap = z.record(regionId, z.array(regionId));

const coastLinksSchema = z
  .object({
    version: z.literal(1),
    source: z.string(),
    derived: linkMap,
    manual: linkMap,
  })
  .strict();

export type MapGraphProvince = z.infer<typeof provinceSchema>;
export type MapGraph = z.infer<typeof graphSchema>;
export type CoastLinks = z.infer<typeof coastLinksSchema>;

export function parseMapGraph(data: unknown): MapGraph {
  return graphSchema.parse(data);
}

export function parseCoastLinks(data: unknown): CoastLinks {
  return coastLinksSchema.parse(data);
}

export type Topology = {
  /** land id → neighbouring land ids (symmetric; fog dropped) */
  land: Map<string, Set<string>>;
  /** sea id → neighbouring sea ids (symmetric) */
  sea: Map<string, Set<string>>;
  /** land id → sea ids it touches (derived ∪ manual) */
  coast: Map<string, Set<string>>;
  /** sea id → land ids touching it (the inverse of `coast`) */
  seaToCoast: Map<string, Set<string>>;
  /** land ids flagged coastal in the graph */
  coastal: Set<string>;
  /** the province holding the town massalia */
  massaliaRegion: string;
  /** town slug → land region id (for resolving town targets) */
  townRegion: Map<string, string>;
};

const MASSALIA_TOWN = "massalia";

function fail(message: string): never {
  throw new Error(`map graph: ${message}`);
}

// Validate the two files against each other and build the walkable sets.
//   - every neighbour and coast-link id exists in the graph
//   - land neighbours land, sea neighbours sea (fog references are dropped)
//   - adjacency is symmetric
//   - every coast link is land → sea
//   - massaliaRegion is a land province holding the town massalia
export function buildTopology(graph: MapGraph, links: CoastLinks): Topology {
  const provinces = graph.provinces;
  const typeOf = (id: string): MapProvinceType | undefined => provinces[id]?.type;

  const land = new Map<string, Set<string>>();
  const sea = new Map<string, Set<string>>();
  for (const [id, p] of Object.entries(provinces)) {
    if (p.type === "land") land.set(id, new Set());
    else if (p.type === "sea") sea.set(id, new Set());
  }

  for (const [id, p] of Object.entries(provinces)) {
    if (p.type === "fog") continue;
    const mine = p.type === "land" ? land : sea;
    for (const n of p.neighbors) {
      const t = typeOf(n);
      if (t === undefined) fail(`${id} lists unknown neighbour ${n}`);
      if (t === "fog") continue;
      if (t !== p.type) fail(`${id} (${p.type}) lists ${n} (${t}) as a neighbour; ${p.type} may only neighbour ${p.type}`);
      if (n === id) fail(`${id} lists itself as a neighbour`);
      mine.get(id)!.add(n);
    }
  }
  for (const [map, what] of [
    [land, "land"],
    [sea, "sea"],
  ] as const) {
    for (const [id, ns] of map) {
      for (const n of ns) if (!map.get(n)!.has(id)) fail(`${what} adjacency is not symmetric: ${id} → ${n} but not ${n} → ${id}`);
    }
  }

  const coast = new Map<string, Set<string>>();
  const seaToCoast = new Map<string, Set<string>>();
  for (const [block, name] of [
    [links.derived, "derived"],
    [links.manual, "manual"],
  ] as const) {
    for (const [landId, seaIds] of Object.entries(block)) {
      const lt = typeOf(landId);
      if (lt === undefined) fail(`coast-links.${name} names unknown province ${landId}`);
      if (lt !== "land") fail(`coast-links.${name}: ${landId} is ${lt}, not land`);
      for (const seaId of seaIds) {
        const st = typeOf(seaId);
        if (st === undefined) fail(`coast-links.${name}: ${landId} links unknown province ${seaId}`);
        if (st !== "sea") fail(`coast-links.${name}: ${landId} → ${seaId} is land → ${st}, not land → sea`);
        if (!coast.has(landId)) coast.set(landId, new Set());
        coast.get(landId)!.add(seaId);
        if (!seaToCoast.has(seaId)) seaToCoast.set(seaId, new Set());
        seaToCoast.get(seaId)!.add(landId);
      }
    }
  }

  const coastal = new Set<string>();
  const townRegion = new Map<string, string>();
  for (const [id, p] of Object.entries(provinces)) {
    if (p.type !== "land") continue;
    if (p.coastal) coastal.add(id);
    for (const town of p.towns) {
      if (townRegion.has(town)) fail(`town ${town} appears in both ${townRegion.get(town)} and ${id}`);
      townRegion.set(town, id);
    }
  }

  const m = graph.massaliaRegion;
  if (typeOf(m) !== "land") fail(`massaliaRegion ${m} is not a land province`);
  if (!provinces[m]!.towns.includes(MASSALIA_TOWN)) fail(`massaliaRegion ${m} does not hold the town ${MASSALIA_TOWN}`);

  return { land, sea, coast, seaToCoast, coastal, massaliaRegion: m, townRegion };
}
