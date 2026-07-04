import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type ChamberSeat, type ChamberView, type ChamberVotesView, type ChamberVoteView, type SeatParty, type ElectionsView, type ElectionOfficeView, type OfficesView, type OfficeSeatView, type OfficeSide, type AgendaView, type AgendaScopeView } from "../../api.js";
import { assetPath, type House } from "../../data/league.js";
import { AssetIcon, DashboardCard, DigestList, PanelBanner, type PanelProps, PanelRow, PersonRow, formatDuration, ideologyReadout, titleCase, useCountdownSeconds } from "../shared.js";

const partyNews = [
  { id: "champion", icon: "📣", text: <>A member seeks the party's backing for <b>Archon</b>.</> },
  { id: "drift", icon: "⚠️", text: <>Members who drift to the other side are <b>expelled</b>.</> },
];

const partyOptions: {
  slug: "dynatoi" | "palaioi";
  greek: string;
  name: "Dynatoi" | "Palaioi";
  pitch: string;
  side: "Reformist" | "Traditionalist";
  consClass: boolean;
}[] = [
  { slug: "dynatoi", greek: "ΔΥΝΑΤΟΙ", name: "Dynatoi", pitch: "The reformers — new money, open ports, and a League remade. They court the bold.", side: "Reformist", consClass: false },
  { slug: "palaioi", greek: "ΠΑΛΑΙΟΙ", name: "Palaioi", pitch: "The old guard — tradition, temples, and the founders' law. They reward loyalty.", side: "Traditionalist", consClass: true },
];

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const PARTY_ICON: Record<string, string> = { dynatoi: "DYNATOI CLEAR.webp", palaioi: "PALAIOI CLEAR.webp" };
const SEAT_PARTY_LABELS: Record<SeatParty, string> = {
  palaioi: "Palaioi",
  dynatoi: "Dynatoi",
  independent: "Independent",
};

type SeatDot = { x: number; y: number; seat: ChamberSeat };

// Lay the chamber out as a parliament arc: rows of dots, seats per row
// proportional to the row's circumference. Display order groups the benches —
// Palaioi NPCs far left, Dynatoi NPCs far right, independents in the centre,
// and the bought/empty seats (seat_index 110+) filling the gaps left-to-right
// as players buy in. seat_index is the stable identity; this mapping is purely
// presentational.
function hemicycleLayout(seats: ChamberSeat[]): SeatDot[] {
  const total = seats.length;
  if (!total) return [];
  const cx = 230;
  const cy = 212;
  const rowCount = 6;
  const radii = Array.from({ length: rowCount }, (_, i) => 86 + i * 22);
  const weight = radii.reduce((sum, r) => sum + r, 0);
  const counts = radii.map((r) => Math.floor((total * r) / weight));
  let remainder = total - counts.reduce((sum, n) => sum + n, 0);
  for (let i = rowCount - 1; remainder > 0; i = (i - 1 + rowCount) % rowCount, remainder--) counts[i]!++;

  // All dot positions, sorted left -> right across the arc.
  const positions: { x: number; y: number; angle: number }[] = [];
  counts.forEach((n, i) => {
    const r = radii[i]!;
    for (let k = 0; k < n; k++) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (n - 1);
      positions.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle), angle });
    }
  });
  positions.sort((a, b) => b.angle - a.angle || a.y - b.y);

  // Benches: Palaioi left, Dynatoi right (mirrored), independents centred,
  // everything else (player + empty, by seat_index) fills the free slots.
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const slots = new Array<ChamberSeat | undefined>(total);
  const npc = (party: SeatParty) => ordered.filter((seat) => seat.holderType === "npc" && seat.party === party);
  npc("palaioi").forEach((seat, i) => (slots[i] = seat));
  npc("dynatoi").forEach((seat, i) => (slots[total - 1 - i] = seat));
  const independents = npc("independent");
  let cursor = Math.floor((total - independents.length) / 2);
  for (const seat of independents) {
    while (slots[cursor]) cursor++;
    slots[cursor] = seat;
  }
  cursor = 0;
  for (const seat of ordered) {
    if (seat.holderType === "npc") continue;
    while (slots[cursor]) cursor++;
    slots[cursor] = seat;
  }

  return slots.map((seat, i) => ({ x: positions[i]!.x, y: positions[i]!.y, seat: seat! }));
}

