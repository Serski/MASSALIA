import { useState } from "react";
import { MapCanvas } from "./map/MapCanvas.js";

export function App() {
  const [view, setView] = useState<"landing" | "map">("landing");

  if (view === "map") {
    return (
      <main className="app-shell game-view">
        <section className="topbar">
          <strong>MASSALIA</strong>
          <button className="nav-button compact" type="button" onClick={() => setView("landing")}>
            Campaigns
          </button>
        </section>
        <MapCanvas />
      </main>
    );
  }

  return (
    <main className="landing-shell">
      <section className="landing-hero" aria-label="Massalia campaign launch">
        <nav className="landing-nav" aria-label="Main">
          <button className="brand-lockup" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="brand-mark" aria-hidden="true">
              M
            </span>
            <span>MASSALIA</span>
          </button>
          <div className="nav-actions">
            <button className="nav-button" type="button">
              Login
            </button>
            <button className="nav-button" type="button">
              Sign Up
            </button>
          </div>
        </nav>

        <section className="start-panel ornate-banner" aria-label="Start campaign">
          <div className="banner-rod rod-top" />
          <div className="banner-rod rod-bottom" />
          <div className="banner-border">
            <div className="banner-strip banner-strip-top">
              <span className="corner-square" aria-hidden="true" />
              <h1>MASSALIA</h1>
              <span className="corner-square" aria-hidden="true" />
            </div>
            <div className="banner-center">
              <span className="massalia-emblem" aria-hidden="true">
                M
              </span>
              <p className="season-copy">Season One · Autumn 815 · Mediterranean shard</p>
            </div>
            <div className="banner-strip banner-strip-bottom">
              <button className="start-button" type="button" onClick={() => setView("map")}>
                Start Game
              </button>
            </div>
          </div>
        </section>
      </section>

      <section className="landing-info info-what">
        <div className="info-copy scroll-card">
          <p className="eyebrow">What Is Massalia</p>
          <h2>A persistent Mediterranean strategy world</h2>
          <p>
            Build a dynasty, rule provinces, negotiate with rivals, and shape a seasonal shard where every decision leaves
            a chronicle behind.
          </p>
        </div>
      </section>

      <section className="landing-info info-mechanics">
        <div className="info-copy scroll-card">
          <p className="eyebrow">Game Mechanics</p>
          <h2>Timestamp strategy, server authority, layered maps</h2>
          <p>
            Resources accrue lazily, buildings resolve on queues, events mutate state server-side, and the political map
            updates as ownership changes.
          </p>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">MASSALIA</div>
        <nav aria-label="Legal">
          <a href="#legal">Legal</a>
          <a href="#impressum">Impressum</a>
          <a href="#about">About</a>
          <a href="#cookies">Cookies</a>
        </nav>
        <small>© 2026 MASSALIA. Browser grand strategy prototype.</small>
      </footer>
    </main>
  );
}
