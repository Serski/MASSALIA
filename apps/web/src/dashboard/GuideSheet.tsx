import { BottomSheet, SheetLabel } from "./sheets.js";
import { SvgIcon } from "./shared.js";
import { GUIDE_CLOSER, GUIDE_FRAMING, GUIDE_READING, GUIDE_SECTIONS, GUIDE_TABS, GUIDE_TIP } from "./guideContent.js";

// The always-available in-game Guide. Lazy-loaded (see Dashboard) and opened via the
// shared activeSheet mechanism; the BottomSheet shell supplies Esc / backdrop / close
// / focus-trap, matching the other sheets. All copy comes from the shared guide module:
// it reprises the onboarding overlay's blocks, then adds the four longer sections.

export default function GuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="guide-sheet-title" title="Guide">
      <SheetLabel>The City &amp; the Clock</SheetLabel>
      <p className="guide-p">{GUIDE_FRAMING}</p>

      <SheetLabel>The Six Tabs</SheetLabel>
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

      <SheetLabel>Reading Your Character</SheetLabel>
      <div className="welcome-traits">
        {GUIDE_READING.map((trait) => (
          <p className="welcome-trait" key={trait.name}>
            <strong>{trait.name}</strong> — {trait.line}
          </p>
        ))}
      </div>

      <SheetLabel>First Day</SheetLabel>
      <p className="guide-p">{GUIDE_TIP}</p>

      {GUIDE_SECTIONS.map((section) => (
        <div key={section.id}>
          <SheetLabel>{section.title}</SheetLabel>
          {section.paragraphs.map((paragraph, index) => (
            <p className="guide-p" key={index}>{paragraph}</p>
          ))}
        </div>
      ))}

      <p className="guide-closer">{GUIDE_CLOSER}</p>
    </BottomSheet>
  );
}
