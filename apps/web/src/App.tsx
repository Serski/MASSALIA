import { MapCanvas } from "./map/MapCanvas.js";

export function App() {
  return (
    <main className="app-shell">
      <section className="topbar">
        <strong>MASSALIA</strong>
        <span>Season One</span>
      </section>
      <MapCanvas />
    </main>
  );
}
