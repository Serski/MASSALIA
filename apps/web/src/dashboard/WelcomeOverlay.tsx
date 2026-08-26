import { useEffect } from "react";
import { SvgIcon } from "./shared.js";
import { GUIDE_CLOSER, GUIDE_FRAMING, GUIDE_READING, GUIDE_READING_HEADER, GUIDE_REREAD, GUIDE_TABS, GUIDE_TIP, GUIDE_TITLE } from "./guideContent.js";

// The first-run welcome overlay. Lazy-loaded (see Dashboard) so it never weighs on
// the main bundle, and rendered only while the player's introSeen flag is false.
// Every dismissal path — the button, the backdrop, or Esc — funnels through the
// single `onDismiss` the Dashboard passes, which acks the "intro" step once and
// hides the overlay optimistically. All copy comes from the shared guide module.

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
          <h2 className="welcome-title" id="welcome-title">{GUIDE_TITLE}</h2>
          <p className="welcome-framing">{GUIDE_FRAMING}</p>

          <div className="welcome-tabs">
            {GUIDE_TABS.map((item) => (
              <div className="welcome-tab" key={item.name}>
                <span className="welcome-tab-ic" aria-hidden="true"><SvgIcon icon={item.icon} /></span>
                <span className="welcome-tab-body">
                  <strong>{item.name}</strong>
                  <span>{item.line}</span>
                </span>
              </div>
            ))}
          </div>

          <h3 className="welcome-section">{GUIDE_READING_HEADER}</h3>
          <div className="welcome-traits">
            {GUIDE_READING.map((trait) => (
              <p className="welcome-trait" key={trait.name}>
                <strong>{trait.name}</strong> — {trait.line}
              </p>
            ))}
          </div>

          <p className="welcome-tip">{GUIDE_TIP}</p>
          <p className="welcome-closer">{GUIDE_CLOSER}</p>
          <p className="welcome-reread">{GUIDE_REREAD}</p>

          <button className="welcome-enter" type="button" onClick={onDismiss}>
            Enter Massalia
          </button>
        </div>
      </div>
    </div>
  );
}