function Hemicycle({ seats }: { seats: ChamberSeat[] }) {
  const dots = useMemo(() => hemicycleLayout(seats), [seats]);
  return (
    <svg className="hemicycle" viewBox="0 0 460 226" role="img" aria-label="The Oligarchy chamber — 300 seats">
      {dots.map(({ x, y, seat }) => (
        <circle
          key={seat.seatIndex}
          cx={x}
          cy={y}
          r={seat.holderType === "player" ? 5.2 : 4.2}
          className={`seat-dot seat-${seat.party ?? "empty"}${seat.holderType === "player" ? " seat-held" : ""}`}
        >
          <title>
            {seat.holderType === "player"
              ? `${seat.holderName ?? "A citizen"} — seat ${seat.seatIndex} (${SEAT_PARTY_LABELS[seat.party ?? "independent"]})`
              : seat.holderType === "npc"
                ? `${SEAT_PARTY_LABELS[seat.party!]} bench — seat ${seat.seatIndex}`
                : `Empty seat ${seat.seatIndex} — 300 dr.`}
          </title>
        </circle>
      ))}
    </svg>
  );
}

// The public ballot record — every voter named with the side they took.
function BallotLedger({ ballots }: { ballots: ChamberVoteView["ballots"] }) {
  if (!ballots.length) return <p className="dashboard-todo">No citizen ballots were cast.</p>;
  return (
    <div className="ledger-list">
      {ballots.map((ballot) => (
        <span key={`${ballot.voterName}-${ballot.castAt}`} className={`ledger-chip ledger-${ballot.choice}`}>
          {ballot.voterName} · {ballot.choice === "yes" ? "AYE" : "NAY"}
        </span>
      ))}
    </div>
  );
}

