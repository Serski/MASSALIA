import type { Layer, LayerProps } from "../mapTypes.js";

export class PoliticalColorLayer implements Layer {
  id = "political-colors";
  zIndex = 20;

  mount(props: LayerProps) {
    this.render(props);
  }

  update(props: LayerProps) {
    this.render(props);
  }

  setVisible(visible: boolean) {
    this.lastProps?.renderer.setLayerVisible(this.id, visible);
  }

  destroy() {
    this.lastProps?.renderer.removeLayer(this.id);
  }

  private lastProps?: LayerProps;

  private render(props: LayerProps) {
    this.lastProps = props;
    props.renderer.removeLayer(this.id);
    props.renderer.addPolygonLayer(
      this.id,
      props.staticData.provinces.map((province) => {
        const state = props.gameState.provinces[province.id];
        const mode = props.staticData.modes[props.activeMode];
        const rawValue = mode && state ? String(state[mode.source] ?? "") : "";
        const color = rawValue.startsWith("#") ? rawValue : props.staticData.fallbackColors[rawValue];
        return {
          id: province.id,
          points: province.polygon,
          style: {
            fillColor: color ?? state?.politicalColor ?? "#b8b08d",
            fillOpacity: 0.42,
            strokeColor: "transparent",
            interactive: false,
          },
        };
      }),
      this.zIndex,
    );
  }
}
