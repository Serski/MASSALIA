import type { MapGameState, ProvinceState } from "@massalia/shared";
import type { IMapRenderer } from "./renderer/IMapRenderer.js";

export type Point = [x: number, y: number];
export type Polygon = Point[];
export type MapMode = "political" | "faction" | "culture" | "religion" | "economy";

export interface ProvinceFeature {
  id: string;
  name: string;
  regionId: string;
  realmId: string;
  polygon: Polygon;
}

export interface MapStaticData {
  bounds: { width: number; height: number };
  provinces: ProvinceFeature[];
  labels: {
    provinces: Array<{ provinceId: string; text: string; position: Point }>;
    regions: Array<{ regionId: string; text: string; position: Point }>;
    realms: Array<{ realmId: string; text: string; position: Point }>;
  };
  modes: Record<string, { label: string; source: keyof ProvinceState }>;
  fallbackColors: Record<string, string>;
}

export interface LayerProps {
  renderer: IMapRenderer;
  staticData: MapStaticData;
  gameState: MapGameState;
  activeMode: MapMode;
}

export interface Layer {
  id: string;
  zIndex: number;
  mount(props: LayerProps): void;
  update(props: LayerProps): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