function OligarchySection({ onRefresh }: PanelProps) {
  const [chamber, setChamber] = useState<ChamberView | null>(null);
  const [votes, setVotes] = useState<ChamberVotesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.oligarchyChamber().then(setChamber).catch((err) => setError(err instanceof ApiError ? err.message : "The chamber rolls could not be read."));
    api.chamberVotes().then(setVotes).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openVote = votes?.open ?? null;
  const lastVote = votes?.past[0] ?? null;
  const countdown = useCountdownSeconds(openVote ? openVote.closesAt : null);

  const buy = async () => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.buySeat();
      setNote(`Seat ${result.seatIndex} is yours. Your name joins the roll of the Three Hundred — and your heirs will keep it.`);
      load();
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The purchase could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const cast = async (choice: "yes" | "no") => {
    setBusy(true);
    setNote("");
    try {
      await api.castChamberVote(choice);
      load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your ballot could not be cast.");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="dashboard-todo">{error}</p>;
  if (!chamber) return <p className="dashboard-todo">Loading the chamber…</p>;

  const { composition, you } = chamber;

  return (
    <>
      <div className="panel-label panel-label-seal">
        <img src={assetPath(OFFICE_ICON.oligarch ?? "")} alt="" loading="lazy" />
        The Oligarchy — the Three Hundred
      </div>
      <DashboardCard className="chamber-card">
        <div className="chamber-grid">
          <Hemicycle seats={chamber.seats} />
          <div className="chamber-legend">
            <div className="legend-row"><span className="legend-dot seat-palaioi" /> Palaioi · {composition.npc.palaioi + composition.players.palaioi} ({composition.players.palaioi} citizens)</div>
            <div className="legend-row"><span className="legend-dot seat-dynatoi" /> Dynatoi · {composition.npc.dynatoi + composition.players.dynatoi} ({composition.players.dynatoi} citizens)</div>
            <div className="legend-row"><span className="legend-dot seat-independent" /> Independent · {composition.npc.independent + composition.players.independent} ({composition.players.independent} citizens)</div>
            <div className="legend-row"><span className="legend-dot seat-empty" /> Empty · {composition.empty}</div>
            <div className="legend-note">{composition.playersTotal} seats held by living dynasties.</div>
            {you.holdsSeat ? (
              <div className="legend-note legend-yours">🏛️ Your dynasty holds seat {you.seatIndex}.</div>
            ) : null}
          </div>
        </div>
      </DashboardCard>

      {!you.holdsSeat && you.canBuy ? (
        <DashboardCard className="oligarchy-buy-card">
          <div className="event-body">
            <span className="dashboard-label oligarchy-kicker">🏛️ A seat among the Three Hundred</span>
            <h3>The chamber has empty marble. Buy your dynasty's seat — it passes to your heirs with your name.</h3>
            <p className="dashboard-todo">A seat seats you in the Oligarchy Council: its daily matters reach your desk, and the yearly chamber vote counts your voice — publicly.</p>
            <button className="event-choice-button" type="button" disabled={busy} onClick={buy}>
              <strong>Buy a seat — {chamber.seatPrice} dr.</strong>
            </button>
          </div>
        </DashboardCard>
      ) : null}
      {!you.holdsSeat && !you.canBuy && you.reason ? (
        <PanelRow icon="🏛️" title="A seat among the Three Hundred" sub={you.reason} dim tag="—" />
      ) : null}

      {openVote ? (
        <DashboardCard className="chamber-vote-card">
          <div className="event-body">
            <span className="dashboard-label oligarchy-kicker">🗳️ The chamber votes — closes in {formatDuration(countdown)}</span>
            <h3>{openVote.title}</h3>
            <p className="chamber-vote-desc">{openVote.description}</p>
            {openVote.youMayVote ? (
              <div className="event-choice-stack chamber-vote-choices">
                <button
                  type="button"
                  className={`event-choice-button${openVote.yourBallot === "yes" ? " ballot-chosen" : ""}`}
                  disabled={busy}
                  onClick={() => cast("yes")}
                >
                  <strong>Vote AYE</strong>
                  {openVote.yourBallot === "yes" ? <span className="choice-costs"><span className="cost-chip cost-positive">✓ your ballot — changeable until close</span></span> : null}
                </button>
                <button
                  type="button"
                  className={`event-choice-button${openVote.yourBallot === "no" ? " ballot-chosen" : ""}`}
                  disabled={busy}
                  onClick={() => cast("no")}
                >
                  <strong>Vote NAY</strong>
                  {openVote.yourBallot === "no" ? <span className="choice-costs"><span className="cost-chip cost-positive">✓ your ballot — changeable until close</span></span> : null}
                </button>
              </div>
            ) : (
              <p className="dashboard-todo">Only seat-holders vote in the chamber. Ballots are a public record.</p>
            )}
            {openVote.ballots.length ? (
              <>
                <div className="panel-label panel-label-spaced">Ballots on the floor — public record</div>
                <BallotLedger ballots={openVote.ballots} />
              </>
            ) : null}
          </div>
        </DashboardCard>
      ) : null}

      {lastVote ? (
        <DashboardCard className={`chamber-result-card ${lastVote.status}`}>
          <div className="event-body">
            <span className="dashboard-label oligarchy-kicker">
              {lastVote.status === "passed" ? "✅ The chamber assented" : "❌ The chamber refused"} · year {300 - lastVote.gameYear} BC
            </span>
            <h3>{lastVote.title} — {lastVote.yesCount ?? 0} aye, {lastVote.noCount ?? 0} nay</h3>
            <div className="panel-label">The ledger — who voted how</div>
            <BallotLedger ballots={lastVote.ballots} />
          </div>
        </DashboardCard>
      ) : null}
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Archon & Ephor offices + elections (Politics Prompt 2). The constitution's
// seats by side/party, the declare→vote→resolve cycle (secret ballot), the
// appointment cascade, and the dynasty-spanning office ledger.
// ---------------------------------------------------------------------------

const OFFICE_LABEL: Record<string, string> = { archon: "Archon", ephor: "Ephor", strategos: "Strategos" };
const SIDE_LABEL: Record<string, string> = { palaioi: "Palaioi", dynatoi: "Dynatoi" };
// Office seals reuse the front-page government art (App.tsx office grid):
// Archon→ARCHON, Ephor→EPHOR, Strategos→GENERAL, the Oligarchy Council→OLIGARCH.
const OFFICE_ICON: Record<string, string> = {
  archon: "assets/offices/ARCHON.webp",
  ephor: "assets/offices/EPHOR.webp",
  strategos: "assets/offices/GENERAL.webp",
  oligarch: "assets/offices/OLIGARCH.webp",
};

function partyDotClass(party: string | null | undefined): string {
  if (party === "palaioi") return "seat-palaioi";
  if (party === "dynatoi") return "seat-dynatoi";
  return "seat-independent";
}
function bcYear(gameYear: number): string {
  return `${300 - gameYear} BC`;
}
function titleCaseVia(via: string | null): string {
  if (!via) return "";
  return via.charAt(0).toUpperCase() + via.slice(1);
}

// One appointment picker (Ephor vacancy or Strategos), lazily loading eligible
// same-side seat-holders when opened.
function AppointPicker({ kind, side, onAppoint }: { kind: "ephor" | "strategos"; side: OfficeSide | null; onAppoint: (characterId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [appointees, setAppointees] = useState<{ characterId: string; name: string; houseName: string; party: string }[] | null>(null);
  useEffect(() => {
    if (!open) return;
    api.officeAppointees(side ?? "").then((r) => setAppointees(r.appointees)).catch(() => setAppointees([]));
  }, [open, side]);
  if (!open) {
    return (
      <button type="button" className="panel-btn" onClick={() => setOpen(true)}>
        Appoint {kind === "ephor" ? "an Ephor" : "a Strategos"}
      </button>
    );
  }
  return (
    <div className="appoint-picker">
      {!appointees ? (
        <span className="dashboard-todo">Loading eligible seat-holders…</span>
      ) : appointees.length === 0 ? (
        <span className="dashboard-todo">No eligible seat-holder is available.</span>
      ) : (
        appointees.map((a) => (
          <button key={a.characterId} type="button" className="event-choice-button" onClick={() => onAppoint(a.characterId)}>
            <strong>{a.name} of House {a.houseName}</strong>
            <span className="choice-costs"><span className={`cost-chip cost-neutral`}>{a.party === "none" ? "Independent" : SIDE_LABEL[a.party]}</span></span>
          </button>
        ))
      )}
    </div>
  );
}

function OfficeSeatRow({ seat, onAppoint }: { seat: OfficeSeatView; onAppoint: (kind: "ephor" | "strategos", side: OfficeSide | null, characterId: string) => void }) {
  const label = `${seat.office === "strategos" ? "Strategos" : `${SIDE_LABEL[seat.side ?? ""]} ${OFFICE_LABEL[seat.office]}`}`;
  return (
    <div className="office-seat">
      <span className={`legend-dot ${partyDotClass(seat.holder?.party ?? seat.side)}`} />
      <span className="office-seat-icon" aria-hidden="true">
        <img src={assetPath(OFFICE_ICON[seat.office] ?? "")} alt="" loading="lazy" />
      </span>
      <div className="office-seat-body">
        <div className="office-seat-title">{label}</div>
        {seat.holder ? (
          <div className="office-seat-sub">
            {seat.holder.name} of House {seat.holder.houseName}
            {seat.acquiredVia && seat.acquiredVia !== "elected" ? <span className="office-via"> · {titleCaseVia(seat.acquiredVia)}</span> : null}
          </div>
        ) : (
          <div className="office-seat-sub vacant">Vacant</div>
        )}
      </div>
      {!seat.holder && seat.youMayAppoint ? (
        <AppointPicker
          kind={seat.office === "strategos" ? "strategos" : "ephor"}
          side={seat.side}
          onAppoint={(id) => onAppoint(seat.office === "strategos" ? "strategos" : "ephor", seat.side, id)}
        />
      ) : null}
    </div>
  );
}

// The live election: declaration (declare a candidacy) or voting (secret ballot).
function ElectionCycleCard({ office, onRefresh }: { office: ElectionOfficeView; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const until = office.phase === "declaration" ? office.declarationEndsAt : office.votingEndsAt;
  const countdown = useCountdownSeconds(until);

  const declare = async (side: OfficeSide) => {
    setBusy(true);
    setNote("");
    try {
      await api.declareCandidacy(office.office, side);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your candidacy could not be recorded.");
    } finally {
      setBusy(false);
    }
  };
  const vote = async (candidateCharacterId: string) => {
    setBusy(true);
    setNote("");
    try {
      await api.castElectionVote(office.office, candidateCharacterId);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Your vote could not be cast.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardCard className="election-card">
      <div className="event-body">
        <span className="dashboard-label oligarchy-kicker">
          🗳️ {OFFICE_LABEL[office.office]} election — {office.phase === "declaration" ? "declarations close" : "voting closes"} in {formatDuration(countdown)}
        </span>
        {office.phase === "declaration" ? (
          <>
            <h3>The {OFFICE_LABEL[office.office]}ship is open. The benches fill with candidates.</h3>
            {office.youAreCandidate ? (
              <p className="dashboard-todo">✓ You have declared. Campaign in your daily routines to court the blocs before the vote.</p>
            ) : office.youMayDeclare.palaioi || office.youMayDeclare.dynatoi ? (
              <div className="event-choice-stack">
                {office.youMayDeclare.palaioi ? (
                  <button type="button" className="event-choice-button" disabled={busy} onClick={() => declare("palaioi")}>
                    <strong>Declare for the {OFFICE_LABEL[office.office]}ship — Palaioi bench</strong>
                  </button>
                ) : null}
                {office.youMayDeclare.dynatoi ? (
                  <button type="button" className="event-choice-button" disabled={busy} onClick={() => declare("dynatoi")}>
                    <strong>Declare for the {OFFICE_LABEL[office.office]}ship — Dynatoi bench</strong>
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="dashboard-todo">You are not eligible to stand (a seat in the Three Hundred and a clear party path are required).</p>
            )}
          </>
        ) : (
          <>
            <h3>Cast your vote for {OFFICE_LABEL[office.office]} — one per bench.</h3>
            <p className="dashboard-todo">🔒 The ballot is secret. Only the winners are announced; no tally is shown until close.</p>
            {(["palaioi", "dynatoi"] as OfficeSide[]).map((side) => {
              const sideCandidates = office.candidates.filter((c) => c.side === side);
              return (
                <div key={side} className="ballot-side">
                  <div className="panel-label">{SIDE_LABEL[side]} bench</div>
                  {sideCandidates.length === 0 ? (
                    <p className="dashboard-todo">No candidate stood on this bench — the seat will fall vacant.</p>
                  ) : (
                    sideCandidates.map((c) => {
                      const chosen = office.yourVote === c.characterId;
                      return (
                        <button key={c.characterId} type="button" className={`event-choice-button${chosen ? " ballot-chosen" : ""}`} disabled={busy} onClick={() => vote(c.characterId)}>
                          <strong>{c.name} of House {c.houseName}</strong>
                          <span className="choice-costs">
                            <span className="cost-chip cost-neutral">{c.party === "none" ? "Independent" : SIDE_LABEL[c.party]}</span>
                            <span className="cost-chip cost-positive">Prestige {c.prestige}</span>
                            {chosen ? <span className="cost-chip cost-positive">✓ your vote</span> : null}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

function OfficesSection({ onRefresh }: PanelProps) {
  const [offices, setOffices] = useState<OfficesView | null>(null);
  const [elections, setElections] = useState<ElectionsView | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.offices().then(setOffices).catch(() => {});
    api.elections().then(setElections).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onRefresh();
  };

  const onAppoint = async (kind: "ephor" | "strategos", side: OfficeSide | null, characterId: string) => {
    setNote("");
    try {
      if (kind === "ephor" && side) await api.appointEphor(side, characterId);
      else await api.appointStrategos(characterId);
      refresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The appointment could not be made.");
    }
  };

  if (!offices) return null;

  return (
    <>
      <div className="panel-label panel-label-spaced">The Constitution — offices of the League</div>
      <DashboardCard className="offices-grid-card">
        <div className="offices-grid">
          {offices.seats.map((seat) => (
            <OfficeSeatRow key={`${seat.office}-${seat.side ?? "x"}-${seat.seatSlot}`} seat={seat} onAppoint={onAppoint} />
          ))}
        </div>
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </DashboardCard>

      {elections?.offices.length ? (
        elections.offices.map((office) => <ElectionCycleCard key={office.office} office={office} onRefresh={refresh} />)
      ) : (
        <p className="dashboard-todo">
          No election is in session.{elections?.nextElectionYear != null ? ` The next falls in ${bcYear(elections.nextElectionYear)}.` : ""}
        </p>
      )}

      {offices.houseTallies.length ? (
        <>
          <div className="panel-label panel-label-spaced">Houses by office held</div>
          <div className="ledger-list">
            {offices.houseTallies.map((t) => (
              <span key={t.houseName} className="ledger-chip">
                {t.houseName}: {t.archonships ? `${t.archonships} Archonship${t.archonships > 1 ? "s" : ""}` : ""}
                {t.archonships && t.ephorships ? " · " : ""}
                {t.ephorships ? `${t.ephorships} Ephorship${t.ephorships > 1 ? "s" : ""}` : ""}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {offices.ledger.length ? (
        <>
          <div className="panel-label panel-label-spaced">The political ledger</div>
          <div className="office-ledger">
            {offices.ledger.slice(0, 16).map((h, i) => (
              <div key={i} className="office-ledger-row">
                <span className={`legend-dot ${partyDotClass(h.side)}`} />
                <span>
                  <b>{h.holderName}</b> of House {h.houseName} — {h.side ? `${SIDE_LABEL[h.side]} ` : ""}{OFFICE_LABEL[h.office]}
                  {h.acquiredVia !== "elected" ? ` (${titleCaseVia(h.acquiredVia)})` : ""}, {bcYear(h.startedYear)}
                  {h.endedYear != null ? `–${bcYear(h.endedYear)}` : " — sitting"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

// The treasury balance + audit ledger (the Ephors' oversight), visible to all.
function TreasuryCard({ treasury }: { treasury: AgendaScopeView["treasury"] }) {
  const label = treasury.owner === "league" ? "League treasury" : `${titleCase(treasury.owner)} treasury`;
  return (
    <DashboardCard className="treasury-card">
      <div className="event-body">
        <span className="dashboard-label">{label}</span>
        <p className="treasury-balance">{treasury.balance} <span className="treasury-unit">drachmae</span></p>
        {treasury.ledger.length > 0 ? (
          <ul className="treasury-ledger">
            {treasury.ledger.slice(0, 6).map((l, i) => (
              <li key={i}><span className={l.delta >= 0 ? "ledger-pos" : "ledger-neg"}>{l.delta >= 0 ? "+" : ""}{l.delta}</span> <span className="ledger-reason">{l.reason}</span></li>
            ))}
          </ul>
        ) : <p className="dashboard-todo">The books are empty.</p>}
      </div>
    </DashboardCard>
  );
}

// One government's agenda: the drafting docket (with the officials' draft/veto
// controls) or the drafted card going to the chamber, plus the treasury.
function AgendaScopeSection({ view, onRefresh }: { view: AgendaScopeView; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote("");
    try { await fn(); setNote(ok); onRefresh(); } catch (err) { setNote(err instanceof ApiError ? err.message : "That could not be done."); } finally { setBusy(false); }
  };
  const drafted = view.cards.find((c) => c.id === view.draftedCardId);
  const kicker = view.scope === "league" ? "🏛️ The League agenda" : `⚖️ ${titleCase(view.scope)} agenda`;
  return (
    <DashboardCard className="agenda-card">
      <div className="event-body">
        <span className="dashboard-label agenda-kicker">{kicker}{view.phase ? ` · ${view.phase}` : ""}</span>
        {view.phase === "drafting" ? (
          <>
            <h3>{view.youMayDraft ? "Choose the measure that goes before the chamber." : "The officials weigh the docket."}</h3>
            <div className="agenda-grid">
              {view.cards.map((card) => {
                const isDrafted = card.id === view.draftedCardId;
                const isVetoed = card.id === view.vetoedCardId;
                return (
                  <DashboardCard key={card.id} className={`agenda-choice${isDrafted ? " agenda-drafted" : ""}${isVetoed ? " agenda-vetoed" : ""}`}>
                    <div className="event-body">
                      <span className="dashboard-label">{card.title}</span>
                      <p className="agenda-flavor">{card.description}</p>
                      <span className="choice-costs">
                        <span className="cost-chip cost-neutral">{titleCase(card.partyLean)} lean</span>
                        {card.cost > 0 ? <span className="cost-chip cost-negative">{card.cost} dr.</span> : <span className="cost-chip cost-positive">Free</span>}
                        {isVetoed ? <span className="cost-chip cost-negative">Vetoed</span> : null}
                        {isDrafted ? <span className="cost-chip cost-positive">✓ drafted</span> : null}
                      </span>
                      {view.youMayDraft && !isVetoed ? (
                        <button className="event-choice-button" type="button" disabled={busy} onClick={() => act(() => api.draftAgenda(view.scope, card.id), `${card.title} goes to the chamber.`)}>
                          <strong>Put forward</strong>
                        </button>
                      ) : null}
                    </div>
                  </DashboardCard>
                );
              })}
            </div>
            {view.youMayVeto && drafted ? (
              <button className="dashboard-ghost-button agenda-veto-btn" type="button" disabled={busy} onClick={() => act(() => api.vetoAgenda(view.scope), `You vetoed ${drafted.title}.`)}>
                ⛔ Veto {drafted.title} (one per term)
              </button>
            ) : null}
          </>
        ) : view.phase === "voting" ? (
          <h3>{drafted ? `"${drafted.title}" is before the chamber — cast your vote below.` : "The chamber is in session."}</h3>
        ) : (
          <p className="dashboard-todo">No measure is in session.</p>
        )}
        <TreasuryCard treasury={view.treasury} />
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// The league agenda + treasury for the council tab; lazily fetched.
function LeagueAgendaSection({ onRefresh }: { onRefresh: () => void }) {
  const [view, setView] = useState<AgendaView | null>(null);
  const load = useCallback(() => { api.agenda().then(setView).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onRefresh(); };
  if (!view) return null;
  return <AgendaScopeSection view={view.league} onRefresh={refresh} />;
}

// The party government for the party tab: its treasury, agenda, and for-life leaders.
function PartyGovernmentSection({ party, onRefresh }: { party: "palaioi" | "dynatoi"; onRefresh: () => void }) {
  const [view, setView] = useState<AgendaView | null>(null);
  const load = useCallback(() => { api.agenda().then(setView).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onRefresh(); };
  if (!view) return null;
  const leaders = view.leaders.filter((l) => l.party === party);
  return (
    <>
      <div className="panel-label">Party leadership</div>
      <div className="party-leaders">
        {leaders.map((l) => (
          <PersonRow
            key={l.office}
            name={l.holder ? l.holder.name : "— vacant —"}
            nameSuffix={<span className="person-suffix"> · {l.office === "party_archon" ? "Party Archon" : "Party Ephor"}</span>}
            role={l.youHold ? "You hold this seat (for life)" : "For life · barred from league office"}
            traits={l.youHold ? [{ label: "You", tone: "good" }] : []}
          />
        ))}
      </div>
      <AgendaScopeSection view={view[party]} onRefresh={refresh} />
    </>
  );
}

export default function PoliticsPanel({ player, onRefresh }: PanelProps) {
  const [tab, setTab] = useState<"council" | "party">("council");
  const [note, setNote] = useState("");
  const censureSeconds = useCountdownSeconds(player.censured ? player.censureExpiresAt : null);
  const joined = player.party !== "Unaligned";

  const join = async (slug: "dynatoi" | "palaioi") => {
    setNote("");
    try {
      await api.joinParty(slug);
      onRefresh();
    } catch (error) {
      setNote(error instanceof ApiError ? error.message : "Could not join the party. Try again.");
    }
  };
  const leave = async () => {
    setNote("");
    try {
      await api.leaveParty();
      onRefresh();
    } catch (error) {
      setNote(error instanceof ApiError ? error.message : "Could not leave the party. Try again.");
    }
  };

  return (
    <section className="dashboard-panel" aria-labelledby="politics-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Assembly</p>
        <h1 id="politics-title">Politics</h1>
        <p>The Oligarchy Council rules the League — and two parties fight to steer it.</p>
      </div>

      <div className="cs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "council"} className={`cs-tab${tab === "council" ? " on" : ""}`} onClick={() => setTab("council")}>
          Oligarchy Council
        </button>
        <button type="button" role="tab" aria-selected={tab === "party"} className={`cs-tab${tab === "party" ? " on" : ""}`} onClick={() => setTab("party")}>
          Your Party {joined ? <span className="party-tab-tag">{PARTY_ICON[player.party.toLowerCase()] ? <AssetIcon file={PARTY_ICON[player.party.toLowerCase()]!} alt="" className="asset-icon party-icon" /> : null} · {player.party}</span> : <span className="party-tab-lock" aria-label="locked">🔒</span>}
        </button>
      </div>

      {tab === "council" ? (
        <div className="pol-page">
          <OligarchySection player={player} onRefresh={onRefresh} />
          <LeagueAgendaSection onRefresh={onRefresh} />
          <OfficesSection player={player} onRefresh={onRefresh} />
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      ) : joined ? (
        <div className="pol-page">
          <PanelBanner
            scene={`the ${player.party} hall`}
            art={assetPath(player.party === "Dynatoi" ? "assets/DYNATOI READY.png" : "assets/PALAIOI READY.png")}
            className={player.party === "Dynatoi" ? "banner-reform" : "banner-cons"}
          />
          {player.censured ? (
            <div className="censure-banner" role="alert">
              <span className="censure-ic" aria-hidden="true">⚠️</span>
              <div>
                <strong>Under censure</strong>
                <p>
                  Your ideology has drifted from the {player.party}. Return to at least 10% {player.party === "Dynatoi" ? "Reformist" : "Traditionalist"} within{" "}
                  <b>{formatDuration(censureSeconds)}</b> or you will be expelled (and branded a turncoat).
                </p>
              </div>
            </div>
          ) : null}
          <PartyGovernmentSection party={player.party.toLowerCase() === "dynatoi" ? "dynatoi" : "palaioi"} onRefresh={onRefresh} />
          <div className="court-grid">
            <div>
              <div className="panel-label">Party news</div>
              <DigestList items={partyNews} />
              <div className="panel-label">Membership</div>
              <div className="pol-aside">
                <div className="mini-office">
                  <div>
                    <div className="mo-t">Your standing</div>
                    <div className="mo-s">Member of the {player.party}</div>
                  </div>
                  <span className="pr-lvl">—</span>
                </div>
                <div className="mini-office">
                  <div>
                    <div className="mo-t">Leave the {player.party}</div>
                    <div className="mo-s">{player.censured ? "Blocked while under censure" : "Defecting brands you a turncoat"}</div>
                  </div>
                  <button type="button" className="panel-btn ghost" onClick={leave} disabled={player.censured}>Leave</button>
                </div>
              </div>
            </div>
          </div>
          <p className="dashboard-todo">TODO: party matters and news are placeholder; joining and leaving are real (players.party).</p>
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      ) : (
        <div className="pol-page">
          <div className="panel-label">Choose your side</div>
          <p className="pol-intro">
            Your ideology is <b>{ideologyReadout(player.ideology)}</b>. Joining a party requires at least 10% ideology toward its side — and drifting 10% toward the other side will see you expelled.
          </p>
          <div className="panel-grid2">
            {partyOptions.map((option) => {
              const qualifies = option.slug === "dynatoi" ? player.ideology >= 10 : player.ideology <= -10;
              const canJoin = qualifies && !player.censured;
              const pct = option.slug === "dynatoi" ? Math.max(0, player.ideology) : Math.max(0, -player.ideology);
              return (
                <div className={`party-pick${option.consClass ? " cons" : ""}`} key={option.slug}>
                  <div
                    className="party-banner"
                    style={{
                      backgroundImage: `url("${assetPath(option.consClass ? "assets/PALAIOI READY.png" : "assets/DYNATOI READY.png")}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <div className="party-body">
                    <div className="party-greek">{option.greek}</div>
                    <div className="party-name">{option.name}</div>
                    <p className="party-pitch">{option.pitch}</p>
                    <button
                      type="button"
                      className={`panel-btn${canJoin ? "" : " ghost"}`}
                      disabled={!canJoin}
                      onClick={() => join(option.slug)}
                    >
                      Join the {option.name}
                    </button>
                    <div className="party-req">
                      {qualifies
                        ? `You qualify — ${pct}% ${option.side} (needs 10%)`
                        : `Requires 10% ${option.side} — you are ${ideologyReadout(player.ideology)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="dashboard-todo">
            Join eligibility uses your real ideology. Drift out of range while a member and you are censured for 3 days, then expelled if you do not return.
          </p>
          {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The Player Chronicle (Timeline).
// ---------------------------------------------------------------------------
