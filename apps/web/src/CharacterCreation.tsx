import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, apiErrorMessage, contentUrl, type AgeConfig } from "./api.js";
import { assetPath, nobleHouses, professions, type Alignment, type House, type Profession } from "./data/league.js";
import "./characterCreation.css";

type AgeAvatar = AgeConfig["avatars"][number];
type AgeOption = AgeConfig["ageOptions"][number];

// Signup shows each avatar at its starting-age stage (20 -> young, 30 -> prime).
function signupStage(startAge: number): "young" | "prime" {
  return startAge >= 30 ? "prime" : "young";
}

function avatarSignupImage(avatar: AgeAvatar): string | undefined {
  return contentUrl(`/content/age/${avatar.portraits[signupStage(avatar.startAge)] ?? ""}`);
}

const STAT_LABELS: Record<string, string> = { prestige: "Prestige", devotion: "Devotion", militia: "Militia", intelligence: "Intelligence" };

function headStartLabel(option: AgeOption): string {
  const parts = Object.entries(option.startBonus).filter(([, v]) => v).map(([k, v]) => `+${v} ${STAT_LABELS[k] ?? k}`);
  return parts.length ? parts.join(", ") : "No head start";
}

type CreationPayload = {
  classSlug: string;
  houseSlug: string;
  avatarId: string;
  name: string;
  origin: "Massalia · the capital";
  email?: string;
};

type SheetState =
  | { type: "class"; item: Profession }
  | { type: "house"; item: House }
  | null;

const steps = [
  "Choose your calling",
  "Pledge your House",
  "Choose your age & face",
  "Save your character",
];

