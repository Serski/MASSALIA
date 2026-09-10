import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopology, parseCoastLinks, parseMapGraph, type Topology } from "@massalia/shared";

// The server-side map topology (content/map/graph.json + coast-links.json),
// validated and built once at boot next to the barracks content. A malformed
// file fails the boot. Reach, basing and movement read getTopology(); nothing
// here is served to the client as a file.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const graphFile = path.join(repoRoot, "content/map/graph.json");
const linksFile = path.join(repoRoot, "content/map/coast-links.json");

let topology: Topology | null = null;

export async function loadMapGraph(): Promise<Topology> {
  const graph = parseMapGraph(JSON.parse(await fs.readFile(graphFile, "utf8")));
  const links = parseCoastLinks(JSON.parse(await fs.readFile(linksFile, "utf8")));
  topology = buildTopology(graph, links);
  return topology;
}

export function getTopology(): Topology {
  if (!topology) throw new Error("Map graph not loaded. Call loadMapGraph() at boot.");
  return topology;
}
