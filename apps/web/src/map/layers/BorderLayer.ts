import type { Layer, LayerProps } from "../mapTypes.js";

export class BorderLayer implements Layer {
  id = "province-borders";
  zIndex = 40;
  private props?: LayerProps;

  mount(props: LayerProps) {
    this.props = props;
    props.renderer.addPolygonLayer(
      this.id,
      props.staticData.provinces.map((province) => ({
        id: province.id,
        points: province.polygon,
        style: {
          strokeColor: "#263126",
          strokeWidth: 1,
          fillOpacity: 0,
          interactive: false,
        },
      })),
      this.zIndex,
    );
    // TODO: Add region and realm border layers using the same Layer interface.
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
