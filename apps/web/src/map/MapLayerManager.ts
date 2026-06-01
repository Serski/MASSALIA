import type { IMapRenderer } from "./renderer/IMapRenderer.js";
import type { MapGameState } from "@massalia/shared";
import type { Layer, LayerProps, MapMode, MapStaticData } from "./mapTypes.js";

export class MapLayerManager {
  private layers = new Map<string, Layer>();
  private activeMode: MapMode = "political";
  private props?: Omit<LayerProps, "activeMode">;

  constructor(private readonly renderer: IMapRenderer) {}

  register(layer: Layer) {
    this.layers.set(layer.id, layer);
    if (this.props) layer.mount({ ...this.props, activeMode: this.activeMode });
  }

  mount(staticData: MapStaticData, gameState: MapGameState) {
    this.props = { renderer: this.renderer, staticData, gameState };
    for (const layer of this.sortedLayers()) {
      layer.mount({ ...this.props, activeMode: this.activeMode });
    }
  }

  update(gameState: MapGameState) {
    if (!this.props) return;
    this.props = { ...this.props, gameState };
    for (const layer of this.sortedLayers()) {
      layer.update({ ...this.props, activeMode: this.activeMode });
    }
  }

  setMode(mode: MapMode) {
    this.activeMode = mode;
    if (this.props) this.update(this.props.gameState);
  }

  setLayerVisible(layerId: string, visible: boolean) {
    this.layers.get(layerId)?.setVisible(visible);
  }

  destroy() {
    for (const layer of this.sortedLayers().reverse()) {
      layer.destroy();
    }
    this.layers.clear();
  }

  private sortedLayers() {
    return [...this.layers.values()].sort((a, b) => a.zIndex - b.zIndex);
  }
}
