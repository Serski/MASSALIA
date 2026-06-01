import { BorderLayer } from "./layers/BorderLayer.js";
import { LabelLayer } from "./layers/LabelLayer.js";
import { PoliticalColorLayer } from "./layers/PoliticalColorLayer.js";
import { ProvinceLayer } from "./layers/ProvinceLayer.js";
import type { Layer } from "./mapTypes.js";

export const mapConfig = {
  baseImagePath: "/content/map/base-map-placeholder.png",
  defaultMode: "political",
  bounds: { width: 760, height: 400 },
};

export function createDefaultLayers(): Layer[] {
  return [
    new PoliticalColorLayer(),
    new ProvinceLayer(),
    new BorderLayer(),
    new LabelLayer(),
    // TODO: Register region/realm borders, war overlays, armies, roads, rivers,
    // trade routes, event markers, siege icons, construction icons, and movement arrows.
  ];
}
