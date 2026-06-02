import { useState } from "react";
import { MapCanvas } from "./map/MapCanvas.js";

export function App() {
  const [view, setView] = useState<"landing" | "map">("landing");
  const landingStats = {
    foundersOnline: "128",
    liveWorlds: "3",
    seasonLabel: "Season I",
    countdown: "18d 04h",
  };
  const factionPlaceholders = ["Phocaean Houses", "Rhone Leagues", "Aurelian Marches", "Harbor Guilds"];

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
          <div className="nav-primary-links" aria-label="Landing sections">
            <a href="#world">The World</a>
            <a href="#factions">Factions</a>
            <a href="#atlas">Atlas</a>
          </div>
          <div className="nav-actions">
            <button className="nav-button nav-login" type="button">
              Login
            </button>
            <button className="nav-button nav-signup" type="button">
              Sign Up
            </button>
          </div>
        </nav>

        <section className="hero-content" aria-label="Massalia overview">
          <div className="hero-copy">
            <p className="hero-eyebrow">Free Browser Strategy · Season I now open</p>
            <h1>MASSALIA</h1>
            <p className="hero-subline">280 BC. A young colony rises between empire, sea, and rival dynasties.</p>
            <p className="hero-logline">
              Build a colony, trade across the Mediterranean, command fleets, and conquer the coast.
            </p>
            <div className="hero-actions">
              <button className="primary-cta" type="button" onClick={() => setView("map")}>
                Start The Game
              </button>
              <p className="cta-note">No download. Play free in your browser.</p>
            </div>
            <dl className="stat-row" aria-label="Live game status">
              <div>
                <dt>
                  <span className="live-pulse" aria-hidden="true" />
                  Founders Now
                </dt>
                <dd>{landingStats.foundersOnline}</dd>
              </div>
              <div>
                <dt>Live Worlds</dt>
                <dd>{landingStats.liveWorlds}</dd>
              </div>
              <div>
                <dt>{landingStats.seasonLabel}</dt>
                <dd>{landingStats.countdown}</dd>
              </div>
            </dl>
            <p className="todo-note">TODO: replace placeholder stats with live season data.</p>
          </div>
          <div className="hero-art-focus" aria-hidden="true">
            <img className="hero-lion" src="/assets/MASSALIA LION.png" alt="" />
          </div>
        </section>
      </section>

      <section className="landing-section pillars-section" id="world" aria-labelledby="pillars-title">
        <p className="section-eyebrow">What You Do</p>
        <h2 id="pillars-title">Shape a colony into a Mediterranean power</h2>
        <div className="pillar-grid">
          <article className="pillar-card">
            <span className="pillar-kicker">Build</span>
            <h3>Raise the harbor city</h3>
            <p>Develop districts, queues, and civic works that keep your dynasty fed, paid, and remembered.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">Trade</span>
            <h3>Move goods by sea</h3>
            <p>Send grain, bronze, wine, and favors through routes that make friends rich and enemies nervous.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">Conquer</span>
            <h3>Command the coast</h3>
            <p>Project force through fleets, armies, alliances, and timed decisions that redraw the map.</p>
          </article>
        </div>
      </section>

      <section className="landing-section atlas-section" id="atlas" aria-labelledby="atlas-title">
        <div className="atlas-copy">
          <p className="section-eyebrow">Atlas</p>
          <h2 id="atlas-title">A seasonal world built around the map</h2>
          <p>
            Province ownership, faction color, control, and resources flow from the server into a layered strategy map.
          </p>
        </div>
        <div className="map-frame" role="img" aria-label="World map placeholder">
          <span>TODO: world map asset</span>
        </div>
      </section>

      <section className="faction-strip" id="factions" aria-label="Faction teaser">
        <span className="section-eyebrow">Factions</span>
        {factionPlaceholders.map((faction) => (
          <span className="faction-chip" key={faction}>
            {faction}
          </span>
        ))}
        <span className="todo-note">TODO: replace with real faction names.</span>
      </section>

      <section className="closing-cta" aria-label="Start playing Massalia">
        <div>
          <p className="section-eyebrow">Season I now open</p>
          <h2>Begin your chronicle on the coast</h2>
          <p>No download. Play free in your browser.</p>
        </div>
        <button className="primary-cta" type="button" onClick={() => setView("map")}>
          Start The Game
        </button>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">MASSALIA</div>
        <nav aria-label="Legal">
          <a href="#news">News</a>
          <a href="#discord">Discord</a>
          <a href="#wiki">Wiki</a>
          <a href="#support">Support</a>
        </nav>
        <small>© 2026 MASSALIA. Browser grand strategy prototype.</small>
      </footer>
    </main>
  );
}
