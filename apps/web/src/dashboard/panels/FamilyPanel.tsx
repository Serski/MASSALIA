import { useCallback, useEffect, useState } from "react";
import { api, ApiError, contentUrl, type ChronicleEntry, type FamilyState, type FamilyCandidate, type MarriageCandidate, type FamilyChild, type BirthEvent, type SpouseDeathNotice, type DivorceNotice, type TragedyNotice } from "../../api.js";
import { assetPath, type House } from "../../data/league.js";
import { DashboardCard, type FourStats, PanelBanner, type PanelProps, PersonFace, PersonRow, StatPips, festivalName, titleCase } from "../shared.js";

function ordinalGeneration(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

const SUCCESSION_KIND_LABEL: Record<string, string> = {
  blood: "blood heir",
  adopted: "adoption",
  regent_handoff: "regent handoff",
  fresh: "fresh start",
};

// The heir + adoption-candidate stat row, restyled to the Atlas ruler icon pips so
// they read consistently with the foreign NPCs. Shared StatPips is the source.
function CandidateStatChips({ stats }: { stats: FourStats }) {
  return <StatPips stats={stats} />;
}

// The philia bond bar (family pack), reusing the child growth-bar treatment — a
// 0–100 fill with a caption below (the child pattern's caption carries a number,
// so we show philia's). Renders nothing when philia is null (no marriage row):
// no bar rather than a broken one.
function PhiliaBar({ philia, band }: { philia: number | null; band: string | null }) {
  if (philia === null || band === null) return null;
  // Own class (philia-bar) so the bond reads as affection, not child-growth
  // progress; the estranged band flips the fill to a warning red.
  return (
    <div className="philia-block">
      <div className={`philia-bar${band === "estranged" ? " estranged" : ""}`} aria-label={`Philia ${philia} of 100`}>
        <span style={{ width: `${philia}%` }} />
      </div>
      <div className="child-grow">{titleCase(band)} · {philia}</div>
    </div>
  );
}

// The trait chips shared by the spouse + prospect cards: the mechanical trait
// first, her personality second, each omitted when null. Both use the tone-good
// pill (the styling PersonRow's Tchip uses); the personality chip carries its
// description as a hover tooltip — its mechanical sibling has no description on
// the wire and needs none. Renders nothing when both are null.
function TraitChips({
  trait,
  personality,
}: {
  trait: { name: string } | null;
  personality: { name: string; description: string } | null;
}) {
  if (!trait && !personality) return null;
  return (
    <div className="person-traits">
      {trait ? <span className="tchip tone-good">{trait.name}</span> : null}
      {personality ? (
        <span className="tchip tone-good" title={personality.description}>{personality.name}</span>
      ) : null}
    </div>
  );
}

// Human-readable cross-house penalty preview for a marriage candidate.
function penaltyText(candidate: MarriageCandidate): string | null {
  const { ideologyShift, partyFavorLoss } = candidate.penalty;
  if (ideologyShift === 0) return null;
  const dir = ideologyShift > 0 ? "Reformist" : "Traditionalist";
  const partyLabel = candidate.party === "palaioi" ? "Palaioi" : candidate.party === "dynatoi" ? "Dynatoi" : null;
  const favorBit = partyFavorLoss > 0 && partyLabel ? ` and cost ${partyFavorLoss} ${partyLabel} favor` : "";
  return `Marrying into House ${candidate.houseName} will pull you ${ideologyShift > 0 ? "+" : ""}${ideologyShift} toward ${dir}${favorBit}.`;
}

// A child portrait (boy/girl), gracefully falling back to an initial while the
// placeholder art has no real PNG yet.
function ChildPortrait({ child }: { child: FamilyChild }) {
  const [ok, setOk] = useState(true);
  const src = contentUrl(child.portrait);
  if (!src || !ok) return <span className="child-av-fallback" aria-hidden="true">{child.name[0]}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setOk(false)} />;
}

