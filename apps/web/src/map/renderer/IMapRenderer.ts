import type { Point, Polygon } from "../mapTypes.js";

export interface RendererLayerHandle {
  id: string;
}

export interface PolygonStyle {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
  interactive?: boolean;
  className?: string;
}

export interface LabelStyle {
  className?: string;
  zIndex?: number;
}

export interface IMapRenderer {
  mount(container: HTMLElement, options: { width: number; height: number }): void;
  destroy(): void;
  addImageLayer(id: string, imageUrl: string, bounds: { width: number; height: number }, zIndex: number): RendererLayerHandle;
  addPolygonLayer(id: string, polygons: Array<{ id: string; points: Polygon; style: PolygonStyle }>, zIndex: number): RendererLayerHandle;
  updatePolygonLayer(id: string, polygons: Array<{ id: string; points: Polygon; style: PolygonStyle }>): void;
  addLabelLayer(id: string, labels: Array<{ id: string; text: string; position: Point; style?: LabelStyle }>, zIndex: number): RendererLayerHandle;
  removeLayer(id: string): void;
  setLayerVisible(id: string, visible: boolean): void;
  fitBounds(bounds: { width: number; height: number }): void;
  on(event: "provinceClick", handler: (provinceId: string) => void): () => void;
}
