import type { MapGameState } from "@massalia/shared";
import { apiBaseUrl } from "../api.js";
import type { MapStaticData, ProvinceFeature } from "./mapTypes.js";
import { mapConfig } from "./mapConfig.js";

interface ProvinceGeoJson {
  features: Array<{
    properties: { id: string; name: string; regionId: string; realmId: string };
    geometry: { coordinates: [[number, number][]] };
  }>;
}

export class MapDataProvider {
  private eventSource?: EventSource;

  async loadStaticData(): Promise<MapStaticData> {
    const [geojson, labels, modes] = await Promise.all([
      fetch("/content/map/provinces.geojson").then((response) => response.json() as Promise<ProvinceGeoJson>),
      fetch("/content/map/labels.json").then((response) => response.json()),
      fetch("/content/map/map-modes.json").then((response) => response.json()),
    ]);

    return {
      bounds: mapConfig.bounds,
      provinces: geojson.features.map((feature): ProvinceFeature => ({
        id: feature.properties.id,
        name: feature.properties.name,
        regionId: feature.properties.regionId,
        realmId: feature.properties.realmId,
        polygon: feature.geometry.coordinates[0],
      })),
      labels,
      modes: modes.modes,
      fallbackColors: modes.fallbackColors,
    };
  }

  async loadGameState(): Promise<MapGameState> {
    return fetch(`${apiBaseUrl}/api/world/state`).then((response) => response.json());
  }

  subscribeGameState(onState: (state: MapGameState) => void) {
    this.eventSource = new EventSource(`${apiBaseUrl}/api/world/stream`);
    this.eventSource.addEventListener("state", (event) => {
      onState(JSON.parse((event as MessageEvent<string>).data));
    });
    return () => this.eventSource?.close();
  }
}
