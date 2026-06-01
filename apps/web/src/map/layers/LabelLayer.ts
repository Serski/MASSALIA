import type { Layer, LayerProps } from "../mapTypes.js";

export class LabelLayer implements Layer {
  id = "province-labels";
  zIndex = 50;
  private props?: LayerProps;

  mount(props: LayerProps) {
    this.props = props;
    props.renderer.addLabelLayer(
      this.id,
      props.staticData.labels.provinces.map((label) => ({
        id: label.provinceId,
        text: label.text,
        position: label.position,
        style: { className: "map-label", zIndex: this.zIndex },
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
