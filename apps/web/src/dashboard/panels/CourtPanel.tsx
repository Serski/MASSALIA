import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type EventResolution, type DailySet, type RoutineSet, type RoutineResult, type FestivalLive, type OlympiadStatus, type OlympiadBallot, type ManumissionChoice } from "../../api.js";
import { assetPath, type House } from "../../data/league.js";
import { DashboardCard, ListRow, PanelBanner, type PanelProps, placeholderDigest, timeUntil, titleCase } from "../shared.js";
import { CardClose, FestivalBanner, OlympicBanner } from "../banners.js";

const ARENA_LABELS: Record<string, string> = {
  class: "Your Calling",
  general: "Massalia",
  council: "Oligarchy Council",
  party: "Your Party",
};

// The curated daily decision set: one card per arena, each resolvable once, with
// composure previews on every choice (never a hidden cost).
function CourtDecisions({ onRefresh }: PanelProps) {
  const [daily, setDaily] = useState<DailySet | null>(null);
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, EventResolution>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Bug 4: per-card ✕ dismissal. Daily cards already persist (resolved) all day; the
  // dismissed-set lets the player clear any one on demand. It clears on the next
  // day's reset because the daily set reloads fresh (a new set replaces these ids).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    api
      .dailyEvents()
      .then(setDaily)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Unable to load decisions."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .dailyEvents()
      .then((set) => {
        if (!cancelled) setDaily(set);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Unable to load decisions.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = async (eventId: string, choiceId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveEvent(eventId, choiceId);
      setOutcomes((prev) => ({ ...prev, [eventId]: result }));
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not resolve that decision.");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="dashboard-todo">{error}</p>;
  if (!daily) return <p className="dashboard-todo">Loading decisions…</p>;
  if (!daily.cards.length) return <p className="dashboard-todo">No decisions await you today.</p>;

  return (
    <div className="dashboard-event-stack">
      {daily.withdrawn ? (
        <div className="court-status withdrawn" role="status">
          ⚠️ You have withdrawn from public life. Today's decisions are closed; new ones arrive tomorrow.
        </div>
      ) : daily.remaining === 0 ? (
        <div className="court-status spent" role="status">
          You have settled today's decisions. New ones arrive tomorrow.
        </div>
      ) : (
        <div className="court-status open">
          {daily.remaining} of {daily.cards.length} decisions awaiting you today
        </div>
      )}
      {daily.cards.filter((card) => !dismissed.has(card.event.id)).map((card) => {
        const event = card.event;
        const liveOutcome = outcomes[event.id];
        const isResolved = card.resolved || Boolean(liveOutcome);
        return (
          <DashboardCard className={`event-card${isResolved ? " card-resolved" : ""}`} key={event.id}>
            <CardClose onClose={() => setDismissed((prev) => new Set(prev).add(event.id))} />
            <div className="event-body">
              <span className="dashboard-label event-kicker">{ARENA_LABELS[card.arena] ?? "Decision"}</span>
              <h3>{event.scene}</h3>
              {isResolved ? (
                <div className="event-outcome" role="status">
                  <p>{liveOutcome?.resultText ?? card.resolvedResult}</p>
                  {liveOutcome && liveOutcome.composureDelta !== 0 ? (
                    <p className={`composure-note ${liveOutcome.composureDelta < 0 ? "neg" : "pos"}`}>
                      {liveOutcome.composureDelta > 0 ? "+" : ""}{liveOutcome.composureDelta} Composure — {liveOutcome.composureReason}
                    </p>
                  ) : null}
                  {liveOutcome?.broke ? (
                    <p className="composure-note neg">
                      You broke down{liveOutcome.grantedTrait ? ` and learned to cope (${liveOutcome.grantedTrait})` : ""} — withdrawn until tomorrow.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="event-choice-stack">
                  {event.choices.map((choice) => (
                    <button
                      className="event-choice-button"
                      type="button"
                      key={choice.id}
                      disabled={busy || daily.withdrawn}
                      onClick={() => resolve(event.id, choice.id)}
                    >
                      <strong>{choice.label}</strong>
                      {choice.costs.length > 0 || choice.composureDelta !== 0 ? (
                        <span className="choice-costs">
                          {choice.costs.map((cost, i) => (
                            <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                          ))}
                          {choice.composureDelta !== 0 ? (
                            <span
                              className={`cost-chip ${choice.composureDelta < 0 ? "cost-negative" : "cost-positive"}`}
                              title={choice.composureReason}
                            >
                              {choice.composureDelta > 0 ? "+" : ""}{choice.composureDelta} Composure
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DashboardCard>
        );
      })}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </div>
  );
}

const LADDER_LABELS: Record<string, string> = {
  rhetoric: "Rhetoric",
  philosophia: "Philosophia",
  gymnasium: "Gymnasium",
  mysteries: "Mysteries",
};

// The proactive half of the daily loop: pick ONE routine per day. Mirrors the
// CourtDecisions resolve/preview pattern; locks after a pick and shows the four
// upbringing-ladder progress bars.
function RoutinesCard({ onRefresh }: PanelProps) {
  const [set, setSet] = useState<RoutineSet | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<RoutineResult | null>(null);

  const load = useCallback(() => {
    api.routines().then(setSet).catch((err) => setError(err instanceof ApiError ? err.message : "Unable to load routines."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .routines()
      .then((next) => !cancelled && setSet(next))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Unable to load routines."));
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async (routineId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveRoutine(routineId);
      setOutcome(result);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not begin that routine.");
    } finally {
      setBusy(false);
    }
  };

  const ladderBars = set ? (
    <div className="routine-ladders" style={{ display: "grid", gap: 6, marginTop: 12 }}>
      {Object.entries(set.ladders).map(([key, ladder]) => {
        const pct = ladder.nextThreshold ? Math.min(100, Math.round((ladder.xp / ladder.nextThreshold) * 100)) : 100;
        return (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto", gap: 8, alignItems: "center", fontSize: 11 }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.8 }}>{LADDER_LABELS[key] ?? key}</span>
            <span style={{ height: 6, borderRadius: 3, background: "rgba(12, 8, 7, 0.5)", border: "1px solid rgba(181, 138, 69, 0.18)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--dash-good)" }} />
            </span>
            <span style={{ opacity: 0.7 }}>{ladder.nextThreshold !== null ? `${ladder.xp}/${ladder.nextThreshold}` : `${ladder.xp} ✓`}</span>
          </div>
        );
      })}
    </div>
  ) : null;

  // order:3 keeps this after the digest on the mobile court-grid reflow.
  return (
    <DashboardCard className="actions-card" style={{ order: 3 }}>
      <h2>Your Day</h2>
      {error ? (
        <p className="dashboard-todo">{error}</p>
      ) : !set ? (
        <p className="dashboard-todo">Loading routines…</p>
      ) : set.withdrawn ? (
        <p className="dashboard-todo" role="status">You have withdrawn from public life. Choose a routine again tomorrow.</p>
      ) : set.pickedRoutineId ? (
        <div className="routine-chosen" role="status">
          <p>
            Today you chose <strong>{set.cards.find((c) => c.id === set.pickedRoutineId)?.label ?? "your routine"}</strong>. New choices arrive tomorrow.
          </p>
          {outcome && outcome.composureDelta !== 0 ? (
            <p className={`composure-note ${outcome.composureDelta < 0 ? "neg" : "pos"}`}>
              {outcome.composureDelta > 0 ? "+" : ""}{outcome.composureDelta} Composure — {outcome.composureReason}
            </p>
          ) : null}
          {outcome?.ladder?.traitGranted ? (
            <p className="composure-note pos">Your practice bore fruit: {outcome.ladder.traitGranted}.</p>
          ) : null}
          {outcome?.broke ? (
            <p className="composure-note neg">The day broke you — withdrawn until tomorrow.</p>
          ) : null}
        </div>
      ) : (
        <div className="event-choice-stack">
          {set.cards.map((card) => (
            <button
              className="event-choice-button"
              type="button"
              key={card.id}
              disabled={busy}
              title={card.scene}
              onClick={() => pick(card.id)}
            >
              <strong>{card.label}</strong>
              {card.costs.length > 0 || card.composureDelta !== 0 ? (
                <span className="choice-costs">
                  {card.costs.map((cost, i) => (
                    <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                  ))}
                  {card.composureDelta !== 0 ? (
                    <span className={`cost-chip ${card.composureDelta < 0 ? "cost-negative" : "cost-positive"}`} title={card.composureReason}>
                      {card.composureDelta > 0 ? "+" : ""}{card.composureDelta} Composure
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {ladderBars}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </DashboardCard>
  );
}

// The voting ballot: every living citizen votes (even those who cannot stand).
// Live standings are HIDDEN until close — your vote is changeable until the window
// shuts, with a countdown.
function OlympicBallotPanel({ onRefresh, onClose }: { onRefresh: () => void; onClose: () => void }) {
  const [ballot, setBallot] = useState<OlympiadBallot | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.olympicBallot().then(setBallot).catch(() => setNote("The ballot could not be read."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const vote = async (candidateId: string) => {
    setBusy(true);
    setNote("");
    try {
      await api.olympicVote(candidateId);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your vote could not be cast.");
    } finally {
      setBusy(false);
    }
  };

  if (!ballot || ballot.phase !== "voting") return null;
  // Bug 2: the Olympic vote is ONE-AND-DONE. Once cast it is locked — show the
  // chosen name and remove the controls so there is no way to submit again.
  const voted = Boolean(ballot.yourVote);
  const votedFor = ballot.candidates.find((c) => c.characterId === ballot.yourVote);
  return (
    <DashboardCard className={`olympic-card ballot-card${voted ? " card-resolved" : ""}`}>
      <CardClose onClose={onClose} />
      <div className="event-body">
        <span className="dashboard-label olympic-kicker">🗳️ Olympic ballot · choose {ballot.seats} to send</span>
        <h3>The assembly votes. Closes in {timeUntil(ballot.votingEndsAt)}.</h3>
        {voted ? (
          <div className="event-outcome" role="status">
            <p>✓ You voted for {votedFor ? `${votedFor.name} of House ${votedFor.houseName}` : "your candidate"} — votes are final.</p>
          </div>
        ) : (
          <>
            <p className="dashboard-todo">The count is sealed until the vote closes — choose who carries Massalia's name. Your vote is final; you cannot change it.</p>
            <div className="event-choice-stack">
              {ballot.candidates.length === 0 ? (
                <p className="dashboard-todo">No names stand on the ballot.</p>
              ) : (
                ballot.candidates.map((c) => (
                  <button key={c.characterId} type="button" className="event-choice-button" disabled={busy} onClick={() => vote(c.characterId)}>
                    <strong>{c.name} of House {c.houseName}</strong>
                    <span className="choice-costs">
                      <span className="cost-chip cost-neutral">{titleCase(c.classId)}</span>
                      <span className="cost-chip cost-positive">Prestige {c.prestige}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// The Olympiad STATUS of the Court: the city-wide victor + your honour/delegate
// badges. The live event banner + the voting ballot are rendered by CourtPanel so
// they can persist (resolved/dimmed) past the server clearing them (Bug 4).
function OlympiadSection({ olympiad }: { olympiad: OlympiadStatus }) {
  return (
    <>
      {olympiad.champion ? (
        <DashboardCard className="olympic-card champion-card">
          <div className="event-body">
            <span className="dashboard-label olympic-kicker">🥇 Olympia</span>
            <h3>Massalia crowns an Olympionikes — {olympiad.champion.name}, victor at the Games!</h3>
          </div>
        </DashboardCard>
      ) : null}
      {olympiad.youAreOlympionikes ? (
        <p className="olympic-badge olympic-honor" role="status">🥇 Olympionikes — an Olympic victor, crowned with wild olive. An honor that outlives the man.</p>
      ) : null}
      {olympiad.youAreDelegate ? (
        <p className="olympic-badge" role="status">🏛️ You are an Olympic Delegate — chosen to carry Massalia's name to Olympia.</p>
      ) : null}
    </>
  );
}

// The stat bonus of a manumission class, rendered as chips.
function bonusChips(bonus: ManumissionChoice["bonus"]) {
  const labels: [keyof ManumissionChoice["bonus"], string][] = [
    ["prestige", "Prestige"],
    ["devotion", "Devotion"],
    ["militia", "Militia"],
    ["intelligence", "Intelligence"],
  ];
  return labels
    .filter(([key]) => (bonus[key] ?? 0) !== 0)
    .map(([key, label]) => (
      <span key={key} className="cost-chip cost-positive">+{bonus[key]} {label}</span>
    ));
}

// The milestone the whole slave arc has built toward: a freedman buys into a
// citizen class. Choosing one switches classId — the mine routine is gone and the
// full citizen daily loop + family unlock. Shown only while the slave holds freedman.
function FreedomPanel({ onRefresh }: { onRefresh: () => void }) {
  const [choices, setChoices] = useState<ManumissionChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.manumission()
      .then((opts) => !cancelled && setChoices(opts.eligible ? opts.choices : []))
      .catch(() => !cancelled && setNote("The registry could not be read."));
    return () => { cancelled = true; };
  }, []);

  const claim = async (classId: string, name: string) => {
    setBusy(true);
    setNote("");
    try {
      await api.manumit(classId);
      setNote(`Free, and a ${name.toLowerCase()} of Massalia. The mine is behind you.`);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The manumission could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  if (!choices) return null;
  return (
    <DashboardCard className="freedom-card">
      <div className="event-body">
        <span className="dashboard-label freedom-kicker">⛓️‍💥 Claim your freedom</span>
        <h3>The registry holds your name as a free citizen. Choose the life you will build.</h3>
        <p className="dashboard-todo">You keep all you have earned — your stats, your traits, your years — and take up the trade of your new station.</p>
        <div className="freedom-grid">
          {choices.map((choice) => (
            <DashboardCard className="freedom-choice" key={choice.classId}>
              <div className="event-body">
                <span className="dashboard-label">{choice.name}</span>
                <p className="freedom-flavor">{choice.flavor}</p>
                <span className="choice-costs">{bonusChips(choice.bonus)}</span>
                <button className="event-choice-button" type="button" disabled={busy} onClick={() => claim(choice.classId, choice.name)}>
                  <strong>Become a {choice.name}</strong>
                </button>
              </div>
            </DashboardCard>
          ))}
        </div>
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

export default function CourtPanel({ player, onRefresh }: PanelProps) {
  // Card persistence (Bug 4): calendar cards (festival / Olympiad) vanish the moment
  // the server stops returning them on resolve. Keep a sticky snapshot so the SAME
  // card instance stays mounted (showing its resolved state) for the rest of the
  // day, and a dismissed-set for the ✕ button. Both reset at the next day (the
  // in-game date label changes once per real day, matching the daily-card reset).
  const dayKey = player.gameDateLabel;
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [festivalSticky, setFestivalSticky] = useState<FestivalLive | null>(null);
  const [olympicLiveSticky, setOlympicLiveSticky] = useState<NonNullable<OlympiadStatus["liveEvent"]> | null>(null);
  const lastDayKey = useRef(dayKey);

  useEffect(() => {
    if (lastDayKey.current !== dayKey) {
      lastDayKey.current = dayKey;
      setDismissed(new Set());
      setFestivalSticky(null);
      setOlympicLiveSticky(null);
    }
  }, [dayKey]);
  useEffect(() => { if (player.festival) setFestivalSticky(player.festival); }, [player.festival]);
  const liveEvent = player.olympiad?.liveEvent;
  useEffect(() => { if (liveEvent) setOlympicLiveSticky(liveEvent); }, [liveEvent]);

  const close = useCallback((key: string) => setDismissed((prev) => new Set(prev).add(key)), []);

  const festival = player.festival ?? festivalSticky;
  const olympicLive = liveEvent ?? olympicLiveSticky;
  const voting = player.olympiad?.phase === "voting";

  return (
    <section className="dashboard-panel" aria-labelledby="court-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Home</p>
        <h1 id="court-title">Court</h1>
        <p>Messages, petitions, and decisions waiting for your return.</p>
      </div>
      <PanelBanner
        scene="the court of Massalia"
        art={assetPath("assets/Court.webp")}
        className="banner-hero"
      />
      <div className="court-grid">
        <div className="decision-column">
          {player.manumission?.eligible ? <FreedomPanel onRefresh={onRefresh} /> : null}
          {player.olympiad ? <OlympiadSection olympiad={player.olympiad} /> : null}
          {olympicLive && !dismissed.has("olympic-live") ? <OlympicBanner key="olympic-live" live={olympicLive} onRefresh={onRefresh} onClose={() => close("olympic-live")} /> : null}
          {voting && !dismissed.has("olympic-ballot") ? <OlympicBallotPanel onRefresh={onRefresh} onClose={() => close("olympic-ballot")} /> : null}
          {festival && !dismissed.has("festival") ? <FestivalBanner key="festival" festival={festival} onRefresh={onRefresh} onClose={() => close("festival")} /> : null}
          <div className="panel-subhead decision-subhead">
            <span className="dashboard-label">Decisions awaiting you</span>
          </div>
          <CourtDecisions player={player} onRefresh={onRefresh} />
        </div>
        <aside className="court-rail" aria-label="Court summary">
          <DashboardCard className="digest-card">
            <h2>While you were away</h2>
            <div className="dashboard-list compact">
              {placeholderDigest.map((item) => (
                <ListRow key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </ListRow>
              ))}
            </div>
            <p className="dashboard-todo">TODO: digest is placeholder data until the away-summary service exists.</p>
          </DashboardCard>
          {/* Daily Routines: the proactive half of the daily loop. order:3 lives
              inside RoutinesCard so it stays after the digest on the mobile reflow. */}
          <RoutinesCard player={player} onRefresh={onRefresh} />
        </aside>
      </div>
    </section>
  );
}

// --- The Ledger / player economy (Economy Build 1) --------------------------
// A universal frame for ALL classes: (a) Your Trade — the class building line,
// (b) Common Buildings — the seven commons, and (c) the class-section slot, a
// generic stateful/time-bound/stat-gated list built for the hardest future case
// (the hoplite's contracts), empty now. Plus the banded NPC-agora vendor drawer.
