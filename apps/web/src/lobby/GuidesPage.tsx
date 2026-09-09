import { SvgIcon } from "../dashboard/shared.js";
import { GUIDE_CLOSER, GUIDE_FRAMING, GUIDE_READING, GUIDE_READING_HEADER, GUIDE_SECTIONS, GUIDE_TABS, GUIDE_TIP } from "../dashboard/guideContent.js";
import { LobbyFrame, LobbySectionHeading } from "./LobbyFrame.js";

// /guides — public, no login, no API call. The in-game Guide's atoms
// (dashboard/guideContent.tsx) in lobby markup: the strings are imported, never
// copied, so the wording still lives in one place.
const LANDING_LINKS = [
  { href: "/#world", label: "The World" },
  { href: "/#roles", label: "Professions" },
  { href: "/#atlas", label: "Atlas" },
  { href: "/#factions", label: "Factions" },
];

export function GuidesPage() {
  return (
    <LobbyFrame active="guides">
      <div className="lobby-page">
        <section className="lobby-section" aria-labelledby="lobby-guides-title">
          <LobbySectionHeading id="lobby-guides-title" eyebrow="Guides" title="How the city works" />
          <p className="lobby-guide-p">{GUIDE_FRAMING}</p>

          <h3 className="lobby-subhead">The six tabs</h3>
          <ul className="lobby-guide-tabs">
            {GUIDE_TABS.map((tab) => (
              <li key={tab.name}>
                <span className="lobby-guide-icon" aria-hidden="true">
                  <SvgIcon icon={tab.icon} />
                </span>
                <span>
                  <strong>{tab.name}</strong>
                  <span>{tab.line}</span>
                </span>
              </li>
            ))}
          </ul>

          <h3 className="lobby-subhead">{GUIDE_READING_HEADER}</h3>
          <ul className="lobby-guide-reading">
            {GUIDE_READING.map((item) => (
              <li key={item.name}>
                <strong>{item.name}</strong> — {item.line}
              </li>
            ))}
          </ul>

          <p className="lobby-guide-tip">{GUIDE_TIP}</p>

          {GUIDE_SECTIONS.map((section) => (
            <details className="lobby-guide-section" key={section.id}>
              <summary>{section.title}</summary>
              {section.paragraphs.map((paragraph, index) => (
                <p className="lobby-guide-p" key={index}>{paragraph}</p>
              ))}
            </details>
          ))}

          <p className="lobby-guide-closer">{GUIDE_CLOSER}</p>

          <p className="lobby-landing-links">
            <span>More on the landing:</span>
            {LANDING_LINKS.map((link) => (
              <a key={link.href} href={link.href}>{link.label}</a>
            ))}
          </p>
        </section>
      </div>
    </LobbyFrame>
  );
}
