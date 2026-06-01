import { useEffect, useRef, useState } from "react";
import type { ProvinceState } from "@massalia/shared";
import { createDefaultLayers, mapConfig } from "./mapConfig.js";
import { MapDataProvider } from "./mapDataProvider.js";
import { MapLayerManager } from "./MapLayerManager.js";
import { LeafletRenderer } from "./renderer/LeafletRenderer.js";

export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [selectedProvince, setSelectedProvince] = useState<ProvinceState | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const renderer = new LeafletRenderer();
    const manager = new MapLayerManager(renderer);
    const provider = new MapDataProvider();
    let unsubscribeState: (() => void) | undefined;
    let unsubscribeClick: (() => void) | undefined;
    let disposed = false;

    renderer.mount(hostRef.current, mapConfig.bounds);
    renderer.addImageLayer("base-map", mapConfig.baseImagePath, mapConfig.bounds, 0);

    Promise.all([provider.loadStaticData(), provider.loadGameState()]).then(([staticData, gameState]) => {
      if (disposed) return;
      for (const layer of createDefaultLayers()) manager.register(layer);
      manager.mount(staticData, gameState);
      unsubscribeClick = renderer.on("provinceClick", (provinceId) => setSelectedProvince(gameState.provinces[provinceId] ?? null));
      unsubscribeState = provider.subscribeGameState((nextState) => {
        manager.update(nextState);
        setSelectedProvince((current) => (current ? nextState.provinces[current.id] ?? null : null));
      });
    });

    return () => {
      disposed = true;
      unsubscribeState?.();
      unsubscribeClick?.();
      manager.destroy();
      renderer.destroy();
    };
  }, []);

  return (
    <section className="map-screen">
      <div ref={hostRef} className="map-host" />
      {selectedProvince && (
        <aside className="hud-panel">
          <h2>{selectedProvince.name}</h2>
          <dl>
            <dt>Owner</dt>
            <dd>{selectedProvince.ownerName ?? "Unclaimed"}</dd>
            <dt>Faction</dt>
            <dd>{selectedProvince.factionId ?? "None"}</dd>
            <dt>Control</dt>
            <dd>{selectedProvince.controlStatus}</dd>
            <dt>Terrain</dt>
            <dd>{selectedProvince.terrain}</dd>
            <dt>Buildings</dt>
            <dd>{selectedProvince.buildings.map((building) => `${building.type} ${building.level}`).join(", ") || "None"}</dd>
            <dt>Resources</dt>
            <dd>{selectedProvince.resources.map((resource) => `${resource.type}: ${Math.floor(resource.amount)}`).join(", ") || "None"}</dd>
          </dl>
        </aside>
      )}
    </section>
  );
}