function ChildCard({ child }: { child: FamilyChild }) {
  const pct = child.comingOfAge > 0 ? Math.min(100, Math.round((child.age / child.comingOfAge) * 100)) : 100;
  return (
    <DashboardCard className="child-card">
      <div className="child-row">
        <span className="child-av">
          <ChildPortrait child={child} />
        </span>
        <div className="child-id">
          <div className="child-nm">
            {child.name} <span className="child-meta">· {child.sex === "male" ? "son" : "daughter"} · age {child.age}</span>
            {child.heirEligible ? <span className="heir-tag">Heir eligible</span> : null}
          </div>
          {child.heirEligible ? (
            <div className="child-grow done">Of age — an eligible heir.</div>
          ) : (
            <>
              <div className="child-grow-bar" aria-label={`${child.age} of ${child.comingOfAge}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="child-grow">{child.yearsToComingOfAge} year{child.yearsToComingOfAge === 1 ? "" : "s"} to coming of age</div>
            </>
          )}
        </div>
      </div>
    </DashboardCard>
  );
}

function BirthNotice({ event, busy, onName }: { event: BirthEvent; busy: boolean; onName: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <DashboardCard className="birth-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">A child is born to your house</span>
        <h3>A {event.sex === "male" ? "son" : "daughter"} is born — provisionally named {event.childName}.</h3>
        {event.motherDied ? (
          <p className="composure-note neg">Your wife {event.lateWifeName ?? ""} did not survive the birth. The child lives; the house endures in grief.</p>
        ) : null}
        <div className="birth-name-row">
          <input
            type="text"
            value={name}
            placeholder={event.childName}
            maxLength={64}
            aria-label="Name the child"
            onChange={(e) => setName(e.target.value)}
          />
          <button className="event-choice-button" type="button" disabled={busy} onClick={() => onName(name)}>
            <strong>{name.trim() ? `Name ${name.trim()}` : `Keep ${event.childName}`}</strong>
          </button>
        </div>
        <p className="dashboard-todo">If you let the season pass, the name {event.childName} stays.</p>
      </div>
    </DashboardCard>
  );
}

// Spouse death of old age — rendered somberly, like a childbirth death. The
// widower's marriage prospects return at the next yearly draw.
function SpouseDeathCard({ notice }: { notice: SpouseDeathNotice }) {
  const name = notice.lateWifeName ?? "Your wife";
  const years = notice.yearsMarried;
  return (
    <DashboardCard className="birth-card mourning-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">A death in the household</span>
        <h3>{name} has died.</h3>
        <p className="composure-note neg">
          {name}, your wife of {years} year{years === 1 ? "" : "s"}, has died of old age. The house mourns; in time you may seek a new match.
        </p>
      </div>
    </DashboardCard>
  );
}

// Divorce aftermath — somber, brief. The marriage is ended; prospects return.
function DivorceAftermathCard({ notice }: { notice: DivorceNotice }) {
  const name = notice.formerWifeName ?? "Your wife";
  const years = notice.yearsMarried;
  return (
    <DashboardCard className="birth-card mourning-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">The marriage is ended</span>
        <h3>You have divorced {name}.</h3>
        <p className="composure-note neg">
          {name}, your wife of {years} year{years === 1 ? "" : "s"}, is put from your house. The matter is closed.
        </p>
      </div>
    </DashboardCard>
  );
}

// She has fallen — delivered as a whisper the player receives. No choice.
function FellCard({ wifeName }: { wifeName: string }) {
  return (
    <DashboardCard className="birth-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">A whisper reaches you</span>
        <h3>{wifeName} has taken a lover.</h3>
        <p className="composure-note muted">What you set in motion has run its course; she is his now, in all but name.</p>
      </div>
    </DashboardCard>
  );
}

// The city knows — the −3 prestige is already applied; the card explains why.
function DiscoveredCard() {
  return (
    <DashboardCard className="birth-card mourning-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">The city talks</span>
        <h3>The affair is known.</h3>
        <p className="composure-note neg">Word of the lover has reached the agora. Your name is diminished by it (−3 prestige).</p>
      </div>
    </DashboardCard>
  );
}

// The tragedy aftermath, one card per archetype (one season). A Clytemnestra
// SUCCESS never reaches here — the heir has no such notice; the Chronicle carries it.
function TragedyCard({ notice }: { notice: TragedyNotice }) {
  const name = notice.formerWifeName ?? "Your wife";
  const wed = `${notice.yearsMarried} year${notice.yearsMarried === 1 ? "" : "s"}`;
  if (notice.archetype === "medea") {
    return (
      <DashboardCard className="birth-card mourning-card">
        <div className="event-body">
          <span className="dashboard-label event-kicker">The house is emptied</span>
          <h3>{name} has killed your children, and herself.</h3>
          <p className="composure-note neg">
            Your wife of {wed} took the children into death with her, then followed. There is no one left.
          </p>
        </div>
      </DashboardCard>
    );
  }
  if (notice.archetype === "clytemnestra") {
    return (
      <DashboardCard className="birth-card mourning-card">
        <div className="event-body">
          <span className="dashboard-label event-kicker">Blood in the house</span>
          <h3>{name} tried to kill you.</h3>
          <p className="composure-note neg">
            She came for you in the night and failed; taken in the act, she took her own life. The city speaks of little else.
          </p>
        </div>
      </DashboardCard>
    );
  }
  return (
    <DashboardCard className="birth-card mourning-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">The marriage is ended</span>
        <h3>{name} is dead by her own hand.</h3>
        <p className="composure-note neg">Your wife of {wed} is gone. She left no word, and the house is very quiet.</p>
      </div>
    </DashboardCard>
  );
}

// The adoption aftermath — brief, in the birth-card register (one season).
function AdoptionCard({ notice }: { notice: { name: string; house: string } }) {
  return (
    <DashboardCard className="birth-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">An heir is named</span>
        <h3>You have adopted {notice.name} of House {notice.house}.</h3>
        <p className="composure-note">The rite is done; your house has an heir, and their blood becomes yours.</p>
      </div>
    </DashboardCard>
  );
}

// The designated-heir card. Its header uses the SAME PersonRow treatment as the
// spouse card beside it (bordered box, portrait, name typography, "· adopted heir"
// suffix per the "· your wife" convention, and an "Age <derived> · <House>" meta
// line in her style). He ages like everyone else — the server derives his age +
// portrait stage from consumedAt. Below the header: the trait chips and icon stat pips.
function HeirCard({ heir }: { heir: FamilyCandidate }) {
  return (
    <DashboardCard className="prospect-card">
      <PersonRow
        name={`${heir.name} of House ${heir.houseName}`}
        nameSuffix={<span className="person-suffix"> · adopted heir</span>}
        role={`Age ${heir.age} · ${heir.houseName}`}
        traits={[]}
        portrait={heir.portrait}
      />
      <TraitChips trait={heir.trait} personality={heir.personality} />
      <CandidateStatChips stats={heir.stats} />
    </DashboardCard>
  );
}

// The always-visible succession outlook line ("If you fell today, …").
function outlookLine(outlook: { kind: string; heirName: string | null; passedOverSon: string | null }): string {
  const name = outlook.heirName ?? "your heir";
  switch (outlook.kind) {
    case "blood":
      return `If you fell today, ${name} inherits.`;
    case "adopted":
      // When an of-age son is passed over (preference "adopted"), name him.
      return outlook.passedOverSon
        ? `If you fell today, your adopted heir ${name} takes the house — over your son ${outlook.passedOverSon}.`
        : `If you fell today, your adopted heir ${name} takes the house.`;
    case "regency":
      return `If you fell today, a regent would rule for ${name}.`;
    default: // forced_adoption / fresh
      return "If you fell today, your line has no heir — the house would pass by adoption.";
  }
}

// The two-choice heir preference control (blood vs adopted), reused by both the
// come-of-age prompt and the Succession toggle. The active choice carries the
// panel's selected state so an answered prompt reads as answered.
function HeirPreferenceChoices({ preference, busy, onChoose }: { preference: string; busy: boolean; onChoose: (p: "blood" | "adopted") => void }) {
  return (
    <div className="event-choice-stack heir-preference-choices">
      <button type="button" className={`event-choice-button${preference === "blood" ? " selected" : ""}`} aria-pressed={preference === "blood"} disabled={busy} onClick={() => onChoose("blood")}>
        <strong>Prefer your blood</strong>
      </button>
      <button type="button" className={`event-choice-button${preference === "adopted" ? " selected" : ""}`} aria-pressed={preference === "adopted"} disabled={busy} onClick={() => onChoose("adopted")}>
        <strong>Prefer the adopted heir</strong>
      </button>
    </div>
  );
}

// The come-of-age prompt: a son first reaches manhood while an adopted heir stands.
// Its two inline choices post the preference; the card marks the active one.
function HeirChoiceCard({ notice, busy, onChoose }: { notice: { son: string; heir: string; preference: string }; busy: boolean; onChoose: (p: "blood" | "adopted") => void }) {
  return (
    <DashboardCard className="birth-card">
      <div className="event-body">
        <span className="dashboard-label event-kicker">A son comes of age</span>
        <h3>{notice.son} stands a man — yet {notice.heir} was named your heir. Who carries the house?</h3>
        <HeirPreferenceChoices preference={notice.preference} busy={busy} onChoose={onChoose} />
      </div>
    </DashboardCard>
  );
}

export default function FamilyPanel({ onRefresh }: PanelProps) {
  // Two tabs: the household management view (default) and the dated house
  // chronicle (the existing TimelinePanel, mounted as-is).
  const [tab, setTab] = useState<"household" | "chronicle">("household");
  const [state, setState] = useState<FamilyState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.family().then(setState).catch((err) => setError(err instanceof ApiError ? err.message : "Unable to load the household."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .family()
      .then((next) => !cancelled && setState(next))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Unable to load the household."));
    return () => {
      cancelled = true;
    };
  }, []);

  const marry = async (candidateId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.marry(candidateId);
      setConfirmId(null);
      const dowryBit = result.dowry > 0 ? ` Her dowry brings +${result.dowry} drachmae.` : "";
      const shiftBit = result.ideologyShift !== 0 ? ` The match pulls you ${result.ideologyShift > 0 ? "+" : ""}${result.ideologyShift} toward ${result.ideologyShift > 0 ? "Reformist" : "Traditionalist"}${result.partyFavorLoss > 0 ? ` (−${result.partyFavorLoss} party favor)` : ""}.` : "";
      setNote(`You are wed to ${result.spouseName}.${dowryBit}${shiftBit}`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The match could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const nameChild = async (childId: string, name: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.nameChild(childId, name);
      setNote(`Your child is named ${result.name}.`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The child could not be named.");
    } finally {
      setBusy(false);
    }
  };

  const giveGift = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await api.giveGift();
      setNote(r.diminished ? `A small gift — she has come to expect them (+${r.delta} philia, −25 drachmae).` : `A gift given (+${r.delta} philia, −25 drachmae).`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The gift could not be given.");
    } finally {
      setBusy(false);
    }
  };

  const holdSymposium = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await api.holdSymposium();
      setNote(`A symposium in her honor (+${r.delta} philia, +${r.prestige} prestige, −35 drachmae).`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The symposium could not be held.");
    } finally {
      setBusy(false);
    }
  };

  const startLoverPlot = async () => {
    setBusy(true);
    setNote("");
    try {
      await api.startLoverPlot();
      setConfirmId(null);
      setNote("A certain officer has been introduced to the household.");
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The scheme could not be set in motion.");
    } finally {
      setBusy(false);
    }
  };

  const divorce = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await api.divorce();
      setConfirmId(null);
      setNote(r.tier === "fallen" ? "The marriage is dissolved. Few will blame you." : "The marriage is dissolved. The city will remember it.");
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The divorce could not be granted.");
    } finally {
      setBusy(false);
    }
  };

  const adopt = async (candidateId: string) => {
    setBusy(true);
    setNote("");
    try {
      const r = await api.adopt(candidateId);
      setConfirmId(null);
      setNote(`${r.heirName} is named your heir.`);
      load();
      onRefresh();
    } catch (err) {
      // 409s (already an heir / under 30 / can't afford) surface through the note line.
      setNote(err instanceof ApiError ? err.message : "The rite could not be performed.");
    } finally {
      setBusy(false);
    }
  };

  const setPreference = async (preference: "blood" | "adopted") => {
    setBusy(true);
    setNote("");
    try {
      await api.setHeirPreference(preference);
      setNote(preference === "adopted" ? "Your adopted heir will carry the house." : "Your blood will carry the house.");
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The choice could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-panel" aria-labelledby="family-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Household</p>
        <h1 id="family-title">House &amp; Family</h1>
        <p>Your blood, your heirs, and the matches that bind the Houses.</p>
      </div>

      <div className="cs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "household"} className={`cs-tab${tab === "household" ? " on" : ""}`} onClick={() => setTab("household")}>
          Household
        </button>
        <button type="button" role="tab" aria-selected={tab === "chronicle"} className={`cs-tab${tab === "chronicle" ? " on" : ""}`} onClick={() => setTab("chronicle")}>
          Chronicle
        </button>
      </div>

      {tab === "chronicle" ? (
        <TimelinePanel />
      ) : (
      <>
      <PanelBanner
        scene="the oikos"
        art={assetPath("assets/Family.webp")}
        className="banner-hero"
      />

      {state?.dynasty ? (
        <div className="dynasty-head">
          <strong>{titleCase(state.dynasty.name)}</strong> · {ordinalGeneration(state.dynasty.generation)} generation
          {state.dynasty.history.length > 0 ? (
            <ul className="dynasty-history">
              {state.dynasty.history.map((h, i) => (
                <li key={i}>
                  {h.fromName ? `${h.fromName} (age ${h.fromAge ?? "?"})` : "—"} → <strong>{h.toName ?? "heir"}</strong>
                  <span className="dynasty-kind"> · {SUCCESSION_KIND_LABEL[h.kind] ?? h.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="dashboard-todo">{error}</p>
      ) : !state ? (
        <p className="dashboard-todo">Loading household…</p>
      ) : state.locks.locked ? (
        <>
          <div className="panel-label">Locked</div>
          <p className="dashboard-todo" role="status">No family is permitted to the unfree. Freedom will open this.</p>
        </>
      ) : (
        <>
          {state.birthEvent ? <BirthNotice event={state.birthEvent} busy={busy} onName={(name) => nameChild(state.birthEvent!.childId, name)} /> : null}

          {state.spouseDeath ? <SpouseDeathCard notice={state.spouseDeath} /> : null}

          {state.divorceNotice ? <DivorceAftermathCard notice={state.divorceNotice} /> : null}

          {state.tragedyNotice ? <TragedyCard notice={state.tragedyNotice} /> : null}

          {state.fellNotice && state.spouse ? <FellCard wifeName={state.spouse.name} /> : null}

          {state.discoveredNotice ? <DiscoveredCard /> : null}

          {state.adoptionNotice ? <AdoptionCard notice={state.adoptionNotice} /> : null}

          {state.heirChoiceNotice ? <HeirChoiceCard notice={state.heirChoiceNotice} busy={busy} onChoose={setPreference} /> : null}

          {state.spouse || state.adoptedHeir ? (
            <>
              <div className="panel-label">Your household</div>
              <div className="household-row">
              {state.spouse ? (
              <DashboardCard className="spouse-card">
                <PersonRow
                  name={`${state.spouse.name} of House ${state.spouse.houseName}`}
                  nameSuffix={<span className="person-suffix"> · your wife</span>}
                  role={`Age ${state.spouse.age} · ${state.spouse.houseName}`}
                  traits={[]}
                  portrait={state.spouse.portrait}
                />
                <TraitChips trait={state.spouse.trait} personality={state.spouse.personality} />
                <PhiliaBar philia={state.spouse.philia} band={state.spouse.philiaBand} />
                {state.spouse.pastChildbearing ? (
                  <p className="composure-note muted spouse-fertility-note">She is past her childbearing years.</p>
                ) : null}

                {/* Plot marker line — the passive state of an active/fallen scheme. */}
                {state.spouse.loverState === "active" ? (
                  <p className="composure-note muted"><em>A certain officer has been introduced to the household.</em></p>
                ) : state.spouse.loverState === "fallen" ? (
                  <p className="composure-note muted"><em>She has a lover.</em></p>
                ) : null}

                {/* Persistent, band-derived warning at philia <= 10 (estranged) — no
                    window, no dismissal. It reads as one warning with the red bond bar. */}
                {state.spouse.philiaBand === "estranged" ? (
                  <div className="estranged-banner" role="alert">
                    <span className="censure-ic" aria-hidden="true">⚠️</span>
                    <div>
                      <strong>She has grown cold</strong>
                      <p>The household feels her withdrawal. Left to fester, an estranged wife becomes a danger to the house — mend the bond while you still can.</p>
                    </div>
                  </div>
                ) : null}

                <div className="spouse-actions">
                  <button className="event-choice-button" type="button" disabled={busy} onClick={giveGift}>
                    {state.spouse.giftDiminished ? "Give a gift · she expects it now (−25 dr)" : "Give a gift (−25 dr)"}
                  </button>
                  <button
                    className="event-choice-button"
                    type="button"
                    disabled={busy || !state.spouse.symposiumAvailable}
                    title={state.spouse.symposiumAvailable ? undefined : "Already honored her this year"}
                    onClick={holdSymposium}
                  >
                    Hold a symposium (−35 dr)
                  </button>

                  {state.spouse.loverState === "none" ? (
                    confirmId === "lover" ? (
                      <div className="event-choice-stack">
                        <button className="event-choice-button" type="button" disabled={busy} onClick={startLoverPlot}>
                          <strong>Confirm — set the scheme in motion</strong>
                        </button>
                        <button className="dashboard-ghost-button" type="button" disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="event-choice-button" type="button" disabled={busy} onClick={() => setConfirmId("lover")}>Push her toward a lover</button>
                    )
                  ) : null}

                  {confirmId === "divorce" && state.spouse.divorceAvailable ? (
                    <div className="event-choice-stack">
                      <button className="event-choice-button" type="button" disabled={busy} onClick={divorce}>
                        <strong>{state.spouse.loverState === "fallen" ? "Confirm — none will blame you" : "Confirm — the city will not forgive it"}</strong>
                      </button>
                      <button className="dashboard-ghost-button" type="button" disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      className="dashboard-ghost-button"
                      type="button"
                      disabled={busy || !state.spouse.divorceAvailable}
                      title={state.spouse.divorceAvailable ? undefined : state.spouse.divorceBlockedReason ?? undefined}
                      onClick={() => setConfirmId("divorce")}
                    >
                      Divorce her
                    </button>
                  )}
                </div>
              </DashboardCard>
              ) : null}
              {state.adoptedHeir ? <HeirCard heir={state.adoptedHeir} /> : null}
              </div>
            </>
          ) : null}

          {state.children.length > 0 ? (
            <>
              <div className="panel-label">Children · {state.children.length}</div>
              <div className="family-card-grid">
                {state.children.map((child) => (
                  <ChildCard key={child.id} child={child} />
                ))}
              </div>
            </>
          ) : null}

          {!state.locks.locked ? (
            <>
              <div className="panel-label">Succession</div>
              <p className="composure-note muted">{outlookLine(state.successionOutlook)}</p>
              {state.adoptedHeir && state.children.some((c) => c.heirEligible) ? (
                <div className="heir-preference-toggle">
                  <span className="dashboard-label">Who carries the house?</span>
                  <HeirPreferenceChoices preference={state.heirPreference} busy={busy} onChoose={setPreference} />
                </div>
              ) : null}
              {state.showAdoption ? (
                state.candidates.adoption.length === 0 ? (
                  <p className="dashboard-todo">No wards are on offer this season.</p>
                ) : (
                  <div className="family-card-grid">
                  {state.candidates.adoption.map((candidate) => (
                    <DashboardCard className="prospect-card" key={candidate.id}>
                      <div className="event-body">
                        <div className="prospect-head">
                          <span className="person-face prospect-face">
                            <PersonFace portrait={candidate.portrait} />
                          </span>
                          <span className="dashboard-label">{candidate.name} of House {candidate.houseName}</span>
                        </div>
                        <p>Age {candidate.age}</p>
                        <TraitChips trait={candidate.trait} personality={candidate.personality} />
                        <CandidateStatChips stats={candidate.stats} />
                        {confirmId === candidate.id ? (
                          <div className="event-choice-stack">
                            <button className="event-choice-button" type="button" disabled={busy} onClick={() => adopt(candidate.id)}>
                              <strong>Confirm — 40 dr, and the house takes their blood</strong>
                            </button>
                            <button className="dashboard-ghost-button" type="button" disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="event-choice-button" type="button" disabled={busy} onClick={() => setConfirmId(candidate.id)}>
                            <strong>Adopt {candidate.name}</strong>
                          </button>
                        )}
                      </div>
                    </DashboardCard>
                  ))}
                  </div>
                )
              ) : null}
            </>
          ) : null}

          {state.locks.marriage && !state.married ? (
            <>
              <div className="panel-label">Prospects</div>
              {state.candidates.marriage.length === 0 ? (
                <p className="dashboard-todo">No matches are on offer this season.</p>
              ) : (
                <div className="family-card-grid">
                {state.candidates.marriage.map((candidate) => {
                  const penalty = penaltyText(candidate);
                  return (
                    <DashboardCard className="prospect-card" key={candidate.id}>
                      <div className="event-body">
                        <div className="prospect-head">
                          <span className="person-face prospect-face">
                            <PersonFace portrait={candidate.portrait} />
                          </span>
                          <span className="dashboard-label">{candidate.name} of House {candidate.houseName}</span>
                        </div>
                        <p>Age {candidate.age}{candidate.dowry > 0 ? ` · dowry ${candidate.dowry}g` : ""}</p>
                        <TraitChips trait={candidate.trait} personality={candidate.personality} />
                        {penalty ? <p className="composure-note neg">{penalty}</p> : <p className="composure-note pos">No ideological cost — a comfortable match.</p>}
                        {confirmId === candidate.id ? (
                          <div className="event-choice-stack">
                            <button className="event-choice-button" type="button" disabled={busy} onClick={() => marry(candidate.id)}>
                              <strong>Confirm marriage to {candidate.name}</strong>
                            </button>
                            <button className="dashboard-ghost-button" type="button" disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="event-choice-button" type="button" disabled={busy} onClick={() => setConfirmId(candidate.id)}>
                            <strong>Marry {candidate.name}</strong>
                          </button>
                        )}
                      </div>
                    </DashboardCard>
                  );
                })}
                </div>
              )}
            </>
          ) : null}

        </>
      )}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The Oligarchy Chamber (Politics Prompt 1): the 300-seat hemicycle, buying a
// dynastic seat, and the yearly chamber vote with its public ballot ledger.
// ---------------------------------------------------------------------------

const GENERATION_WORDS = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

function generationHeading(n: number): string {
  return `${GENERATION_WORDS[n] ?? ordinalGeneration(n)} Generation`;
}

// The ONLY place chronicle prose lives: a registry keyed by the structured
// entry.type, turning a payload into a sentence. The server stores no prose.
const chronicleRenderers: Record<ChronicleEntry["type"], (payload: Record<string, unknown>) => string> = {
  marriage: (p) => `Wed ${p.spouseName}.`,
  divorce: (p) => `Divorced ${p.spouseName}.`,
  birth: (p) => `A ${p.sex === "female" ? "daughter" : "son"}, ${p.childName}, was born.`,
  megas_choregos: (p) => `Named Megas Choregos of the ${festivalName(String(p.festivalId))}.`,
  festival_participation: (p) =>
    p.choregos
      ? `Served as choregos at the ${festivalName(String(p.festivalId))}.`
      : `Took part in the ${festivalName(String(p.festivalId))}.`,
  olympic_selection: (p) =>
    p.sent ? `Chosen to compete at Olympia (${p.yearBC} BC).` : `Stood for selection to Olympia.`,
  tragedy_phaedra: (p) => `${p.spouseName} took her own life.`,
  // One endReason covers both the survived attempt and the fatal one, so this line
  // asserts neither outcome — only the attempt, which is true in every case.
  tragedy_clytemnestra: (p) => `${p.spouseName} made an attempt on his life.`,
  tragedy_medea: (p) => `${p.spouseName} killed their children and herself.`,
  adoption: (p) => `Adopted ${p.heirName} of House ${p.houseName} as heir.`,
};

function renderChronicleEntry(entry: ChronicleEntry): string {
  const render = chronicleRenderers[entry.type];
  return render ? render(entry.payload) : "";
}

// On-demand panel: fetches the dated house chronicle on open and renders it
// oldest→newest, grouped under a heading per dynasty generation.
function TimelinePanel() {
  const [entries, setEntries] = useState<ChronicleEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .chronicle()
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "The chronicle could not be read."));
  }, []);

  // Bucket by generation, preserving the server's oldest→newest order within each.
  const groups: { generation: number; entries: ChronicleEntry[] }[] = [];
  for (const entry of entries ?? []) {
    let group = groups.find((g) => g.generation === entry.generation);
    if (!group) {
      group = { generation: entry.generation, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  groups.sort((a, b) => a.generation - b.generation);

  return (
    <section className="dashboard-panel timeline-dashboard-panel" aria-labelledby="timeline-dashboard-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">House chronicle</p>
        <h1 id="timeline-dashboard-title">Timeline</h1>
        <p>The dated history of your house, generation by generation.</p>
      </div>
      {error ? <p className="dashboard-todo" role="status">{error}</p> : null}
      {entries === null && !error ? <p className="dashboard-todo">Reading the chronicle…</p> : null}
      {entries !== null && entries.length === 0 ? (
        <DashboardCard>
          <p className="dashboard-todo">
            No chronicled events yet. Marry, raise children, and earn the city's honors — your history fills in here.
          </p>
        </DashboardCard>
      ) : null}
      {groups.map((group) => (
        <DashboardCard key={group.generation} className="timeline-gen-card">
          <span className="dashboard-label">{generationHeading(group.generation)}</span>
          <ul className="timeline-list">
            {group.entries.map((entry, index) => (
              <li key={`${entry.type}-${entry.seasonIndex}-${index}`} className="timeline-row">
                <span className="timeline-date">{entry.label}</span>
                <span className="timeline-prose">{renderChronicleEntry(entry)}</span>
              </li>
            ))}
          </ul>
        </DashboardCard>
      ))}
    </section>
  );
}

// --- Player Standings (Atlas Phase 1) --------------------------------------