// A signup avatar tile. Falls back to a label when the (placeholder) art is missing.
function AvatarFace({ label, image, selected, onSelect }: { label: string; image?: string; selected: boolean; onSelect: () => void }) {
  const [imageOk, setImageOk] = useState(true);
  const showImage = Boolean(image) && imageOk;
  return (
    <button
      type="button"
      className={`creation-face${selected ? " selected" : ""}${showImage ? "" : " placeholder"}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Choose ${label}`}
    >
      {showImage ? (
        <img src={image} alt="" width="320" height="420" loading="lazy" decoding="async" onError={() => setImageOk(false)} />
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}

function alignmentLabel(alignment: Alignment) {
  return alignment[0]!.toUpperCase() + alignment.slice(1);
}

function DetailSheet({
  sheet,
  onClose,
  onChooseClass,
  onChooseHouse,
}: {
  sheet: SheetState;
  onClose: () => void;
  onChooseClass: (profession: Profession) => void;
  onChooseHouse: (house: House) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sheet) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sheet, onClose]);

  if (!sheet) {
    return null;
  }

  const name = sheet.item.name;

  return (
    <div className="creation-sheet-backdrop" onMouseDown={onClose}>
      <section
        className="creation-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creation-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="creation-sheet-handle" aria-hidden="true" />
        <div className="creation-sheet-body">
          <p className="section-eyebrow">{sheet.type === "class" ? "Calling details" : "House details"}</p>
          <h2 id="creation-sheet-title">{name}</h2>
          {sheet.type === "class" ? <ClassSheet profession={sheet.item} /> : <HouseSheet house={sheet.item} />}
        </div>
        <footer className="creation-sheet-footer">
          <button className="creation-ghost-button" type="button" onClick={onClose}>
            Close
          </button>
          <button
            className="primary-cta creation-sheet-primary"
            type="button"
            onClick={() => {
              if (sheet.type === "class") {
                onChooseClass(sheet.item);
              } else {
                onChooseHouse(sheet.item);
              }
              onClose();
            }}
          >
            {sheet.type === "class" ? `Choose ${name}` : `Pledge to ${name}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ClassSheet({ profession }: { profession: Profession }) {
  return (
    <div className="creation-detail-stack">
      <p>{profession.objective}</p>
      <dl className="creation-facts">
        <div>
          <dt>Starting income</dt>
          <dd>{profession.income}</dd>
        </div>
        <div>
          <dt>Cost facts</dt>
          <dd>{profession.narrativePath ? "No coin, land, or House at start." : "100 dr. to start."}</dd>
        </div>
      </dl>
      {profession.narrativePath ? (
        <ol className="creation-arc creation-arc-iron">
          {profession.narrativePath.milestones.map((milestone) => (
            <li key={milestone.milestone}>
              <strong>{milestone.milestone}</strong>
              <p>{milestone.advance}</p>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="creation-arc">
          {profession.tiers.map((tier) => (
            <li key={tier.building}>
              <strong>{tier.building}</strong>
              <span>{tier.rank}</span>
              <p>{tier.benefit}{tier.upkeep ? `; upkeep ${tier.upkeep}` : ""}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HouseSheet({ house }: { house: House }) {
  return (
    <div className="creation-detail-stack">
      <p className="party-motto">"{house.motto}"</p>
      <dl className="creation-facts">
        <div>
          <dt>Leaning</dt>
          <dd><AlignmentTag alignment={house.alignment} label={house.stance} /></dd>
        </div>
        <div>
          <dt>Patron deity</dt>
          <dd>{house.patron}</dd>
        </div>
      </dl>
      <p><strong>Who they are:</strong> {house.history}</p>
      <p><strong>Defining moment:</strong> {house.moment}</p>
    </div>
  );
}

function AlignmentTag({ alignment, label = alignmentLabel(alignment) }: { alignment: Alignment; label?: string }) {
  return (
    <span className="creation-leaning">
      <span className={`alignment-dot ${alignment}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function ChoiceCard({
  selected,
  hardMode,
  children,
  onClick,
  onDetails,
  ariaLabel,
}: {
  selected: boolean;
  hardMode?: boolean;
  children: ReactNode;
  onClick: () => void;
  onDetails: () => void;
  ariaLabel: string;
}) {
  return (
    <article className={`creation-choice-card${selected ? " selected" : ""}${hardMode ? " hard-mode" : ""}`}>
      {hardMode ? <span className="hard-mode-badge">Hard Mode</span> : null}
      {selected ? <span className="creation-check" aria-hidden="true">✓</span> : null}
      <button
        className="creation-card-main"
        type="button"
        aria-pressed={selected}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {children}
      </button>
      <button
        className="creation-details-link"
        type="button"
        onClick={onDetails}
      >
        ⓘ View details
      </button>
    </article>
  );
}

function SummaryCard({
  selectedClass,
  selectedHouse,
  portraitImage,
  portraitFallback,
  name,
}: {
  selectedClass?: Profession;
  selectedHouse?: House;
  portraitImage?: string;
  portraitFallback: string;
  name: string;
}) {
  const [imageOk, setImageOk] = useState(true);
  useEffect(() => setImageOk(true), [portraitImage]);
  const showImage = Boolean(portraitImage) && imageOk;
  return (
    <aside className="creation-summary" aria-label="You, in the League">
      <p className="section-eyebrow">You, in the League</p>
      <div className="summary-portrait">
        <span className={`summary-ring${showImage ? " has-portrait" : ""}`} aria-hidden="true">
          {showImage ? (
            <img src={portraitImage} alt="" width="160" height="160" onError={() => setImageOk(false)} />
          ) : (
            portraitFallback
          )}
        </span>
      </div>
      <h2>{name.trim() || "Unnamed"}</h2>
      <p>{selectedClass ? `${selectedClass.rank} · ${selectedClass.name}` : "— · class"}</p>
      <dl>
        <div><dt>Origin</dt><dd>Massalia · the capital</dd></div>
        <div><dt>House</dt><dd>{selectedHouse ? selectedHouse.name : "— not yet —"}</dd></div>
        <div><dt>Party</dt><dd className="muted">chosen in-game</dd></div>
        <div><dt>Epithet</dt><dd className="muted">earned later</dd></div>
      </dl>
      <small>Ring, sigil, and name are drawn in code over the portrait. No per-player art.</small>
    </aside>
  );
}

export function CharacterCreation({ onExit, onComplete }: { onExit: () => void; onComplete: (payload: CreationPayload) => void }) {
  const [step, setStep] = useState(1);
  const [selectedClassSlug, setSelectedClassSlug] = useState("");
  const [selectedHouseSlug, setSelectedHouseSlug] = useState("");
  const [selectedFace, setSelectedFace] = useState("");
  const [ageConfig, setAgeConfig] = useState<AgeConfig | null>(null);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newsletter, setNewsletter] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedClass = useMemo(() => professions.find((profession) => profession.slug === selectedClassSlug), [selectedClassSlug]);
  const selectedHouse = useMemo(() => nobleHouses.find((house) => house.slug === selectedHouseSlug), [selectedHouseSlug]);

  // Load the age config (avatars + age options) for the signup gallery.
  useEffect(() => {
    let cancelled = false;
    api.ageConfig().then((cfg) => !cancelled && setAgeConfig(cfg)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The faces for the chosen age, scoped to the class's face pool: hetaira draw
  // from the female hetaira pool, every other class from the male player pool.
  // Wife portraits (pool "wife") are never a signup face.
  const avatarsForAge = useMemo(() => {
    if (!ageConfig || selectedAge === null) return [];
    const facePool = selectedClass?.slug === "hetaira" ? "hetaira" : "player";
    return ageConfig.avatars.filter((avatar) => avatar.startAge === selectedAge && (avatar.pool ?? "player") === facePool);
  }, [ageConfig, selectedAge, selectedClass]);
  const selectedAvatar = useMemo(() => avatarsForAge.find((avatar) => avatar.id === selectedFace), [avatarsForAge, selectedFace]);

  const canContinue =
    (step === 1 && Boolean(selectedClass)) ||
    (step === 2 && Boolean(selectedHouse)) ||
    (step === 3 && selectedAge !== null && Boolean(selectedFace) && Boolean(name.trim())) ||
    (step === 4 && consent);

  function continueLabel() {
    if (step === 3) {
      return "Continue → email";
    }
    if (step === 4) {
      return "Enter the agora →";
    }
    return "Continue →";
  }

  function goNext() {
    if (!canContinue) {
      return;
    }
    if (step < 4) {
      setStep((current) => current + 1);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!selectedClass || !selectedHouse || !selectedFace || !name.trim() || !consent) {
      return;
    }
    const payload: CreationPayload = {
      classSlug: selectedClass.slug,
      houseSlug: selectedHouse.slug,
      avatarId: selectedFace,
      name: name.trim(),
      origin: "Massalia · the capital",
      email,
    };
    setIsSubmitting(true);
    try {
      await api.register(email, password, newsletter);
      await api.createCharacter(payload);
      onComplete(payload);
    } catch (error) {
      setMessage(apiErrorMessage(error, "creation"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="creation-shell">
      <nav className="creation-nav" aria-label="Character creation">
        <button className="brand-lockup" type="button" onClick={onExit}>
          <span className="brand-mark" aria-hidden="true">
            <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </span>
          <span>MASSALIA</span>
        </button>
        <button className="creation-ghost-button" type="button" onClick={onExit}>Exit</button>
      </nav>
      <section className="creation-layout" aria-labelledby="creation-title">
        <SummaryCard
          selectedClass={selectedClass}
          selectedHouse={selectedHouse}
          portraitImage={selectedAvatar ? avatarSignupImage(selectedAvatar) : undefined}
          portraitFallback={selectedAge !== null ? `Age ${selectedAge}` : "—"}
          name={name}
        />
        <section className="creation-panel">
          <p className="section-eyebrow">Character Creation · Step {step} of 4</p>
          <h1 id="creation-title">{steps[step - 1]}</h1>
          <div className="creation-stepper" aria-label="Creation progress">
            {steps.map((label, index) => (
              <span className={index + 1 <= step ? "active" : ""} key={label} aria-label={`Step ${index + 1}: ${label}`} />
            ))}
          </div>

          {step === 1 ? (
            <div className="creation-class-grid">
              {professions.map((profession) => (
                <ChoiceCard
                  ariaLabel={`Choose ${profession.name}`}
                  hardMode={profession.hardMode}
                  key={profession.slug}
                  selected={selectedClassSlug === profession.slug}
                  onClick={() => setSelectedClassSlug(profession.slug)}
                  onDetails={() => setSheet({ type: "class", item: profession })}
                >
                  <span className="creation-figure">
                    <img src={profession.image} alt="" width="260" height="380" loading="lazy" decoding="async" />
                  </span>
                  <span className="creation-card-copy">
                    <strong>{profession.name}</strong>
                    <span>{profession.rank}</span>
                  </span>
                </ChoiceCard>
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <>
              <div className="creation-house-grid">
                {nobleHouses.map((house) => (
                  <ChoiceCard
                    ariaLabel={`Pledge to ${house.name}`}
                    key={house.slug}
                    selected={selectedHouseSlug === house.slug}
                    onClick={() => setSelectedHouseSlug(house.slug)}
                    onDetails={() => setSheet({ type: "house", item: house })}
                  >
                    <span className="creation-house-crest" aria-hidden="true">
                      {house.image ? <img src={house.image} alt="" loading="lazy" /> : house.initial}
                    </span>
                    <span className="creation-card-copy">
                      <strong>{house.name}</strong>
                      <AlignmentTag alignment={house.alignment} />
                    </span>
                  </ChoiceCard>
                ))}
              </div>
              <p className="creation-note">The House hints which way you may lean when parties come courting.</p>
            </>
          ) : null}

          {step === 3 ? (
            <div className="creation-avatar-step">
              {/* Choose a starting age FIRST — it swaps the avatar gallery and is
                  the whole tradeoff (20 = longer life, 30 = a head start). */}
              <div className="creation-age-toggle" role="group" aria-label="Choose your starting age">
                {(ageConfig?.ageOptions ?? []).map((option) => (
                  <button
                    key={option.age}
                    type="button"
                    className={`creation-age-option${selectedAge === option.age ? " selected" : ""}`}
                    aria-pressed={selectedAge === option.age}
                    onClick={() => {
                      setSelectedAge(option.age);
                      setSelectedFace("");
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span className="creation-age-note">{option.note}</span>
                    <span className={`creation-age-bonus${Object.keys(option.startBonus).length ? "" : " muted"}`}>
                      Head start: {headStartLabel(option)}
                    </span>
                  </button>
                ))}
              </div>

              {selectedAge === null ? (
                <p className="creation-note">Pick an age to see its faces.</p>
              ) : (
                <div className="creation-face-grid" aria-label="Choose your face">
                  {avatarsForAge.map((avatar, index) => (
                    <AvatarFace
                      key={avatar.id}
                      label={`Face ${index + 1}`}
                      image={avatarSignupImage(avatar)}
                      selected={selectedFace === avatar.id}
                      onSelect={() => setSelectedFace(avatar.id)}
                    />
                  ))}
                </div>
              )}

              <div className="creation-name-fields">
                <label>
                  <span>Name</span>
                  <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
                </label>
                <label>
                  <span>Epithet</span>
                  <input type="text" value="earned later — locked" disabled />
                </label>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <form className="creation-account-form" id="creation-account-form" onSubmit={handleSubmit}>
              <p className="creation-note">Save your character.</p>
              <button className="primary-cta" type="button" onClick={() => setMessage("TODO: Discord OAuth is not connected yet.")}>
                Continue with Discord
              </button>
              <div className="auth-divider"><span>or</span></div>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <label>
                <span>Password</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
              </label>
              <label className="creation-consent">
                <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
                <span>Send me season updates and League dispatches.</span>
              </label>
              <label className="creation-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
                <span>I accept the <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Policy</a>.</span>
              </label>
              {message ? <p className="auth-message" role="status">{message}</p> : null}
            </form>
          ) : null}

          <footer className="creation-footer">
            <button className="creation-ghost-button" type="button" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>
              Back
            </button>
            {step === 4 ? (
              <button className="primary-cta" type="submit" form="creation-account-form" disabled={!canContinue || isSubmitting}>
                {isSubmitting ? "Saving..." : continueLabel()}
              </button>
            ) : (
              <button className="primary-cta" type="button" disabled={!canContinue} onClick={goNext}>
                {continueLabel()}
              </button>
            )}
          </footer>
        </section>
      </section>
      <DetailSheet
        sheet={sheet}
        onClose={() => setSheet(null)}
        onChooseClass={(profession) => setSelectedClassSlug(profession.slug)}
        onChooseHouse={(house) => setSelectedHouseSlug(house.slug)}
      />
    </main>
  );
}
