import { useEffect } from "react";
import { SvgIcon, type IconName } from "./shared.js";

// The first-run welcome overlay. Lazy-loaded (see Dashboard) so it never weighs on
// the main bundle, and rendered only while the player's introSeen flag is false.
// Every dismissal path — the button, the backdrop, or Esc — funnels through the
// single `onDismiss` the Dashboard passes, which acks the "intro" step once and
// hides the overlay optimistically.

type NavLine = { icon: IconName; name: string; line: string };

const NAV_LINES: NavLine[] = [
  {
    icon: "court",
    name: "Court",
    line: "Your daily audience. Each day deals a fresh hand of decisions, one per arena, each resolvable once — they expire with the day.",
  },
  {
    icon: "ledger",
    name: "Ledger",
    line: "Your holdings. Build and upgrade your class buildings, collect income, manage your workers.",
  },
  {
    icon: "market",
    name: "Market",
    line: "The agora. Buy and sell goods; hire slaves, freemen, and citizens.",
  },
  {
    icon: "family",
    name: "Family",
    line: "Marry well: every bride arrives with a retinue, some with dowries besides. A new draw of brides arrives each season if none please you. Raise children; secure your heir.",
  },
  {
    icon: "politics",
    name: "Politics",
    line: "Parties, elections, offices. Join the PALAIOI or DYNATOI and climb toward the archonship.",
  },
  {
    icon: "atlas",
    name: "Atlas",
    line: "The world beyond the walls: league cities, factions, standings.",
  },
];

type Trait = { name: string; line: string };

const TRAITS: Trait[] = [
  {
    name: "Stats",
    line: "Prestige, Devotion, Militia, Intelligence, each 0–100. Your class favors one. Age wears them down — Prestige alone never fades.",
  },
  {
    name: "Composure",
    line: "your steadiness. Hard blows drain it; time restores it, faster with a devoted wife. Emptied, you withdraw until you recover.",
  },
  {
    name: "Philia",
    line: "your wife's bond to you. Gifts and symposia raise it — and a devoted wife steadies your composure. Neglect invites complications.",
  },
];

export default function WelcomeOverlay({ onDismiss }: { onDismiss: () => void }) {
  // Esc dismisses, matching the button and backdrop paths.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={onDismiss}>
      <div className="welcome-card" onClick={(event) => event.stopPropagation()}>
        <div className="welcome-body">
          <h2 className="welcome-title" id="welcome-title">Welcome to Massalia</h2>
          <p className="welcome-framing">
            One real day is one season of your life — three months by the calendar. Build, trade, marry, scheme — and leave an heir worthy of the name.
          </p>

          <div className="welcome-tabs">
            {NAV_LINES.map((item) => (
              <div className="welcome-tab" key={item.name}>
                <span className="welcome-tab-ic" aria-hidden="true"><SvgIcon icon={item.icon} /></span>
                <span className="welcome-tab-body">
                  <strong>{item.name}</strong>
                  <span>{item.line}</span>
                </span>
              </div>
            ))}
          </div>

          <h3 className="welcome-section">Reading your character:</h3>
          <div className="welcome-traits">
            {TRAITS.map((trait) => (
              <p className="welcome-trait" key={trait.name}>
                <strong>{trait.name}</strong> — {trait.line}
              </p>
            ))}
          </div>

          <p className="welcome-tip">
            First day: marry — put the dowry into your class building — and join a party.
          </p>
          <p className="welcome-closer">
            Your portrait in the top bar holds your stats, achievements, and settings — start there.
          </p>

          <button className="welcome-enter" type="button" onClick={onDismiss}>
            Enter Massalia
          </button>
        </div>
      </div>
    </div>
  );
}
