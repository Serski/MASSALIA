import L from "leaflet";
import type { IMapRenderer, PolygonStyle } from "./IMapRenderer.js";
import type { Point, Polygon } from "../mapTypes.js";

type ProvinceClickHandler = (provinceId: string) => void;

export class LeafletRenderer implements IMapRenderer {
  private map?: L.Map;
  private layers = new Map<string, L.Layer>();
  private provinceClickHandlers = new Set<ProvinceClickHandler>();

  mount(container: HTMLElement, options: { width: number; height: number }) {
    this.map = L.map(container, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      minZoom: -2,
      maxZoom: 2,
    });
    this.fitBounds(options);
  }

  destroy() {
    this.map?.remove();
    this.layers.clear();
    this.provinceClickHandlers.clear();
  }

  addImageLayer(id: string, imageUrl: string, bounds: { width: number; height: number }, zIndex: number) {
    const layer = L.imageOverlay(imageUrl, this.toLeafletBounds(bounds), { zIndex });
    this.addLayer(id, layer);
    return { id };
  }

  addPolygonLayer(id: string, polygons: Array<{ id: string; points: Polygon; style: PolygonStyle }>, zIndex: number) {
    const group = L.layerGroup();
    for (const polygon of polygons) {
      L.polygon(this.toLatLngs(polygon.points), this.toPathOptions(polygon.style))
        .on("click", () => this.emitProvinceClick(polygon.id))
        .addTo(group);
    }
    (group as unknown as { setZIndex?: (zIndex: number) => void }).setZIndex?.(zIndex);
    this.addLayer(id, group);
    return { id };
  }

  updatePolygonLayer(id: string, polygons: Array<{ id: string; points: Polygon; style: PolygonStyle }>) {
    this.removeLayer(id);
    this.addPolygonLayer(id, polygons, 0);
  }

  addLabelLayer(id: string, labels: Array<{ id: string; text: string; position: Point; style?: { className?: string; zIndex?: number } }>, zIndex: number) {
    const group = L.layerGroup();
    for (const label of labels) {
      const icon = L.divIcon({
        className: label.style?.className ?? "map-label",
        html: label.text,
        iconSize: [120, 20],
        iconAnchor: [60, 10],
      });
      L.marker(this.toLatLng(label.position), { icon, interactive: false, zIndexOffset: label.style?.zIndex ?? zIndex }).addTo(group);
    }
    this.addLayer(id, group);
    return { id };
  }

  removeLayer(id: string) {
    const layer = this.layers.get(id);
    if (layer && this.map) {
      layer.removeFrom(this.map);
    }
    this.layers.delete(id);
  }

  setLayerVisible(id: string, visible: boolean) {
    const layer = this.layers.get(id);
    if (!layer || !this.map) return;
    if (visible) {
      layer.addTo(this.map);
    } else {
      layer.removeFrom(this.map);
    }
  }

  fitBounds(bounds: { width: number; height: number }) {
    this.map?.fitBounds(this.toLeafletBounds(bounds), { animate: false });
  }

  on(event: "provinceClick", handler: ProvinceClickHandler) {
    if (event === "provinceClick") {
      this.provinceClickHandlers.add(handler);
    }
    return () => this.provinceClickHandlers.delete(handler);
  }

  private addLayer(id: string, layer: L.Layer) {
    this.removeLayer(id);
    this.layers.set(id, layer);
    layer.addTo(this.requireMap());
  }

  private emitProvinceClick(provinceId: string) {
    for (const handler of this.provinceClickHandlers) handler(provinceId);
  }

  private toLatLng(point: Point): L.LatLngExpression {
    const [x, y] = point;
    return [y, x];
  }

  private toLatLngs(points: Polygon): L.LatLngExpression[] {
    return points.map((point) => this.toLatLng(point));
  }

  private toLeafletBounds(bounds: { width: number; height: number }): L.LatLngBoundsExpression {
    return [
      [0, 0],
      [bounds.height, bounds.width],
    ];
  }

  private toPathOptions(style: PolygonStyle): L.PathOptions {
    return {
      color: style.strokeColor ?? "#263126",
      weight: style.strokeWidth ?? 1,
      fillColor: style.fillColor ?? "transparent",
      fillOpacity: style.fillOpacity ?? 0,
      interactive: style.interactive ?? false,
      className: style.className,
    };
  }

  private requireMap() {
    if (!this.map) throw new Error("LeafletRenderer is not mounted");
    return this.map;
  }
}
