#!/usr/bin/env node

// Build the first playable MASSALIA theatre from the full generated map.
//
// The full 1,023-cell dataset remains the source of truth. This script selects:
//   - roughly three large display regions inland from the relevant coastlines;
//   - the Balearics, Corsica, Sardinia and Sicily in full;
//   - merged land/sea regions with true shared-edge boundaries;
//   - enough adjoining sea cells to connect the western/central Mediterranean;
//   - empty Atlantic-Iberian and west-French frontier provinces for colonies.
//
// Switzerland, Dalmatia and the rest of the eastern Mediterranean stay as
// terrain-only context under the campaign-boundary fog.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const geoPath = path.join(repoRoot, "packages/db/seed-data/map/provinces.geojson");
const adjacencyPath = path.join(repoRoot, "packages/db/seed-data/map/adjacency.json");
const ownersPath = path.join(repoRoot, "packages/db/seed-data/map/owners_seed.json");
const townsPath = path.join(repoRoot, "apps/web/public/map/towns_px.json");
const pixelsPath = path.join(repoRoot, "apps/web/public/map/provinces_px.json");
const outputPath = path.join(repoRoot, "apps/web/public/map/theatre.json");
const regionsOutputPath = path.join(repoRoot, "apps/web/public/map/regions_px.json");

// Seven source cells become roughly three of the larger display regions. This
// keeps the requested three-region coastal depth after merging the fine mesh.
const SOURCE_LAND_DEPTH = 7;
const DISPLAY_LAND_DEPTH = 3;
const SEA_DEPTH = 3;
const LAND_REGION_SIZE = 4;
const SEA_REGION_SIZE = 4;

function polygonArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function polygonCentroid(ring) {
  const area = polygonArea(ring);
  if (Math.abs(area) < 1e-9) {
    const sum = ring.reduce(([x, y], point) => [x + point[0], y + point[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
}

function outerRings(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  return geometry.coordinates.map((polygon) => polygon[0]);
}

function featureCentroid(feature) {
  const rings = outerRings(feature.geometry);
  const largest = rings.reduce((best, ring) =>
    Math.abs(polygonArea(ring)) > Math.abs(polygonArea(best)) ? ring : best,
  );
  return polygonCentroid(largest);
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(x, y, geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => {
    if (!rings[0] || !pointInRing(x, y, rings[0])) return false;
    return rings.slice(1).every((hole) => !pointInRing(x, y, hole));
  });
}

function inBox(lon, lat, west, south, east, north) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

function inPolygon(lon, lat, polygon) {
  return pointInRing(lon, lat, polygon);
}

// A coarse land-only outline prevents coastal BFS from leaking into the Balkans.
const ITALY = [
  [6.6, 46.5], [13.7, 46.5], [13.8, 44.3], [12.2, 43.3], [12.7, 42.0],
  [15.2, 41.0], [18.8, 40.8], [18.8, 38.3], [16.0, 38.0], [15.6, 36.5],
  [12.0, 36.3], [10.5, 39.0], [8.0, 42.2], [6.6, 44.3],
];

const ISLAND_BOXES = [
  [0.8, 38.3, 4.6, 40.7],   // Balearics
  [8.2, 41.1, 10.1, 43.3],  // Corsica
  [7.8, 38.6, 10.2, 41.5],  // Sardinia
  [11.8, 36.3, 15.9, 38.8], // Sicily
];

function inIsland(lon, lat) {
  return ISLAND_BOXES.some(([west, south, east, north]) => inBox(lon, lat, west, south, east, north));
}

function inSwiss(lon, lat) {
  return inBox(lon, lat, 5.8, 45.7, 10.7, 48.0);
}

function inDalmatiaOrBalkans(lon, lat) {
  return lon > 13.9 && lat > 42.2;
}

function inLandTheatre(lon, lat) {
  const iberia = inBox(lon, lat, -10.7, 35.0, 3.8, 44.5);
  const westFrance = inBox(lon, lat, -5.8, 43.0, 0.8, 47.7);
  const southFrance = inBox(lon, lat, -1.8, 41.8, 8.4, 45.7);
  const italy = inPolygon(lon, lat, ITALY);
  // Coastal Morocco, Algeria and northern Tunisia. Keeping the southern limit
  // above the Sahara avoids turning the first theatre into a continental map.
  const northAfrica = inBox(lon, lat, -11.0, 33.0, 12.0, 38.0);
  return (iberia || westFrance || southFrance || italy || northAfrica || inIsland(lon, lat))
    && !inSwiss(lon, lat)
    && !inDalmatiaOrBalkans(lon, lat);
}

function isDesiredCoast(lon, lat) {
  return inLandTheatre(lon, lat);
}

function inSeaTheatre(lon, lat) {
  // This is only a broad safety envelope. The visible sea frontier is selected
  // by adjacency depth, so it follows complete region edges instead of tracing
  // the sides of a display rectangle.
  return inBox(lon, lat, -15.0, 29.0, 18.5, 49.0)
    && !(lon > 14.0 && lat > 41.0); // no Adriatic/Dalmatian theatre
}

function inColonyFrontier(lon, lat) {
  const atlanticIberia = inBox(lon, lat, -10.7, 36.0, -1.0, 44.5);
  const westFrance = inBox(lon, lat, -5.8, 43.0, 0.5, 47.7);
  return atlanticIberia || westFrance;
}

function expand(start, depth, neighbors, allowed) {
  const selected = new Set(start);
  let frontier = new Set(start);
  for (let step = 1; step < depth; step++) {
    const next = new Set();
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!selected.has(neighbor) && allowed(neighbor)) {
          selected.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }
  return selected;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || String(a).localeCompare(String(b)))[0]?.[0];
}

function cellSort(a, b, centers) {
  const [ax, ay] = centers.get(a);
  const [bx, by] = centers.get(b);
  return by - ay || ax - bx || a.localeCompare(b, undefined, { numeric: true });
}

// Deterministically grow compact connected groups. Bucket boundaries preserve
// initial polity and colony-frontier divisions, so the larger display regions
// do not blur the campaign's starting political geography.
function clusterCells(ids, targetSize, neighbors, centers, bucketOf) {
  const remaining = new Set(ids);
  const groups = [];
  while (remaining.size) {
    const seed = [...remaining].sort((a, b) => cellSort(a, b, centers))[0];
    const bucket = bucketOf(seed);
    const members = [seed];
    remaining.delete(seed);
    while (members.length < targetSize) {
      const candidates = new Set();
      for (const member of members) {
        for (const neighbor of neighbors.get(member) ?? []) {
          if (remaining.has(neighbor) && bucketOf(neighbor) === bucket) candidates.add(neighbor);
        }
      }
      if (!candidates.size) break;
      const mean = members.reduce(([x, y], id) => {
        const [cx, cy] = centers.get(id);
        return [x + cx, y + cy];
      }, [0, 0]).map((value) => value / members.length);
      const next = [...candidates].sort((a, b) => {
        const [ax, ay] = centers.get(a);
        const [bx, by] = centers.get(b);
        const ad = (ax - mean[0]) ** 2 + (ay - mean[1]) ** 2;
        const bd = (bx - mean[0]) ** 2 + (by - mean[1]) ** 2;
        return ad - bd || cellSort(a, b, centers);
      })[0];
      members.push(next);
      remaining.delete(next);
    }
    groups.push({ bucket, members });
  }

  // Absorb isolated one-cell leftovers when they touch a compatible group.
  const membership = new Map(groups.flatMap((group, index) => group.members.map((id) => [id, index])));
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (!group || group.members.length !== 1) continue;
    const candidates = new Set();
    for (const neighbor of neighbors.get(group.members[0]) ?? []) {
      const candidate = membership.get(neighbor);
      if (candidate != null && candidate !== index && groups[candidate]?.bucket === group.bucket) candidates.add(candidate);
    }
    const target = [...candidates]
      .filter((candidate) => groups[candidate].members.length < targetSize + 2)
      .sort((a, b) => groups[a].members.length - groups[b].members.length || a - b)[0];
    if (target == null) continue;
    groups[target].members.push(...group.members);
    for (const id of group.members) membership.set(id, target);
    groups.splice(index, 1);
    for (const [id, groupIndex] of membership) if (groupIndex > index) membership.set(id, groupIndex - 1);
  }
  return groups.map((group) => group.members.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
}

function pathRings(d) {
  const tokens = d.match(/[MLZ]|-?\d+(?:\.\d+)?/gi) ?? [];
  const rings = [];
  let ring = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++].toUpperCase();
    if (token === "M") {
      if (ring.length > 2) rings.push(ring);
      ring = [[Number(tokens[index++]), Number(tokens[index++])]];
    } else if (token === "L") {
      ring.push([Number(tokens[index++]), Number(tokens[index++])]);
    } else if (token === "Z") {
      if (ring.length > 2) rings.push(ring);
      ring = [];
    }
  }
  if (ring.length > 2) rings.push(ring);
  return rings;
}

const pointKey = ([x, y]) => `${x},${y}`;
const edgeKey = (a, b) => {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
};

// Cancel shared member edges, then stitch the remaining coastline/border edges
// into one even-odd SVG path. This creates genuinely larger regions rather than
// merely painting several small provinces the same colour.
function mergePixelPaths(memberIds, pixelById) {
  const boundary = new Map();
  for (const id of memberIds) {
    for (const ring of pathRings(pixelById.get(id).d)) {
      for (let index = 0; index < ring.length; index++) {
        const a = ring[index];
        const b = ring[(index + 1) % ring.length];
        const key = edgeKey(a, b);
        if (boundary.has(key)) boundary.delete(key);
        else boundary.set(key, { a, b });
      }
    }
  }
  const adjacency = new Map();
  const points = new Map();
  const add = (a, b) => {
    const key = pointKey(a);
    points.set(key, a);
    const list = adjacency.get(key) ?? [];
    list.push(pointKey(b));
    adjacency.set(key, list);
  };
  for (const { a, b } of boundary.values()) {
    add(a, b);
    add(b, a);
  }
  for (const [point, connected] of adjacency) {
    if (connected.length % 2 !== 0) throw new Error(`Open merged boundary at ${point}`);
  }
  const unused = new Set(boundary.keys());
  const rings = [];
  while (unused.size) {
    const firstKey = unused.values().next().value;
    const first = boundary.get(firstKey);
    const start = pointKey(first.a);
    let previous = start;
    let current = pointKey(first.b);
    const ring = [first.a, first.b];
    unused.delete(firstKey);
    let guard = 0;
    while (current !== start && guard++ < boundary.size + 2) {
      const options = (adjacency.get(current) ?? []).filter((next) => unused.has(edgeKey(points.get(current), points.get(next))));
      const next = options.find((option) => option !== previous) ?? options[0];
      if (!next) break;
      unused.delete(edgeKey(points.get(current), points.get(next)));
      previous = current;
      current = next;
      if (current !== start) ring.push(points.get(current));
    }
    if (current !== start) throw new Error(`Could not close merged boundary for ${memberIds.join(", ")}`);
    if (ring.length > 2) rings.push(ring);
  }
  return rings.map((ring) => `M${ring.map(([x, y]) => `${x},${y}`).join("L")}Z`).join("");
}

const geojson = JSON.parse(await readFile(geoPath, "utf8"));
const adjacency = JSON.parse(await readFile(adjacencyPath, "utf8"));
const owners = JSON.parse(await readFile(ownersPath, "utf8"));
const towns = JSON.parse(await readFile(townsPath, "utf8")).towns;
const pixels = JSON.parse(await readFile(pixelsPath, "utf8"));

const features = new Map(geojson.features.map((feature) => [feature.properties.id, feature]));
const centers = new Map([...features].map(([id, feature]) => [id, featureCentroid(feature)]));
const neighbors = new Map([...features.keys()].map((id) => [id, new Set()]));
for (const [a, b] of adjacency) {
  neighbors.get(a)?.add(b);
  neighbors.get(b)?.add(a);
}

const landSeeds = [];
const islandLand = [];
for (const [id, feature] of features) {
  if (feature.properties.type !== "land") continue;
  const [lon, lat] = centers.get(id);
  if (inIsland(lon, lat)) islandLand.push(id);
  if (feature.properties.coastal && isDesiredCoast(lon, lat)) landSeeds.push(id);
}

const playableLand = expand(
  [...landSeeds, ...islandLand],
  SOURCE_LAND_DEPTH,
  neighbors,
  (id) => {
    const feature = features.get(id);
    if (feature?.properties.type !== "land") return false;
    const [lon, lat] = centers.get(id);
    return inLandTheatre(lon, lat);
  },
);

// Sea cells grow outward from the selected coastline. Three cells are enough to
// connect the islands without retaining the distant Atlantic/eastern basin.
const seaSeeds = new Set();
for (const landId of playableLand) {
  for (const neighbor of neighbors.get(landId) ?? []) {
    const feature = features.get(neighbor);
    if (feature?.properties.type !== "sea") continue;
    const [lon, lat] = centers.get(neighbor);
    if (inSeaTheatre(lon, lat)) seaSeeds.add(neighbor);
  }
}
const activeSea = expand(
  seaSeeds,
  SEA_DEPTH,
  neighbors,
  (id) => {
    const feature = features.get(id);
    if (feature?.properties.type !== "sea") return false;
    const [lon, lat] = centers.get(id);
    return inSeaTheatre(lon, lat);
  },
);

const frontier = [...playableLand].filter((id) =>
  [...(neighbors.get(id) ?? [])].some((neighbor) => features.get(neighbor)?.properties.type === "land" && !playableLand.has(neighbor)),
);
const colonyCandidates = [...playableLand].filter((id) => {
  if (owners[id]) return false;
  const [lon, lat] = centers.get(id);
  return inColonyFrontier(lon, lat);
});

const activeTownNames = [];
for (const town of towns) {
  const province = [...playableLand].find((id) => pointInGeometry(town.lon, town.lat, features.get(id).geometry));
  if (province) activeTownNames.push(town.name);
}

const sortIds = (ids) => [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
// Wasteland remains terrain-only under fog. The two generated wasteland cells
// are intentionally very large and should never form visible campaign provinces.
const activeProvinceIds = sortIds(new Set([...playableLand, ...activeSea]));
const pixelById = new Map(pixels.provinces.map((province) => [province.id, province]));
const colonySet = new Set(colonyCandidates);
const frontierSet = new Set(frontier);
const landGroups = clusterCells(
  playableLand,
  LAND_REGION_SIZE,
  neighbors,
  centers,
  (id) => owners[id] ? `owner:${owners[id]}` : colonySet.has(id) ? "colony" : "unclaimed",
);
const seaGroups = clusterCells(activeSea, SEA_REGION_SIZE, neighbors, centers, () => "sea");

function makeRegion(memberProvinceIds, type, index) {
  const memberFeatures = memberProvinceIds.map((id) => features.get(id));
  return {
    id: `${type === "land" ? "RL" : "RS"}${String(index + 1).padStart(4, "0")}`,
    type,
    terrain: mode(memberFeatures.map((feature) => feature.properties.terrain)) ?? type,
    coastal: memberFeatures.some((feature) => feature.properties.coastal),
    frontier: type === "land" && memberProvinceIds.some((id) => frontierSet.has(id)),
    colonyCandidate: type === "land" && memberProvinceIds.every((id) => colonySet.has(id)),
    memberProvinceIds,
    d: mergePixelPaths(memberProvinceIds, pixelById),
  };
}

const displayRegions = [
  ...landGroups.map((members, index) => makeRegion(members, "land", index)),
  ...seaGroups.map((members, index) => makeRegion(members, "sea", index)),
];

// Crop the presentation to the selected theatre instead of scaling the full
// Europe/Africa source frame into a very tall page. Paths are generated from
// M/L coordinates, so paired numeric values describe their complete bounds.
// Use land for framing: a few very large generated sea cells reach the source
// image edges and would otherwise force the entire world-height frame back in.
const activePixelIds = new Set(playableLand);
let minX = Number.POSITIVE_INFINITY;
let minY = Number.POSITIVE_INFINITY;
let maxX = Number.NEGATIVE_INFINITY;
let maxY = Number.NEGATIVE_INFINITY;
for (const province of pixels.provinces) {
  if (!activePixelIds.has(province.id)) continue;
  const coordinates = province.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  for (let index = 0; index < coordinates.length; index += 2) {
    minX = Math.min(minX, coordinates[index]);
    minY = Math.min(minY, coordinates[index + 1]);
    maxX = Math.max(maxX, coordinates[index]);
    maxY = Math.max(maxY, coordinates[index + 1]);
  }
}
const viewPadding = 70;
let viewX = Math.max(0, Math.floor(minX - viewPadding));
const viewY = Math.max(0, Math.floor(minY - viewPadding));
let viewWidth = Math.min(pixels.width, Math.ceil(maxX + viewPadding)) - viewX;
const viewHeight = Math.min(pixels.height, Math.ceil(maxY + viewPadding)) - viewY;
const targetWidth = Math.min(pixels.width, Math.ceil(viewHeight * 1.6));
if (viewWidth < targetWidth) {
  viewX = Math.max(0, Math.min(pixels.width - targetWidth, Math.round(viewX - (targetWidth - viewWidth) / 2)));
  viewWidth = targetWidth;
}
// Avoid the artificial diagonal edge of the source projection at the far-left
// image boundary; there is still ample Atlantic water west of Iberia.
if (viewX < 150) {
  viewX = 150;
  viewWidth = Math.min(viewWidth, pixels.width - viewX);
}
const viewBox = { x: viewX, y: viewY, width: viewWidth, height: viewHeight };
const output = {
  version: 2,
  name: "Western and Central Mediterranean Theatre",
  description: "Large coastal regions across the western and central Mediterranean, with full major islands and black fog beyond the campaign boundary.",
  landDepth: DISPLAY_LAND_DEPTH,
  seaDepth: SEA_DEPTH,
  viewBox,
  activeProvinceIds,
  playableLandProvinceIds: sortIds(playableLand),
  activeSeaProvinceIds: sortIds(activeSea),
  frontierProvinceIds: sortIds(frontier),
  colonyCandidateProvinceIds: sortIds(colonyCandidates),
  initialOwners: Object.fromEntries(
    sortIds(playableLand)
      .filter((id) => owners[id])
      .map((id) => [id, owners[id]]),
  ),
  activeTownNames: activeTownNames.sort(),
  displayRegionCount: displayRegions.length,
  displayLandRegionCount: landGroups.length,
  displaySeaRegionCount: seaGroups.length,
  excludedRegions: ["Switzerland", "Dalmatia", "Balkans", "Eastern Mediterranean", "deep continental interiors"],
};

const regionOutput = {
  version: 1,
  width: pixels.width,
  height: pixels.height,
  regions: displayRegions,
};

await Promise.all([
  writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
  writeFile(regionsOutputPath, `${JSON.stringify(regionOutput)}\n`),
]);
console.log(`theatre written: ${path.relative(repoRoot, outputPath)}`);
console.log(`  playable land:   ${output.playableLandProvinceIds.length}`);
console.log(`  active sea:      ${output.activeSeaProvinceIds.length}`);
console.log(`  frontier land:   ${output.frontierProvinceIds.length}`);
console.log(`  colony options:  ${output.colonyCandidateProvinceIds.length}`);
console.log(`  active towns:    ${output.activeTownNames.length}`);
console.log(`  display regions: ${displayRegions.length} (${landGroups.length} land, ${seaGroups.length} sea)`);
