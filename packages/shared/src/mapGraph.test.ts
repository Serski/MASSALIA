import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTopology, parseCoastLinks, parseMapGraph } from "./mapGraph.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

const graph = parseMapGraph(read("content/map/graph.json"));
const links = parseCoastLinks(read("content/map/coast-links.json"));

describe("map graph", () => {
  it("both real files parse and build a topology of 140 land and 33 sea provinces, fog excluded", () => {
    const t = buildTopology(graph, links);
    expect(Object.keys(graph.provinces)).toHaveLength(175);
    expect(t.land.size).toBe(140);
    expect(t.sea.size).toBe(33);
    expect(t.land.has("R174")).toBe(false);
    expect(t.sea.has("R175")).toBe(false);
    // Fog references are dropped from every neighbour set.
    for (const ns of t.land.values()) for (const n of ns) expect(graph.provinces[n]!.type).toBe("land");
    expect(t.massaliaRegion).toBe("R060");
    expect(t.townRegion.get("massalia")).toBe("R060");
  });

  it("R060 is coastal and touches R150; every coastal-flagged province has a coast link", () => {
    const t = buildTopology(graph, links);
    expect(t.coastal.has("R060")).toBe(true);
    expect(t.coast.get("R060")).toEqual(new Set(["R150"]));
    expect(t.seaToCoast.get("R150")!.has("R060")).toBe(true);
    for (const id of t.coastal) expect(t.coast.get(id)?.size ?? 0, id).toBeGreaterThan(0);
    // The four coasts the geometry only resolves by tolerance.
    expect(links.derived.R057).toEqual(["R150"]);
    expect(links.derived.R109).toEqual(["R159"]);
    expect(links.derived.R114).toEqual(["R162"]);
    expect(links.derived.R137).toEqual(["R167"]);
  });

  it("every sea province is reachable from R150 through sea", () => {
    const t = buildTopology(graph, links);
    const seen = new Set<string>(["R150"]);
    const queue = ["R150"];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of t.sea.get(cur)!) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(t.sea.size);
  });

  it("rejects a fabricated land → land coast link, an unknown id, and a non-symmetric edge", () => {
    const bad = parseCoastLinks({ ...links, manual: { R060: ["R046"] } });
    expect(() => buildTopology(graph, bad)).toThrow(/R060 → R046 is land → land/);
    const unknown = parseCoastLinks({ ...links, manual: { R060: ["R999"] } });
    expect(() => buildTopology(graph, unknown)).toThrow(/unknown province R999/);
    const asym = parseMapGraph({ ...graph, provinces: { ...graph.provinces, R060: { ...graph.provinces.R060!, neighbors: [...graph.provinces.R060!.neighbors, "R001"] } } });
    expect(() => buildTopology(asym, links)).toThrow(/not symmetric: R060 → R001/);
    // A land province neighbouring sea is refused outright.
    const mixed = parseMapGraph({ ...graph, provinces: { ...graph.provinces, R060: { ...graph.provinces.R060!, neighbors: ["R150"] } } });
    expect(() => buildTopology(mixed, links)).toThrow(/land may only neighbour land/);
  });
});
