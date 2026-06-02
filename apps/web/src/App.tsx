import { useState } from "react";
import { MapCanvas } from "./map/MapCanvas.js";

export function App() {
  const [view, setView] = useState<"landing" | "map">("landing");
  const landingStats = {
    cities: "10",
    houses: "10",
    seasonLabel: "Season I",
    seasonStatus: "Open now",
  };
  const leagueCities = [
    { name: "Massalia", resource: "Lead", capital: true },
    { name: "Emporion", resource: "Tin" },
    { name: "Rhoda", resource: "Leather" },
    { name: "Agathe", resource: "Horse" },
    { name: "Arelate", resource: "Wool" },
    { name: "Olbia", resource: "Wood" },
    { name: "Monoikos", resource: "Iron" },
    { name: "Antipolis", resource: "Marble" },
    { name: "Nikaia", resource: "Stone" },
    { name: "Athinopolis", resource: "Salt" },
  ];
  const nobleHouses = [
    { name: "Leonidas", stance: "Very Conservative", alignment: "conservative" },
    { name: "Timon", stance: "Conservative", alignment: "conservative" },
    { name: "Herakleides", stance: "Mod. Conservative", alignment: "conservative" },
    { name: "Iason", stance: "Centrist→Cons.", alignment: "conservative" },
    { name: "Xanthippos", stance: "Centrist", alignment: "centrist" },
    { name: "Aristeides", stance: "Centrist", alignment: "centrist" },
    { name: "Philon", stance: "Reformist→Centrist", alignment: "reformist" },
    { name: "Nicanor", stance: "Mod. Reformist", alignment: "reformist" },
    { name: "Miltiades", stance: "Mod. Reformist", alignment: "reformist" },
    { name: "Kleitos", stance: "Reformist", alignment: "reformist" },
  ];

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
              <img src="/assets/MASSALIA LION.png" alt="" />
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
            <p className="hero-eyebrow">
              <span className="live-pulse" aria-hidden="true" />
              Free Browser Strategy Game
            </p>
            <p className="hero-lead">4th Century BC · The League Of</p>
            <h1>Massalia</h1>
            <p className="hero-subline">Founded by Phocaean Greeks. Forged by ten cities. Ruled by whoever dares.</p>
            <p className="hero-logline">
              Claim one of ten cities, each with its own resource. Join a Noble House, take a side between the old guard
              and the reformers, and trade, scheme, and ally your way to the head of the western Mediterranean&apos;s
              greatest confederation.
            </p>
            <div className="hero-actions">
              {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. The "Play free in your browser" microcopy may also need to change. */}
              <button className="primary-cta" type="button" onClick={() => setView("map")}>
                Start The Game
              </button>
              <p className="cta-note">No download. Play free in your browser.</p>
            </div>
            <dl className="stat-row" aria-label="Live game status">
              <div>
                <dt>Cities to claim</dt>
                <dd>{landingStats.cities}</dd>
              </div>
              <div>
                <dt>Noble Houses</dt>
                <dd>{landingStats.houses}</dd>
              </div>
              <div>
                <dt>{landingStats.seasonLabel}</dt>
                <dd>{landingStats.seasonStatus}</dd>
              </div>
            </dl>
            <p className="todo-note">TODO: wire real live-player count, season length, and countdown when available.</p>
          </div>
          <div className="hero-art-focus" aria-hidden="true">
            <img className="hero-lion" src="/assets/MASSALIA LION.png" alt="" />
          </div>
        </section>
      </section>

      <section className="landing-section pillars-section" id="world" aria-labelledby="pillars-title">
        <p className="section-eyebrow">What You Do</p>
        <h2 id="pillars-title">Three choices that shape your game</h2>
        <div className="pillar-grid">
          <article className="pillar-card">
            <span className="pillar-kicker">I</span>
            <h3>Claim a City &amp; Resource</h3>
            <p>Choose where you begin among the ten cities and the signature resource that fuels your rise.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">II</span>
            <h3>Join a Noble House</h3>
            <p>Pledge to one of ten houses, or found your own.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">III</span>
            <h3>Engage in Politics</h3>
            <p>
              Side with the traditionalist Palaioi or reformist Dynatoi; win the assembly and bend the League to your
              will.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section atlas-section" id="atlas" aria-labelledby="atlas-title">
        <div className="atlas-copy">
          <p className="section-eyebrow">Atlas</p>
          <h2 id="atlas-title">The cities of the League</h2>
          <p>Ten Phocaean cities hold the western sea together. Each begins with a resource worth fighting over.</p>
          <div className="city-list" aria-label="League cities and resources">
            {leagueCities.map((city) => (
              <div className="city-item" key={city.name}>
                <span>{city.capital ? "★ " : ""}{city.name}</span>
                <strong>{city.resource}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="map-frame" role="img" aria-label="World map placeholder">
          <span>Your League of Massalia map goes here</span>
          <strong>GULF OF GALATES</strong>
        </div>
      </section>

      <section className="landing-section parties-section" aria-labelledby="parties-title">
        <p className="section-eyebrow">Assembly</p>
        <h2 id="parties-title">Tradition, or reform?</h2>
        <div className="party-duel">
          <article className="party-card palaioi-card">
            <p className="party-script">ΠΑΛΑΙΟΙ · Palaioi</p>
            <h3>The Conservatives</h3>
            <p className="party-motto">“Preserving the Heritage”</p>
            <p>
              The old Phocaean aristocracy, families of the first settlers who hold the land, temples, and military.
            </p>
            <p>
              They want pure Hellenic tradition, resistance to Gaulish syncretism, and independence against Carthage and
              Rome.
            </p>
          </article>
          <span className="vs-medallion" aria-hidden="true">VS</span>
          <article className="party-card dynatoi-card">
            <p className="party-script">ΔΥΝΑΤΟΙ · Dynatoi</p>
            <h3>The Reformists</h3>
            <p className="party-motto">“Reform for Prosperity”</p>
            <p>Newer progressive families, traders and diplomats tied to the Gaulish tribes.</p>
            <p>
              They want a cosmopolitan Massalia open to Gaulish customs, trade expansion into Gaul, and security through
              alliance over war.
            </p>
          </article>
        </div>
      </section>

      <section className="houses-section" id="factions" aria-label="Ten Noble Houses">
        <div className="houses-heading">
          <span className="section-eyebrow">Factions</span>
          <h2>Ten Noble Houses</h2>
        </div>
        <div className="alignment-legend" aria-label="Alignment legend">
          <span><i className="alignment-dot conservative" /> Conservative</span>
          <span><i className="alignment-dot centrist" /> Centrist</span>
          <span><i className="alignment-dot reformist" /> Reformist</span>
        </div>
        <div className="house-chip-grid">
          {nobleHouses.map((house) => (
            <span className="house-chip" key={house.name}>
              <i className={`alignment-dot ${house.alignment}`} />
              <strong>{house.name}</strong>
              <small>{house.stance}</small>
            </span>
          ))}
        </div>
      </section>

      <section className="closing-cta" aria-label="Start playing Massalia">
        <div>
          <p className="section-eyebrow">Season I now open</p>
          <h2>Enter The League of Massalia</h2>
          <p>No download. Play free in your browser.</p>
        </div>
        {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. The "Play free in your browser" microcopy may also need to change. */}
        <button className="primary-cta" type="button" onClick={() => setView("map")}>
          Start The Game
        </button>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">MASSALIA</div>
        <nav aria-label="Legal">
          <a href="#discord">Discord</a>
          <a href="#lore">Lore</a>
          <a href="#map">Map</a>
          <a href="#support">Support</a>
        </nav>
        <small>© 320 BC – MMXXVI · THE LEAGUE OF MASSALIA</small>
      </footer>
    </main>
  );
}
