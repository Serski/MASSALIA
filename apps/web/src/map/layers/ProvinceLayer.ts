import type { Layer, LayerProps } from "../mapTypes.js";

export class ProvinceLayer implements Layer {
  id = "province-hit-areas";
  zIndex = 30;
  private props?: LayerProps;

  mount(props: LayerProps) {
    this.props = props;
    props.renderer.addPolygonLayer(
      this.id,
      props.staticData.provinces.map((province) => ({
        id: province.id,
        points: province.polygon,
        style: {
          fillOpacity: 0,
          strokeColor: "transparent",
          strokeWidth: 1,
          interactive: true,
        },
      })),
      this.zIndex,
    );
  }

  update(props: LayerProps) {
    this.props = props;
  }

  setVisible(visible: boolean) {
    this.props?.renderer.setLayerVisible(this.id, visible);
  }

  destroy() {
    this.props?.renderer.removeLayer(this.id);
  }
}
