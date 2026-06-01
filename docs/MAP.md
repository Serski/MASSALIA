# Map System

The map is a central game system. It is built as data plus server state plus renderer-backed layers.

## Separation Of Concerns

- Map data: static geometry, ids, labels, and region/realm grouping in `content/map`.
- Game state: dynamic server-owned ownership, faction colors, resources, buildings, and control status from `/api/world/state`.
- Rendering: the only Leaflet-aware code is `LeafletRenderer`.

React is a thin host in `MapCanvas.tsx`. All layer behavior lives in `.ts` files with no React imports.

## Renderer Boundary

`IMapRenderer` is the abstraction every layer uses:

- `mount`
- `addImageLayer`
- `addPolygonLayer`
- `updatePolygonLayer`
- `addLabelLayer`
- `removeLayer`
- `setLayerVisible`
- `fitBounds`
- `on("provinceClick")`

Leaflet is the first implementation, using `CRS.Simple`. A later PixiJS/WebGL renderer should implement the same interface and replace only the renderer construction.

## Coordinate Convention

Content files use GeoJSON-style `[x, y]` coordinates. Leaflet `CRS.Simple` expects `[y, x]`. That transform happens only inside `LeafletRenderer`; layers and map data never handle renderer-specific coordinate order.

## Layer Interface

Every layer implements:

```ts
interface Layer {
  id: string;
  zIndex: number;
  mount(props: LayerProps): void;
  update(props: LayerProps): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
```

The `MapLayerManager` registers layers, orders by `zIndex`, updates them when game state changes, toggles visibility, and controls the active map mode.

## Current Vertical Slice

- Base placeholder image layer.
- Clickable province polygon hit areas.
- Political/faction color layer driven by API state.
- Province border layer.
- Province label layer.
- HUD province panel populated from API state.

## Adding A Layer

1. Create a new `layers/FooLayer.ts` implementing `Layer`.
2. Render only through `IMapRenderer`.
3. Consume only `LayerProps`; do not fetch inside the layer.
4. Register it in `createDefaultLayers`.

Future layers already planned: region and realm borders, war and occupation overlays, armies, roads, rivers, trade routes, event markers, siege icons, construction icons, and movement arrows.

## Swapping The Painted Map

Replace `content/map/base-map-placeholder.png` with the final painted image and update `mapConfig.bounds` if its dimensions change. Province polygons and labels remain separate data files.
