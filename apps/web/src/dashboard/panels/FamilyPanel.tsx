import { useCallback, useEffect, useState } from "react";
import { api, ApiError, contentUrl, type ChronicleEntry, type FamilyState, type MarriageCandidate, type FamilyChild, type BirthEvent, type SpouseDeathNotice } from "../../api.js";
import { assetPath, type House } from "../../data/league.js";
import { DashboardCard, type FourStats, PanelBanner, type PanelProps, PersonFace, PersonRow, festivalName, titleCase } from "../shared.js";

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

const FAMILY_STAT_DEFS: { key: keyof FourStats; abbr: string }[] = [
  { key: "prestige", abbr: "PRE" },
  { key: "devotion", abbr: "DEV" },
  { key: "militia", abbr: "MIL" },
  { key: "intelligence", abbr: "INT" },
];

function CandidateStatChips({ stats }: { stats: FourStats }) {
  return (
    <span className="choice-costs">
      {FAMILY_STAT_DEFS.map((s) => (
        <span key={s.key} className="cost-chip cost-neutral">{s.abbr} {stats[s.key]}</span>
      ))}
    </span>
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

          {state.spouse ? (
            <>
              <div className="panel-label">Your spouse</div>
              <PersonRow
                name={`${state.spouse.name} of House ${state.spouse.houseName}`}
                nameSuffix={<span className="person-suffix"> · your wife</span>}
                role={`Age ${state.spouse.age} · ${state.spouse.houseName}`}
                traits={state.spouse.trait ? [{ label: state.spouse.trait.name, tone: "good" }] : []}
                right={<CandidateStatChips stats={state.spouse.stats} />}
                portrait={state.spouse.portrait}
              />
              {state.spouse.pastChildbearing ? (
                <p className="composure-note muted spouse-fertility-note">She is past her childbearing years.</p>
              ) : null}
            </>
          ) : null}

          {state.children.length > 0 ? (
            <>
              <div className="panel-label">Children · {state.children.length}</div>
              {state.children.map((child) => (
                <ChildCard key={child.id} child={child} />
              ))}
            </>
          ) : null}

          {state.locks.marriage && !state.married ? (
            <>
              <div className="panel-label">Prospects</div>
              {state.candidates.marriage.length === 0 ? (
                <p className="dashboard-todo">No matches are on offer this season.</p>
              ) : (
                state.candidates.marriage.map((candidate) => {
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
                        <p>Age {candidate.age}{candidate.trait ? ` · ${candidate.trait.name}` : ""}{candidate.dowry > 0 ? ` · dowry ${candidate.dowry}g` : ""}</p>
                        <CandidateStatChips stats={candidate.stats} />
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
                })
              )}
            </>
          ) : null}

          {!state.locks.marriage && !state.locks.locked ? (
            <>
              <div className="panel-label">Adoption</div>
              {state.candidates.adoption.length === 0 ? (
                <p className="dashboard-todo">No wards are on offer this season.</p>
              ) : (
                state.candidates.adoption.map((candidate) => (
                  <PersonRow
                    key={candidate.id}
                    name={`${candidate.name} of House ${candidate.houseName}`}
                    role={`Age ${candidate.age}${candidate.trait ? ` · ${candidate.trait.name}` : ""}`}
                    traits={candidate.trait ? [{ label: candidate.trait.name, tone: "good" }] : []}
                    right={<CandidateStatChips stats={candidate.stats} />}
                    portrait={candidate.portrait}
                  />
                ))
              )}
              <p className="dashboard-todo">Marriage is not your path; an heir comes by adoption — the rite arrives with the succession pack.</p>
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
  birth: (p) => `A ${p.sex === "female" ? "daughter" : "son"}, ${p.childName}, was born.`,
  megas_choregos: (p) => `Named Megas Choregos of the ${festivalName(String(p.festivalId))}.`,
  festival_participation: (p) =>
    p.choregos
      ? `Served as choregos at the ${festivalName(String(p.festivalId))}.`
      : `Took part in the ${festivalName(String(p.festivalId))}.`,
  olympic_selection: (p) =>
    p.sent ? `Chosen to compete at Olympia (${p.yearBC} BC).` : `Stood for selection to Olympia.`,
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
